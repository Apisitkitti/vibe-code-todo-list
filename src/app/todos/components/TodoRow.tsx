"use client";

import type { ReactNode } from "react";

import { Button, Checkbox, Tooltip, Typography } from "@heroui/react";

import type { TodoItemData } from "@/lib/todo";

import { PriorityChip } from "./PriorityChip";
import { TodoDueDate } from "./TodoDueDate";

const ICON_BUTTON_SIZING = "min-h-11 min-w-11 sm:min-h-9 sm:min-w-9";

/**
 * The title takes the slack at `sm:` and up, which is what reserves the
 * metadata column (`docs/DESIGN.md` §1: *"Nothing reflows between rows; a row
 * with no due date leaves the slot empty rather than shifting"*).
 *
 * Without `flex-1` the title is sized by its own content, so the chip/date/note
 * cluster hugged the end of each title and landed somewhere different on every
 * row — the list had no column to scan down. With it, the cluster is pushed to
 * a consistent right edge and a row missing a date leaves the gap rather than
 * sliding everything left.
 *
 * `min-w-0` alongside it, or the flex item refuses to shrink below its content
 * width and `truncate` never fires. The trade is that long titles truncate
 * sooner, which is the trade §1 already made.
 *
 * `sm:` only: below that the row is `flex-col`, where `flex-1` would stretch
 * the title vertically instead and there is no column to reserve.
 */
const TITLE_SIZING = "sm:min-w-0 sm:flex-1";

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
  /**
   * A confirmed delete is in flight against this row — it is about to stop
   * existing. The one case §8.3.2 keeps a row-level pending treatment for, and
   * the only thing that still separates it from an ordinary busy row.
   */
  isVanishing: boolean;
  showTooltips: boolean;
  onToggle: (todo: TodoItemData, nextCompleted: boolean) => void;
  onEdit: (todo: TodoItemData) => void;
  onDelete: (todo: TodoItemData) => void;
}

export const TodoRow = ({
  todo,
  isPending,
  isVanishing,
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
      // The outline is the row boundary; the gap is only breathing room.
      // Spacing alone gave the list no boundary at all at rest — the row and
      // the Card behind it are both `--surface`, so `gap-1.5` was 6px of the
      // row's own colour — and no surface token can supply one: measured
      // against `--surface`, `--surface-hover` is 1.20:1 light / 1.19:1 dark,
      // `--surface-secondary` 1.15 / 1.13, `--surface-tertiary` 1.20 / 1.18.
      // Hover does not exist on touch and there is no row-level focus style,
      // so on a phone that left no separation in any state (§4.4).
      //
      // `--border-secondary` measures 1.71:1 light / 1.78:1 dark against
      // `--surface`, and 1.42 / 1.50 against a hovered row — the same token,
      // and the same strength, as the `divide-y` rule this replaced, drawn
      // around the pill instead of across it. Not a `--field-border-width`
      // case: this is a plain border utility on an `<li>`, so HeroUI's 0px
      // field default (DEF-08) does not reach it.
      // No `opacity-60` on the row, in either state, and that is a contrast
      // decision rather than a cosmetic one.
      //
      // `opacity` is a **group** multiplier: it dims the row's own paint and
      // every descendant's, the title included. A completing row already
      // carries `text-muted line-through` optimistically, so the dim landed on
      // the muted token and the title measured **2.32:1** — below even the 3:1
      // large-text floor, on 16px text, during exactly the window the user is
      // watching to find out what happened (QA §A4). Deleting an
      // already-completed row reached the identical number by the identical
      // route, so restricting the dim to delete would not have been enough on
      // its own.
      //
      // Nothing is lost by dropping it. The row still announces itself with
      // `aria-busy`, and its controls still *look* unavailable, because they
      // are genuinely disabled and HeroUI dims a disabled control itself via
      // `--disabled-opacity` — which SC 1.4.11 exempts as an inactive
      // component, where a dimmed *title* has no such exemption.
      //
      // `pointer-events-none` stays for the delete alone (§8.3.2): that row is
      // about to vanish. A toggle keeps its pointer surface, because the flip
      // is optimistic and already shown — dimming and deadening it is visible
      // latency for its own sake. `isDisabled` on the controls is what
      // actually prevents the out-of-order PATCHes m-4 describes; this only
      // ever stopped a mouse (QA DEF-12).
      className={`group flex items-center gap-3 rounded-2xl border border-border-secondary px-4 py-3.5 hover:bg-surface-hover ${
        isVanishing ? "pointer-events-none" : ""
      }`}
    >
      <Checkbox
        isDisabled={isPending}
        isSelected={todo.completed}
        // Optimistic: `TodoListScreen` flips `completed` in local state before
        // the request goes out, so the box ticks under the finger and
        // `aria-checked` moves with it rather than lagging a round trip behind
        // (review m-7, `docs/DESIGN.md` §1 and §8.3.2). What keeps that honest
        // is the revert — a refused write writes the previous value back, and
        // the row re-sections with it — not the box holding still.
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
          className={
            todo.completed
              ? `${TITLE_SIZING} text-muted line-through`
              : TITLE_SIZING
          }
        >
          {todo.title}
        </Typography>
        <div className="flex shrink-0 items-center gap-2">
          {/*
            A completed row goes quiet: no priority chip and no due date.
            `src/lib/todoGroups.ts` already argues the date half — "a completed
            todo is done, so its date has nothing left to say" — and this is
            the row finally agreeing with it, instead of filing a finished task
            under `Completed` while it announces `Aug 12`. The priority half is
            §8.5: once a todo is done its priority is history and it is
            competing for attention with the active rows above it.

            §6.4 is unaffected. Completion is carried by the checkbox's
            `aria-checked` and by `line-through` on the title, never by the
            chip or the date, so nothing that carried meaning has been removed.
            The `✎` note marker stays — a note is still there to read — and so
            do the actions.
          */}
          {todo.completed ? null : (
            <>
              <PriorityChip priority={todo.priority} />
              {todo.dueAt ? <TodoDueDate dueAt={todo.dueAt} /> : null}
            </>
          )}
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
