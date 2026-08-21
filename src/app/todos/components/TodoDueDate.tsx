import { Typography } from "@heroui/react";

import { formatDueDate } from "@/lib/date";

export interface TodoDueDateProps {
  dueAt: string;
}

/**
 * Rendered for an *active* row only. `TodoRow` drops the date entirely on a
 * completed row, which is why there is no `completed` prop here any more: the
 * old one existed solely to suppress the overdue treatment on a row that is
 * finished, and a date that is not drawn at all cannot be drawn as overdue.
 * Keeping it would have left a second, weaker answer to the same question in
 * the codebase.
 */
export const TodoDueDate = ({ dueAt }: TodoDueDateProps) => {
  const { label, isOverdue, isToday } = formatDueDate(dueAt);

  if (label === "") return null;

  return (
    // The label is relative to "now", so server and client can disagree by a
    // day across a timezone boundary; the value itself is identical.
    <time dateTime={dueAt} suppressHydrationWarning>
      {/*
        Three ordered steps of urgency in one column, and `Today` is the middle
        one: future and undated at `--muted`, `Today` at `--foreground`, overdue
        at `--warning-soft-foreground` with its `⚠`. None of them is colour-only
        — every step keeps its word — so §6.4 is untouched.

        **`--foreground`, not an accent.** §8.4.5 proposed
        `--accent-soft-foreground` and that half was not taken: a row reading
        `Today` normally sits under a section headed `Today`, and on the board
        inside a column headed `Today`, so the accent would be spent saying what
        the structure has already said — and §3 allows one saturated element at
        rest, which `/todos` is already over (§8.4).

        What survives is the case where the structure says nothing.
        `TodoGroupedList` renders headings only when `groups.length > 1`, so a
        brand-new account with one todo due today has no `Today` heading at all
        and this word is the entire signal. At `--muted` it was the same ink as
        `Aug 28`.

        Dropping `color="muted"` raises contrast rather than lowering it —
        measured on the Card at 5.60:1 → 17.72:1 light and 6.75:1 → 17.27:1 dark
        — so there is no WCAG exposure. That is the same argument, on the same
        two tokens, that `TodoGroupedList` carries for its section headings.
        Both are pinned in `e2e/due-date-ramp.spec.ts`.

        **`Today` alone, deliberately, and not `Tomorrow`.** `Today` is a word
        this app has already made structural — the section, the board column,
        the reschedule menu's first item. `Tomorrow` is none of those, and
        widening the treatment to it would turn one signal into a second tier of
        muted.
      */}
      <Typography
        type="body-sm"
        color={isToday ? undefined : "muted"}
        className={isOverdue ? "text-warning-soft-foreground" : undefined}
      >
        {isOverdue ? (
          <>
            <span aria-hidden="true" className="mr-1">
              ⚠
            </span>
            <span className="sr-only">Overdue — </span>
          </>
        ) : null}
        {label}
      </Typography>
    </time>
  );
};
