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
 * - `aria-label`s use straight double quotes (`"`) — §7.4.
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
export const NEW_TODO_LABEL = "New todo";
export const ACCOUNT_MENU_LABEL = "Account menu";
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
