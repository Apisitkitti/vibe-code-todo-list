/**
 * Every user-visible string this suite asserts on, traced to the copy deck in
 * `docs/DESIGN.md` §7. Nothing here is invented: if a test needs wording that
 * is not in the deck, the deck is what should change.
 *
 * Quote characters are load-bearing and are NOT interchangeable:
 *
 * - Toast and dialog prose wrap the title in curly double quotes (`“ ”`) and
 *   use the typographic apostrophe in contractions (`Couldn’t`) — §7.15's
 *   punctuation note.
 * - §7.4's row controls build their `aria-label` from the raw title, so those
 *   use straight double quotes (`"`).
 * - The one exception is `undoActionLabel` below, whose `aria-label` borrows a
 *   toast's own prose rather than inventing a second wording — so it carries
 *   that prose's curly quotes. Naming what the button reverses is worth more
 *   than a uniform quote character; the alternative was a second copy deck to
 *   keep in step with the first.
 *
 * Asserting the wrong one is the difference between a passing test and a test
 * that silently matches nothing, so the two shapes are built by separate
 * helpers below rather than by hand at each call site.
 */

/** Curly-quoted title, for toasts and dialog body prose (§7.11, §7.15). */
export const quoted = (title: string) => `“${title}”`;

/** Straight-quoted title, for `aria-label`s only (§7.4). */
export const ariaQuoted = (title: string) => `"${title}"`;

/** §7.3 */
export const PAGE_HEADING = "Your todos";

/**
 * §7.3 — the counter beside the heading.
 *
 * It describes the **account**, not the filtered page (`GET /api/todos`
 * computes both counts without the filter clauses), so a filter never moves
 * it and a toggle moves the first number by exactly one — including when the
 * row it describes has just left the filtered list (`docs/PRD.md` US-07).
 */
export const doneCount = (done: number, total: number) =>
  `${done} of ${total} done`;

/**
 * §7.17 / §7.18 — the quick-add bar, which replaced the `New todo` toolbar
 * button as the primary capture path. The modal is still reachable, from
 * `More options`, and that is what `openCreate` now presses.
 */
export const QUICK_ADD_LABEL = "Add a todo";
export const QUICK_ADD_PLACEHOLDER = 'Add a todo — try "pay rent friday high"';
/*
  Written out rather than built from `QUICK_ADD_EXAMPLE` below, and that is the
  point: the app builds *both* of its two showings from one constant, so a test
  that also shared one string could not catch the two drifting apart. This is
  the independent copy.
*/
export const QUICK_ADD_SUBMIT_LABEL = "Add";
export const MORE_OPTIONS_LABEL = "More options";
export const CHIP_GROUP_LABEL = "Read from your text";
export const CHIP_HINT = "Press Esc to keep your text exactly as typed.";
export const EMPTY_STATE_ACTION_LABEL = "Add a todo";
export const keepInTitleLabel = (label: string, words: string) =>
  `${label} — keep ${ariaQuoted(words)} in the title`;
export const dueChipLabel = (day: string) => `Due ${day}`;
export const priorityChipLabel = (priority: string) => `${priority} priority`;

/** §7.17 — the receipt when the new todo is outside the current filter. */
export const addedHiddenToast = (title: string) =>
  `Todo ${quoted(title)} added — hidden by your filters`;
export const ACCOUNT_MENU_LABEL = "Account menu";

/**
 * §7.3 / §7.10 — the status filter.
 *
 * It renders as react-aria's `ToggleButtonGroup` in single-selection mode,
 * which is a `role="radiogroup"` of `role="radio"` buttons, *not* a group of
 * buttons — `getByRole("button")` matches none of them. The group's own
 * `aria-label` is the only handle that distinguishes it from the priority
 * filter beside it.
 */
export const STATUS_FILTER_ARIA_LABEL = "Filter todos by status";
export const STATUS_FILTER_LABELS = {
  all: "All",
  active: "Active",
  completed: "Completed",
} as const;
export const SIGN_OUT_LABEL = "Sign out";

/** §7.1 / §7.2 */
export const SIGN_IN_HEADING = "Welcome back";
export const SIGN_UP_HEADING = "Create your account";
export const CREATE_ACCOUNT_LABEL = "Create account";
export const SIGN_IN_LABEL = "Sign in";

