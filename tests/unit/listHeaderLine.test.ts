import { describe, expect, test } from "vitest";

import { formatHeaderDate, formatListHeaderLine } from "@/lib/listHeaderLine";
import type { TodoItemData } from "@/lib/todo";
import { groupTodos } from "@/lib/todoGroups";

/**
 * The dated header line (`docs/PRD.md` US-12).
 *
 * Every case here is built by running real todos through `groupTodos` rather
 * than by hand-assembling a `TodoGroup[]`. That is the point of the feature:
 * the counts are the sizes of the sections the list is drawing, so a test that
 * fabricated the sections would be testing a string join and would pass
 * happily on a header that had stopped agreeing with the list.
 *
 * Like `todoGroups.test.ts`, `now` is built with the local-time `Date`
 * constructor. "Today" is the *viewer's* calendar day while `dueAt` is stored
 * at UTC midnight, and an ISO literal would make these pass in UTC and fail
 * for anyone running them from an offset — which is why CI runs the suite with
 * `TZ=Pacific/Kiritimati`.
 */

/** Local noon on Sunday 16 August 2026, so the local calendar day is unambiguous. */
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

const lineFor = (todos: TodoItemData[], now: Date = NOW) =>
  formatListHeaderLine(groupTodos(todos, now), now);

describe("formatHeaderDate", () => {
  test("is the weekday, the day of the month and the month", () => {
    expect(formatHeaderDate(NOW)).toBe("Sunday, 16 August");
  });

  test("carries no year and no ordinal suffix", () => {
    expect(formatHeaderDate(NOW)).not.toMatch(/2026|16th/);
  });

  test("reads the viewer's local day, not UTC", () => {
    /*
      23:30 local on the 16th. Anywhere east of UTC that instant is already the
      17th in UTC, so a header built from `dayjs.utc` would name the wrong day
      and the wrong weekday — the mirror image of the bug `dueDayOffset`
      exists to avoid on the row.
    */
    expect(formatHeaderDate(new Date(2026, 7, 16, 23, 30, 0))).toBe(
      "Sunday, 16 August",
    );
  });
});

describe("formatListHeaderLine", () => {
  test("both clauses, due today before overdue", () => {
    expect(
      lineFor([
        todo({ id: "a", dueAt: dueAt("2026-08-16") }),
        todo({ id: "b", dueAt: dueAt("2026-08-16") }),
        todo({ id: "c", dueAt: dueAt("2026-08-16") }),
        todo({ id: "d", dueAt: dueAt("2026-08-10") }),
      ]),
    ).toBe("Sunday, 16 August · 3 due today · 1 overdue");
  });

  test("a zero clause is omitted entirely rather than shown as 0", () => {
    expect(lineFor([todo({ id: "a", dueAt: dueAt("2026-08-10") })])).toBe(
      "Sunday, 16 August · 1 overdue",
    );
    expect(lineFor([todo({ id: "a", dueAt: dueAt("2026-08-16") })])).toBe(
      "Sunday, 16 August · 1 due today",
    );
  });

  test("with neither, the line is the date alone", () => {
    expect(
      lineFor([
        todo({ id: "a", dueAt: null }),
        todo({ id: "b", dueAt: dueAt("2026-08-30") }),
      ]),
    ).toBe("Sunday, 16 August");
  });

  test("an empty list is the date alone, with no special case", () => {
    expect(lineFor([])).toBe("Sunday, 16 August");
  });

  test("`null` groups — not loaded — is the date alone", () => {
    expect(formatListHeaderLine(null, NOW)).toBe("Sunday, 16 August");
  });

  /**
   * US-12: "a completed todo is in `Completed`, not in `Today` or `Overdue`,
   * however its due date reads". This is free, and it is free *because* the
   * counts come from the sections — `todoGroupId` puts completion first, so
   * there is no second rule here that could disagree with it.
   */
  test("completed todos are never counted, whatever their date says", () => {
    expect(
      lineFor([
        todo({ id: "a", dueAt: dueAt("2026-08-16"), completed: true }),
        todo({ id: "b", dueAt: dueAt("2026-08-01"), completed: true }),
      ]),
    ).toBe("Sunday, 16 August");
  });

  /**
   * US-12: "the counts describe the todos currently shown, so the line and the
   * list can never disagree". A filtered list is simply a shorter `todos`
   * array by the time it reaches here, so this is the filtered case stated as
   * the invariant it actually is — the line counts what it was given.
   */
  test("the counts are the sizes of the sections, on any subset", () => {
    const all = [
      todo({ id: "a", dueAt: dueAt("2026-08-16") }),
      todo({ id: "b", dueAt: dueAt("2026-08-16") }),
      todo({ id: "c", dueAt: dueAt("2026-08-10") }),
    ];
    const filtered = all.slice(0, 1);

    expect(lineFor(all)).toBe("Sunday, 16 August · 2 due today · 1 overdue");
    expect(lineFor(filtered)).toBe("Sunday, 16 August · 1 due today");

    // Stated against the sections themselves, so this fails if the header ever
    // starts counting from anywhere else.
    const groups = groupTodos(all, NOW);
    const sizeOf = (id: string) =>
      groups.find((group) => group.id === id)?.todos.length ?? 0;

    expect(formatListHeaderLine(groups, NOW)).toContain(
      `${sizeOf("today")} due today`,
    );
    expect(formatListHeaderLine(groups, NOW)).toContain(
      `${sizeOf("overdue")} overdue`,
    );
  });

  test("singular and plural share one wording, with no `1 todos`", () => {
    expect(lineFor([todo({ id: "a", dueAt: dueAt("2026-08-16") })])).toContain(
      "1 due today",
    );
    expect(
      lineFor([
        todo({ id: "a", dueAt: dueAt("2026-08-10") }),
        todo({ id: "b", dueAt: dueAt("2026-08-11") }),
      ]),
    ).toContain("2 overdue");
  });
});
