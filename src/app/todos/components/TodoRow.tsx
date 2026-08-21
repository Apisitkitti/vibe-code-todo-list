"use client";

import { Checkbox, Typography } from "@heroui/react";

import { ICON_BUTTON_SIZING, ROW_TITLE_LAYOUT } from "@/lib/styles";
import type { TodoItemData } from "@/lib/todo";

import { PriorityChip, priorityDrawsChip } from "./PriorityChip";
import { TodoActions } from "./TodoActions";
import { TodoDueDate } from "./TodoDueDate";

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
  /** `dueAt` is the `YYYY-MM-DD` wire day, or `null` to clear it. */
  onReschedule: (todo: TodoItemData, dueAt: string | null) => void;
  onDelete: (todo: TodoItemData) => void;
}

export const TodoRow = ({
  todo,
  isPending,
  isVanishing,
  showTooltips,
  onToggle,
  onEdit,
  onReschedule,
  onDelete,
}: TodoRowProps) => {
  /*
    Everything the metadata line can hold, as one fragment, so the two branches
    below cannot drift into rendering different things.

    A completed row goes quiet: no priority chip and no due date.
    `src/lib/todoGroups.ts` already argues the date half — "a completed todo is
    done, so its date has nothing left to say" — and this is the row finally
    agreeing with it, instead of filing a finished task under `Completed` while
    it announces `Aug 12`. The priority half is §8.5: once a todo is done its
    priority is history and it is competing for attention with the active rows
    above it.

    §6.4 is unaffected. Completion is carried by the checkbox's `aria-checked`
    and by `line-through` on the title, never by the chip or the date, so
    nothing that carried meaning has been removed. The `✎` note marker stays — a
    note is still there to read — and so do the actions.
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

  /**
   * Whether that fragment draws anything, which is what decides whether it gets
   * a box of its own.
   *
   * Written from the same three conditions the fragment above branches on, in
   * the same order and with the same truthiness — `dueAt` and `note` are
   * checked for truth rather than for `!== null`, because an empty-string note
   * renders nothing and would otherwise buy an empty line. The two must agree
   * exactly: a `true` here with nothing to draw is the defect this replaces, and
   * a `false` with something to draw would drop visible content.
   *
   * `priorityDrawsChip` rather than `priority !== "medium"`, so the level's own
   * component stays the only file that knows which levels draw.
   */
  const hasVisibleMetadata =
    (!todo.completed &&
      (priorityDrawsChip(todo.priority) || Boolean(todo.dueAt))) ||
    Boolean(todo.note);

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
      //
      // **`flex-wrap`, and it is load-bearing rather than defensive** (§4.4,
      // "Three targets and 320px"). A third 44×44 action does not fit beside a
      // 44×44 checkbox and a readable title at 320px, and the target size is
      // not negotiable — so the actions cluster is allowed to take a line of
      // its own when the row cannot hold everything on one. The content
      // column's `min-w-32` is what decides *when*: it is the narrowest a
      // truncated title may be squeezed to, so flexbox breaks the line rather
      // than going below it. Measured, that is a wrap below 457px — every
      // phone — with no breakpoint named anywhere in the CSS to keep in step
      // with the design. §4.4 carries the arithmetic; note that 112px of it is
      // surrounding padding, a third of which is the Card's own `px-4` and is
      // the term the first draft of that arithmetic left out.
      className={`group flex flex-wrap items-center gap-x-3 gap-y-2 rounded-2xl border border-border-secondary px-4 py-3.5 hover:bg-surface-hover ${
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
        <Checkbox.Content className={`${ICON_BUTTON_SIZING} flex items-center justify-start`}>
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

      {/*
        `min-w-32` rather than `min-w-0`, and it is the whole of the 320px
        decision: it says a truncated title may be squeezed to 128px and no
        further, which is what makes flexbox move the actions to their own line
        instead of crushing the title to nothing. `truncate` still works — the
        floor bounds the shrink, it does not stop it.
      */}
      <div className="flex min-w-32 flex-1 flex-col gap-1 sm:flex-row sm:items-center sm:gap-3">
        <Typography
          type="body"
          weight="medium"
          truncate
          className={
            todo.completed
              ? `${ROW_TITLE_LAYOUT} text-muted line-through`
              : ROW_TITLE_LAYOUT
          }
        >
          {todo.title}
        </Typography>
        {/*
          The metadata line gets a box **only when it has something to draw**,
          and the branch is a layout fix rather than a tidy-up.

          Below `sm:` this column is a `flex-col gap-1`. A cluster rendered with
          nothing in it is still a flex item — zero-height, but it takes the 4px
          gap before it — so the `<li>`'s `items-center` centred the checkbox
          against a block 4px taller than the title and the control sat
          **2.00px** below it. At `sm:` and up the same empty box took a 12px
          `gap-3` in a row the title is `flex-1` of, so it cost nothing visible
          there; the fault was only ever the stacked half, which is why
          `e2e/card-row-parity.spec.ts` skipped mobile until now.

          The `else` is the whole of the accessibility trade: the fragment is
          still rendered, without a box. When it has nothing visible its only
          content is `PriorityChip`'s `sr-only` `Priority: …`, which is
          `position: absolute` — so it is not a flex item, takes no gap, and the
          announcement survives an element that does not. A screen-reader user
          is exactly who cannot see that the chip is absent, so dropping the
          announcement with the box would cost the level to the only person
          relying on it (`e2e/a11y-contrast.spec.ts`).
        */}
        {hasVisibleMetadata ? (
          <div className="flex shrink-0 items-center gap-2">{metadata}</div>
        ) : (
          metadata
        )}
      </div>

      {/*
        `ml-auto` keeps the cluster right-aligned whether it shares the row's
        first line or has wrapped onto one of its own. The controls themselves
        are `TodoActions`, shared with the board's cards so the reschedule menu
        cannot differ between the two (`docs/DESIGN.md` §8.8).
      */}
      <TodoActions
        todo={todo}
        isPending={isPending}
        showTooltips={showTooltips}
        className="ml-auto transition-opacity motion-reduce:transition-none lg:opacity-0 lg:group-focus-within:opacity-100 lg:group-hover:opacity-100"
        onEdit={onEdit}
        onReschedule={onReschedule}
        onDelete={onDelete}
      />
    </li>
  );
};
