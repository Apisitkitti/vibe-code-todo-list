import type { TodoFormValues } from "@/app/todos/components/form";
import { http } from "@/lib/http";
import type {
  TodoCreatedVia,
  TodoItemData,
  TodoListFilters,
  TodoListResult,
} from "@/lib/todo";

/**
 * Transport only (`docs/CONVENTIONS.md` → Services): each function calls the
 * `/api/todos` endpoint through the shared axios instance and returns the
 * response body. No try/catch, no retries, no reshaping, no validation — the
 * calling component catches, decides, and toasts.
 */

const TODOS_ENDPOINT = "/todos";

const todoEndpoint = (todoId: string) => `${TODOS_ENDPOINT}/${todoId}`;
/** Completion has its own route, so a save can never also flip a checkbox. */
const todoStatusEndpoint = (todoId: string) => `${todoEndpoint(todoId)}/status`;

export const getTodoList = async (filters: TodoListFilters): Promise<TodoListResult> => {
  const response = await http.get<TodoListResult>(TODOS_ENDPOINT, {
    params: filters,
  });

  return response.data;
};

/**
 * `createdVia` is required here and optional on the wire, which is the right
 * way round: the API stays usable by a caller that does not participate in the
 * measurement, while every caller *in this app* is made to say which surface
 * it is. A default here would let a new capture surface be added and quietly
 * counted as an existing one.
 */
export const createTodo = async (
  values: TodoFormValues,
  createdVia: TodoCreatedVia,
): Promise<TodoItemData> => {
  const response = await http.post<TodoItemData>(TODOS_ENDPOINT, {
    ...values,
    createdVia,
  });

  return response.data;
};

export const updateTodo = async (todoId: string, values: TodoFormValues): Promise<TodoItemData> => {
  const response = await http.patch<TodoItemData>(todoEndpoint(todoId), values);

  return response.data;
};

export const toggleTodo = async (todoId: string, completed: boolean): Promise<TodoItemData> => {
  const response = await http.patch<TodoItemData>(todoStatusEndpoint(todoId), {
    completed,
  });

  return response.data;
};

export const deleteTodo = async (todoId: string): Promise<void> => {
  await http.delete(todoEndpoint(todoId));
};
