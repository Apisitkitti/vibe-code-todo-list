import { describe, expect, it } from "vitest";

import { DEFAULT_PRIORITY_FILTER, DEFAULT_STATUS_FILTER } from "@/lib/todo";
import type { TodoListFilters, TodoView } from "@/lib/todo";
import { CLEARED_FILTERS, TODOS_PATH, todosUrl } from "@/lib/todosUrl";

/**
 * The property this file exists for is not "the string looks right" — it is
 * **nothing in the URL deletes anything else in it.** That was the defect
 * waiting the moment the view joined the filters there: two components each
 * rebuilt the query string from the state they knew about, and each silently
 * dropped the other's.
 */

const DEFAULTS: TodoListFilters = {
  status: DEFAULT_STATUS_FILTER,
  priority: DEFAULT_PRIORITY_FILTER,
  query: "",
};

const FILTER_CASES: TodoListFilters[] = [
  DEFAULTS,
  { ...DEFAULTS, status: "active" },
  { ...DEFAULTS, priority: "high" },
  { ...DEFAULTS, query: "milk" },
  { status: "completed", priority: "low", query: "rent" },
];

const VIEWS: TodoView[] = ["list", "board"];

describe("todosUrl", () => {
  it("omits every parameter that is at its default", () => {
    expect(todosUrl(DEFAULTS, "list")).toBe(TODOS_PATH);
  });

  it("keeps the view through any filter change", () => {
    for (const filters of FILTER_CASES) {
      expect(todosUrl(filters, "board")).toContain("view=board");
    }
  });

  it("keeps every filter through any view change", () => {
    for (const view of VIEWS) {
      const url = todosUrl(
        { status: "active", priority: "high", query: "milk" },
        view,
      );

      expect(url).toContain("status=active");
      expect(url).toContain("priority=high");
      expect(url).toContain("q=milk");
    }
  });

  it("is stable, so replacing with the current URL is not a navigation", () => {
    for (const filters of FILTER_CASES) {
      for (const view of VIEWS) {
        expect(todosUrl(filters, view)).toBe(todosUrl(filters, view));
      }
    }
  });

  it("escapes a query that would otherwise change the shape of the URL", () => {
    const url = todosUrl({ ...DEFAULTS, query: "a&view=board" }, "list");

    expect(url).not.toContain("view=board");
    expect(new URL(url, "http://x").searchParams.get("q")).toBe("a&view=board");
  });
});

describe("CLEARED_FILTERS", () => {
  /*
    The product ruling: `Clear filters` stops the narrowing and does not move
    the user off the board they are looking at.

    Asserted through `todosUrl` rather than on the tuple's fields, because the
    ruling is about what the user ends up looking at. It used to be pinned on a
    `clearedFiltersUrl` helper; that helper wrote the URL itself, which made it
    a second unguarded writer, so the tuple is now pushed through the same
    guard as every other change and the assertion follows it there.
  */
  it("drops the filters and keeps the view", () => {
    expect(todosUrl(CLEARED_FILTERS, "board")).toContain("view=board");
    expect(todosUrl(CLEARED_FILTERS, "board")).not.toContain("status=");
    expect(todosUrl(CLEARED_FILTERS, "list")).toBe(TODOS_PATH);
  });
});
