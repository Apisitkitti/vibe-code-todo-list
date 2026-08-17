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
 *     no `in` to anchor it, and `2026-2-5` is not a date. Refusing to be
 *     clever is the feature; a near-miss that fires is the defect.
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

  /**
   * Rule 2, as one predicate: a run may only be lifted if at least one word is
   * left over. Released runs never ask, because they lift nothing.
   */
  const canLift = (length: number) =>
    words.length - lifted.size - length >= 1;

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
  };
};
