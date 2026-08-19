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
  const { label, isOverdue } = formatDueDate(dueAt);

  if (label === "") return null;

  const showOverdue = isOverdue;

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
