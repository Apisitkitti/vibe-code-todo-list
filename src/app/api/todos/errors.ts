import type { ZodError } from "zod";

import {
  isTodoFieldName,
  type TodoFieldErrors,
} from "@/app/todos/components/form";
import { ApiErrorCode, apiError } from "@/lib/apiError";
import { TODO_NOT_FOUND_MESSAGE } from "@/lib/todo";

/**
 * The todo-specific error wording. The body shape, the status codes and the
 * default messages all come from `@/lib/apiError`, which is the single source
 * of truth — these are thin wrappers that only supply domain wording.
 * Success shapes live in `./model.ts`.
 *
 * Named `errors.ts`, not `error.ts`: anything called `error.*` under `app/`
 * is Next's error-boundary convention and has to be a Client Component.
 */

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

export const unauthorizedResponse = () => apiError(ApiErrorCode.Unauthorized);

/** Used for a missing todo and for one owned by somebody else, identically. */
export const notFoundResponse = () =>
  apiError(ApiErrorCode.NotFound, { message: TODO_NOT_FOUND_MESSAGE });

/**
 * A zod issue at the root of the body (malformed JSON, an array, a bare
 * string) produces no field errors, so there is no single field to blame and
 * the code's own "that request wasn't valid" wording is what the user sees.
 * Reporting `TODO_NOT_FOUND_MESSAGE` there would tell them their todo was
 * deleted when nothing of the sort happened.
 */
export const badRequestResponse = (fieldErrors: TodoFieldErrors) => {
  const [firstMessage] = Object.values(fieldErrors);

  return apiError(ApiErrorCode.BadRequest, {
    message: firstMessage,
    fieldErrors,
  });
};

/**
 * A `400` that no single field is to blame for — the body itself is the
 * problem. Takes the reason so the caller can say what it expected instead of
 * falling back to the generic "that request wasn't valid".
 */
export const malformedBodyResponse = (message: string) =>
  apiError(ApiErrorCode.BadRequest, { message });
