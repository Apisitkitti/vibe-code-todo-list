/**
 * The forms' one public entry point. Each form owns a folder; this barrel is
 * what lets the rest of the app import from `./form` without knowing that
 * layout, so a form can gain a file — a schema, a parser, a sub-component —
 * without every consumer being edited.
 *
 * There is deliberately no barrel *inside* each form folder. This file is the
 * only consumer of those paths, so an inner `index.ts` would re-export two or
 * three names for exactly one reader — ceremony, and a second place a name can
 * go missing from.
 */
export { TodoForm, type TodoFormProps } from "./TodoForm/TodoForm";
export { readFieldErrors } from "./TodoForm/fieldErrors";

export {
  QuickAddForm,
  type QuickAddFormProps,
} from "./QuickAddForm/QuickAddForm";

/**
 * The quick-add bar's own schema, colocated with the only thing that uses it.
 * It validates that something was typed and nothing more; no route handler
 * parses it.
 */
export { quickAddSchema, type QuickAddValues } from "./QuickAddForm/schema";

/**
 * Re-exported, not re-declared: the todo write contract lives at
 * `@/lib/todo.schema` because the route handlers re-parse with it and server
 * code must not import out of a route's UI folder (`docs/REVIEW.md` §1.3).
 * That is the whole split — a schema the server parses with stays in
 * `src/lib`; a schema only its form uses moves in with the form.
 *
 * It stays in this barrel so components keep importing everything a form needs
 * from one path. Server code imports `@/lib/todo.schema` directly.
 */
export {
  DEFAULT_TODO_FORM_VALUES,
  TODO_FIELD_NAMES,
  isTodoFieldName,
  todoFormSchema,
  type TodoFieldErrors,
  type TodoFormValues,
} from "@/lib/todo.schema";
