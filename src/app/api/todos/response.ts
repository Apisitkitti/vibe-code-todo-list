import type { Todo } from "@/generated/prisma/client";
import type { ZodError } from "zod";

import { NextResponse } from "next/server";

import {
  isTodoFieldName,
  type TodoFieldErrors,
} from "@/app/todos/components/form";
import { TODO_NOT_FOUND_MESSAGE, type TodoItemData } from "@/lib/todo";

/**
 * Shared response shapes for `/api/todos`. Every error body carries a
 * `message` the client can hand straight to `getErrorMessage`, and validation
 * failures add `fieldErrors` keyed by form field name.
 */

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

/**
 * First message per field, so each input shows one error.
 *
 * Fields are matched against the form's own list rather than cast into it —
 * a zod path the form does not know about (the toggle's `completed`, or a
 * renamed field) is dropped here instead of being typed as a form error and
 * discovered by the client (review m-6).
 */
export const toFieldErrors = (error: ZodError): TodoFieldErrors => {
  const fieldErrors: TodoFieldErrors = {};

  for (const issue of error.issues) {
    const field = issue.path[0];

    if (typeof field !== "string" || !isTodoFieldName(field)) continue;
    if (field in fieldErrors) continue;

    fieldErrors[field] = issue.message;
  }

  return fieldErrors;
};

export const unauthorizedResponse = () => {
  return NextResponse.json({ message: "Sign in again to continue." }, { status: 401 });
};

/** Used for a missing todo and for one owned by somebody else, identically. */
export const notFoundResponse = () => {
  return NextResponse.json({ message: TODO_NOT_FOUND_MESSAGE }, { status: 404 });
};

/**
 * A zod issue at the root of the body (malformed JSON, an array, a bare
 * string) produces no field errors. That is a malformed request, not a
 * missing todo — reporting `TODO_NOT_FOUND_MESSAGE` here would tell the user
 * their todo was deleted when nothing of the sort happened.
 */
export const badRequestResponse = (fieldErrors: TodoFieldErrors) => {
  const [firstMessage] = Object.values(fieldErrors);

  return NextResponse.json(
    { message: firstMessage ?? "That request wasn’t valid.", fieldErrors },
    { status: 400 },
  );
};

/** `request.json()` throws on a malformed body; the caller gets `null`. */
export const readJsonBody = async (request: Request): Promise<unknown> => {
  return await request.json().catch(() => null);
};
