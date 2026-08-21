"use client";

import { ToggleButton, ToggleButtonGroup } from "@heroui/react";

import {
  BOARD_VIEW_LABEL,
  LIST_VIEW_LABEL,
  VIEW_TOGGLE_ARIA_LABEL,
} from "@/app/todos/constants";
import { LABELLED_CONTROL_SIZING } from "@/lib/styles";
import { VIEW_VALUES, type TodoView } from "@/lib/todo";

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
 * `router.replace`, not `push`: flipping between views is looking at the same
 * todos, not navigating somewhere new, and a history entry per flip would make
 * Back mean "the other view" for as long as the user kept toggling. That is
 * `useTodosUrlSync`'s call to make now, not this component's.
 *
 * **This no longer writes the URL, and no longer takes the filters to carry.**
 * It used to rebuild the query string from the filters it was handed, which is
 * correct only while those filters are current — and they are not, for the
 * length of a navigation the filter row has already started. Pressing Board
 * inside a typing window pushed the search text the URL still held rather than
 * the one on screen, deleting it. The owner lays this change over what the URL
 * is actually going to be, so there is nothing left here to get wrong.
 *
 * The same `ToggleButtonGroup` the status filter uses, so the two read as the
 * same kind of control — react-aria renders it as a `radiogroup`, which is the
 * right semantics for "one of these at a time" and is what a screen reader will
 * announce it as.
 *
 * **And now literally beside it**, at the end of `TodoFilters`' row, which is
 * what §4.11 asked for and not what shipped. It renders wherever it is put, so
 * the placement, the `lg` gate and the `hasTodos` gate all belong to
 * `TodoListScreen` and `TodoFilters` rather than here.
 */

const VIEW_LABELS: Record<TodoView, string> = {
  list: LIST_VIEW_LABEL,
  board: BOARD_VIEW_LABEL,
};

export interface ViewToggleProps {
  view: TodoView;
  onSelectView: (view: TodoView) => void;
}

export const ViewToggle = ({ view, onSelectView }: ViewToggleProps) => {
  return (
    <ToggleButtonGroup
      aria-label={VIEW_TOGGLE_ARIA_LABEL}
      selectionMode="single"
      disallowEmptySelection
      selectedKeys={[view]}
      onSelectionChange={(keys) => {
        const [key] = [...keys];

        if (typeof key !== "string") return;

        onSelectView(key as TodoView);
      }}
      size="sm"
    >
      {VIEW_VALUES.map((value) => (
        <ToggleButton
          key={value}
          id={value}
          className={LABELLED_CONTROL_SIZING}
        >
          {VIEW_LABELS[value]}
        </ToggleButton>
      ))}
    </ToggleButtonGroup>
  );
};
