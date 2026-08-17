import { describe, expect, test } from "vitest";

import type {
  TodoItemData,
  TodoListFilters,
  TodoListResult,
} from "@/lib/todo";
import { groupTodos } from "@/lib/todoGroups";
import {
  applyCompletion,
  replaceTodo,
  todoMatchesFilters,
  todoMatchesStatusFilter,
} from "@/lib/todoListState";

/**
 * The optimistic toggle's local half (review m-7, PM backlog #3).
 *
 * `docs/REVIEW.md` E-2 is explicit about why this file exists: *"optimistic
 * state has exactly one failure mode — the revert — and QA has no fault
 * injection. The moment we apply changes locally, we have a correctness
 * property with no verifier."* Playwright injects the 500 and checks what the
 * user is left looking at; this file checks the things a browser cannot be
 * asked about — that the rollback restores the exact value, the exact count
 * and the exact section, and that it is safe to run when there is nothing to
 * roll back.
 *
 * `now` is built with the local-time `Date` constructor for the same reason
 * `todoGroups.test.ts` does it: "today" is the viewer's calendar day while
 * `dueAt` is stored at UTC midnight, and an ISO literal would make the
 * section assertions pass in UTC and fail from an offset.
 */

/** Local noon on 16 August 2026, so the local calendar day is unambiguous. */
const NOW = new Date(2026, 7, 16, 12, 0, 0);

/** UTC midnight, which is how the API stores and returns every due date. */
const dueAt = (day: string) => `${day}T00:00:00.000Z`;

const todo = (
  overrides: Partial<TodoItemData> & { id: string },
): TodoItemData => ({
  title: overrides.id,
  note: null,
  priority: "medium",
  completed: false,
  dueAt: null,
  createdAt: "2026-08-01T00:00:00.000Z",
  ...overrides,
});

const listOf = (
  todos: TodoItemData[],
  overrides: Partial<TodoListResult> = {},
): TodoListResult => ({
  todos,
  totalCount: todos.length,
  completedCount: todos.filter((item) => item.completed).length,
  ...overrides,
});

const idsOf = (result: TodoListResult) => result.todos.map((item) => item.id);

const completedOf = (result: TodoListResult, id: string) =>
  result.todos.find((item) => item.id === id)?.completed;

/** The section a row renders under, which is what the user actually sees move. */
const sectionOf = (result: TodoListResult, id: string) =>
  groupTodos(result.todos, NOW).find((group) =>
    group.todos.some((item) => item.id === id),
  )?.id;

describe("todoMatchesStatusFilter", () => {
  test("the All filter shows both", () => {
    expect(todoMatchesStatusFilter(true, "all")).toBe(true);
    expect(todoMatchesStatusFilter(false, "all")).toBe(true);
  });

  test("Active shows only incomplete todos", () => {
    expect(todoMatchesStatusFilter(false, "active")).toBe(true);
    expect(todoMatchesStatusFilter(true, "active")).toBe(false);
  });

  test("Completed shows only complete todos", () => {
    expect(todoMatchesStatusFilter(true, "completed")).toBe(true);
    expect(todoMatchesStatusFilter(false, "completed")).toBe(false);
  });
});

describe("applyCompletion — the flip", () => {
  test("marks the row complete without waiting for anything", () => {
    const before = listOf([todo({ id: "a" }), todo({ id: "b" })]);

    const after = applyCompletion(before, "a", true, "all");

    expect(completedOf(after, "a")).toBe(true);
    expect(completedOf(after, "b")).toBe(false);
  });

  test("moves the completed count with the box, so the header agrees", () => {
    const before = listOf([todo({ id: "a" }), todo({ id: "b" })]);

    expect(applyCompletion(before, "a", true, "all").completedCount).toBe(1);
  });

  test("un-completing takes the count back down", () => {
    const before = listOf([todo({ id: "a", completed: true })]);

    expect(applyCompletion(before, "a", false, "all").completedCount).toBe(0);
  });

  test("never touches the total — a toggle creates and destroys nothing", () => {
    const before = listOf([todo({ id: "a" }), todo({ id: "b" })]);

    expect(applyCompletion(before, "a", true, "all").totalCount).toBe(2);
  });

  test("leaves every row where the server put it", () => {
    const before = listOf([
      todo({ id: "a" }),
      todo({ id: "b" }),
      todo({ id: "c" }),
    ]);

    // Ordering is the server's (`TODO_LIST_ORDER_BY`); the client only cuts
    // sections. A flip must not re-sequence the page under the user.
    expect(idsOf(applyCompletion(before, "b", true, "all"))).toEqual([
      "a",
      "b",
      "c",
    ]);
  });

  test("does not mutate the result it was given", () => {
    const before = listOf([todo({ id: "a" })]);

    applyCompletion(before, "a", true, "all");

    expect(before.completedCount).toBe(0);
    expect(before.todos[0].completed).toBe(false);
  });

  test("an id that is not on screen changes nothing at all", () => {
    const before = listOf([todo({ id: "a" })]);

    // Identity, not equality: a filtered-out row must not re-render the list.
    expect(applyCompletion(before, "missing", true, "all")).toBe(before);
  });

  test("writing the value a row already holds is a no-op", () => {
    const before = listOf([todo({ id: "a", completed: true })]);

    expect(applyCompletion(before, "a", true, "all")).toBe(before);
  });
});

