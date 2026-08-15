import { Chip } from "@heroui/react";

import { PRIORITY_FILTER_LABELS, PRIORITY_GLYPHS } from "@/app/todos/constants";
import type { TodoPriority } from "@/lib/todo";

/** Colour never carries the meaning alone (`docs/DESIGN.md` §4.4, §6.4). */
const PRIORITY_CHIP_COLORS: Record<TodoPriority, "danger" | "warning" | "default"> =
  {
    high: "danger",
    medium: "warning",
    low: "default",
  };

export interface PriorityChipProps {
  priority: TodoPriority;
}

export const PriorityChip = ({ priority }: PriorityChipProps) => {
  const label = PRIORITY_FILTER_LABELS[priority];

  return (
    <Chip color={PRIORITY_CHIP_COLORS[priority]} variant="soft" size="sm">
      <Chip.Label>
        <span aria-hidden="true" className="mr-1">
          {PRIORITY_GLYPHS[priority]}
        </span>
        <span className="sr-only">Priority: </span>
        {label}
      </Chip.Label>
    </Chip>
  );
};
