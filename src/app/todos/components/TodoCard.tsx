"use client";

import { Checkbox, Typography } from "@heroui/react";

import { toggleTargetProps } from "@/lib/rowFocus";
import type { TodoItemData } from "@/lib/todo";

import { PriorityChip } from "./PriorityChip";
import { TodoActions } from "./TodoActions";
import { TodoDueDate } from "./TodoDueDate";

/**
 * One todo, as a card in a board column.
 *
 * **The same controls as `TodoRow`, in a different shape.** The checkbox, the
 * chip, the date, the note marker and the three actions are all here and all
 * mean what they mean on the row — the actions are literally the same
 * component (`TodoActions`), which is what makes "a keyboard user can do
 * everything a drag can do" a fact about the code rather than a claim in a
 * document (`docs/DESIGN.md` §8.8).
 *
 * Two lines instead of one, because a column is ~200px wide and the row's
 * horizontal arrangement wraps into an unreadable stack at that width: title
 * and checkbox on the first line, metadata and actions on the second.
 *
 * **The actions are always visible here**, where the row hides them until hover
 * or focus at `lg:`. The row can afford that because it is one of many
 * identical rows in a narrow column of text and the actions are noise at rest;
 * a card is a discrete object with room around it, and a card whose controls
 * appear only on hover is a card a touch user cannot operate at all — and the
 * board is only reachable at `lg:` on a pointer device today, so this is about
 * the object, not the input.
 */

export interface TodoCardProps {
  todo: TodoItemData;
  isPending: boolean;
  /** A confirmed delete is running against this card (§8.3.2). */
  isVanishing: boolean;
  /** This card is the one the pointer is currently carrying. */
  isDragging: boolean;
  /**
   * This card was moved by the last board move and has just been re-rendered
   * where the server put it. See `TodoBoard` for why it is marked at all.
   */
  isSettling: boolean;
  showTooltips: boolean;
  onToggle: (todo: TodoItemData, nextCompleted: boolean) => void;
  onEdit: (todo: TodoItemData) => void;
  /** `dueAt` is the `YYYY-MM-DD` wire day, or `null` to clear it. */
  onReschedule: (todo: TodoItemData, dueAt: string | null) => void;
  onDelete: (todo: TodoItemData) => void;
  onDragStart: (todo: TodoItemData) => void;
  onDragEnd: () => void;
}

export const TodoCard = ({
  todo,
  isPending,
  isVanishing,
  isDragging,
  isSettling,
  showTooltips,
  onToggle,
  onEdit,
  onReschedule,
  onDelete,
  onDragStart,
  onDragEnd,
}: TodoCardProps) => {
  /*
    HTML5 drag and drop, with no library and no `position` anywhere.

    react-aria's `useDrag`/`useDrop` were the alternative and were declined:
    their headline feature over this is a *keyboard* drag mode, which moves
    items to positions and cannot express "this sets a date" (`docs/DESIGN.md`
    §6.8, §8.1) — so it would have to be disabled, leaving the pointer half,
    which is what these four handlers already are. The keyboard path is the
    reschedule menu on the card, which says what it does in words.

    `text/plain` carries the id even though `TodoBoard` holds the dragged todo
    in state and reads it from there. Firefox refuses to start a drag at all
    unless `setData` has been called, and a drag that silently does not start
    is not something a reviewer would think to check for.
  */
  const handleDragStart = (event: React.DragEvent<HTMLLIElement>) => {
    event.dataTransfer.setData("text/plain", todo.id);
    event.dataTransfer.effectAllowed = "move";

    onDragStart(todo);
  };

  return (
    <li
      aria-busy={isPending}
      /*
        A write in flight is not draggable. The same rule the reschedule
        trigger's open guard enforces, for the same reason: two writes to the
        same column are free to land in either order (review m-4, QA DEF-12).
      */
      draggable={!isPending && !isVanishing}
      onDragStart={handleDragStart}
      onDragEnd={onDragEnd}
      /*
        `--accent` at 12% marks the card that is currently being carried, so
        the original stays visible in its old column while the browser drags a
        translucent copy of it. Composed with `color-mix` from a token rather
        than hard-coded, per §3.

        No `opacity` on the card, for the reason §8.3.2 gives about rows:
        `opacity` is a group multiplier and would take the title down with it.
      */
      className={`flex flex-col gap-2 rounded-2xl border px-3 py-3 ${
        isDragging
          ? "border-accent bg-[color-mix(in_srgb,var(--accent)_12%,transparent)]"
          : "border-border-secondary hover:bg-surface-hover"
      } ${isSettling ? "ring-2 ring-[var(--focus)]" : ""} ${
        isVanishing ? "pointer-events-none" : ""
      }`}
    >
      <div className="flex items-start gap-2">
        {/*
          The anchor `restoreToggleFocus` finds this card's checkbox by, after a
          completion moves the card to another column and React rebuilds it.
          On a wrapper rather than on the control — `src/lib/rowFocus.ts` says
          why.
        */}
        <span {...toggleTargetProps(todo.id)} className="shrink-0">
          <Checkbox
            isDisabled={isPending}
            isSelected={todo.completed}
            onChange={(isSelected) => onToggle(todo, isSelected)}
            aria-label={
              todo.completed
                ? `Mark "${todo.title}" as not complete`
                : `Mark "${todo.title}" as complete`
            }
          >
            <Checkbox.Content className="flex min-h-11 min-w-11 items-center justify-start sm:min-h-9 sm:min-w-9">
              {/* The §4.4 / DEF-08 border, unchanged from the row. */}
              <Checkbox.Control className="border border-[color-mix(in_srgb,var(--foreground)_50%,transparent)]">
                <Checkbox.Indicator />
              </Checkbox.Control>
            </Checkbox.Content>
          </Checkbox>
        </span>

        {/*
          Wraps rather than truncates, unlike the row. A row truncates because
          it is scanned against its neighbours down a shared right edge (§1);
          a card has no such column to keep, and a title cut off at 20
          characters in a 200px column would hide the only thing the card says.
          Capped at three lines so one long title cannot make a column of one
          card taller than a column of four.
        */}
        <Typography
          type="body-sm"
          weight="medium"
          className={`line-clamp-3 min-w-0 flex-1 ${
            todo.completed ? "text-muted line-through" : ""
          }`}
        >
          {todo.title}
        </Typography>
      </div>

      <div className="flex flex-wrap items-center gap-2">
        {/*
          A completed card goes quiet, exactly as a completed row does — the
          §8.5 argument and `todoGroups`' "a completed todo is done, so its date
          has nothing left to say".
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

        <TodoActions
          todo={todo}
          isPending={isPending}
          showTooltips={showTooltips}
          className="ml-auto"
          onEdit={onEdit}
          onReschedule={onReschedule}
          onDelete={onDelete}
        />
      </div>
    </li>
  );
};