/** §7.5 */
export const ADD_TODO_LABEL = "Add todo";
export const SAVE_CHANGES_LABEL = "Save changes";
export const TITLE_FIELD_LABEL = "Title";
export const CREATE_MODAL_HEADING = "New todo";

/**
 * The edit dialog names its record (§7.5).
 *
 * Spelled out here for the untruncated case, which is every existing caller —
 * the bound is 45 characters and these titles are short. **The truncation is
 * deliberately not reproduced in this deck**: importing the app's own
 * `truncateForAnnouncement` would make any assertion built on it agree with the
 * code by construction, and could not catch a wrong bound. The long case is
 * asserted against literal expected strings in
 * `e2e/edit-dialog-name.spec.ts`.
 */
export const editModalHeading = (title: string) => `Edit “${title}”`;

/** §7.6 — the delete confirm, the one mutation that still asks. */
export const DELETE_CONFIRM_HEADING = "Delete this todo?";
export const DELETE_CONFIRM_ACTION = "Delete";
export const CANCEL_LABEL = "Cancel";
export const deleteConfirmBody = (title: string) =>
  `${quoted(title)} will be permanently deleted. This can’t be undone.`;

/** §7.4 — row controls. `aria-label`s, so straight quotes. */
export const editLabel = (title: string) => `Edit ${ariaQuoted(title)}`;
export const deleteLabel = (title: string) => `Delete ${ariaQuoted(title)}`;
export const markCompleteLabel = (title: string) =>
  `Mark ${ariaQuoted(title)} as complete`;
export const markNotCompleteLabel = (title: string) =>
  `Mark ${ariaQuoted(title)} as not complete`;
export const EDIT_TOOLTIP = "Edit";
export const DELETE_TOOLTIP = "Delete";

/**
 * §7.21 — the reschedule menu (backlog #5).
 *
 * The trigger's name is built the same way Edit's and Delete's are — straight
 * quotes, because it is an `aria-label` — and the menu borrows it, so a screen
 * reader hears which todo the open menu belongs to rather than five unlabelled
 * items.
 */
export const rescheduleLabel = (title: string) => `Reschedule ${ariaQuoted(title)}`;
export const RESCHEDULE_TOOLTIP = "Reschedule";
export const TODAY_ITEM_LABEL = "Today";
export const TOMORROW_ITEM_LABEL = "Tomorrow";
export const NEXT_WEEK_ITEM_LABEL = "Next week";
export const PICK_A_DATE_ITEM_LABEL = "Pick a date…";
export const CLEAR_DUE_DATE_ITEM_LABEL = "Clear due date";

/** §7.21 — what a reschedule reports, and what its Undo reports when it lands. */
export const dueToast = (title: string, dayLabel: string) =>
  `Todo ${quoted(title)} due ${dayLabel}`;
export const dueClearedToast = (title: string) =>
  `Todo ${quoted(title)} due date cleared`;
export const RESCHEDULE_FAILURE = "Couldn’t change the due date. Try again.";

/** §7.11 / §7.15 — success toasts. All name the record. */
export const addedToast = (title: string) => `Todo ${quoted(title)} added`;
export const updatedToast = (title: string) => `Todo ${quoted(title)} updated`;
export const deletedToast = (title: string) => `Todo ${quoted(title)} deleted`;
export const markedCompleteToast = (title: string) =>
  `Todo ${quoted(title)} marked complete`;
export const markedNotCompleteToast = (title: string) =>
  `Todo ${quoted(title)} marked not complete`;

/** §7.15 — what an Undo reports when it succeeds. */
export const removedToast = (title: string) => `Todo ${quoted(title)} removed`;
export const restoredToast = (title: string) => `Todo ${quoted(title)} restored`;

/** §7.13 / §7.15 */
export const UNDO_LABEL = "Undo";

/**
 * §7.13 — the Undo button's accessible name.
 *
 * The visible word is `Undo` on every toast in the stack, so the name a screen
 * reader announces is the only thing that separates a completion-revert from an
 * `added` toast's Undo, which is a `DELETE`. Built from the toast's own title
 * for the same reason the app builds it that way: one wording, not two.
 */
export const undoActionLabel = (toastTitle: string) =>
  `${UNDO_LABEL} — ${toastTitle}`;
