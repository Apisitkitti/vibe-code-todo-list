"use client";

import { Checkbox, Typography } from "@heroui/react";

import { toggleTargetProps } from "@/lib/rowFocus";
import { ICON_BUTTON_SIZING } from "@/lib/styles";
import type { TodoItemData } from "@/lib/todo";

import { PriorityChip, priorityDrawsChip } from "./PriorityChip";
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
 * Stacked instead of arranged along one line, because a column is ~209px wide
 * and the row's horizontal arrangement wraps into an unreadable stack at that
 * width: checkbox and title, then the metadata when there is any, then the
 * actions. Three explicit lines rather than two and a `flex-wrap` — see the
 * note on the metadata line below for what that bought and what it cost.
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

  /*
    The metadata, as one fragment — identical to `TodoRow`'s, for the reason the
    docblock above gives: a card and a row are the same object in two shapes. A
    completed card goes quiet exactly as a completed row does (§8.5, and
    `todoGroups`' "a completed todo is done, so its date has nothing left to
    say"); the note marker stays either way.
  */
  const metadata = (
    <>
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
    </>
  );

  /** The same predicate `TodoRow` applies, on the same three conditions. */
  const hasVisibleMetadata =
    (!todo.completed &&
      (priorityDrawsChip(todo.priority) || Boolean(todo.dueAt))) ||
    Boolean(todo.note);

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
      {/*
        `items-start`, and the checkbox is centred on the title's **first
        line** rather than on the title.

        A card and a row are the same object in two shapes, and this was the
        clearest place they did not read as one: the row's control and title
        share a centre line and measure 0.00 apart, and every card sat 6.00px
        low. The row is not what changes — its centring is correct, and the rule
        is that text baseline-aligns to text while a box centre-aligns to text.
        A checkbox is a box.

        But `items-center` here would be the wrong reading of that rule. A row's
        title truncates and is always one line, so "the title" and "the title's
        first line" are the same thing; a card's wraps to three, and centring
        the control against the whole block would put it 24px low on a
        three-line card — worse than the fault it replaced.

        So the wrapper below is exactly one line tall (`h-6`, the title's
        `body-sm` `leading-6`) and the 36px tap target is centred inside it,
        overflowing 6px into the card's own `py-3`. The target keeps §6.3's
        floor at full size; what it stops doing is setting the height of a block
        it is only a marker in. `e2e/card-row-parity.spec.ts` measures both the
        one-line and the wrapped case, and the row alongside them.
      */}
      <div className="flex items-start gap-2">
        {/*
          The anchor `restoreToggleFocus` finds this card's checkbox by, after a
          completion moves the card to another column and React rebuilds it.
          On a wrapper rather than on the control — `src/lib/rowFocus.ts` says
          why.
        */}
        <span
          {...toggleTargetProps(todo.id)}
          className="flex h-6 shrink-0 items-center"
        >
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
            <Checkbox.Content
              className={`${ICON_BUTTON_SIZING} flex items-center justify-start`}
            >
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

      {/*
        Two explicit lines, and **`flex-wrap` is not one of them**.

        The metadata and the actions used to share a single `flex flex-wrap`
        line, which meant the metadata got whatever `TodoActions` left over.
        Measured at 1280×800 with five columns: the line is 183.20px,
        `TodoActions` is a fixed 124.00 and §2.2's `gap-2` is 8 — so the
        metadata's budget was **51.20px**. `Low` is 48.45 and fitted; `High` is
        **52.16**, over by 0.95px, and 0.95px of overflow moved the whole action
        cluster onto a line of its own and the card 28px taller. On a board of
        otherwise identical cards, whether a card was two lines or three
        depended on nothing the user can see except whether it said `High`.
        `Medium` draws no chip, so the untriaged default was the only reason a
        majority of cards cleared the budget at all
        (`docs/decisions/2026-08-21-board-card-metadata-line.md`).

        Now the height follows what the card carries, identically for every card
        of the same content shape and at every column width. Measured, one-line
        titles, before → after:

        | the card carries | before | after |
        |---|---|---|
        | nothing (`Medium`, undated) | 94 | 94 |
        | a `Low` chip | 94 | 122 |
        | a `High` chip | 122 | 122 |
        | a date, either chip | 126 | 126 |

        One shape pays: a `Low`, undated card goes 94 → 122, and that cost is
        the point rather than a regression — a card is a line taller because it
        says something more, not because of which chip it drew. Nothing gets
        shorter, which the deferral record listed as unmeasured and is the thing
        that decides whether this trade is worth taking; 28px on one shape, to
        stop a 28px step turning on 0.95px, is.

        The 122/126 step is the date's own line box: `TodoDueDate` is `body-sm`
        at `leading-6` where the chip is 20px, so a dated line is 4px taller
        than a chipped one. That is the card carrying more, which is exactly
        what the height is now allowed to mean.

        The metadata line is rendered only when it has visible content, and the
        `else` keeps the fragment without a box so `PriorityChip`'s `sr-only`
        announcement survives — `TodoRow` carries the full argument.
      */}
      {hasVisibleMetadata ? (
        <div className="flex items-center gap-2">{metadata}</div>
      ) : (
        metadata
      )}

      {/*
        Always, and `justify-end` rather than `ml-auto` on the actions
        themselves: on a line of its own there is nothing for an auto margin to
        push against, so the alignment belongs to the line.
      */}
      <div className="flex justify-end">
        <TodoActions
          todo={todo}
          isPending={isPending}
          showTooltips={showTooltips}
          className=""
          onEdit={onEdit}
          onReschedule={onReschedule}
          onDelete={onDelete}
        />
      </div>
    </li>
  );
};
