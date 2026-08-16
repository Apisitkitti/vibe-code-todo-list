"use client";

import type { ReactNode } from "react";

import { Button, Checkbox, Tooltip, Typography } from "@heroui/react";

import type { TodoItemData } from "@/lib/todo";

import { PriorityChip } from "./PriorityChip";
import { TodoDueDate } from "./TodoDueDate";

const ICON_BUTTON_SIZING = "min-h-11 min-w-11 sm:min-h-9 sm:min-w-9";

const EditIcon = () => {
  return (
    <svg
      aria-hidden="true"
      width={16}
      height={16}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={2}
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <path d="M12 20h9" />
      <path d="M16.5 3.5a2.12 2.12 0 0 1 3 3L7 19l-4 1 1-4Z" />
    </svg>
  );
};

const DeleteIcon = () => {
  return (
    <svg
      aria-hidden="true"
      width={16}
      height={16}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={2}
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <path d="M3 6h18" />
      <path d="M8 6V4h8v2" />
      <path d="M19 6l-1 14H6L5 6" />
      <path d="M10 11v6M14 11v6" />
    </svg>
  );
};

/** Tooltips are pointer-only affordances; the `aria-label` is the real name. */
const ActionTooltip = ({
  label,
  isEnabled,
  children,
}: {
  label: string;
  isEnabled: boolean;
  children: ReactNode;
}) => {
  if (!isEnabled) return <>{children}</>;

  // `Tooltip.Trigger` renders a plain `div`, which lands between react-aria's
  // PressResponder and the button and swallows the trigger ("A PressResponder
  // was rendered without a pressable child"). The pressable child belongs
  // directly under `Tooltip`.
  return (
    <Tooltip>
      {children}
      <Tooltip.Content>{label}</Tooltip.Content>
    </Tooltip>
  );
};

export interface TodoRowProps {
  todo: TodoItemData;
  isPending: boolean;
  showTooltips: boolean;
  onToggle: (todo: TodoItemData, nextCompleted: boolean) => void;
  onEdit: (todo: TodoItemData) => void;
  onDelete: (todo: TodoItemData) => void;
}

export const TodoRow = ({
  todo,
  isPending,
  showTooltips,
  onToggle,
  onEdit,
  onDelete,
}: TodoRowProps) => {
  return (
    <li
      // `pointer-events-none` only stops a mouse. A keyboard user could hold
      // Space and fire the out-of-order PATCHes m-4 describes, so the controls
      // are disabled outright and the row announces itself as busy
      // (QA DEF-12).
      aria-busy={isPending}
      className={`group flex items-center gap-3 rounded-2xl px-4 py-3.5 hover:bg-surface-hover ${
        isPending ? "pointer-events-none opacity-60" : ""
      }`}
    >
      <Checkbox
        isDisabled={isPending}
        isSelected={todo.completed}
        // Not optimistic: the box holds its current state until the server
        // confirms the flip, so it never shows something that did not happen.
        onChange={(isSelected) => onToggle(todo, isSelected)}
        aria-label={
          todo.completed
            ? `Mark "${todo.title}" as not complete`
            : `Mark "${todo.title}" as complete`
        }
      >
        <Checkbox.Content className="flex min-h-11 min-w-11 items-center justify-start sm:min-h-9 sm:min-w-9">
          {/*
            HeroUI's theme gives form fields no border by default
            (`--field-border-width: 0px`), relying on the field background to
            stand out. In dark mode `--field-background` is the same colour as
            the row behind it, so an unchecked box was invisible — roughly 1:1
            contrast (QA DEF-08).

            `--border` alone is not enough: measured against the box it is
            1.21:1 in dark, under the 3:1 WCAG 1.4.11 asks of a control
            boundary. Half-strength foreground clears it in both themes
            (~5:1 dark, ~4:1 light). The checked state paints over it with the
            accent fill.
          */}
          <Checkbox.Control className="border border-[color-mix(in_srgb,var(--foreground)_50%,transparent)]">
            <Checkbox.Indicator />
          </Checkbox.Control>
        </Checkbox.Content>
      </Checkbox>

      <div className="flex min-w-0 flex-1 flex-col gap-1 sm:flex-row sm:items-center sm:gap-3">
        <Typography
          type="body"
          weight="medium"
          truncate
          className={todo.completed ? "text-muted line-through" : undefined}
        >
          {todo.title}
        </Typography>
        <div className="flex shrink-0 items-center gap-2">
          <PriorityChip priority={todo.priority} />
          {todo.dueAt ? (
            <TodoDueDate dueAt={todo.dueAt} completed={todo.completed} />
          ) : null}
          {todo.note ? (
            <>
              <span aria-hidden="true" className="text-muted">
                ✎
              </span>
              <span className="sr-only">Has a note</span>
            </>
          ) : null}
        </div>
      </div>

      <div className="flex shrink-0 items-center gap-1 transition-opacity motion-reduce:transition-none lg:opacity-0 lg:group-focus-within:opacity-100 lg:group-hover:opacity-100">
        <ActionTooltip label="Edit" isEnabled={showTooltips}>
          <Button
            variant="ghost"
            size="sm"
            isIconOnly
            className={ICON_BUTTON_SIZING}
            isDisabled={isPending}
            aria-label={`Edit "${todo.title}"`}
            onPress={() => onEdit(todo)}
          >
            <EditIcon />
          </Button>
        </ActionTooltip>
        <ActionTooltip label="Delete" isEnabled={showTooltips}>
          <Button
            variant="ghost"
            size="sm"
            isIconOnly
            className={ICON_BUTTON_SIZING}
            isDisabled={isPending}
            aria-label={`Delete "${todo.title}"`}
            onPress={() => onDelete(todo)}
          >
            <DeleteIcon />
          </Button>
        </ActionTooltip>
      </div>
    </li>
  );
};
