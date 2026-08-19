export { TodoForm, type TodoFormProps } from "./TodoForm";
export { QuickAddForm, type QuickAddFormProps } from "./QuickAddForm";
export { readFieldErrors } from "./fieldErrors";

/**
 * Re-exported, not re-declared: the schema itself lives at
 * `@/lib/todo.schema` because the route handlers re-parse with it and server
 * code must not import out of a route's UI folder (`docs/REVIEW.md` §1.3).
 *
 * It stays in this barrel so components keep importing everything a form needs
 * from one path. Server code imports `@/lib/todo.schema` directly.
 */
export {
  DEFAULT_TODO_FORM_VALUES,
  TODO_FIELD_NAMES,
  isTodoFieldName,
  quickAddSchema,
  todoFormSchema,
  type QuickAddValues,
  type TodoFieldErrors,
  type TodoFormValues,
} from "@/lib/todo.schema";
