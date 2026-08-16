import type { Prisma, Todo } from "@/generated/prisma/client";

import { prisma } from "@/lib/prisma";
import type { TodoItemData, TodoListResult } from "@/lib/todo";

/**
 * Everything the `/api/todos` handlers share: turning rows into the response
 * bodies, and the reads that follow a write.
 *
 * The response types are `TodoItemData` and `TodoListResult` from
 * `@/lib/todo` — the same types the client already uses. There is no separate
 * API model layer, because a second declaration of the same todo is only
 * something to keep in sync. Error shapes live in `./errors.ts`.
 */

/**
 * The order the list is read in — urgency first, and the whole of the ordering
 * rule in one place.
 *
 *  1. `completed asc` — done work sits under live work, always. Unchanged, and
 *     the reason it stays first is that a completed todo's due date is history:
 *     an overdue-but-finished row must not lead the list.
 *  2. `dueAt asc`, **nulls last** — the sequencing this whole change exists
 *     for. Ascending dates put the most overdue row first and run forward
 *     through today into the future; `nulls: "last"` parks undated todos after
 *     every dated one instead of Postgres's default of sorting NULLs high.
 *     Note what this buys: the section boundaries the client draws (overdue /
 *     today / upcoming / no date) are *cuts in this sequence*, never a
 *     reordering of it, so the server needs no idea what day it is.
 *  3. `priority desc` — the tie-break between todos sharing a due date, and
 *     the only place priority sequences anything. It is deliberately *below*
 *     the date: a low-priority todo due today is more urgent than a high one
 *     due next month, and ranking priority first would put the date back to
 *     being decoration. The `Priority` enum is declared `low, medium, high`
 *     (`prisma/schema.prisma`), so Postgres orders it in that declaration
 *     order and `desc` yields high → medium → low. Getting that backwards is
 *     silent, which is why `tests/api/ordering.test.ts` asserts it directly.
 *  4. `createdAt desc` — the last resort, and today's behaviour preserved:
 *     among todos with the same date and priority, newest first.
 *
 * Served by `@@index([userId, completed, dueAt])`, which matches the `where`
 * scope plus the two leading sort keys.
 */
export const TODO_LIST_ORDER_BY: Prisma.TodoOrderByWithRelationInput[] = [
  { completed: "asc" },
  { dueAt: { sort: "asc", nulls: "last" } },
  { priority: "desc" },
  { createdAt: "desc" },
];

/** Dates cross the wire as ISO strings; the client never sees a `Date`. */
export const toTodoResponse = (todo: Todo): TodoItemData => {
  return {
    id: todo.id,
    title: todo.title,
    note: todo.note,
    priority: todo.priority,
    completed: todo.completed,
    dueAt: todo.dueAt ? todo.dueAt.toISOString() : null,
    createdAt: todo.createdAt.toISOString(),
  };
};

export const toTodoListResponse = (
  todos: Todo[],
  totalCount: number,
  completedCount: number,
): TodoListResult => {
  return {
    todos: todos.map(toTodoResponse),
    totalCount,
    completedCount,
  };
};

/**
 * Re-read after a write, through the same ownership filter, so a response can
 * never carry a row the caller does not own.
 */
export const findOwnedTodo = (id: string, userId: string) => {
  return prisma.todo.findFirst({ where: { id, userId } });
};

/**
 * Completion is only ever changed through `/status`. Both the create and the
 * save handlers use this to reject a body that carries it, rather than
 * parsing it away and returning a success the caller will misread.
 */
export const mentionsCompleted = (body: unknown): boolean => {
  return typeof body === "object" && body !== null && "completed" in body;
};

/** `request.json()` throws on a malformed body; the caller gets `null`. */
export const readJsonBody = async (request: Request): Promise<unknown> => {
  return await request.json().catch(() => null);
};