describe("applyCompletion — under a status filter", () => {
  /*
    `docs/PRD.md` US-07 (ruling) and US-10. A list under `Active` shows only
    active todos at *every moment*, not only after a reload — a row kept on
    screen because the viewer just pressed it makes one filter mean two
    different things for two users looking at the same data.
  */

  test("completing a todo under Active drops it from the list at once", () => {
    const before = listOf([todo({ id: "a" }), todo({ id: "b" })]);

    const after = applyCompletion(before, "a", true, "active");

    expect(idsOf(after)).toEqual(["b"]);
  });

  test("un-completing a todo under Completed drops it from the list at once", () => {
    const before = listOf([
      todo({ id: "a", completed: true }),
      todo({ id: "b", completed: true }),
    ]);

    expect(idsOf(applyCompletion(before, "a", false, "completed"))).toEqual([
      "b",
    ]);
  });

  test("the counts still move, because they describe the account not the page", () => {
    const before = listOf([todo({ id: "a" }), todo({ id: "b" })]);

    const after = applyCompletion(before, "a", true, "active");

    // The row is gone from a filtered page whose counts were never about that
    // page: `GET /api/todos` counts without the filter clauses.
    expect(after.completedCount).toBe(1);
    expect(after.totalCount).toBe(2);
  });

  test("no other row moves when one is removed", () => {
    const before = listOf([
      todo({ id: "a" }),
      todo({ id: "b" }),
      todo({ id: "c" }),
    ]);

    expect(idsOf(applyCompletion(before, "b", true, "active"))).toEqual([
      "a",
      "c",
    ]);
  });

  test("the row leaves no section behind under Active", () => {
    const before = listOf([
      todo({ id: "overdue", dueAt: dueAt("2026-08-13") }),
      todo({ id: "undated" }),
    ]);

    const after = applyCompletion(before, "overdue", true, "active");

    // US-10: under Active the `Completed` heading never appears at any point.
    expect(groupTodos(after.todos, NOW).map((group) => group.id)).toEqual([
      "no-date",
    ]);
  });

  test("emptying the list under Active leaves an empty page, not a zeroed account", () => {
    const before = listOf([todo({ id: "a" })]);

    const after = applyCompletion(before, "a", true, "active");

    // `totalCount` is what decides between "Nothing here yet" and
    // "All caught up" (US-11 / US-10), so it must survive the removal.
    expect(after.todos).toEqual([]);
    expect(after.totalCount).toBe(1);
    expect(after.completedCount).toBe(1);
  });

  test("a row the filter still wants stays in place", () => {
    const before = listOf([todo({ id: "a", completed: true })]);

    // Only reachable as the in-place revert of a flip under `Completed`.
    const after = applyCompletion(before, "a", true, "completed");

    expect(after).toBe(before);
  });

  test("a row already gone cannot be put back by this function", () => {
    const before = listOf([todo({ id: "b" })]);

    /*
      Invariant 2. Only the server knows the §2 place a row returns to, so
      `TodoListScreen` refetches for that; silently appending it here would put
      it at an index no ordering rule chose.
    */
    expect(applyCompletion(before, "a", false, "active")).toBe(before);
  });
});

