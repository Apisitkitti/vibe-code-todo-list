"use client";

import { useEffect, useRef, useState } from "react";

import { Typography } from "@heroui/react";

import {
  BOARD_COLUMN_EMPTY,
  BOARD_ORDER_NOTE,
  DRAG_CANCELLED_MESSAGE,
  dragDroppedMessage,
  dragStartedMessage,
} from "@/app/todos/constants";
import type { TodoItemData } from "@/lib/todo";
import {
  boardMove,
  type BoardColumn,
  type BoardColumnId,
  type BoardMove,
} from "@/lib/todoBoard";

import { TodoCard } from "./TodoCard";

/**
 * The board: the list's five urgency sections, side by side, with the cards
 * draggable between them (`docs/DESIGN.md` §8.8, `docs/PRD.md` US-14).
 *
 * **A view over the same data, not a second place to store it.** The columns
 * are `boardColumns`, which are `groupTodos`' sections computed by the same
 * function; a drop writes a due date or a completion through the routes that
 * already exist; and order *within* a column is the server's, unchanged. There
 * is no `position`, and nothing here should be read as a step towards one — the
 * standing decision against manual reordering (`docs/DESIGN.md` §8.1,
 * `docs/PM-PROPOSAL.md` §4) is not reopened by this feature.
 *
 * ## The drop-position problem, and what this does about it
 *
 * A reschedule is deliberately not optimistic on the list, because a due date
 * is the second sort key and local state is forbidden from choosing a position
 * (`src/lib/todoListState.ts`, invariants 1 and 2). But a card that springs
 * back to its old column until the server answers is a broken drag — the whole
 * point of direct manipulation is that the thing moves when you move it.
 *
 * Both of those stay true here. The card changes **column** immediately
 * (`applyDueDate`, which rewrites the field and does not touch the sequence)
 * and its **position inside that column** is never guessed. What follows from
 * that is the honest part: a card can settle at a different index once the
 * refetch lands.
 *
 * So this board **never draws an insertion point.** There is no gap that opens
 * under the pointer, no line between two cards, no placeholder. The drop target
 * is the whole column and it highlights as one object, because a column is what
 * a drop actually chooses. A promise that is never made cannot be broken, and
 * the alternative — an indicator captioned as approximate — is a control that
 * tells you it is lying to you and asks you to aim at it anyway.
 *
 * Two things make up for what the indicator would have given:
 *
 *  - `BOARD_ORDER_NOTE` under the columns says, once and in words, that a drop
 *    chooses a column rather than a place in it, and what the order inside a
 *    column actually is;
 *  - the card that just moved keeps a focus-coloured ring for a moment after it
 *    lands, so a user who dropped it into a busy column can find where it went
 *    instead of re-reading the column. This is the piece that turns "it may
 *    settle elsewhere" from a surprise into an observation.
 *
 * ## What announces what
 *
 * The **gesture** is announced here, through a polite live region: picked up,
 * dropped, cancelled. The **mutation** is announced by the same §7.19 toast a
 * menu press raises, from `TodoListScreen`. Splitting it that way is what keeps
 * a keyboard user — who never drags, and whose equivalent is the card's
 * reschedule menu — from hearing every move twice.
 */

export interface TodoBoardProps {
  columns: BoardColumn[];
  pendingTodoIds: ReadonlySet<string>;
  vanishingTodoId: string | null;
  showTooltips: boolean;
  onToggle: (todo: TodoItemData, nextCompleted: boolean) => void;
  onEdit: (todo: TodoItemData) => void;
  onReschedule: (todo: TodoItemData, dueAt: string | null) => void;
  onDelete: (todo: TodoItemData) => void;
}

/**
 * How long the moved card keeps its ring. Long enough to find it after the
 * refetch has re-sequenced the column — the round trip is the thing being
 * covered — and short enough that a board full of rings never accumulates.
 */
const SETTLE_HIGHLIGHT_MS = 2_500;

