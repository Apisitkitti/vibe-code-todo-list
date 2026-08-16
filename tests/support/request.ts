import { NextRequest } from "next/server";

import type { ApiErrorBody } from "@/lib/apiError";
import type { TodoItemData, TodoListResult } from "@/lib/todo";

/**
 * Building the arguments a route handler expects. The handlers are called as
 * plain functions with a real `NextRequest`, so URL parsing, `searchParams`
 * and JSON body reading all run for real.
 */

const ORIGIN = "http://localhost:3000";

export const getRequest = (path: string): NextRequest => {
  return new NextRequest(new URL(path, ORIGIN));
};

export const jsonRequest = (
  path: string,
  method: "POST" | "PATCH" | "DELETE",
  body: unknown,
): NextRequest => {
  return new NextRequest(new URL(path, ORIGIN), {
    method,
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
};

export const deleteRequest = (path: string): NextRequest => {
  return new NextRequest(new URL(path, ORIGIN), { method: "DELETE" });
};

/** The `{ params }` second argument Next hands a dynamic route handler. */
export const idContext = (id: string) => ({ params: Promise.resolve({ id }) });

export const readJson = async <T>(response: Response): Promise<T> => {
  return (await response.json()) as T;
};

export const readError = (response: Response) => readJson<ApiErrorBody>(response);
export const readTodoBody = (response: Response) => readJson<TodoItemData>(response);
export const readList = (response: Response) => readJson<TodoListResult>(response);
