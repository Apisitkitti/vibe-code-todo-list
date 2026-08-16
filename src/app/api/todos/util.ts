import type { Todo } from "@/generated/prisma/client";

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

/** `request.json()` throws on a malformed body; the caller gets `null`. */
export const readJsonBody = async (request: Request): Promise<unknown> => {
  return await request.json().catch(() => null);
};