describe("applyCompletion — the revert", () => {
  /*
    The reason the whole design is allowed to be optimistic. Each test below
    presses, then rolls back, and asserts the list is indistinguishable from
    one where the press never happened.
  */

  test("a refused completion puts the box back and the count back", () => {
    const before = listOf([todo({ id: "a" }), todo({ id: "b" })]);

    const optimistic = applyCompletion(before, "a", true, "all");
    const reverted = applyCompletion(optimistic, "a", false, "all");

    expect(completedOf(reverted, "a")).toBe(false);
    expect(reverted.completedCount).toBe(before.completedCount);
    expect(reverted.totalCount).toBe(before.totalCount);
  });

  test("a refused un-completion puts the tick back", () => {
    const before = listOf([todo({ id: "a", completed: true })]);

    const optimistic = applyCompletion(before, "a", false, "all");
    const reverted = applyCompletion(optimistic, "a", true, "all");

    expect(completedOf(reverted, "a")).toBe(true);
    expect(reverted.completedCount).toBe(1);
  });

  test("the reverted list matches the original field for field", () => {
    const before = listOf([
      todo({ id: "a", title: "Alpha", note: "keep me", dueAt: dueAt("2026-08-13") }),
      todo({ id: "b", completed: true }),
    ]);

    const reverted = applyCompletion(
      applyCompletion(before, "a", true, "all"),
      "a",
      false,
      "all",
    );

    // Not just `completed`: a rollback that quietly dropped the note or the
    // due date would still satisfy a checkbox assertion.
    expect(reverted).toEqual(before);
  });

  test("reverting something that never applied is harmless", () => {
    const before = listOf([todo({ id: "a" })]);

    // `runToggle` reverts in `catch` without checking whether the flip landed.
    // That must not double-count.
    expect(applyCompletion(before, "a", false, "all")).toBe(before);
  });

  test("reverting twice does not drive the count below zero", () => {
    const before = listOf([todo({ id: "a", completed: true })]);

    const once = applyCompletion(before, "a", false, "all");
    const twice = applyCompletion(once, "a", false, "all");

    expect(twice.completedCount).toBe(0);
  });

  test("a revert puts the row back in the section it came from", () => {
    /*
      The half a checkbox assertion misses. Grouping re-sections on every
      change, so completing an overdue todo moves it out of `Overdue` and into
      `Completed` *before* the server agrees — and a revert that restored the
      boolean but left the row filed under `Completed` would be a rollback the
      user can still see.
    */
    const before = listOf([
      todo({ id: "overdue", dueAt: dueAt("2026-08-13") }),
      todo({ id: "later", dueAt: dueAt("2026-08-20") }),
    ]);

    expect(sectionOf(before, "overdue")).toBe("overdue");

    const optimistic = applyCompletion(before, "overdue", true, "all");

    expect(sectionOf(optimistic, "overdue")).toBe("completed");

    const reverted = applyCompletion(optimistic, "overdue", false, "all");

    expect(sectionOf(reverted, "overdue")).toBe("overdue");
    expect(groupTodos(reverted.todos, NOW).map((group) => group.id)).toEqual(
      groupTodos(before.todos, NOW).map((group) => group.id),
    );
  });

  test("a row removed by a filter is not restored locally — that is a refetch", () => {
    const before = listOf([todo({ id: "a" }), todo({ id: "b" })]);

    const optimistic = applyCompletion(before, "a", true, "active");
    const attempted = applyCompletion(optimistic, "a", false, "active");

    /*
      Deliberate, and the reason `runToggle` calls `reloadSilently()` on this
      path: putting the row back at index 0 because that is where it used to be
      would be a guess at §2's answer. The count also stays optimistic here —
      the refetch corrects both together.
    */
    expect(attempted).toBe(optimistic);
    expect(idsOf(attempted)).toEqual(["b"]);
  });
});

