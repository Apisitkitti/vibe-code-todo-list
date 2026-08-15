import { isAxiosError } from "axios";

const UNEXPECTED_ERROR_MESSAGE = "An unexpected error occurred. Try again.";

const readMessageProperty = (value: unknown): string | null => {
  if (value && typeof value === "object" && "message" in value) {
    const message = (value as { message?: unknown }).message;

    if (typeof message === "string" && message.trim() !== "") return message;
  }

  return null;
};

/**
 * The single place callers turn a thrown value into copy they can show.
 * Handles axios errors, server-action errors and anything else identically
 * (`docs/CONVENTIONS.md` → Services).
 */
export const getErrorMessage = (error: unknown, fallback: string = UNEXPECTED_ERROR_MESSAGE): string => {
  if (isAxiosError(error)) {
    // axios always sets its own `message` ("Network Error", "timeout of 15000ms
    // exceeded", "Request failed with status code 500"), so `?? fallback` would
    // never be reached. That text is not user-facing copy — prefer the fallback.
    return readMessageProperty(error.response?.data) ?? fallback;
  }

  if (error instanceof Error) {
    // Next.js masks server-action exceptions in production and leaves only a
    // digest, so the raw message is not something a user should read.
    if (typeof (error as { digest?: unknown }).digest === "string") return fallback;

    return error.message.trim() === "" ? fallback : error.message;
  }

  if (typeof error === "string" && error.trim() !== "") return error;

  return readMessageProperty(error) ?? fallback;
};
