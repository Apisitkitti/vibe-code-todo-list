import { rescheduleDay, TODAY_DAY_OFFSET, TOMORROW_DAY_OFFSET } from "./date";
import type { TodoItemData } from "./todo";
import {
  TODO_GROUP_HEADINGS,
  TODO_GROUP_IDS,
  todoGroupId,
  type TodoGroupId,
} from "./todoGroups";

/**
 * The board: the same todos as the list, laid out as columns instead of
 * sections, and what dragging a card from one column to another *means*.
 *
 * **This is a view over existing data, not a second place to store it**
 * (`docs/DESIGN.md` §8.8, `docs/PRD.md` US-14). There is no `position` column,
 * no ordering key of its own, and nothing here that a row could be filed under.
 * A column is not a bucket a card is put into — it is the name of a fact the
 * card already carries, and moving a card is a way of *changing that fact*:
 *
 *  - the five columns are `TODO_GROUP_IDS`, the same urgency groups
 *    `groupTodos` cuts the list into, computed by the same `todoGroupId`;
 *  - dropping a card in a dated column writes a due date through
 *    `PATCH /api/todos/[id]/due`;
 *  - dropping it in `Completed`, or out of it, writes completion through
 *    `PATCH /api/todos/[id]/status`.
 *
 * So the board cannot express anything the list cannot, and nothing about it
 * is an argument for adding an ordering column later — the standing decision
 * against manual reordering (`docs/DESIGN.md` §8.1, `docs/PM-PROPOSAL.md` §4)
 * is untouched, and *order within a column remains the server's*.
 */

export const BOARD_COLUMN_IDS = TODO_GROUP_IDS;

export type BoardColumnId = TodoGroupId;

export interface BoardColumn {
  id: BoardColumnId;
  heading: string;
  todos: TodoItemData[];
}

/**
 * All five columns, always, empty ones included — which is the one place the
 * board deliberately differs from `groupTodos`.
 *
 * The list omits an empty section because a heading standing over nothing is
 * noise in a vertical scan. A board is the opposite: the columns *are* the
 * structure, so one that comes and goes as its last card leaves would move
 * every other column sideways under the pointer — during a drag, which is when
 * the layout most needs to hold still. An empty column is also a drop target,
 * and a drop target that is not on screen cannot be aimed at.
 *
 * Order within a column is the order the rows arrived in, which is the
 * server's (`src/app/api/todos/util.ts` → `TODO_LIST_ORDER_BY`). Nothing here
 * sorts. This function walks the list once and marks which column each row
 * belongs to, exactly as `groupTodos` does.
 */
export const boardColumns = (
  todos: readonly TodoItemData[],
  now: Date = new Date(),
): BoardColumn[] => {
  const buckets = new Map<BoardColumnId, TodoItemData[]>();

  for (const todo of todos) {
    const id = todoGroupId(todo, now);
    const bucket = buckets.get(id);

    if (bucket) {
      bucket.push(todo);
    } else {
      buckets.set(id, [todo]);
    }
  }

  return BOARD_COLUMN_IDS.map((id) => ({
    id,
    heading: TODO_GROUP_HEADINGS[id],
    todos: buckets.get(id) ?? [],
  }));
};

/**
 * What a drop writes: a due date, or a completion. Never both, because the two
 * are separate routes and a body that half-matches gets half-applied
 * (`references/api-routes.md` → one route per operation).
 */
export type BoardMove =
  | { kind: "due"; dueAt: string | null }
  | { kind: "status"; completed: boolean };

