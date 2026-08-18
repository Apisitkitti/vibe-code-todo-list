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
export const EDIT_MODAL_HEADING = "Edit todo";

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

/** §7.16 — the list's section headings, in the order the list shows them. */
export const OVERDUE_HEADING = "Overdue";
export const TODAY_HEADING = "Today";
export const UPCOMING_HEADING = "Upcoming";
export const NO_DATE_HEADING = "No date";
export const COMPLETED_HEADING = "Completed";
export const GROUP_HEADINGS_IN_ORDER = [
  OVERDUE_HEADING,
  TODAY_HEADING,
  UPCOMING_HEADING,
  NO_DATE_HEADING,
  COMPLETED_HEADING,
];

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
