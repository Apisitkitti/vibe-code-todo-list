import { describe, expect, test } from "vitest";

import type { TodoItemData } from "@/lib/todo";
import {
  TODO_GROUP_HEADINGS,
  TODO_GROUP_IDS,
  groupTodos,
  todoGroupId,
} from "@/lib/todoGroups";

/**
 * The client half of the ordering rule: which section a todo falls in, and
 * when the headings appear at all.
 *
 * Like `todoDates.test.ts`, every `now` is built with the local-time `Date`
 * constructor rather than from an ISO string. "Today" is the *viewer's*
 * calendar day while `dueAt` is stored at UTC midnight, and an ISO literal
 * would quietly make these pass in UTC and fail for anyone running them from
 * an offset — the exact bug this grouping has to get right.
 */

/** Local noon on 16 August 2026, so the local calendar day is unambiguous. */
const NOW = new Date(2026, 7, 16, 12, 0, 0);

/** UTC midnight, which is how the API stores and returns every due date. */
const dueAt = (day: string) => `${day}T00:00:00.000Z`;

const todo = (overrides: Partial<TodoItemData> & { id: string }): TodoItemData => ({
  title: overrides.id,
  note: null,
  priority: "medium",
  completed: false,
  dueAt: null,
  createdAt: "2026-08-01T00:00:00.000Z",
  ...overrides,
});

describe("todoGroupId", () => {
  test("a todo due today, stored at UTC midnight, is Today", () => {
    expect(todoGroupId(todo({ id: "a", dueAt: dueAt("2026-08-16") }), NOW)).toBe(
      "today",
    );
  });

  test("a todo due yesterday is Overdue", () => {
    expect(todoGroupId(todo({ id: "a", dueAt: dueAt("2026-08-15") }), NOW)).toBe(
      "overdue",
    );
  });

  test("a todo due tomorrow is Upcoming", () => {
    expect(todoGroupId(todo({ id: "a", dueAt: dueAt("2026-08-17") }), NOW)).toBe(
      "upcoming",
    );
  });

  test("a todo with no due date is No date", () => {
    expect(todoGroupId(todo({ id: "a", dueAt: null }), NOW)).toBe("no-date");
  });

  /**
   * Completion beats the date. An overdue todo that is *finished* has nothing
   * left to be urgent about, and leaving it in Overdue would put done work at
   * the very top of the list — the loudest possible place for it.
   */
  test("a completed overdue todo is Completed, not Overdue", () => {
    expect(
      todoGroupId(
        todo({ id: "a", dueAt: dueAt("2026-01-01"), completed: true }),
        NOW,
      ),
    ).toBe("completed");
  });

  test("a completed todo due today is Completed too", () => {
    expect(
      todoGroupId(
        todo({ id: "a", dueAt: dueAt("2026-08-16"), completed: true }),
        NOW,
      ),
    ).toBe("completed");
  });

  test("a completed undated todo is Completed, not No date", () => {
    expect(todoGroupId(todo({ id: "a", completed: true }), NOW)).toBe("completed");
  });

  /** Same instinct as `formatDueDate`, which renders nothing rather than guessing. */
  test("a value that is not a date at all falls back to No date", () => {
    expect(todoGroupId(todo({ id: "a", dueAt: "not-a-date" }), NOW)).toBe(
      "no-date",
    );
  });

  describe("the boundary between today and tomorrow, in the user's own day", () => {
    const dueTomorrowMorning = todo({ id: "a", dueAt: dueAt("2026-08-17") });
    const dueTodayMorning = todo({ id: "b", dueAt: dueAt("2026-08-16") });

    test("one second before local midnight, the 17th is still Upcoming", () => {
      const lateTonight = new Date(2026, 7, 16, 23, 59, 59);

      expect(todoGroupId(dueTomorrowMorning, lateTonight)).toBe("upcoming");
      expect(todoGroupId(dueTodayMorning, lateTonight)).toBe("today");
    });

    test("at local midnight the sections move on: the 17th becomes Today", () => {
      const justAfterMidnight = new Date(2026, 7, 17, 0, 0, 0);

      expect(todoGroupId(dueTomorrowMorning, justAfterMidnight)).toBe("today");
      expect(todoGroupId(dueTodayMorning, justAfterMidnight)).toBe("overdue");
    });

    /**
     * A due date is a calendar day, not an instant, so the clock time inside
     * the stored value must not move a todo between sections.
     */
    test("the time of day inside the stored value changes nothing", () => {
      const endOfUtcDay = todo({ id: "a", dueAt: "2026-08-16T23:59:59.000Z" });

      expect(todoGroupId(endOfUtcDay, NOW)).toBe("today");
    });
  });
});