/**
 * The move a drop performs, or `null` when the card cannot be dropped there.
 *
 * **The rule, and it is the whole design: a drop does exactly what that card's
 * own reschedule menu would do, and a column the menu cannot produce is not a
 * drop target.** Everything below follows from it, and so does the answer to
 * "how does a keyboard user do this?" — they open the menu on the card and
 * press the item with the same name. There is no move a mouse can make here
 * that a keyboard cannot, which is why this feature does not owe anyone a
 * keyboard drag mode (`docs/DESIGN.md` §6.8, §8.1).
 *
 * | Column | Active card | Completed card |
 * |---|---|---|
 * | `Overdue` | **refused** | allowed only if that is where it returns to |
 * | `Today` | `Today` — today's date | as above |
 * | `Upcoming` | `Tomorrow` — the nearest day in that column | as above |
 * | `No date` | `Clear due date` | as above |
 * | `Completed` | tick the checkbox | — it is already there |
 *
 * **`Overdue` is refused for an active card, and the reason is the one
 * `Upcoming` already explains, pointed the other way.**
 *
 * `Upcoming` spans every future date, and a gesture cannot name a date — so it
 * takes the bucket's *near edge*, tomorrow, and `Pick a date…` remains the way
 * to say which day. `Overdue` spans every past date and has the same problem,
 * but its near edge is **yesterday**, and there the guess stops being helpful
 * and turns destructive: it invents a deadline the user has already missed,
 * which is a claim about their record rather than a shorthand for their
 * intent, and it files the row under the section that exists to shout at them.
 * A wrong guess towards the future costs a second drag; a wrong guess into the
 * past rewrites history.
 *
 * So the column is shown, cards live in it and can be dragged *out* of it —
 * which is the move that actually matters — but nothing is dragged in.
 *
 * **What this refusal is emphatically not.** An earlier version of this comment
 * claimed "no menu item produces it" and that "nothing in this app sets a date
 * in the past". Both are false, and the code says so: `FormDatePicker` sets no
 * `minValue` and no `isDateUnavailable`, `todoFormSchema.dueAt` only checks
 * that the day parses, and `PATCH /api/todos/[id]/due` accepts any parseable
 * day — so `Pick a date…`, this very menu's fourth item, opens a picker that
 * will happily set last Tuesday. `e2e/grouping.spec.ts` seeds three past dates
 * through the real create endpoint and asserts `201` on each. **Past dates are
 * ordinary, supported data.** What is refused here is a *gesture guessing one*,
 * which is a far narrower claim and the only one this code makes.
 *
 * **A completed card has exactly one valid target: the column it returns to**,
 * computed from the date it still holds. Reopening is a `/status` write and
 * writes no date, so a completed card with yesterday's date comes back to
 * `Overdue` whatever column it was dropped on. Allowing the other drops would
 * mean either landing the card somewhere other than where it was released —
 * the one thing direct manipulation must never do — or issuing a second write
 * the user did not ask for and the keyboard has no equivalent of. Refusing
 * them tells the truth before the release instead of after it.
 *
 * `now` is threaded through rather than read here so the caller's clock is the
 * one that decides, the same way every other date decision in this app is made
 * from the viewer's own (`src/lib/date.ts`).
 */
export const boardMove = (
  todo: TodoItemData,
  column: BoardColumnId,
  now: Date = new Date(),
): BoardMove | null => {
  // A card is never a valid target for the column it is already sitting in:
  // there is no change to write, and highlighting it would promise one.
  if (todoGroupId(todo, now) === column) return null;

  if (todo.completed) {
    const returnsTo = todoGroupId({ ...todo, completed: false }, now);

    return column === returnsTo ? { kind: "status", completed: false } : null;
  }

  if (column === "completed") return { kind: "status", completed: true };
  if (column === "overdue") return null;
  if (column === "no-date") return { kind: "due", dueAt: null };

  /*
    The two dated columns take the same day the menu's items take, from the
    same function — so a drag on `Today` and a press of `Today` are the same
    write, resolved against the same clock, and cannot drift apart.

    `Upcoming` is `Tomorrow` because tomorrow is the nearest day in that column
    and the only one a gesture can name: a column spanning every future date
    cannot be dropped onto at a *date*, only at a *bucket*, and the menu's
    `Pick a date…` remains the way to say which. Choosing the near edge also
    keeps the drag reversible in one move — the card is one `Today` away from
    coming back.
  */
  const dayOffset = column === "today" ? TODAY_DAY_OFFSET : TOMORROW_DAY_OFFSET;

  return { kind: "due", dueAt: rescheduleDay(dayOffset, now).dueAt };
};