describe("replaceTodo — reconciling with the server", () => {
  test("splices the authoritative row in place of the guess", () => {
    const before = listOf([todo({ id: "a", title: "stale" }), todo({ id: "b" })]);
    const saved = todo({ id: "a", title: "authoritative", completed: true });

    const after = replaceTodo(applyCompletion(before, "a", true, "all"), saved);

    expect(after.todos[0]).toEqual(saved);
    expect(idsOf(after)).toEqual(["a", "b"]);
  });

  test("keeps the count right when the guess was already correct", () => {
    const before = listOf([todo({ id: "a" })]);

    const after = replaceTodo(
      applyCompletion(before, "a", true, "all"),
      todo({ id: "a", completed: true }),
    );

    expect(after.completedCount).toBe(1);
  });

  /*
    The correction below is `replaceTodo`'s reason for existing, and review
    MA-3 found it under-tested: zeroing the delta reddened one case out of
    nineteen, against four for the equivalent break in `applyCompletion`. The
    three tests that follow are aimed at that one line from three directions —
    upward, downward, and the mid-flight reload the line actually exists for.
  */

  test("corrects the count upward when the server disagrees with the guess", () => {
    // The row was already complete server-side — a duplicate write, or a flip
    // from another tab. The response is the truth and the count follows it.
    const before = listOf([todo({ id: "a" })]);

    const after = replaceTodo(before, todo({ id: "a", completed: true }));

    expect(after.completedCount).toBe(1);
    expect(completedOf(after, "a")).toBe(true);
  });

  test("corrects the count downward when the server says the row is not complete", () => {
    const before = listOf([
      todo({ id: "a", completed: true }),
      todo({ id: "b", completed: true }),
    ]);

    expect(before.completedCount).toBe(2);

    const after = replaceTodo(before, todo({ id: "a", completed: false }));

    expect(after.completedCount).toBe(1);
    expect(completedOf(after, "a")).toBe(false);
  });

  test("a reload landing mid-flight still reconciles to exactly one", () => {
    /*
      The race the by-difference correction is *for* (review MA-2). A `GET`
      lands between the press and the response and clobbers the optimistic
      flip with the pre-write truth. `replaceTodo` then measures against that
      reloaded row, not against the guess, and still moves the count by one.
      An assumed `+1` on top of the optimistic `+1` would double-count.
    */
    const pressed = applyCompletion(
      listOf([todo({ id: "a" }), todo({ id: "b" })]),
      "a",
      true,
      "all",
    );

    expect(pressed.completedCount).toBe(1);

    // The refetch arrives, carrying the state from before the write committed.
    const reloaded = listOf([todo({ id: "a" }), todo({ id: "b" })]);

    expect(reloaded.completedCount).toBe(0);

    const after = replaceTodo(reloaded, todo({ id: "a", completed: true }));

    expect(after.completedCount).toBe(1);
  });

  test("never moves the count when the row already agrees with the response", () => {
    const before = listOf([todo({ id: "a", completed: true })]);

    const after = replaceTodo(before, todo({ id: "a", completed: true }));

    expect(after.completedCount).toBe(1);
  });

  test("does not add a row the current filter is not showing", () => {
    const before = listOf([todo({ id: "a" })]);

    expect(replaceTodo(before, todo({ id: "elsewhere" }))).toBe(before);
  });

  test("does not mutate the result it was given", () => {
    const before = listOf([todo({ id: "a" })]);

    replaceTodo(before, todo({ id: "a", completed: true }));

    expect(before.todos[0].completed).toBe(false);
    expect(before.completedCount).toBe(0);
  });
});

/**
 * The quick-add bar's "is it hidden, or did it fail?" question (PM backlog #1).
 *
 * It never puts a row on screen — invariant 2 stands. It decides one sentence
 * of a toast, and the whole value of that sentence is that it agrees with the
 * list, so every case below is written against what `GET /api/todos` would
 * have returned for the same filters.
 */
