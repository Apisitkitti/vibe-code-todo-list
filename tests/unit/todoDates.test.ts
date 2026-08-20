import { afterAll, describe, expect, test } from "vitest";

import {
  NEXT_WEEK_DAY_OFFSET,
  TODAY_DAY_OFFSET,
  TOMORROW_DAY_OFFSET,
  dueDayOffset,
  formatDueDate,
  rescheduleDay,
} from "@/lib/date";
import { parseDueDate, toDueDateInputValue } from "@/lib/todo";

/**
 * Puts `TZ` back the way it was found, **including when it was not set at
 * all** — which is the normal state on macOS and on most developer machines.
 *
 * `process.env.TZ = undefined` assigns the *string* `"undefined"`, which Node
 * cannot parse as a zone and silently treats as UTC. UTC is the one timezone
 * in which every bug this file exists to catch disappears, so a test that
 * "restored" `TZ` that way would leave the process in the exact state that
 * makes its neighbours pass for the wrong reason. Nothing is affected today —
 * the two tests that set `TZ` are declared last and Vitest runs in declaration
 * order — but that is an ordering accident, not a guarantee, and the next date
 * test added below them would inherit it.
 */
/**
 * The process's real offset, read at import time — before any test in this file
 * has touched `process.env.TZ`. The guard at the bottom compares against it.
 */
const OFFSET_AT_IMPORT = new Date(2026, 7, 16, 12, 0, 0).getTimezoneOffset();

const restoreTimezone = (previous: string | undefined) => {
  if (previous === undefined) {
    delete process.env.TZ;

    return;
  }

  process.env.TZ = previous;
};

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

/**
 * The day arithmetic both the row label and the list grouping read, so that
 * the app has one answer to "what day is it" rather than two that agree until
 * they do not.
 */
