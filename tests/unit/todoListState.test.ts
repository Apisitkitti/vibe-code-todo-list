import { describe, expect, test } from "vitest";

import type { TodoItemData, TodoListResult } from "@/lib/todo";
import { groupTodos } from "@/lib/todoGroups";
import { replaceTodo, setTodoCompleted } from "@/lib/todoListState";

/**
 * The optimistic toggle's local half (review m-7, PM backlog #3).
 *
 * `docs/REVIEW.md` E-2 is explicit about why this file exists: *"optimistic
 * state has exactly one failure mode — the revert — and QA has no fault
 * injection. The moment we apply changes locally, we have a correctness
 * property with no verifier."* Playwright now injects the 500 and checks what
 * the user is left looking at; this file checks the thing a browser cannot be
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

describe("setTodoCompleted — the flip", () => {
  test("marks the row complete without waiting for anything", () => {
    const before = listOf([todo({ id: "a" }), todo({ id: "b" })]);

    const after = setTodoCompleted(before, "a", true);

    expect(completedOf(after, "a")).toBe(true);
    expect(completedOf(after, "b")).toBe(false);
  });

  test("moves the completed count with the box, so the header agrees", () => {
    const before = listOf([todo({ id: "a" }), todo({ id: "b" })]);

    expect(setTodoCompleted(before, "a", true).completedCount).toBe(1);
  });

  test("un-completing takes the count back down", () => {
    const before = listOf([todo({ id: "a", completed: true })]);

    expect(setTodoCompleted(before, "a", false).completedCount).toBe(0);
  });

  test("never touches the total — a toggle creates and destroys nothing", () => {
    const before = listOf([todo({ id: "a" }), todo({ id: "b" })]);

    expect(setTodoCompleted(before, "a", true).totalCount).toBe(2);
  });

  test("leaves every row where the server put it", () => {
    const before = listOf([
      todo({ id: "a" }),
      todo({ id: "b" }),
      todo({ id: "c" }),
    ]);

    // Ordering is the server's (`TODO_LIST_ORDER_BY`); the client only cuts
    // sections. A flip must not re-sequence the page under the user.
    expect(idsOf(setTodoCompleted(before, "b", true))).toEqual(["a", "b", "c"]);
  });

  test("does not mutate the result it was given", () => {
    const before = listOf([todo({ id: "a" })]);

    setTodoCompleted(before, "a", true);

    expect(before.completedCount).toBe(0);
    expect(before.todos[0].completed).toBe(false);
  });

  test("an id that is not on screen changes nothing at all", () => {
    const before = listOf([todo({ id: "a" })]);

    // Identity, not equality: a filtered-out row must not re-render the list.
    expect(setTodoCompleted(before, "missing", true)).toBe(before);
  });

  test("writing the value a row already holds is a no-op", () => {
    const before = listOf([todo({ id: "a", completed: true })]);

    expect(setTodoCompleted(before, "a", true)).toBe(before);
  });
});

describe("setTodoCompleted — the revert", () => {
  /*
    The reason the whole design is allowed to be optimistic. Each test below
    presses, then rolls back, and asserts the list is indistinguishable from
    one where the press never happened.
  */

  test("a refused completion puts the box back and the count back", () => {
    const before = listOf([todo({ id: "a" }), todo({ id: "b" })]);

    const optimistic = setTodoCompleted(before, "a", true);
    const reverted = setTodoCompleted(optimistic, "a", false);

    expect(completedOf(reverted, "a")).toBe(false);
    expect(reverted.completedCount).toBe(before.completedCount);
    expect(reverted.totalCount).toBe(before.totalCount);
  });

  test("a refused un-completion puts the tick back", () => {
    const before = listOf([todo({ id: "a", completed: true })]);

    const optimistic = setTodoCompleted(before, "a", false);
    const reverted = setTodoCompleted(optimistic, "a", true);

    expect(completedOf(reverted, "a")).toBe(true);
    expect(reverted.completedCount).toBe(1);
  });

  test("the reverted list matches the original field for field", () => {
    const before = listOf([
      todo({ id: "a", title: "Alpha", note: "keep me", dueAt: dueAt("2026-08-13") }),
      todo({ id: "b", completed: true }),
    ]);

    const reverted = setTodoCompleted(
      setTodoCompleted(before, "a", true),
      "a",
      false,
    );

    // Not just `completed`: a rollback that quietly dropped the note or the
    // due date would still satisfy a checkbox assertion.
    expect(reverted).toEqual(before);
  });

  test("reverting something that never applied is harmless", () => {
    const before = listOf([todo({ id: "a" })]);

    // `runToggle` reverts unconditionally in `catch`, including when the
    // request failed before the flip could matter. That must not double-count.
    expect(setTodoCompleted(before, "a", false)).toBe(before);
    expect(setTodoCompleted(before, "a", false).completedCount).toBe(0);
  });

  test("reverting twice does not drive the count below zero", () => {
    const before = listOf([todo({ id: "a", completed: true })]);

    const once = setTodoCompleted(before, "a", false);
    const twice = setTodoCompleted(once, "a", false);

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

    const optimistic = setTodoCompleted(before, "overdue", true);

    expect(sectionOf(optimistic, "overdue")).toBe("completed");

    const reverted = setTodoCompleted(optimistic, "overdue", false);

    expect(sectionOf(reverted, "overdue")).toBe("overdue");
    expect(groupTodos(reverted.todos, NOW).map((group) => group.id)).toEqual(
      groupTodos(before.todos, NOW).map((group) => group.id),
    );
  });
});

describe("replaceTodo — reconciling with the server", () => {
  test("splices the authoritative row in place of the guess", () => {
    const before = listOf([todo({ id: "a", title: "stale" }), todo({ id: "b" })]);
    const saved = todo({ id: "a", title: "authoritative", completed: true });

    const after = replaceTodo(setTodoCompleted(before, "a", true), saved);

    expect(after.todos[0]).toEqual(saved);
    expect(idsOf(after)).toEqual(["a", "b"]);
  });

  test("keeps the count right when the guess was already correct", () => {
    const before = listOf([todo({ id: "a" })]);

    const after = replaceTodo(
      setTodoCompleted(before, "a", true),
      todo({ id: "a", completed: true }),
    );

    expect(after.completedCount).toBe(1);
  });

  test("corrects the count when the server disagrees with the guess", () => {
    // The row was already complete server-side — a duplicate write, or a flip
    // from another tab. The response is the truth and the count follows it.
    const before = listOf([todo({ id: "a" })]);

    const after = replaceTodo(before, todo({ id: "a", completed: true }));

    expect(after.completedCount).toBe(1);
    expect(completedOf(after, "a")).toBe(true);
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