describe("todoMatchesFilters", () => {
  const filters = (
    overrides: Partial<TodoListFilters> = {},
  ): TodoListFilters => ({
    status: "all",
    priority: "all",
    query: "",
    ...overrides,
  });

  test("the default filters hide nothing", () => {
    expect(todoMatchesFilters(todo({ id: "a" }), filters())).toBe(true);
  });

  test("a new todo is active, so the Completed filter hides it", () => {
    const created = todo({ id: "a" });

    expect(todoMatchesFilters(created, filters({ status: "completed" }))).toBe(
      false,
    );
    expect(todoMatchesFilters(created, filters({ status: "active" }))).toBe(true);
  });

  test("the priority filter matches by equality", () => {
    const created = todo({ id: "a", priority: "high" });

    expect(todoMatchesFilters(created, filters({ priority: "high" }))).toBe(true);
    expect(todoMatchesFilters(created, filters({ priority: "low" }))).toBe(false);
  });

  test("the search is a case-insensitive substring of the title", () => {
    const created = todo({ id: "a", title: "Buy Oat Milk" });

    expect(todoMatchesFilters(created, filters({ query: "oat" }))).toBe(true);
    expect(todoMatchesFilters(created, filters({ query: "MILK" }))).toBe(true);
    expect(todoMatchesFilters(created, filters({ query: "bread" }))).toBe(false);
  });

  /**
   * Backlog #4 widened `GET /api/todos` to search the note as well, and this
   * predicate had to move with it in the same commit. The direction of the
   * error is what makes that non-optional: left reading titles only, it would
   * call a note-matching row *hidden* while the list was showing it, and the
   * quick-add toast would say "hidden by your filters" about a todo sitting in
   * front of the user. `tests/api/filterPredicate.test.ts` is what catches the
   * drift against the real handler; this pins the intent.
   */
  test("the search reads the note as well as the title, as the server does", () => {
    const created = todo({ id: "a", title: "Call the vet", note: "about milk" });

    expect(todoMatchesFilters(created, filters({ query: "milk" }))).toBe(true);
    expect(todoMatchesFilters(created, filters({ query: "MILK" }))).toBe(true);
    expect(todoMatchesFilters(created, filters({ query: "vet" }))).toBe(true);
    expect(todoMatchesFilters(created, filters({ query: "bread" }))).toBe(false);
  });

  test("a todo with no note is matched on its title alone, and not crashed on", () => {
    // `note` is nullable, and the row the quick-add bar asks about usually has
    // none — the bar collects a title.
    const created = todo({ id: "a", title: "Buy milk", note: null });

    expect(todoMatchesFilters(created, filters({ query: "milk" }))).toBe(true);
    expect(todoMatchesFilters(created, filters({ query: "vet" }))).toBe(false);
  });

  test("a note folds the same way a title does", () => {
    // `fold` is applied to whichever field is being read, so the İ and the
    // accent cases hold in the note exactly as they do in the title.
    const created = todo({ id: "a", title: "Trip", note: "İstanbul, café" });

    expect(todoMatchesFilters(created, filters({ query: "istanbul" }))).toBe(
      true,
    );
    expect(todoMatchesFilters(created, filters({ query: "cafe" }))).toBe(true);
  });

  /**
   * Review finding: JavaScript and Postgres disagree about lowercasing. `İ`
   * (U+0130) folds to a bare `i` under glibc — which is what `ILIKE` uses —
   * and to `i` plus a combining dot (U+0069 U+0307) in JavaScript, so a naive
   * `toLowerCase().includes()` called `İstanbul` hidden while the row sat in
   * the list. `fold` decomposes and drops the marks, which folds at least as
   * far as any collation will.
   */
  test("folds hard enough that no collation matches less than it does", () => {
    const istanbul = todo({ id: "a", title: "İstanbul trip" });

    expect(todoMatchesFilters(istanbul, filters({ query: "istanbul" }))).toBe(
      true,
    );
    expect(todoMatchesFilters(istanbul, filters({ query: "İSTANBUL" }))).toBe(
      true,
    );

    // Accents fold too. This is the direction that is *allowed* to be looser
    // than the server: erring toward "visible" costs a plain toast, erring
    // toward "hidden" costs a sentence that is a lie.
    const cafe = todo({ id: "b", title: "Café receipts" });

    expect(todoMatchesFilters(cafe, filters({ query: "cafe" }))).toBe(true);
    expect(todoMatchesFilters(cafe, filters({ query: "café" }))).toBe(true);
  });

  test("still says hidden when the words genuinely are not there", () => {
    // The folding must not collapse into "everything matches".
    const istanbul = todo({ id: "a", title: "İstanbul trip" });

    expect(todoMatchesFilters(istanbul, filters({ query: "berlin" }))).toBe(
      false,
    );
    expect(todoMatchesFilters(istanbul, filters({ query: "istanbulx" }))).toBe(
      false,
    );
  });

  test("filters combine with AND", () => {
    const created = todo({ id: "a", title: "Buy milk", priority: "high" });

    expect(
      todoMatchesFilters(
        created,
        filters({ status: "active", priority: "high", query: "milk" }),
      ),
    ).toBe(true);
    expect(
      todoMatchesFilters(
        created,
        filters({ status: "active", priority: "low", query: "milk" }),
      ),
    ).toBe(false);
  });
});