export const UNDO_FAILURE = "Couldn’t undo that. Try again.";

/**
 * §7.5 / §7.6 / §7.9 — mutation failure copy.
 *
 * These are the *fallbacks* `getErrorMessage` uses when the failing response
 * carries no readable `message`. When the API's own error body comes back
 * intact, the user sees `INTERNAL_ERROR_MESSAGE` instead — the two cases are
 * asserted separately in the fault-injection spec.
 */
export const CREATE_FAILURE = "Couldn’t add the todo. Try again.";
export const EDIT_FAILURE = "Couldn’t save your changes. Try again.";
export const TOGGLE_FAILURE = "Couldn’t update the todo. Try again.";
export const DELETE_FAILURE = "Couldn’t delete the todo. Try again.";

/** `src/lib/apiError.ts` — the default message on every `INTERNAL` response. */
export const INTERNAL_ERROR_MESSAGE = "Something went wrong on our end.";

/** `src/lib/apiError.ts` — the default message on every `UNAUTHORIZED`. */
export const UNAUTHORIZED_MESSAGE = "Sign in again to continue.";

/** §7.9 — the list's error slot. */
export const LIST_ERROR_TITLE = "Couldn’t load your todos";
export const TRY_AGAIN_LABEL = "Try again";

/** §7.7 — empty states. */
export const EMPTY_HEADING = "Nothing here yet";
export const NO_MATCHES_HEADING = "No matches";
/**
 * The heading `resolveEmptyState` reaches for when a status or priority filter
 * matches none of the account's todos — the longest of the five, and the only
 * one that wraps inside the 320px this app supports.
 */
export const NO_MATCHING_FILTERS_HEADING = "No todos match these filters";

/**
 * §7.18 "Empty state teaching line" / §7.7 — the one worked example of the
 * quick-add vocabulary, and the one line that teaches it.
 *
 * The example is shared with the bar's placeholder in the app (`QUICK_ADD_EXAMPLE`
 * in `src/app/todos/constants`), so it is written out once here too — a test
 * that hard-coded a second example would pass while the product taught two.
 *
 * Curly quotes: this is prose in an empty state, so §7.19's punctuation note
 * applies, where the placeholder is a field hint and uses straight quotes. The
 * two are not interchangeable and asserting the wrong one silently matches
 * nothing.
 */
export const QUICK_ADD_EXAMPLE = "pay rent friday high";
export const EMPTY_STATE_SYNTAX_HINT = `A day and a priority at the end are read — ${quoted(QUICK_ADD_EXAMPLE)} becomes ${quoted("pay rent")}, due Friday, High priority.`;

/**
 * §6.4 — the words that carry a level or a state where colour otherwise would,
 * and the glyphs that duplicate them in ink.
 *
 * These are separated from the headings below because they are asserted through
 * `expectWording`, which asks *who the word is for* rather than merely whether
 * it is in the DOM. Each constant below is the string as a single text node
 * renders it, because that is what `expectWording` matches — `PRIORITY_PREFIX`
 * and the level word are two nodes in the chip and one node on an untriaged
 * row, and the two cases are asserted differently for that reason.
 */

/** The chip's `sr-only` prefix (`PriorityChip`). Trailing space is real. */
export const PRIORITY_PREFIX = "Priority: ";

/** §8.4.2 — the level words. Mirrors `PRIORITY_FILTER_LABELS` in the app. */
export const PRIORITY_WORDS = { high: "High", low: "Low" } as const;

/**
 * The whole announcement on an untriaged row, which `PriorityChip` renders as
 * one node because that level draws no chip — `§4.4`'s trade, where the
 * announcement carries the level alone.
 */
export const MEDIUM_PRIORITY_ANNOUNCEMENT = "Priority: Medium";

/** §4.4 / §6.4 — the shape glyphs, `aria-hidden` beside the word they echo. */
export const PRIORITY_GLYPH_WORDS = { high: "▲", low: "▼" } as const;

/**
 * §6.4 — the overdue step's non-colour half, both of it. `TodoDueDate` renders
 * an `aria-hidden` `⚠` for the eye and a visually-hidden `Overdue — ` for the
 * ear, and the audit killed neither: `D1` gutted the prefix and survived 57
 * tests, `D3` deleted the glyph and survived 50.
 *
 * The dash is an em dash (U+2014) with a space on each side, and the trailing
 * space is part of the string the component emits. Asserting a hyphen here
 * silently matches nothing.
 */
