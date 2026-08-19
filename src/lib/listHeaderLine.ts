import dayjs from "dayjs";

import type { TodoGroup, TodoGroupId } from "./todoGroups";

/**
 * The dated header line above the list (`docs/PRD.md` US-12,
 * `docs/DESIGN.md` §7.19).
 *
 * `Saturday, 16 August · 3 due today · 1 overdue`, with either count clause
 * omitted entirely when it is zero, and the date alone when both are.
 *
 * **The counts are read from the sections themselves, never recomputed.** US-12
 * requires that the line and the list can never disagree about how many todos
 * are due, and the only way to guarantee that rather than to test for it is to
 * give both of them the same array: `TodoListScreen` calls `groupTodos` once
 * and hands the result to `TodoGroupedList` and to this function. A second
 * pass over `todos` here would be a second answer, and two answers computed
 * from one input at two moments can differ — over a midnight boundary, or
 * across an optimistic write that has moved a row between the two calls.
 *
 * That also settles "today". `groupTodos` decides section membership through
 * `dueDayOffset` (`src/lib/date.ts`), the one place the app reconciles a
 * UTC-midnight `dueAt` against the viewer's local calendar day, so this file
 * inherits that decision instead of making a second one. CI runs with
 * `TZ=Pacific/Kiritimati` precisely to catch a second one.
 */

/** `Saturday, 16 August` — the viewer's own local day. */
export const formatHeaderDate = (now: Date = new Date()): string =>
  dayjs(now).format("dddd, D MMMM");

/** §7.18's punctuation note: the middle dot, not a hyphen and not a pipe. */
const SEPARATOR = " · ";

const sizeOf = (groups: readonly TodoGroup[], id: TodoGroupId): number =>
  groups.find((group) => group.id === id)?.todos.length ?? 0;

/**
 * `groups` is `null` while the list has not loaded and when it failed to load:
 * the date renders alone, so the counts never appear as zero and then change
 * under the user (US-12), and never describe a list that is not on screen.
 *
 * An empty array is a different thing and is handled by the same arithmetic
 * rather than by a special case — zero sections means zero in both clauses,
 * and both clauses are omitted when zero. That is the empty-state requirement
 * satisfied without a branch that could drift from the loaded one.
 */
export const formatListHeaderLine = (
  groups: readonly TodoGroup[] | null,
  now: Date = new Date(),
): string => {
  const date = formatHeaderDate(now);

  if (groups === null) return date;

  const dueToday = sizeOf(groups, "today");
  const overdue = sizeOf(groups, "overdue");

  const clauses = [
    dueToday > 0 ? `${dueToday} due today` : null,
    overdue > 0 ? `${overdue} overdue` : null,
  ].filter((clause): clause is string => clause !== null);

  return [date, ...clauses].join(SEPARATOR);
};
