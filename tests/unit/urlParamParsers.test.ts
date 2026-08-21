import { describe, expect, it } from "vitest";

import {
  DEFAULT_PRIORITY_FILTER,
  DEFAULT_STATUS_FILTER,
  DEFAULT_VIEW,
  isTodoPriority,
  parsePriorityFilter,
  parseStatusFilter,
  parseView,
} from "@/lib/todo";

/**
 * The three parsers standing between the query string and the `where` clause.
 *
 * A URL is, in `parseView`'s own words, "something people edit and share", so
 * every one of these degrades a value it does not recognise to a default
 * rather than raising. Their *defaults* were already covered — changing
 * `parseStatusFilter`'s fallback from `DEFAULT_STATUS_FILTER` to `"completed"`
 * took fifteen tests red. Their **refusals** were not: mutation audit §2.4
 * reduced `parseStatusFilter` to `typeof value === "string"` and passed any
 * string straight through as a `TodoStatusFilter`, and nothing anywhere went
 * red.
 *
 * What that costs is not an aesthetic. `GET /api/todos` writes
 * `where.completed = status === "completed"` for any `status` that is not
 * `"all"`, so `?status=nonsense` surviving the parse is not a no-op — it is a
 * list silently filtered to the active todos, for a URL the user believes
 * shows everything. `?view=nonsense` is the same shape one layer up.
 *
 * So this file is entirely about **what they refuse**, and it is organised
 * that way rather than by export: the accepted values are already exercised
 * from `todosUrl`, `filterSync` and the API suites, several times each. The
 * `unknown` parameter is the point — these are handed `string | null` from
 * `searchParams` and whatever `params` holds on the server component, and
 * neither of those is guaranteed to be a string.
 */

/**
 * Named by what makes each one interesting rather than by its value, because
 * "5" as a test name teaches a reader the argument list and nothing else.
 * Every one of these is reachable: `searchParams.get` yields `null`, a
 * repeated `?status=a&status=b` yields an array in the server component's
 * `params`, and the rest are what a hand-edited URL or a direct API call
 * produces.
 */
const JUNK: readonly (readonly [string, unknown])[] = [
  ["a word that is not one of the values", "nonsense"],
  ["the empty string a cleared param leaves", ""],
  ["whitespace, which is not the same as absent", "   "],
  ["an absent param", null],
  ["a param that was never in the URL", undefined],
  ["a number", 5],
  ["a boolean", true],
  ["an object", {}],
  ["a repeated param, which arrives as an array", ["active"]],
  ["a value that only differs in case", "Active"],
  ["a value with the right word inside it", "xactivex"],
];

describe("parseStatusFilter — what it refuses", () => {
  it.each(JUNK)("falls back to the default for %s", (_reason, value) => {
    expect(parseStatusFilter(value)).toBe(DEFAULT_STATUS_FILTER);
  });

  /**
   * The case that stops the eleven above from passing vacuously: a parser that
   * returned the default unconditionally would satisfy every one of them, and
   * `all` *is* the default, so the accepted values have to be shown to survive.
   */
  it("lets each of its own values through unchanged, so the refusals above mean something", () => {
    expect(parseStatusFilter("all")).toBe("all");
    expect(parseStatusFilter("active")).toBe("active");
    expect(parseStatusFilter("completed")).toBe("completed");
  });
});

describe("parsePriorityFilter — what it refuses", () => {
  it.each(JUNK)("falls back to the default for %s", (_reason, value) => {
    expect(parsePriorityFilter(value)).toBe(DEFAULT_PRIORITY_FILTER);
  });

  /** `high` is the one that must survive: it is what reaches `where.priority`. */
  it("lets each of its own values through unchanged, so the refusals above mean something", () => {
    expect(parsePriorityFilter("all")).toBe("all");
    expect(parsePriorityFilter("low")).toBe("low");
    expect(parsePriorityFilter("medium")).toBe("medium");
    expect(parsePriorityFilter("high")).toBe("high");
  });

  /**
   * `all` is a filter value and not a priority. A parser sharing its list with
   * `PRIORITY_VALUES` would drop it, and the whole filter would stop working
   * while every individual priority still passed.
   */
  it("accepts all, which is a filter value and not a priority", () => {
    expect(parsePriorityFilter("all")).toBe("all");
  });
});

describe("parseView — what it refuses", () => {
  it.each(JUNK)("falls back to the list for %s", (_reason, value) => {
    expect(parseView(value)).toBe(DEFAULT_VIEW);
  });

  it("lets each of its own values through unchanged, so the refusals above mean something", () => {
    expect(parseView("list")).toBe("list");
    expect(parseView("board")).toBe("board");
  });
});

/**
 * `isTodoPriority` is the same guard in predicate form.
 *
 * **Nothing calls it.** `grep -rn "isTodoPriority" src/ tests/ e2e/` finds
 * only its own definition, so unlike the three parsers above it guards no live
 * path today, and the audit's reasoning for §2.4 — "these sit on the URL" —
 * is true of them and not of it. It is tested here because it is exported from
 * `src/lib/todo.ts` and a reduction of it to `return true` should not be
 * silent, but the honest finding is that it is dead code and the cheaper fix
 * is to delete it. Flagged separately rather than decided here.
 */
describe("isTodoPriority — what it refuses", () => {
  it.each(JUNK)("rejects %s", (_reason, value) => {
    expect(isTodoPriority(value)).toBe(false);
  });

  it("rejects the filter's own all, which is not a priority", () => {
    expect(isTodoPriority("all")).toBe(false);
  });

  it("accepts each real priority, so the refusals above mean something", () => {
    expect(isTodoPriority("low")).toBe(true);
    expect(isTodoPriority("medium")).toBe(true);
    expect(isTodoPriority("high")).toBe(true);
  });
});
