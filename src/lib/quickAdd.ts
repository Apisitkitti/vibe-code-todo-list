import dayjs from "dayjs";
import customParseFormat from "dayjs/plugin/customParseFormat";

import { formatDueDate } from "./date";
import {
  DEFAULT_PRIORITY,
  DUE_DATE_FORMAT,
  PRIORITY_LABELS,
  PRIORITY_VALUES,
  type TodoPriority,
} from "./todo";

dayjs.extend(customParseFormat);

/**
 * The quick-add bar's parser: one line of typed text to the same
 * `{ title, dueAt, priority }` the create form already produces.
 *
 * **Four rules, and every one of them exists to stop the parser eating a
 * title.** A parser that lifts a word the user meant literally is worse than
 * no parser (`docs/PM-PROPOSAL.md` §2), and every such failure is silent — the
 * todo saves, the toast says it saved, and the title is simply short by a
 * word. So:
 *
 *  1. **Only the tail is ever read.** Words are consumed right-to-left and the
 *     scan stops at the first word that is not vocabulary. `high priority
 *     handover` keeps every word, because the scan meets `handover` and stops
 *     before it can reach `high`. This is what makes the parse predictable
 *     enough to describe in one sentence: *trailing words that name a day or a
 *     priority are lifted out*.
 *  2. **The title is never emptied.** A consumption that would leave no words
 *     behind is refused, so `tomorrow` alone is a todo called "tomorrow",
 *     `high` alone is a todo called "high", and `next week` alone is a todo
 *     called "next week". A user who types only the word always gets it
 *     literally, with no recovery step.
 *  3. **Lowercase only, whole words only.** `friday` is a day; `Friday` is
 *     part of a name. This is the rule that keeps `Casual Friday`,
 *     `Black Friday`, `Cyber Monday`, `Palm Sunday` and `Ash Wednesday` intact,
 *     and it is a stronger guarantee than the chips are: a capital letter
 *     means the parse never fires at all, so there is nothing to notice and
 *     nothing to undo. It also hands the user a second escape hatch that costs
 *     one keystroke — hold shift and the word is yours.
 *
 *     It was case-*insensitive* in the first cut of this module, and the doc
 *     claimed otherwise. The doc was right and the code was wrong: a capital
 *     is exactly the signal that a weekday is part of a proper noun, and
 *     throwing that signal away to be accommodating is how `Black Friday`
 *     becomes `Black`.
 *  4. **The vocabulary is small, closed and exact.** Whole words, so
 *     `Highlight` is not `high`, `mondays` is not `monday`, `tomorrow!` is not
 *     `tomorrow`, `in three days` is not `in 3 days`, `count the 3 days` has
 *     no `in` to anchor it, `next friday` is not `next week`, and `2026-2-5`
 *     is not a date. Refusing to be clever is the feature; a near-miss that
 *     fires is the defect — and a phrase that half-matches is the worst of
 *     them, because it strands the half it did not read in the title.
 *
 * **Releasing a word puts it back without changing anything else** (review
 * B-1). A released kind is still *matched* — it has to be, or the scan would
 * stop at the unconsumed word and everything to its left would become
 * unreachable, silently reverting a reading the user never asked to undo. So a
 * released run is stepped over: its words stay in the title and the scan
 * carries on past them. `Call mum about high tomorrow`, releasing the date,
 * gives the title `Call mum about tomorrow` with priority `high` — the date
 * back, the priority untouched.
 *
 * The other half of that guarantee is that a release can never make the parser
 * take *more* than it took before: words handed back to the title are not
 * budget for rule 2 (`canLift`, review RB-1).
 *
 * The output is deliberately the existing contract: `dueAt` is the
 * `YYYY-MM-DD` wire format `todoFormSchema` and `parseDueDate` already own, so
 * nothing downstream of the bar knows this module exists.
 */

/**
 * Lowercase, and compared with `===`. See rule 3 — the capital is the user
 * telling us the word is part of a name.
 */
const WEEKDAY_NAMES = [
  "sunday",
  "monday",
  "tuesday",
  "wednesday",
  "thursday",
  "friday",
  "saturday",
] as const;

const DAYS_IN_WEEK = 7;

