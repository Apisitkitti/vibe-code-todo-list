"use client";

import { ToggleButton, ToggleButtonGroup } from "@heroui/react";
import { useRouter } from "next/navigation";

import {
  BOARD_VIEW_LABEL,
  LIST_VIEW_LABEL,
  VIEW_TOGGLE_ARIA_LABEL,
} from "@/app/todos/constants";
import { VIEW_VALUES, type TodoListFilters, type TodoView } from "@/lib/todo";
import { todosUrl } from "@/lib/todosUrl";

/**
 * List or board, and the choice goes in the URL (`docs/PRD.md` US-14).
 *
 * **Because that is where this app puts state a user would want to keep**, and
 * the filters made the argument first (US-10): a URL survives a reload, it can
 * be sent to yourself on another machine, and the back button undoes the
 * change. A `localStorage` view preference would have none of those and would
 * additionally make two tabs disagree about what "the board" is. The view is
 * exactly as shareable as the filter it sits beside, which is the point.
 *
 * `router.replace`, not `push`, matching `TodoFilters`: flipping between views
 * is looking at the same todos, not navigating somewhere new, and a history
 * entry per flip would make Back mean "the other view" for as long as the user
 * kept toggling.
 *
 * The same `ToggleButtonGroup` the status filter uses, so the two read as the
 * same kind of control — react-aria renders it as a `radiogroup`, which is the
 * right semantics for "one of these at a time" and is what a screen reader will
 * announce it as.
 */

const VIEW_LABELS: Record<TodoView, string> = {
  list: LIST_VIEW_LABEL,
  board: BOARD_VIEW_LABEL,
};

export interface ViewToggleProps {
  /** Carried through so switching views never drops the filters, and vice versa. */
  filters: TodoListFilters;
  view: TodoView;
}

export const ViewToggle = ({ filters, view }: ViewToggleProps) => {
  const router = useRouter();

  const selectView = (next: TodoView) => {
    router.replace(todosUrl(filters, next), { scroll: false });
  };

  return (
    <ToggleButtonGroup
      aria-label={VIEW_TOGGLE_ARIA_LABEL}
      selectionMode="single"
      disallowEmptySelection
      selectedKeys={[view]}
      onSelectionChange={(keys) => {
        const [key] = [...keys];

        if (typeof key !== "string") return;

        selectView(key as TodoView);
      }}
      size="sm"
    >
      {VIEW_VALUES.map((value) => (
        <ToggleButton key={value} id={value} className="min-h-11 sm:min-h-9">
          {VIEW_LABELS[value]}
        </ToggleButton>
      ))}
    </ToggleButtonGroup>
  );
};
