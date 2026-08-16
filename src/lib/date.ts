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