export const TodoBoard = ({
  columns,
  pendingTodoIds,
  vanishingTodoId,
  showTooltips,
  onToggle,
  onEdit,
  onReschedule,
  onDelete,
}: TodoBoardProps) => {
  const [draggingTodo, setDraggingTodo] = useState<TodoItemData | null>(null);
  const [settlingTodoId, setSettlingTodoId] = useState<string | null>(null);
  /**
   * What the live region is currently saying.
   *
   * Held as state rather than written into the DOM by hand because a live
   * region only announces what *changes* inside it, and React replacing the
   * text node is exactly that change. Writing it imperatively would work
   * equally well and would be a second way to update the same element.
   */
  const [dragAnnouncement, setDragAnnouncement] = useState("");
  /**
   * Whether the drag that is ending was taken by a column.
   *
   * A ref rather than reading `draggingTodo` in `handleDragEnd`, because that
   * would be asking whether React had committed the drop's state update before
   * the browser fired `dragend` — a scheduling question with no stable answer
   * and a wrong one that announces "Move cancelled" over a move that succeeded.
   */
  const wasDropped = useRef(false);

  /** The columns this card may be dropped on, by their headings, in board order. */
  const droppableHeadings = (todo: TodoItemData) =>
    columns
      .filter((column) => boardMove(todo, column.id) !== null)
      .map((column) => column.heading);

  const handleDragStart = (todo: TodoItemData) => {
    wasDropped.current = false;
    setDraggingTodo(todo);
    setDragAnnouncement(dragStartedMessage(todo.title, droppableHeadings(todo)));
  };

  /**
   * Fires after `onDrop` when the drop was taken, and on its own when it was
   * not — a release outside every column, or `Escape`. Both end the drag, so
   * the carried card is cleared here rather than in the drop handler.
   *
   * The cancellation message is raised only when no column took the card.
   */
  const handleDragEnd = () => {
    if (!wasDropped.current) setDragAnnouncement(DRAG_CANCELLED_MESSAGE);

    setDraggingTodo(null);
  };

  /**
   * Whether this column would accept the card currently being carried.
   *
   * `null` when nothing is being dragged, so the columns are inert at rest and
   * nothing on screen suggests a drop target that has no card to receive.
   */
  const moveInto = (column: BoardColumnId): BoardMove | null => {
    if (draggingTodo === null) return null;

    return boardMove(draggingTodo, column);
  };

  const handleDragOver = (
    event: React.DragEvent<HTMLElement>,
    column: BoardColumnId,
  ) => {
    if (moveInto(column) === null) return;

    /*
      Calling `preventDefault` on dragover is what marks an element as a drop
      target — the default action is to refuse the drop. So a column the card
      cannot move to needs no code at all to reject it: returning above leaves
      the browser showing a "no drop" cursor, which is the refusal stated to the
      pointer without anything having to draw it.
    */
    event.preventDefault();
    event.dataTransfer.dropEffect = "move";
  };

  const handleDrop = (
    event: React.DragEvent<HTMLElement>,
    column: BoardColumn,
  ) => {
    const todo = draggingTodo;
    const move = moveInto(column.id);

    if (todo === null || move === null) return;

    event.preventDefault();

    // Before the mutation, so `handleDragEnd` — which the browser fires next —
    // reports a completed move rather than a cancelled one.
    wasDropped.current = true;
    setDraggingTodo(null);
    setDragAnnouncement(dragDroppedMessage(todo.title, column.heading));
    setSettlingTodoId(todo.id);

    if (move.kind === "status") {
      onToggle(todo, move.completed);

      return;
    }

    onReschedule(todo, move.dueAt);
  };

  useEffect(() => {
    if (settlingTodoId === null) return;

    const timer = setTimeout(() => setSettlingTodoId(null), SETTLE_HIGHLIGHT_MS);

    return () => clearTimeout(timer);
  }, [settlingTodoId]);

  return (
    <div className="flex flex-col gap-3 p-2">
      {/*
        `grid-cols-5` rather than a scroller: the board renders at `lg:` and
        above only (`TodoListScreen`), where five columns fit, and a board you
        have to scroll sideways to see is a board whose drop targets are
        off screen. Equal columns, so a busy `Today` does not squeeze `Overdue`
        into a strip.
      */}
      <div className="grid grid-cols-5 items-start gap-2">
        {columns.map((column) => {
          const move = moveInto(column.id);
          const isTarget = move !== null;

          return (
            <section
              key={column.id}
              /*
                A drop is taken on the column as a whole, headings included —
                aiming at a strip of cards is harder than aiming at a column,
                and there is no position to aim at anyway.
              */
              onDragOver={(event) => handleDragOver(event, column.id)}
              onDrop={(event) => handleDrop(event, column)}
              className={`flex min-h-32 flex-col gap-1.5 rounded-2xl border p-2 ${
                isTarget
                  ? "border-accent bg-[color-mix(in_srgb,var(--accent)_8%,transparent)]"
                  : "border-transparent"
              }`}
            >
              {/*
                An `<h2>`, the same level and the same `body-sm` step the
                list's section headings use (§7.16), so switching views does
                not reshape the heading tree. The count is `aria-hidden` for
                the reason it is there: each column's `<ul>` reports its own
                size natively and more precisely.
              */}
              <Typography.Heading level={2} className="px-1 text-sm leading-6">
                {column.heading}
                <span aria-hidden="true">{` · ${column.todos.length}`}</span>
              </Typography.Heading>

              {column.todos.length === 0 ? (
                <Typography type="body-sm" color="muted" className="px-1 py-2">
                  {BOARD_COLUMN_EMPTY[column.id]}
                </Typography>
              ) : (
                <ul className="flex flex-col gap-1.5">
                  {column.todos.map((todo) => (
                    <TodoCard
                      key={todo.id}
                      todo={todo}
                      isPending={pendingTodoIds.has(todo.id)}
                      isVanishing={todo.id === vanishingTodoId}
                      isDragging={todo.id === draggingTodo?.id}
                      isSettling={todo.id === settlingTodoId}
                      showTooltips={showTooltips}
                      onToggle={onToggle}
                      onEdit={onEdit}
                      onReschedule={onReschedule}
                      onDelete={onDelete}
                      onDragStart={handleDragStart}
                      onDragEnd={handleDragEnd}
                    />
                  ))}
                </ul>
              )}
            </section>
          );
        })}
      </div>

      <Typography type="body-sm" color="muted" className="px-1">
        {BOARD_ORDER_NOTE}
      </Typography>

      {/*
        The gesture's commentary. `role="status"` is the polite live region;
        `sr-only` because a sighted user is watching the card move and does not
        need it written down as well.
      */}
      <p role="status" aria-live="polite" className="sr-only">
        {dragAnnouncement}
      </p>
    </div>
  );
};
