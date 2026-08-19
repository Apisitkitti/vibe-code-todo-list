/**
 * The todo write contract: the one schema both producers of a todo payload
 * validate with, and the one the route handlers re-parse with.
 *
 * **It lives in `src/lib` because the API depends on it** (`docs/REVIEW.md`
 * §1.3 / E-3). It used to live in `src/app/todos/components/form/`, which made
 * `src/app/api/todos/route.ts` import its trust boundary out of a screen's
 * presentation folder — the dependency arrow pointing UI → API backwards. That
 * was survivable while the form was the only producer of this payload. It
 * stopped being survivable when the quick-add bar became a second one, because
 * "the form's schema" and "the API's contract" were then two ideas sharing one
 * file, three directories inside a route, where nobody looks for a
 * security-relevant module.
 *
 * The form barrel at `src/app/todos/components/form/index.ts` still re-exports
 * everything here, so components keep importing from `./form` and none of them
 * had to change. Server code imports this path directly.
 */
import { z } from "zod";

import {
  DUE_DATE_FORMAT,
  NOTE_MAX_LENGTH,
  PRIORITY_LABELS,
  PRIORITY_VALUES,
  TITLE_MAX_LENGTH,
  parseDueDate,
} from "@/lib/todo";

/**
 * Messages are built from the same values they describe, so raising a limit
 * or adding a priority updates the copy with it. A hard-coded "under 200
 * characters" starts lying the moment `TITLE_MAX_LENGTH` changes.
 */
const tooLongMessage = (field: string, maxLength: number) =>
  `Keep the ${field} under ${maxLength} characters.`;

/**
 * The wrong-type message, which is a different mistake from being too long.
 * Answering `{"note": 5}` with "keep the note under 2000 characters" describes
 * a limit the caller never came near (QA DEF-09).
 */
const mustBeTextMessage = (field: string) => `The ${field} must be text.`;

const PRIORITY_INVALID_MESSAGE = `Choose a priority: ${PRIORITY_VALUES.map(
  (priority) => PRIORITY_LABELS[priority].toLowerCase(),
).join(", ")}.`;

const DUE_DATE_INVALID_MESSAGE = `Enter a valid date (${DUE_DATE_FORMAT}).`;

/**
 * The single description of a todo form's shape. The client validates with it
 * for fast feedback and the route handlers under `src/app/api/todos` re-parse
 * with the very same schema, which is the only copy that is trusted
 * (`docs/CONVENTIONS.md` → Route handlers are the trust boundary, step 2;
 * `docs/PRD.md` NFR-08).
 *
 * Not the Forms section's wording, which says this schema is "re-validated
 * inside the server action". There are no server actions in this app and there
 * never have been. The re-parse happens in the route handler, and that is the
 * boundary — see `.claude/skills/todo-app-structure/SKILL.md`.
 *
 * Limits live in `@/lib/todo` so the schema, the inputs' `maxLength` and the
 * database rules all read the same constant.
 *
 * `note` and `dueAt` are optional per `docs/PRD.md` §2, so a request body may
 * omit them entirely. They default to `""`, which keeps the inferred output a
 * plain `string` for the form while leaving the API contract honest.
 */
export const todoFormSchema = z.object({
  // Every `z.string()` carries its own message. The form can only ever send a
  // string, but the API is public: without these, a wrong type from a direct
  // call renders zod's internal English under the field — "Invalid input:
  // expected string, received number" (QA DEF-07).
  title: z
    .string("Enter a title.")
    .trim()
    .min(1, "Enter a title.")
    .max(TITLE_MAX_LENGTH, tooLongMessage("title", TITLE_MAX_LENGTH)),
  note: z
    .string(mustBeTextMessage("note"))
    .trim()
    .max(NOTE_MAX_LENGTH, tooLongMessage("note", NOTE_MAX_LENGTH))
    .default(""),
  priority: z.enum(PRIORITY_VALUES, PRIORITY_INVALID_MESSAGE),
  // The DatePicker yields "" or `YYYY-MM-DD`.
  dueAt: z
    .string(DUE_DATE_INVALID_MESSAGE)
    .trim()
    .refine((value) => parseDueDate(value) !== "invalid", DUE_DATE_INVALID_MESSAGE)
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

/**
 * The quick-add bar's own shape: one line of raw text.
 *
 * It validates only what it can validate *about the raw string* — that
 * something was typed. Everything else is a claim about the todo the text
 * parses into, not about the text, so the bar re-parses its result through
 * `todoFormSchema` above before it calls the API. That is deliberate: the
 * title's rules live in one schema, the one the route handler re-parses with,
 * and the bar borrows them rather than restating them at a second length.
 */
export const quickAddSchema = z.object({
  text: z.string("Enter a title.").trim().min(1, "Enter a title."),
});

export type QuickAddValues = z.infer<typeof quickAddSchema>;

export const DEFAULT_TODO_FORM_VALUES: TodoFormValues = {
  title: "",
  note: "",
  priority: "medium",
  dueAt: "",
};
