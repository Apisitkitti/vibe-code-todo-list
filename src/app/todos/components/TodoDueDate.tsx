import { Typography } from "@heroui/react";

import { formatDueDate } from "@/lib/date";

export interface TodoDueDateProps {
  dueAt: string;
  completed: boolean;
}

export const TodoDueDate = ({ dueAt, completed }: TodoDueDateProps) => {
  const { label, isOverdue } = formatDueDate(dueAt);

  if (label === "") return null;

  const showOverdue = isOverdue && !completed;

  return (
    // The label is relative to "now", so server and client can disagree by a
    // day across a timezone boundary; the value itself is identical.
    <time dateTime={dueAt} suppressHydrationWarning>
      <Typography
        type="body-sm"
        color="muted"
        className={showOverdue ? "text-warning-soft-foreground" : undefined}
      >
        {showOverdue ? (
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