/**
 * The ceiling on `in N days`. Not a validation rule so much as a refusal to
 * take `in 99999 days` seriously — beyond a year the user means a date, and
 * `YYYY-MM-DD` is in the vocabulary for exactly that.
 */
const MAX_RELATIVE_DAYS = 365;

export type QuickAddTokenKind = "due" | "priority";

export interface QuickAddToken {
  kind: QuickAddTokenKind;
  /** The words consumed, exactly as typed — what "keep it" puts back. */
  text: string;
  /** Chip wording, from the copy deck (`docs/DESIGN.md` §7.17). */
  label: string;
}

export interface QuickAddResult {
  title: string;
  /** `YYYY-MM-DD` or `""` — the wire format the schema already takes. */
  dueAt: string;
  priority: TodoPriority;
  /** Left to right, in the order the words appear. Empty when nothing fired. */
  tokens: QuickAddToken[];
  /**
   * The trailing words the scan actually read — lifted *and* stepped over —
   * normalised the way the parser normalises, and empty when nothing was read.
   *
   * This is rule 1 stated as a value: everything to the left of it is title
   * the parser never looked at. It is what a refusal is keyed to, so that an
   * edit the reading cannot see cannot revoke that refusal (`QuickAddRelease`).
   */
  tail: string[];
}

export interface QuickAddOptions {
  /** Injected by the tests; "tomorrow" is a fact about the reader's clock. */
  now?: Date;
  /**
   * Kinds the user asked to keep as literal text. A released kind is matched
   * and stepped over rather than skipped, so releasing one never costs the
   * other — see the note on B-1 above.
   */
  release?: readonly QuickAddTokenKind[];
}

interface DueMatch {
  /** How many trailing words this matched. */
  length: number;
  dueAt: string;
}

interface PriorityMatch {
  length: number;
  priority: TodoPriority;
}

/** Rule 3: no case folding anywhere. `===` against a lowercase table. */
const isPriorityWord = (word: string): word is TodoPriority =>
  (PRIORITY_VALUES as readonly string[]).includes(word);

const isWeekdayName = (word: string) =>
  (WEEKDAY_NAMES as readonly string[]).includes(word);

/**
 * Days are the user's own calendar days, not UTC ones — the same "today" the
 * list's sections are cut against (`src/lib/date.ts`). Formatting to
 * `YYYY-MM-DD` here is what keeps the picker, the parser and the API speaking
 * one format.
 */
const toDayString = (value: dayjs.Dayjs) => value.format(DUE_DATE_FORMAT);

/**
 * The date half of the vocabulary, longest phrase first so `in 3 days` is not
 * mistaken for a bare `days`.
 *
 * A weekday name means the *next* one strictly ahead: typing `tuesday` on a
 * Tuesday means the Tuesday coming, not the one you are standing in. Anything
 * else would let a single word mean "today" without saying so.
 */
const matchDue = (words: readonly string[], now: Date): DueMatch | null => {
  const today = dayjs(now).startOf("day");
  const last = words[words.length - 1] ?? "";
  const previous = words[words.length - 2] ?? "";
  const beforePrevious = words[words.length - 3] ?? "";

  // Digits only, deliberately: "in three days" is not vocabulary and must not
  // half-match into a lost word. The `in` is a required anchor — without it
  // "count the 3 days" would parse.
  if (
    beforePrevious === "in" &&
    /^\d{1,3}$/.test(previous) &&
    (last === "day" || last === "days")
  ) {
    const days = Number(previous);

    if (days <= MAX_RELATIVE_DAYS) {
      return { length: 3, dueAt: toDayString(today.add(days, "day")) };
    }
  }

  if (previous === "next" && last === "week") {
    return { length: 2, dueAt: toDayString(today.add(DAYS_IN_WEEK, "day")) };
  }

  /*
    `next week` is the only phrase beginning `next`. Anything else — the very
    plausible `next friday`, and `next month`, `next year` — is not
    vocabulary, and matching only its last word would leave `next` stranded in
    the title: `ship the deck next friday` would become a todo called "ship
    the deck next". Refusing here keeps the whole phrase literal, which is
    what rule 4 promises, and it can only ever keep more words than it takes.
  */
  if (previous === "next") return null;

  // `tonight` is today: the app stores a day, not an hour, and pretending
  // otherwise would be a promise the schema cannot keep.
  if (last === "today" || last === "tonight") {
    return { length: 1, dueAt: toDayString(today) };
  }

  if (last === "tomorrow") {
    return { length: 1, dueAt: toDayString(today.add(1, "day")) };
  }

  if (isWeekdayName(last)) {
    const ahead =
      (WEEKDAY_NAMES.indexOf(last as (typeof WEEKDAY_NAMES)[number]) -
        today.day() +
        DAYS_IN_WEEK) %
        DAYS_IN_WEEK || DAYS_IN_WEEK;

    return { length: 1, dueAt: toDayString(today.add(ahead, "day")) };
  }

  // Strict, like `parseDueDate`: "2026-02-31" is not a date and stays a word,
  // and neither is "2026-2-5" — the shape is exact, not merely date-ish.
  const explicit = dayjs(last, DUE_DATE_FORMAT, true);

  if (explicit.isValid()) return { length: 1, dueAt: toDayString(explicit) };

  return null;
};