export const OVERDUE_ANNOUNCEMENT = "Overdue — ";
export const OVERDUE_GLYPH = "⚠";

/** §7.16 — the list's section headings, in the order the list shows them. */
export const OVERDUE_HEADING = "Overdue";
export const TODAY_HEADING = "Today";
export const UPCOMING_HEADING = "Upcoming";
export const NO_DATE_HEADING = "No date";
export const COMPLETED_HEADING = "Completed";
/**
 * §7.16 — a heading's **rendered text**, which carries the section count:
 * `Overdue · 3`. Separator is `·` per §7.18's punctuation note.
 *
 * Deliberately separate from the constants above, and both are needed. The
 * count is `aria-hidden`, so a heading's *accessible name* is still the bare
 * string — `getByRole("heading", { name: OVERDUE_HEADING })` keeps matching —
 * while `toHaveText` reads the text content and sees the count. Asserting the
 * wrong one of the two would pass for the wrong reason.
 */
export const sectionHeadingText = (heading: string, count: number) =>
  `${heading} · ${count}`;

export const GROUP_HEADINGS_IN_ORDER = [
  OVERDUE_HEADING,
  TODAY_HEADING,
  UPCOMING_HEADING,
  NO_DATE_HEADING,
  COMPLETED_HEADING,
];

/**
 * US-12 / §7.19 — the dated header line above the list.
 *
 * The date is built here from `Date`'s own parts rather than through dayjs,
 * which is what the app formats it with. That is deliberate: a helper sharing
 * the app's formatter would agree with it by construction and could not catch
 * the app formatting the wrong day. Clauses are joined with `·` per §7.18.
 */
const WEEKDAYS = [
  "Sunday",
  "Monday",
  "Tuesday",
  "Wednesday",
  "Thursday",
  "Friday",
  "Saturday",
];

const MONTHS = [
  "January",
  "February",
  "March",
  "April",
  "May",
  "June",
  "July",
  "August",
  "September",
  "October",
  "November",
  "December",
];

/** `Saturday, 16 August`, in the runner's own local day. */
export const headerDate = (now: Date = new Date()) =>
  `${WEEKDAYS[now.getDay()]}, ${now.getDate()} ${MONTHS[now.getMonth()]}`;

export const headerLine = (...clauses: string[]) =>
  [headerDate(), ...clauses].join(" · ");

export const dueTodayClause = (count: number) => `${count} due today`;
export const overdueClause = (count: number) => `${count} overdue`;

/** Matches the line whatever its clauses, for locating it before reading it. */
export const HEADER_LINE_PATTERN = /^\w+day, \d{1,2} [A-Z][a-z]+/;

/**
 * Raw transport text that must NEVER reach the user. `getErrorMessage`
 * deliberately prefers the copy deck over axios's own `message`, and these are
 * the strings that prove it is still doing so.
 */
export const AXIOS_LEAK_PATTERNS = [
  /Request failed with status code/i,
  /Network Error/i,
  /timeout of \d+ms exceeded/i,
  /AxiosError/i,
  /ERR_[A-Z_]+/,
];

/**
 * §7.20 — the board view (`docs/PRD.md` US-14).
 *
 * The column headings are §7.16's, unchanged and deliberately so: the board is
 * the list's own sections laid out sideways, and a second set of names for the
 * same five groups would be the first sign it had become a second opinion
 * about where a todo belongs.
 */
export const VIEW_TOGGLE_ARIA_LABEL = "Choose a view";
export const LIST_VIEW_LABEL = "List";
export const BOARD_VIEW_LABEL = "Board";

/** §7.20 — what an empty column says, per column. */
export const BOARD_EMPTY_COLUMN = {
  overdue: "Nothing overdue.",
  today: "Nothing due today.",
  upcoming: "Nothing scheduled ahead.",
  "no-date": "Every todo has a date.",
  completed: "Nothing completed yet.",
} as const;

/**
 * §7.20 — the line under the columns, and the one place the app states what
 * §8.8 decided: a drop chooses a column, not a place inside it.
 */
export const BOARD_ORDER_NOTE =
  "Cards are ordered by due date within each column. Dropping a card chooses its column, not its place in it.";
