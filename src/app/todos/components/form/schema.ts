import { z } from "zod";

import {
  NOTE_MAX_LENGTH,
  PRIORITY_VALUES,
  TITLE_MAX_LENGTH,
  parseDueDate,
} from "@/lib/todo";

/**
 * The single description of a todo form's shape. The client validates with it
 * for fast feedback and the route handlers under `src/app/api/todos` re-parse
 * with the very same schema, which is the only copy that is trusted
 * (`docs/CONVENTIONS.md` → Forms, `docs/PRD.md` NFR-08).
 *
 * Limits live in `@/lib/todo` so the schema, the inputs' `maxLength` and the
 * database rules all read the same constant.
 *
 * `note` and `dueAt` are optional per `docs/PRD.md` §2, so a request body may
 * omit them entirely. They default to `""`, which keeps the inferred output a
 * plain `string` for the form while leaving the API contract honest.
 */
export const todoFormSchema = z.object({
  title: z
    .string()
    .trim()
    .min(1, "Enter a title.")
    .max(TITLE_MAX_LENGTH, "Keep the title under 200 characters."),
  note: z
    .string()
    .trim()
    .max(NOTE_MAX_LENGTH, "Keep the note under 2000 characters.")
    .default(""),
  priority: z.enum(PRIORITY_VALUES, "Choose a priority."),
  // `<input type="date">` yields "" or `YYYY-MM-DD`.
  dueAt: z
    .string()
    .trim()
    .refine(
      (value) => parseDueDate(value) !== "invalid",
      "Enter a valid date.",
    )
    .default(""),
});

/**
 * Parsed output — every field present, defaults applied. This is what the
 * submit handler and the route handlers work with.
 */
export type TodoFormValues = z.infer<typeof todoFormSchema>;

/**
 * Pre-parse input, where the optional fields may be absent. `useForm` is typed
 * with this so the resolver's input and output types line up.
 */
export type TodoFormInput = z.input<typeof todoFormSchema>;

/** Server-reported errors, keyed by field name so `Form` can wire them up. */
export type TodoFieldErrors = Partial<Record<keyof TodoFormValues, string>>;

/**
 * The form's field names, in one place so the server's error mapping and the
 * client's error reading cannot drift apart. Typed against the schema, so
 * renaming a field here is a compile error rather than a silent mismatch.
 */
export const TODO_FIELD_NAMES = [
  "title",
  "note",
  "priority",
  "dueAt",
] as const satisfies readonly (keyof TodoFormValues)[];

export const isTodoFieldName = (value: string): value is keyof TodoFormValues =>
  (TODO_FIELD_NAMES as readonly string[]).includes(value);

export const DEFAULT_TODO_FORM_VALUES: TodoFormValues = {
  title: "",
  note: "",
  priority: "medium",
  dueAt: "",
};
