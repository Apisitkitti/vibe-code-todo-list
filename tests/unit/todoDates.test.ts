import { describe, expect, test } from "vitest";

import { formatDueDate } from "@/lib/date";
import { parseDueDate, toDueDateInputValue } from "@/lib/todo";

/**
 * The two halves of the due-date round trip. `parseDueDate` turns the wire
 * format into a UTC instant; `formatDueDate` turns it back into the words the
 * row shows.
 *
 * `now` is always built with the local-time `Date` constructor rather than an
 * ISO string. `formatDueDate` reads "today" in the viewer's own calendar day,
 * so an ISO literal would make these tests pass in UTC and fail for anyone
 * running them from a non-zero offset — a real failure mode for a team split
 * across timezones, and one CI would never catch on its own.
 */

describe("parseDueDate", () => {
  test("an empty value means no due date", () => {
    expect(parseDueDate("")).toBeNull();
  });

  test("whitespace is trimmed away to no due date", () => {
    expect(parseDueDate("   ")).toBeNull();
  });

  test("a valid day becomes UTC midnight", () => {
    const parsed = parseDueDate("2026-08-16");

    expect(parsed).toBeInstanceOf(Date);
    expect((parsed as Date).toISOString()).toBe("2026-08-16T00:00:00.000Z");
  });

  test("surrounding whitespace is tolerated", () => {
    expect((parseDueDate("  2026-08-16  ") as Date).toISOString()).toBe(
      "2026-08-16T00:00:00.000Z",
    );
  });

  test("a leap day in a leap year is valid", () => {
    expect((parseDueDate("2024-02-29") as Date).toISOString()).toBe(
      "2024-02-29T00:00:00.000Z",
    );
  });

  /**
   * Strict parsing is the point: without it dayjs rolls "2026-02-31" forward
   * to 3 March and the user silently gets a different date than they typed.
   */
  test.each([
    ["a day that does not exist in that month", "2026-02-31"],
    ["a leap day in a non-leap year", "2025-02-29"],
    ["a month above twelve", "2026-13-01"],
    ["a zero month", "2026-00-10"],
    ["a single-digit month, which is not the wire format", "2026-8-16"],
    ["a full ISO timestamp", "2026-08-16T10:00:00Z"],
    ["a slash-separated date", "2026/08/16"],
    ["a day-first date", "16-08-2026"],
    ["free text", "next tuesday"],
  ])("rejects %s", (_label, value) => {
    expect(parseDueDate(value)).toBe("invalid");
  });
});

describe("toDueDateInputValue", () => {
  test("takes the calendar day off an ISO instant", () => {
    expect(toDueDateInputValue("2026-08-16T00:00:00.000Z")).toBe("2026-08-16");
  });

  test("no due date becomes an empty field", () => {
    expect(toDueDateInputValue(null)).toBe("");
  });

  test("round-trips through parseDueDate", () => {
    const parsed = parseDueDate("2026-08-16") as Date;

    expect(toDueDateInputValue(parsed.toISOString())).toBe("2026-08-16");
  });
});

describe("formatDueDate", () => {
  /** Local noon on 16 August 2026, so the local calendar day is unambiguous. */
  const now = new Date(2026, 7, 16, 12, 0, 0);

  test("today", () => {
    expect(formatDueDate("2026-08-16T00:00:00.000Z", now)).toEqual({
      label: "Today",
      isOverdue: false,
    });
  });

  test("tomorrow", () => {
    expect(formatDueDate("2026-08-17T00:00:00.000Z", now)).toEqual({
      label: "Tomorrow",
      isOverdue: false,
    });
  });

  test("yesterday is overdue", () => {
    expect(formatDueDate("2026-08-15T00:00:00.000Z", now)).toEqual({
      label: "Yesterday",
      isOverdue: true,
    });
  });

  test("a date later this year omits the year", () => {
    expect(formatDueDate("2026-12-25T00:00:00.000Z", now)).toEqual({
      label: "Dec 25",
      isOverdue: false,
    });
  });

  test("a date earlier this year is overdue and omits the year", () => {
    expect(formatDueDate("2026-01-05T00:00:00.000Z", now)).toEqual({
      label: "Jan 5",
      isOverdue: true,
    });
  });

  test("a date in another year carries the year", () => {
    expect(formatDueDate("2027-03-01T00:00:00.000Z", now)).toEqual({
      label: "Mar 1, 2027",
      isOverdue: false,
    });
  });

  test("a past year is overdue and carries the year", () => {
    expect(formatDueDate("2025-11-30T00:00:00.000Z", now)).toEqual({
      label: "Nov 30, 2025",
      isOverdue: true,
    });
  });

  test("an unparseable value renders as nothing rather than throwing", () => {
    expect(formatDueDate("not-a-date", now)).toEqual({
      label: "",
      isOverdue: false,
    });
  });

  test("an empty string renders as nothing", () => {
    expect(formatDueDate("", now)).toEqual({ label: "", isOverdue: false });
  });

  /**
   * The boundary that the UTC-day comparison exists to get right: an instant
   * late on the previous UTC day is still "today" only if it lands on the same
   * UTC calendar day, regardless of the clock time inside it.
   */
  test("compares calendar days, not instants", () => {
    expect(formatDueDate("2026-08-16T23:59:59.000Z", now).label).toBe("Today");
    expect(formatDueDate("2026-08-16T00:00:00.000Z", now).label).toBe("Today");
  });
});
