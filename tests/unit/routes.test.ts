import { describe, expect, test } from "vitest";

import { sanitiseNextPath, signInPathWithNext } from "@/lib/routes";

/**
 * `?next=` is an open-redirect surface: the value arrives in a query string
 * and ends up in a `redirect()`. The cases below are the attack shapes, not a
 * sample of them — each rejected input is a different way of expressing "leave
 * this origin", and the accepted ones are the paths the app genuinely needs to
 * round-trip after a sign-in.
 */

describe("sanitiseNextPath rejects anything that leaves this origin", () => {
  test.each([
    ["a protocol-relative URL", "//evil.com"],
    ["a protocol-relative URL with a path", "//evil.com/steal"],
    // WHATWG URL parsing treats a backslash as a slash, so this resolves to
    // https://evil.com/ despite looking like a path.
    ["a backslash protocol-relative URL", "/\\evil.com"],
    ["a double backslash", "\\\\evil.com"],
    ["a backslash anywhere in the path", "/todos\\..\\admin"],
    ["a trailing backslash", "/todos\\"],
    ["an absolute https URL", "https://evil.com"],
    ["an absolute http URL", "http://evil.com/todos"],
    ["a scheme-relative javascript URL", "javascript:alert(1)"],
    ["a bare relative path", "todos"],
    ["a parent-relative path", "../admin"],
    ["an empty string", ""],
    ["a lone slash pair", "//"],
    ["a slash-backslash", "/\\"],
    ["a leading space before the slash", " /todos"],
  ])("rejects %s", (_label, value) => {
    expect(sanitiseNextPath(value)).toBeNull();
  });

  test.each([
    ["null", null],
    ["undefined", undefined],
    // Query strings can repeat a key, which yields an array rather than a
    // string — `?next=/todos&next=//evil.com`.
    ["an array of values", ["/todos", "//evil.com"]],
  ])("rejects %s", (_label, value) => {
    expect(sanitiseNextPath(value)).toBeNull();
  });
});

describe("sanitiseNextPath keeps the paths the app actually uses", () => {
  test.each([
    ["the todos page", "/todos"],
    ["the root", "/"],
    ["a path with a query string", "/todos?status=active&priority=high"],
    ["a path with a fragment", "/todos#top"],
    ["a nested path", "/todos/settings/profile"],
    ["a path with an encoded segment", "/todos/a%20b"],
  ])("accepts %s", (_label, value) => {
    expect(sanitiseNextPath(value)).toBe(value);
  });
});

describe("signInPathWithNext", () => {
  test("carries a safe path, encoded", () => {
    expect(signInPathWithNext("/todos")).toBe("/sign-in?next=%2Ftodos");
  });

  test("encodes a query string inside the carried path", () => {
    expect(signInPathWithNext("/todos?status=active")).toBe(
      "/sign-in?next=%2Ftodos%3Fstatus%3Dactive",
    );
  });

  test("drops an unsafe path rather than carrying it", () => {
    expect(signInPathWithNext("//evil.com")).toBe("/sign-in");
  });

  test("falls back to a bare sign-in when there is no path at all", () => {
    expect(signInPathWithNext(null)).toBe("/sign-in");
  });
});
