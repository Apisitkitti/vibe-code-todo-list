"use client";

import { Typography } from "@heroui/react";

import { formatListHeaderLine } from "@/lib/listHeaderLine";
import type { TodoGroup } from "@/lib/todoGroups";

export interface TodoListHeaderLineProps {
  /**
   * The sections the list is rendering, or `null` while it has not loaded and
   * when it failed to load — in which case the date shows alone.
   *
   * The same array `TodoGroupedList` is drawing, deliberately. US-12 requires
   * that this line and the list can never disagree about how many todos are
   * due; one array shared by both is what makes that structural instead of
   * something a test has to keep catching.
   */
  groups: readonly TodoGroup[] | null;
}

/**
 * One plain-text line above the list (`docs/PRD.md` US-12).
 *
 * Not a heading and not a control, per US-12's last criterion: it summarises
 * the sections, and the sections (US-06) remain the place overdue work is
 * actually conveyed. Making it an `<h2>` would put a second, competing
 * structure in the heading tree beside the section headings it summarises.
 */
export const TodoListHeaderLine = ({ groups }: TodoListHeaderLineProps) => {
  return (
    // The date is the viewer's local day, so a server render and a client
    // render can legitimately disagree across a timezone boundary — the same
    // reason `TodoDueDate` suppresses it. The value is not in doubt; whose
    // clock it was read on is.
    <Typography type="body-sm" color="muted" suppressHydrationWarning>
      {formatListHeaderLine(groups)}
    </Typography>
  );
};
