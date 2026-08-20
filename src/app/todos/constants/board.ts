/** Board view copy (`docs/DESIGN.md` §7.20). */

import type { BoardColumnId } from "@/lib/todoBoard";

export const VIEW_TOGGLE_ARIA_LABEL = "Choose a view";
export const LIST_VIEW_LABEL = "List";
export const BOARD_VIEW_LABEL = "Board";

/**
 * What an empty column says.
 *
 * One line each, in the column's own terms, because a board shows every column
 * whether or not it has cards (`src/lib/todoBoard.ts` → `boardColumns`) and
 * five identical "Nothing here" lines would say nothing at all. `Overdue` and
 * `Today` empty are *good news* and are worded as such; the other three are
 * merely facts.
 */
export const BOARD_COLUMN_EMPTY: Record<BoardColumnId, string> = {
  overdue: "Nothing overdue.",
  today: "Nothing due today.",
  upcoming: "Nothing scheduled ahead.",
  "no-date": "Every todo has a date.",
  completed: "Nothing completed yet.",
};

/**
 * The drag's running commentary, for the live region
 * (`docs/DESIGN.md` §8.8 → "what announces what").
 *
 * These describe the **gesture**; the mutation is reported by the same §7.19
 * toast a menu press raises, so the two never say the same thing twice. A drag
 * that is picked up and put down again writes nothing, and has only these to
 * report it.
 */
export const dragStartedMessage = (title: string, columns: string[]) =>
  columns.length === 0
    ? `Picked up “${title}”. There is nowhere to move it.`
    : `Picked up “${title}”. Drop it on ${columns.join(", ")}.`;

export const dragDroppedMessage = (title: string, column: string) =>
  `Dropped “${title}” on ${column}.`;

export const DRAG_CANCELLED_MESSAGE = "Move cancelled.";

/**
 * The line under the board's columns, and the one place the app admits what
 * §8.8 decided: a drop chooses a column, never a position.
 */
export const BOARD_ORDER_NOTE =
  "Cards are ordered by due date within each column. Dropping a card chooses its column, not its place in it.";
