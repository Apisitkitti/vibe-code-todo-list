import { isAxiosError } from "axios";

import { TODO_FIELD_NAMES, type TodoFieldErrors } from "./schema";

const BAD_REQUEST_STATUS = 400;

/**
 * Validation failures arrive as a `400` body rather than a return value now
 * that mutations go over HTTP. This reads them back out so the caller can put
 * them on the right inputs; anything else is a plain error for the toast.
 */
export const readFieldErrors = (error: unknown): TodoFieldErrors | null => {
  if (!isAxiosError(error) || error.response?.status !== BAD_REQUEST_STATUS) {
    return null;
  }

  const body = error.response.data as { fieldErrors?: unknown };

  if (typeof body?.fieldErrors !== "object" || body.fieldErrors === null) {
    return null;
  }

  const source = body.fieldErrors as Record<string, unknown>;
  const fieldErrors: TodoFieldErrors = {};

  for (const field of TODO_FIELD_NAMES) {
    const message = source[field];

    if (typeof message === "string" && message !== "") {
      fieldErrors[field] = message;
    }
  }

  return Object.keys(fieldErrors).length > 0 ? fieldErrors : null;
};
