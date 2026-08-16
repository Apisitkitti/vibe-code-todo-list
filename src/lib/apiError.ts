import { NextResponse } from "next/server";

/**
 * The single source of truth for every error this API returns.
 *
 * One body shape, one status per code, one default message per code. Route
 * handlers pick a code; they never hand-write a status or a JSON shape, so a
 * `401` from one endpoint is byte-identical to a `401` from another and the
 * client can rely on `message` always being present.
 *
 * Domain-specific wording overrides the default message (a missing todo reads
 * better than "Not found"), but never the shape.
 */

export enum ApiErrorCode {
  Unauthorized = "UNAUTHORIZED",
  NotFound = "NOT_FOUND",
  BadRequest = "BAD_REQUEST",
}

/** What every error response body looks like. There is no second shape. */
export interface ApiErrorBody {
  code: ApiErrorCode;
  /** Safe to show the user as-is — `getErrorMessage` hands it straight over. */
  message: string;
  /** Present only on a validation failure, keyed by form field name. */
  fieldErrors?: Record<string, string>;
}

interface ApiErrorDefinition {
  status: number;
  message: string;
}

const API_ERROR_DEFINITIONS: Record<ApiErrorCode, ApiErrorDefinition> = {
  [ApiErrorCode.Unauthorized]: {
    status: 401,
    message: "Sign in again to continue.",
  },
  [ApiErrorCode.NotFound]: {
    status: 404,
    message: "That item no longer exists.",
  },
  [ApiErrorCode.BadRequest]: {
    status: 400,
    message: "That request wasn’t valid.",
  },
};

export interface ApiErrorOptions {
  /** Domain wording in place of the code's default. */
  message?: string;
  fieldErrors?: Record<string, string>;
}

export const apiError = (code: ApiErrorCode, options: ApiErrorOptions = {}) => {
  const definition = API_ERROR_DEFINITIONS[code];

  const body: ApiErrorBody = {
    code,
    message: options.message ?? definition.message,
  };

  if (options.fieldErrors && Object.keys(options.fieldErrors).length > 0) {
    body.fieldErrors = options.fieldErrors;
  }

  return NextResponse.json(body, { status: definition.status });
};
