import { dueDayOffset } from "./date";
import type { TodoItemData } from "./todo";

/**
 * The list's sections: which one a todo belongs to, and how the sections are
 * ordered on screen.
 *
 * This is the *client* half of the ordering rule. The server sequences the
 * rows (`src/app/api/todos/util.ts` → `TODO_LIST_ORDER_BY`) and this file only
 * decides where the cuts between sections fall, because "today" is a fact
 * about the viewer's clock and timezone rather than about the data. Postgres
 * cannot answer it and should not try: a query that bucketed server-side would
 * be right for whoever's clock the server was reading.
 *
 * The two halves agree by construction rather than by coincidence. `dueAt`
 * ascending with nulls last already produces overdue → today → upcoming → no
 * date for *any* value of "now", so grouping never reorders anything — it
 * walks a list that is already in section order and marks the boundaries.
 */

export const TODO_GROUP_IDS = [
  "overdue",
  "today",
  "upcoming",
  "no-date",
  "completed",
] as const;

export type TodoGroupId = (typeof TODO_GROUP_IDS)[number];

/** Headings, per the copy deck in `docs/DESIGN.md` §7.16. */
export const TODO_GROUP_HEADINGS: Record<TodoGroupId, string> = {
  overdue: "Overdue",
  today: "Today",
  upcoming: "Upcoming",
  "no-date": "No date",
  completed: "Completed",
};

export interface TodoGroup {
  id: TodoGroupId;
  heading: string;
  todos: TodoItemData[];
}

/**
 * Completion wins over the due date: a completed todo is done, so its date has
 * nothing left to say and it would otherwise sit in `Overdue` shouting about
 * work that is finished. A due date that will not parse is treated as no date
 * rather than as a silent `Overdue` — same reasoning as `formatDueDate`, which
 * renders nothing rather than guessing.
 */
export const todoGroupId = (
  todo: TodoItemData,
  now: Date = new Date(),
): TodoGroupId => {
  if (todo.completed) return "completed";

  if (todo.dueAt === null) return "no-date";

  const dayOffset = dueDayOffset(todo.dueAt, now);

  if (dayOffset === null) return "no-date";
  if (dayOffset < 0) return "overdue";
  if (dayOffset === 0) return "today";

  return "upcoming";
};

/**
 * Sections in `TODO_GROUP_IDS` order, empty ones omitted entirely — a user who
 * has never set a due date must see their list exactly as it is today, with no
 * headings standing over nothing.
 *
 * Order *within* a section is the order the rows arrived in, which is the
 * server's. Re-sorting here would put a second ordering authority in the app
 * and the two would drift.
 */
export const groupTodos = (
  todos: readonly TodoItemData[],
  now: Date = new Date(),
): TodoGroup[] => {
  const buckets = new Map<TodoGroupId, TodoItemData[]>();

  for (const todo of todos) {
    const id = todoGroupId(todo, now);
    const bucket = buckets.get(id);

    if (bucket) {
      bucket.push(todo);
    } else {
      buckets.set(id, [todo]);
    }
  }

  return TODO_GROUP_IDS.flatMap((id) => {
    const bucket = buckets.get(id);

    if (!bucket) return [];

    return [{ id, heading: TODO_GROUP_HEADINGS[id], todos: bucket }];
  });
};