describe("dueDayOffset", () => {
  /** Local noon on 16 August 2026, so the local calendar day is unambiguous. */
  const now = new Date(2026, 7, 16, 12, 0, 0);

  test.each([
    ["today", "2026-08-16T00:00:00.000Z", 0],
    ["tomorrow", "2026-08-17T00:00:00.000Z", 1],
    ["yesterday", "2026-08-15T00:00:00.000Z", -1],
    ["a week out", "2026-08-23T00:00:00.000Z", 7],
    ["last year", "2025-08-16T00:00:00.000Z", -365],
  ])("%s", (_label, iso, expected) => {
    expect(dueDayOffset(iso, now)).toBe(expected);
  });

  test("counts calendar days, so the clock time inside the value is ignored", () => {
    expect(dueDayOffset("2026-08-16T23:59:59.000Z", now)).toBe(0);
    expect(dueDayOffset("2026-08-16T00:00:00.000Z", now)).toBe(0);
  });

  test("moves with the user's own midnight, not with UTC's", () => {
    expect(dueDayOffset("2026-08-17T00:00:00.000Z", new Date(2026, 7, 16, 23, 59, 59))).toBe(1);
    expect(dueDayOffset("2026-08-17T00:00:00.000Z", new Date(2026, 7, 17, 0, 0, 0))).toBe(0);
  });

  test("a value that is not a date has no offset at all", () => {
    expect(dueDayOffset("not-a-date", now)).toBeNull();
    expect(dueDayOffset("", now)).toBeNull();
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

/**
 * The reschedule menu's half of the due-date round trip (backlog #5).
 *
 * `rescheduleDay` has to be the exact inverse of `dueDayOffset`, or the row
 * reads back a date the menu did not set: pressing `Today` and being shown
 * `Tomorrow` is the entire defect this suite exists to prevent, and it is
 * invisible from a machine sitting at UTC.
 *
 * So the property is asserted rather than a handful of examples: for every hour
 * of the local day, the day `rescheduleDay` produces, stored the way the route
 * stores it, is read back by `dueDayOffset` as exactly the offset asked for.
 * That holds in any timezone the suite is run in, which is what makes it worth
 * having on a team split across offsets — CI runs at `TZ=Pacific/Kiritimati`,
 * and the Kiritimati case below is pinned directly as well so the guarantee
 * does not depend on where anybody happens to be sitting.
 */
describe("rescheduleDay", () => {
  /** Every hour of one local day, so a UTC-vs-local slip cannot hide in a gap. */
  const LOCAL_HOURS = Array.from({ length: 24 }, (_hour, index) => index);

  /** What the route does with the wire day before the row ever reads it back. */
  const asStored = (wireDay: string) => (parseDueDate(wireDay) as Date).toISOString();

  const OFFSETS = [
    ["Today", TODAY_DAY_OFFSET],
    ["Tomorrow", TOMORROW_DAY_OFFSET],
    ["Next week", NEXT_WEEK_DAY_OFFSET],
  ] as const;

  test.each(OFFSETS)(
    "%s survives the round trip at every hour of the local day",
    (_label, dayOffset) => {
      for (const hour of LOCAL_HOURS) {
        const now = new Date(2026, 7, 16, hour, 30, 0);

        expect(
          dueDayOffset(asStored(rescheduleDay(dayOffset, now).dueAt), now),
          `offset ${dayOffset} at local hour ${hour}`,
        ).toBe(dayOffset);
      }
    },
  );

  test("Next week is the same weekday, seven days on — not the start of a week", () => {
    // A Sunday, so a "start of next week" reading would land on a different day
    // whichever convention it picked, and +7 lands on the next Sunday.
    const sunday = new Date(2026, 7, 16, 12, 0, 0);

    expect(rescheduleDay(NEXT_WEEK_DAY_OFFSET, sunday).dueAt).toBe("2026-08-23");
    expect(new Date(2026, 7, 23).getDay()).toBe(sunday.getDay());
  });

  test("the three offsets are 0, 1 and 7 — the contract the menu is built on", () => {
    expect([TODAY_DAY_OFFSET, TOMORROW_DAY_OFFSET, NEXT_WEEK_DAY_OFFSET]).toEqual([
      0, 1, 7,
    ]);
  });

  test("today is the local calendar day, not the UTC one", () => {
    // 23:30 local on the 16th. Anywhere east of UTC this instant is already the
    // 16th locally while UTC may still read the 16th too — the assertion that
    // separates the two implementations is the round trip above; this pins the
    // simpler statement that the wire day is formatted from local time.
    const lateEvening = new Date(2026, 7, 16, 23, 30, 0);

    expect(rescheduleDay(TODAY_DAY_OFFSET, lateEvening).dueAt).toBe("2026-08-16");
  });

  test("the preview names the day the row will show", () => {
    const now = new Date(2026, 7, 16, 12, 0, 0);

    expect(rescheduleDay(TOMORROW_DAY_OFFSET, now).preview).toBe("Aug 17");
    expect(rescheduleDay(NEXT_WEEK_DAY_OFFSET, now).preview).toBe("Aug 23");
  });

  test("the preview carries the year when the day falls in another one", () => {
    const newYearsEve = new Date(2026, 11, 28, 12, 0, 0);

    expect(rescheduleDay(NEXT_WEEK_DAY_OFFSET, newYearsEve).preview).toBe(
      "Jan 4, 2027",
    );
  });

  /**
   * dayjs adds days by setting the date component rather than by adding
   * 86,400,000ms, so a DST transition inside the span does not move the answer.
   * Pinned because the alternative implementation is a plausible one-line
   * change and its failure is a single wrong day, once or twice a year.
   */
  test("a DST transition inside the span does not shift the day", () => {
    const previousTz = process.env.TZ;

    process.env.TZ = "America/New_York";

    try {
      // 2026-03-08 is the US spring-forward. Seven days from the 5th is the
      // 12th, and an hours-based add would land at 23:00 on the 11th.
      const beforeSpringForward = new Date(2026, 2, 5, 12, 0, 0);

      expect(rescheduleDay(NEXT_WEEK_DAY_OFFSET, beforeSpringForward).dueAt).toBe(
        "2026-03-12",
      );
      expect(rescheduleDay(TOMORROW_DAY_OFFSET, new Date(2026, 2, 7, 23, 30, 0)).dueAt).toBe(
        "2026-03-08",
      );
    } finally {
      restoreTimezone(previousTz);
    }
  });
});

/**
 * The timezone CI runs under, asserted directly rather than only through the
 * hour sweep above.
 *
 * `Pacific/Kiritimati` is UTC+14 — the furthest ahead any inhabited place gets
 * — so for the last fourteen hours of every UTC day the user is already living
 * on the next calendar day. An implementation that read "today" from
 * `dayjs.utc(now)` would hand those users yesterday's date every afternoon and
 * evening, and would look perfectly correct from London.
 */
describe("rescheduleDay at UTC+14", () => {
  const previousTz = process.env.TZ;

  afterAll(() => {
    restoreTimezone(previousTz);
  });

  test("Today is the user's day, not UTC's, on the far side of the date line", () => {
    process.env.TZ = "Pacific/Kiritimati";

    // Local 10:00 on 17 August 2026 is 20:00 UTC on 16 August — the window an
    // implementation reading UTC would get wrong.
    const localMorning = new Date(2026, 7, 17, 10, 0, 0);

    expect(localMorning.toISOString().slice(0, 10)).toBe("2026-08-16");
    expect(rescheduleDay(TODAY_DAY_OFFSET, localMorning).dueAt).toBe("2026-08-17");
    expect(rescheduleDay(TOMORROW_DAY_OFFSET, localMorning).dueAt).toBe("2026-08-18");
    expect(rescheduleDay(NEXT_WEEK_DAY_OFFSET, localMorning).dueAt).toBe("2026-08-24");
  });

  test("and the row reads that day back as Today", () => {
    process.env.TZ = "Pacific/Kiritimati";

    const localMorning = new Date(2026, 7, 17, 10, 0, 0);
    const stored = (
      parseDueDate(rescheduleDay(TODAY_DAY_OFFSET, localMorning).dueAt) as Date
    ).toISOString();

    expect(dueDayOffset(stored, localMorning)).toBe(0);
    expect(formatDueDate(stored, localMorning).label).toBe("Today");
    expect(formatDueDate(stored, localMorning).isOverdue).toBe(false);
  });
});

/**
 * Declared last, so it runs last (Vitest runs a file in declaration order).
 *
 * Two tests above change `process.env.TZ`, and the failure mode of restoring it
 * badly is silent and contagious: `process.env.TZ = undefined` assigns the
 * string `"undefined"`, Node cannot parse it, and the process falls back to
 * **UTC** — the one timezone in which every bug this file exists to catch
 * disappears. Nothing here would go red; the next date test added below would
 * simply start passing for the wrong reason.
 *
 * So the file checks its own housekeeping rather than trusting it. This is the
 * test that would have caught review F4, and it costs one comparison.
 */
describe("the file leaves the process timezone as it found it", () => {
  test("TZ is not the string \"undefined\", and the offset is unchanged", () => {
    expect(process.env.TZ).not.toBe("undefined");
    expect(new Date(2026, 7, 16, 12, 0, 0).getTimezoneOffset()).toBe(
      OFFSET_AT_IMPORT,
    );
  });
});