const matchPriority = (words: readonly string[]): PriorityMatch | null => {
  const last = words[words.length - 1] ?? "";

  return isPriorityWord(last) ? { length: 1, priority: last } : null;
};

export const parseQuickAdd = (
  input: string,
  { now = new Date(), release = [] }: QuickAddOptions = {},
): QuickAddResult => {
  const released = new Set<QuickAddTokenKind>(release);
  const trimmed = input.trim();
  const words = trimmed === "" ? [] : trimmed.split(/\s+/);

  const tokens: QuickAddToken[] = [];
  /** Word indices lifted out of the title. Released runs are never in here. */
  const lifted = new Set<number>();

  let dueAt = "";
  let priority: TodoPriority = DEFAULT_PRIORITY;
  let hasDue = false;
  let hasPriority = false;
  /** How far right-to-left the scan has walked. */
  let cursor = words.length;
  /** Words a release put back. They are the user's, and cannot be spent. */
  let steppedOver = 0;

  /**
   * Rule 2, as one predicate: a run may only be lifted if at least one word is
   * left over that the parser has not already been told to keep its hands off.
   *
   * **`steppedOver` is subtracted, and leaving it out was review RB-1.** A
   * released run stays in the title, so counting it as a survivor freed the
   * budget for a lift the unreleased parse had refused — and a release could
   * then make the parser take *more* words than before, which is the exact
   * opposite of what pressing the chip asks for. `high tomorrow` reads as
   * title `high` due tomorrow; pressing "keep tomorrow in the title" used to
   * give a todo titled `tomorrow` with priority High, having eaten the word
   * the user never touched.
   *
   * The rule that fixes it states the intent directly: **words handed back to
   * the title are not budget.** Rule 2 then means what it always said — at
   * least one word survives that the user did not have to rescue.
   */
  const canLift = (length: number) =>
    words.length - lifted.size - steppedOver - length >= 1;

  const lift = (length: number) => {
    for (let index = cursor - length; index < cursor; index += 1) {
      lifted.add(index);
    }
  };

  const runText = (length: number) =>
    words.slice(cursor - length, cursor).join(" ");

  while (cursor > 0) {
    let matched = 0;

    if (!hasPriority) {
      const match = matchPriority(words.slice(0, cursor));

      if (match) {
        if (released.has("priority")) {
          // Matched, and deliberately stepped over: the scan has to get past
          // it to reach whatever is further left (B-1).
          hasPriority = true;
          steppedOver += match.length;
          matched = match.length;
        } else if (canLift(match.length)) {
          tokens.unshift({
            kind: "priority",
            text: runText(match.length),
            label: `${PRIORITY_LABELS[match.priority]} priority`,
          });
          lift(match.length);
          hasPriority = true;
          priority = match.priority;
          matched = match.length;
        }
      }
    }

    if (matched === 0 && !hasDue) {
      const match = matchDue(words.slice(0, cursor), now);

      if (match) {
        if (released.has("due")) {
          hasDue = true;
          steppedOver += match.length;
          matched = match.length;
        } else if (canLift(match.length)) {
          tokens.unshift({
            kind: "due",
            text: runText(match.length),
            label: `Due ${formatDueDate(match.dueAt, now).label}`,
          });
          lift(match.length);
          hasDue = true;
          dueAt = match.dueAt;
          matched = match.length;
        }
      }
    }

    // Rule 1: the first word that is not vocabulary ends the scan.
    if (matched === 0) break;

    cursor -= matched;
  }

  return {
    title: words.filter((_, index) => !lifted.has(index)).join(" "),
    dueAt,
    priority,
    tokens,
    // Where the scan stopped: rule 1's boundary, as words.
    tail: words.slice(cursor),
  };
};