describe("groupTodos", () => {
  test("returns the sections in urgency order, whatever order the rows arrive in", () => {
    const groups = groupTodos(
      [
        todo({ id: "done", completed: true }),
        todo({ id: "none" }),
        todo({ id: "later", dueAt: dueAt("2026-09-01") }),
        todo({ id: "today", dueAt: dueAt("2026-08-16") }),
        todo({ id: "late", dueAt: dueAt("2026-08-10") }),
      ],
      NOW,
    );

    expect(groups.map((group) => group.id)).toEqual([
      "overdue",
      "today",
      "upcoming",
      "no-date",
      "completed",
    ]);
  });

  test("every section carries its copy-deck heading", () => {
    const groups = groupTodos(
      [
        todo({ id: "late", dueAt: dueAt("2026-08-10") }),
        todo({ id: "today", dueAt: dueAt("2026-08-16") }),
        todo({ id: "later", dueAt: dueAt("2026-09-01") }),
        todo({ id: "none" }),
        todo({ id: "done", completed: true }),
      ],
      NOW,
    );

    expect(groups.map((group) => group.heading)).toEqual([
      "Overdue",
      "Today",
      "Upcoming",
      "No date",
      "Completed",
    ]);
  });

  test("an empty section is not returned at all", () => {
    const groups = groupTodos(
      [
        todo({ id: "late", dueAt: dueAt("2026-08-10") }),
        todo({ id: "done", completed: true }),
      ],
      NOW,
    );

    expect(groups.map((group) => group.id)).toEqual(["overdue", "completed"]);
  });

  /**
   * The requirement PM wrote as a requirement rather than a nicety: a user who
   * has never set a due date must see exactly the list they see today. One
   * section is what the UI reads to decide that no headings render.
   */
  test("a list with no due dates anywhere collapses to a single section", () => {
    const groups = groupTodos(
      [todo({ id: "a" }), todo({ id: "b" }), todo({ id: "c" })],
      NOW,
    );

    expect(groups).toHaveLength(1);
    expect(groups[0].id).toBe("no-date");
  });

  test("no todos means no sections", () => {
    expect(groupTodos([], NOW)).toEqual([]);
  });

  /**
   * Grouping cuts the server's sequence; it never re-sorts it. If it did, the
   * app would hold a second opinion about ordering and the two would drift.
   */
  test("keeps the order rows arrived in within a section", () => {
    const groups = groupTodos(
      [
        todo({ id: "first", dueAt: dueAt("2026-09-01") }),
        todo({ id: "second", dueAt: dueAt("2026-09-02") }),
        todo({ id: "third", dueAt: dueAt("2026-09-03") }),
      ],
      NOW,
    );

    expect(groups[0].todos.map((entry) => entry.id)).toEqual([
      "first",
      "second",
      "third",
    ]);
  });

  test("every todo lands in exactly one section", () => {
    const todos = [
      todo({ id: "late", dueAt: dueAt("2026-08-10") }),
      todo({ id: "today", dueAt: dueAt("2026-08-16") }),
      todo({ id: "later", dueAt: dueAt("2026-09-01") }),
      todo({ id: "none" }),
      todo({ id: "done", completed: true }),
      todo({ id: "done-late", dueAt: dueAt("2026-01-01"), completed: true }),
    ];

    const grouped = groupTodos(todos, NOW).flatMap((group) => group.todos);

    expect(grouped).toHaveLength(todos.length);
    expect(new Set(grouped.map((entry) => entry.id)).size).toBe(todos.length);
  });
});

describe("the section vocabulary", () => {
  test("every id has a heading, and there are no spare headings", () => {
    expect(Object.keys(TODO_GROUP_HEADINGS).sort()).toEqual(
      [...TODO_GROUP_IDS].sort(),
    );
  });

  /** The render order is this array, so its order is part of the contract. */
  test("the ids are declared in the order the list shows them", () => {
    expect(TODO_GROUP_IDS).toEqual([
      "overdue",
      "today",
      "upcoming",
      "no-date",
      "completed",
    ]);
  });
});
