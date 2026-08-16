import { AxiosError, AxiosHeaders } from "axios";
import { describe, expect, test } from "vitest";

import { getErrorMessage } from "@/lib/getErrorMessage";

/**
 * Every thrown value the UI shows a user passes through here, so the thing
 * being tested is really "what does the user end up reading". The interesting
 * cases are the ones where the honest answer is the fallback: axios's own
 * transport wording and Next's production digests are both technically a
 * `message`, and neither is copy.
 */

const DEFAULT_FALLBACK = "An unexpected error occurred. Try again.";

const axiosErrorWith = (data: unknown, message = "Request failed with status code 500") => {
  return new AxiosError(
    message,
    "ERR_BAD_RESPONSE",
    { headers: new AxiosHeaders() },
    undefined,
    {
      data,
      status: 500,
      statusText: "Internal Server Error",
      headers: new AxiosHeaders(),
      config: { headers: new AxiosHeaders() },
    },
  );
};

describe("axios errors", () => {
  test("prefer the server's message, which is written for the user", () => {
    expect(
      getErrorMessage(axiosErrorWith({ code: "NOT_FOUND", message: "That todo no longer exists." })),
    ).toBe("That todo no longer exists.");
  });

  /**
   * axios always sets its own `message`, so a naive `?? fallback` would never
   * be reached and users would read "Request failed with status code 500".
   */
  test("never surface axios's own transport wording", () => {
    expect(getErrorMessage(axiosErrorWith({ code: "INTERNAL" }))).toBe(
      DEFAULT_FALLBACK,
    );
  });

  test("a network error with no response falls back", () => {
    const error = new AxiosError("Network Error", "ERR_NETWORK", {
      headers: new AxiosHeaders(),
    });

    expect(getErrorMessage(error)).toBe(DEFAULT_FALLBACK);
  });

  test("a blank server message falls back rather than showing nothing", () => {
    expect(getErrorMessage(axiosErrorWith({ message: "   " }))).toBe(
      DEFAULT_FALLBACK,
    );
  });

  test("a non-string server message falls back", () => {
    expect(getErrorMessage(axiosErrorWith({ message: 42 }))).toBe(
      DEFAULT_FALLBACK,
    );
  });

  test("an HTML error page as the body falls back", () => {
    expect(getErrorMessage(axiosErrorWith("<html>502 Bad Gateway</html>"))).toBe(
      DEFAULT_FALLBACK,
    );
  });
});

describe("Error instances", () => {
  test("show their message", () => {
    expect(getErrorMessage(new Error("Something specific went wrong."))).toBe(
      "Something specific went wrong.",
    );
  });

  test("an empty message falls back", () => {
    expect(getErrorMessage(new Error(""))).toBe(DEFAULT_FALLBACK);
  });

  test("a whitespace-only message falls back", () => {
    expect(getErrorMessage(new Error("   "))).toBe(DEFAULT_FALLBACK);
  });

  /**
   * Next masks server-action exceptions in production and leaves a digest. The
   * remaining message is an opaque id, not something to put in front of anyone.
   */
  test("a digest-carrying error falls back instead of leaking the digest", () => {
    const error = Object.assign(new Error("An error occurred in the Server Components render."), {
      digest: "3856255467",
    });

    expect(getErrorMessage(error)).toBe(DEFAULT_FALLBACK);
  });

  test("a non-string digest is not treated as a digest", () => {
    const error = Object.assign(new Error("Real message."), { digest: 123 });

    expect(getErrorMessage(error)).toBe("Real message.");
  });

  test("a subclass is still an Error", () => {
    class TimeoutError extends Error {}

    expect(getErrorMessage(new TimeoutError("Timed out."))).toBe("Timed out.");
  });
});

describe("everything else", () => {
  test("a thrown string is used as-is", () => {
    expect(getErrorMessage("Plain string failure")).toBe("Plain string failure");
  });

  test("a blank thrown string falls back", () => {
    expect(getErrorMessage("   ")).toBe(DEFAULT_FALLBACK);
  });

  test("a bare object with a message is read", () => {
    expect(getErrorMessage({ message: "From a plain object." })).toBe(
      "From a plain object.",
    );
  });

  test.each([
    ["null", null],
    ["undefined", undefined],
    ["a number", 500],
    ["an empty object", {}],
    ["an array", []],
  ])("%s falls back", (_label, value) => {
    expect(getErrorMessage(value)).toBe(DEFAULT_FALLBACK);
  });
});

describe("the caller's own fallback", () => {
  test("replaces the default when there is nothing to show", () => {
    expect(getErrorMessage(null, "Could not save the todo.")).toBe(
      "Could not save the todo.",
    );
  });

  test("does not override a message that exists", () => {
    expect(getErrorMessage(new Error("Real."), "Could not save the todo.")).toBe(
      "Real.",
    );
  });

  test("is used for an axios error with no usable body", () => {
    expect(getErrorMessage(axiosErrorWith({}), "Could not load your todos.")).toBe(
      "Could not load your todos.",
    );
  });
});
