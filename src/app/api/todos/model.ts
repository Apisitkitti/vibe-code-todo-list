import type { Todo } from "@/generated/prisma/client";

import type { TodoItemData } from "@/lib/todo";

/**
 * The data model for `/api/todos`: how a database row becomes the JSON shape
 * the client consumes. Error shapes live in `./error.ts`.
 */

/** Dates cross the wire as ISO strings; the client never sees a `Date`. */
export const toTodoItemData = (todo: Todo): TodoItemData => {
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

/** `request.json()` throws on a malformed body; the caller gets `null`. */
export const readJsonBody = async (request: Request): Promise<unknown> => {
  return await request.json().catch(() => null);
};
