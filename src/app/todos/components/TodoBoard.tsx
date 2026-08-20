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
  /**
   * The card wearing the settle ring, and **which drop put it there**.
   *
   * The sequence number is the whole of it: keyed on the id alone, dropping the
   * same card twice inside the window wrote the value the state already held,
   * so the effect below never re-ran and the ring expired on the *first* drop's
   * timer — up to 2.5s early, and on the drop the user was actually watching.
   * That is the one affordance covering "the card may settle at a different
   * index", which is what the whole no-insertion-indicator decision rests on
   * (`docs/decisions/2026-08-20-board-is-a-view-not-an-order.md`), so it losing
   * its own restart is not a cosmetic bug.
   *
   * A counter rather than a timestamp because it only has to be *different*,
   * and two drops inside one millisecond would not be.
   */
  const [settling, setSettling] = useState<{ id: string; seq: number } | null>(
    null,
  );
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

    // The live row, so the column that lights up and the column that accepts
    // the drop are decided from the same data. `handleDrop` re-asks rather than
    // trusting this, because a render can land between the two.
    return boardMove(liveTodo(draggingTodo), column);
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

  /**
   * The card as it is **now**, looked up by id, rather than the snapshot taken
   * at `dragstart`.
   *
   * `draggingTodo` is captured when the drag begins and is of unbounded age by
   * the time it is dropped. Almost everything downstream reads it: `boardMove`
   * decides from its `completed` and `dueAt`, and `handleReschedule` reads
   * `todo.dueAt` for the value Undo will put back. This file's own standard —
   * and `TodoListScreen`'s, in as many words — is that the previous value is
   * read *from the row*, never derived; a snapshot is a derivation with a
   * timestamp on it.
   *
   * Reaching a stale one takes a mutation already in flight when the drag
   * starts (its `reloadSilently` lands mid-drag and replaces the row) plus a
   * foreign writer having changed that row — the same three-precondition shape
   * `runToggle` records as review MI-1, and not something a review could build
   * a repro for with one pointer and one tab. It is closed here anyway because
   * closing it is a lookup: arguing about the reachability of a stale read
   * costs more than not taking one.
   *
   * Falls back to the snapshot when the id is gone from `columns`, which is a
   * card deleted or filtered away mid-drag. `boardMove` and the write are both
   * safe on a row that no longer exists — the write answers 404 and the toast
   * reports it — and using the snapshot keeps the drop reporting the card the
   * user was actually holding.
   */
  const liveTodo = (todo: TodoItemData): TodoItemData => {
    for (const column of columns) {
      const found = column.todos.find((candidate) => candidate.id === todo.id);

      if (found) return found;
    }

    return todo;
  };

  const handleDrop = (
    event: React.DragEvent<HTMLElement>,
    column: BoardColumn,
  ) => {
    const todo = draggingTodo === null ? null : liveTodo(draggingTodo);
    const move = todo === null ? null : boardMove(todo, column.id);

    if (todo === null || move === null) return;

    event.preventDefault();

    // Before the mutation, so `handleDragEnd` — which the browser fires next —
    // reports a completed move rather than a cancelled one.
    wasDropped.current = true;
    setDraggingTodo(null);
    setDragAnnouncement(dragDroppedMessage(todo.title, column.heading));
    setSettling((current) => ({ id: todo.id, seq: (current?.seq ?? 0) + 1 }));

    if (move.kind === "status") {
      onToggle(todo, move.completed);

      return;
    }

    onReschedule(todo, move.dueAt);
  };

  useEffect(() => {
    if (settling === null) return;

    const timer = setTimeout(() => setSettling(null), SETTLE_HIGHLIGHT_MS);

    return () => clearTimeout(timer);
    // The sequence number is in the dependency deliberately: a second drop of
    // the same card has to cancel the first timer and start a fresh one, and
    // the id alone cannot express "again".
  }, [settling]);

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
                      isSettling={todo.id === settling?.id}
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