/**
 * A refusal, and the reading it was made against.
 *
 * Keyed to `tail` — the words the parse read — and to nothing else, because
 * nothing else can change the reading: only trailing words are ever read
 * (rule 1), and whitespace is not a word at all. So a typo fixed to the left,
 * a word inserted there, a trailing space and a doubled space all leave the
 * refusal standing, and a different tail word ends it (QA DEF-22).
 *
 * **A lapsed refusal does not come back**, which is the other half of the rule
 * and lives in the bar rather than here: `releaseAfterEdit` is applied to every
 * edit, so once the text leaves the reading the refusal is gone for good. That
 * is what makes a retyped line a new line — to retype a line you must first
 * leave the reading — and it is what keeps review B-2's guarantee that a
 * refusal never outlives the text it was made against. Without it the refusal
 * would simply reappear when the new line happened to end in the same word: no
 * chip, no date and no signal, which is the silently disabled parser B-2 was
 * filed about and is worse than an unwanted chip.
 *
 * **The residual, stated rather than papered over:** a single edit that
 * replaces the line without ever passing through a state that leaves the
 * reading — a paste, in practice — keeps the refusal. No comparison of two
 * texts can tell that from an edit to the left of the tail, because the two
 * results are the same text; only the path differs, and a paste has no path. A
 * submit clears the refusal outright (`clearTo`), so it cannot reach the next
 * todo.
 */
export interface QuickAddRelease {
  /** The reading refused, as `QuickAddResult.tail` had it. */
  tail: readonly string[];
  kinds: readonly QuickAddTokenKind[];
}

export const NO_RELEASE: QuickAddRelease = { tail: [], kinds: [] };

/** The parser's own normalisation, and the only unit any of this compares in. */
const toWords = (text: string): string[] => {
  const trimmed = text.trim();

  return trimmed === "" ? [] : trimmed.split(/\s+/);
};

/** Whether `text` still ends in the words the refusal was made against. */
const stillReads = (release: QuickAddRelease, text: string) => {
  const { tail, kinds } = release;

  if (kinds.length === 0 || tail.length === 0) return false;

  const words = toWords(text);
  const offset = words.length - tail.length;

  if (offset < 0) return false;

  return tail.every((word, index) => word === words[offset + index]);
};

/**
 * Records a refusal of `kinds` against what `text` currently reads as.
 *
 * The tail is taken from the parse *under* the refusal, because that is the
 * reading the user is now looking at: a released run is stepped over rather
 * than skipped, so refusing one kind can let the scan reach further left (B-1).
 */
export const releaseAgainst = (
  text: string,
  kinds: readonly QuickAddTokenKind[],
  options: QuickAddOptions = {},
): QuickAddRelease => ({
  tail: parseQuickAdd(text, { ...options, release: kinds }).tail,
  kinds: [...new Set(kinds)],
});

/**
 * The refusal after an edit: itself while the reading is still there, and
 * `NO_RELEASE` the moment it is not.
 *
 * **One-way.** Applied to every edit, this is what stops a refusal reappearing
 * because the line was retyped to end in the same word — see `QuickAddRelease`.
 */
export const releaseAfterEdit = (
  release: QuickAddRelease,
  text: string,
): QuickAddRelease => (stillReads(release, text) ? release : NO_RELEASE);

/** The kinds refused for `text` right now. Empty once the reading has gone. */
export const heldRelease = (
  release: QuickAddRelease,
  text: string,
): readonly QuickAddTokenKind[] =>
  stillReads(release, text) ? release.kinds : [];
