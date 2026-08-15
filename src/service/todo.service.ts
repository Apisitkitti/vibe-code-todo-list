import type { TodoFormValues } from "@/app/todos/components/form";
import { http } from "@/lib/http";
import type { TodoItemData, TodoListFilters, TodoListResult } from "@/lib/todo";

/**
 * Transport only (`docs/CONVENTIONS.md` → Services): each function calls the
 * `/api/todos` endpoint through the shared axios instance and returns the
 * response body. No try/catch, no retries, no reshaping, no validation — the
 * calling component catches, decides, and toasts.
 */

const TODOS_ENDPOINT = "/todos";

export const getTodoList = async (filters: TodoListFilters): Promise<TodoListResult> => {
  const response = await http.get<TodoListResult>(TODOS_ENDPOINT, {
    params: filters,
  });

  return response.data;
};

export const createTodo = async (values: TodoFormValues): Promise<TodoItemData> => {
  const response = await http.post<TodoItemData>(TODOS_ENDPOINT, values);

  return response.data;
};

export const updateTodo = async (todoId: string, values: TodoFormValues): Promise<TodoItemData> => {
  const response = await http.patch<TodoItemData>(
    `${TODOS_ENDPOINT}/${todoId}`,
    values,
  );

  return response.data;
};

export const toggleTodo = async (todoId: string, completed: boolean): Promise<TodoItemData> => {
  const response = await http.patch<TodoItemData>(
    `${TODOS_ENDPOINT}/${todoId}`,
    {
      completed,
    },
  );

  return response.data;
};

export const deleteTodo = async (todoId: string): Promise<void> => {
  await http.delete(`${TODOS_ENDPOINT}/${todoId}`);
};
