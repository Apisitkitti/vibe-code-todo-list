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
 * Due dates are stored at UTC midnight, so they are compared as calendar days
 * rather than instants. `now` is read in its own local calendar day, which is
 * the day the user believes they are in. Copy per `docs/DESIGN.md` §7.4.
 */
export const formatDueDate = (iso: string, now: Date = new Date()): DueDateDisplay => {
  const due = dayjs.utc(iso);

  if (!due.isValid()) {
    return { label: "", isOverdue: false };
  }

  const dueDay = toUtcDay(due);
  const todayDay = toUtcDay(dayjs(now));
  const dayOffset = dueDay.diff(todayDay, "day");

  const isOverdue = dayOffset < 0;

  if (dayOffset === 0) return { label: "Today", isOverdue };
  if (dayOffset === 1) return { label: "Tomorrow", isOverdue };
  if (dayOffset === -1) return { label: "Yesterday", isOverdue };

  const format =
    dueDay.year() === todayDay.year() ? SAME_YEAR_FORMAT : OTHER_YEAR_FORMAT;

  return { label: dueDay.format(format), isOverdue };
};
