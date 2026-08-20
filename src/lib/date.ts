import dayjs from "dayjs";
import utc from "dayjs/plugin/utc";

dayjs.extend(utc);

const DAY_FORMAT = "YYYY-MM-DD";
const SAME_YEAR_FORMAT = "MMM D";
const OTHER_YEAR_FORMAT = "MMM D, YYYY";

export interface DueDateDisplay {
  label: string;
  isOverdue: boolean;
}

/**
 * What each quick reschedule means, in whole days from the user's today.
 *
 * **`Next week` is today + 7 — the same weekday, one week on.** That is a
 * decision, not the only reading, so it is written down here rather than left
 * to be inferred from a `7` at a call site.
 *
 * The alternative was "the start of next week", and it was declined because it
 * cannot be computed from anything this app knows. A week's first day is a
 * locale fact (Sunday in the US, Monday under ISO, Saturday in much of the
 * Gulf) and the app has no locale setting anywhere — every date decision it
 * makes is derived from the device clock alone (`docs/PRD.md` §2, *user's
 * today*). Reaching for `@react-aria/i18n`'s `startOfWeek` would introduce a
 * second source of truth for "when is it", answering to the browser's language
 * rather than to its clock, and the two disagree for real users. It is also
 * ambiguous on the day it matters most: pressing `Next week` *on* the first day
 * of the week either means today or means seven days away, and neither answer
 * is wrong enough to be obviously right.
 *
 * `+7` has none of that: it is the same arithmetic as `Tomorrow`'s `+1` with a
 * different number, it lands on a weekday the user can name without being told,
 * and it never resolves to today. The menu shows the resolved date beside the
 * label (`docs/DESIGN.md` §7.19) so the reading is visible before the press
 * rather than discoverable afterwards.
 */
export const TODAY_DAY_OFFSET = 0;
export const TOMORROW_DAY_OFFSET = 1;
export const NEXT_WEEK_DAY_OFFSET = 7;

/** A quick reschedule's target: what goes on the wire, and what the menu shows. */
export interface RescheduleDay {
  /** `YYYY-MM-DD`, the wire format `PATCH /api/todos/[id]/due` takes. */
  dueAt: string;
  /** The same day in the row's own words, e.g. `Aug 26` (`docs/DESIGN.md` §7.19). */
  preview: string;
}

/**
 * The day a quick reschedule lands on, counted in the viewer's own calendar.
 *
 * This is the other half of `dueDayOffset` below and has to be its exact
 * inverse, or `Today` sets a date the row then reads back as `Tomorrow`. The
 * pairing is the whole of the timezone correctness here:
 *
 *  - `dueDayOffset` reads `now` in the user's **local** calendar day and
 *    compares it, as a calendar day, against a `dueAt` stored at UTC midnight;
 *  - so this must produce that same local calendar day — `dayjs(now)`, local,
 *    never `dayjs.utc(now)` — shifted by whole days and formatted as the wire
 *    day, which `parseDueDate` then stores at UTC midnight.
 *
 * Getting that wrong is invisible from any machine sitting at or near UTC and
 * wrong for up to a full day everywhere else: at UTC+13 the local day is
 * already tomorrow for the last eleven hours of every UTC day, so a user
 * pressing `Today` would be handed yesterday. CI runs the suites under
 * `TZ=Pacific/Kiritimati` for exactly this, and
 * `tests/unit/todoDates.test.ts` pins the round trip at every hour of the local
 * day so the property is checked wherever it is run rather than only there.
 *
 * Day arithmetic goes through dayjs's `add(n, "day")`, which sets the date
 * component rather than adding 86,400,000ms (`node_modules/dayjs/esm/index.js`
 * → `instanceFactorySet`), so a DST transition inside the span does not shift
 * the answer by a day.
 */
export const rescheduleDay = (
  dayOffset: number,
  now: Date = new Date(),
): RescheduleDay => {
  const today = dayjs(now);
  const target = today.add(dayOffset, "day");

  return {
    dueAt: target.format(DAY_FORMAT),
    preview: target.format(
      target.year() === today.year() ? SAME_YEAR_FORMAT : OTHER_YEAR_FORMAT,
    ),
  };
};

/** The calendar day an instant falls on, in UTC. */
const toUtcDay = (value: dayjs.Dayjs) => {
  return dayjs.utc(value.format(DAY_FORMAT), DAY_FORMAT, true);
};

/**
 * Whole days from the user's today to the due day, or `null` when the value is
 * not a date at all: `-1` is yesterday, `0` today, `1` tomorrow.
 *
 * This is the one place the app decides what "today" means, and both callers
 * that need to — the row's label and the list's grouping — read it from here
 * rather than each deriving it. Due dates are stored at UTC midnight, so they
 * are compared as calendar days rather than instants, while `now` is read in
 * its own *local* calendar day, which is the day the user believes they are
 * in. Comparing the two as instants is what would make a todo due today read
 * as overdue for anyone west of UTC.
 */
export const dueDayOffset = (iso: string, now: Date = new Date()): number | null => {
  const due = dayjs.utc(iso);

  if (!due.isValid()) return null;

  return toUtcDay(due).diff(toUtcDay(dayjs(now)), "day");
};

/**
 * The words the row shows for a due date, per `docs/DESIGN.md` §7.4. The
 * day arithmetic itself belongs to `dueDayOffset` above.
 */
export const formatDueDate = (iso: string, now: Date = new Date()): DueDateDisplay => {
  const dayOffset = dueDayOffset(iso, now);

  if (dayOffset === null) {
    return { label: "", isOverdue: false };
  }

  const dueDay = toUtcDay(dayjs.utc(iso));
  const todayDay = toUtcDay(dayjs(now));

  const isOverdue = dayOffset < 0;

  if (dayOffset === 0) return { label: "Today", isOverdue };
  if (dayOffset === 1) return { label: "Tomorrow", isOverdue };
  if (dayOffset === -1) return { label: "Yesterday", isOverdue };

  const format =
    dueDay.year() === todayDay.year() ? SAME_YEAR_FORMAT : OTHER_YEAR_FORMAT;

  return { label: dueDay.format(format), isOverdue };
};
