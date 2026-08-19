"use client";

import { useState, type ReactNode } from "react";

import { Button, Checkbox, Dropdown, Tooltip, Typography } from "@heroui/react";

import {
  NEXT_WEEK_DAY_OFFSET,
  TODAY_DAY_OFFSET,
  TOMORROW_DAY_OFFSET,
  rescheduleDay,
} from "@/lib/date";
import { rescheduleTriggerProps } from "@/lib/rowFocus";
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

/**
 * The reschedule menu's copy (`docs/DESIGN.md` §7.19). The three quick days
 * carry the offset each means; `Next week` is `+7` and the reasoning for that
 * lives with the constant in `src/lib/date.ts`, not here.
 */
const RESCHEDULE_TOOLTIP = "Reschedule";
const PICK_A_DATE_LABEL = "Pick a date…";
const CLEAR_DUE_DATE_LABEL = "Clear due date";

const QUICK_RESCHEDULE_DAYS = [
  { id: "today", label: "Today", dayOffset: TODAY_DAY_OFFSET },
  { id: "tomorrow", label: "Tomorrow", dayOffset: TOMORROW_DAY_OFFSET },
  { id: "next-week", label: "Next week", dayOffset: NEXT_WEEK_DAY_OFFSET },
] as const;

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

/**
 * HeroUI ships an `IconCalendar`, but every other icon in this row is an inline
 * `<svg>` at 16×16 with `stroke="currentColor"` (`docs/DESIGN.md` §4.4) and a
 * single imported icon among three hand-drawn ones is a visible size and weight
 * mismatch. Drawn to match its neighbours.
 */
const CalendarIcon = () => {
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
      <rect x="3" y="5" width="18" height="16" rx="2" />
      <path d="M3 10h18" />
      <path d="M8 3v4M16 3v4" />
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

interface RescheduleMenuProps {
  todo: TodoItemData;
  isDisabled: boolean;
  showTooltip: boolean;
  onReschedule: (todo: TodoItemData, dueAt: string | null) => void;
  onPickDate: (todo: TodoItemData) => void;
}

/**
 * The third row action (`docs/PM-PROPOSAL.md` §3 #5): changing only the due
 * date, which is the most common single edit, without the modal.
 *
 * **The trigger is a plain HeroUI `Button`, not `Dropdown.Trigger`.**
 * `Dropdown.Trigger` is the bare react-aria `Button` with a `dropdown__trigger`
 * class and none of the `button--ghost` / `button--icon-only` styling, so using
 * it would mean re-deriving this row's icon-button look by hand and keeping it
 * in step with the two beside it (`TodosHeader` does that, and it has no
 * neighbours to match). `Dropdown`'s root is react-aria's `MenuTrigger`, which
 * publishes its trigger props through a `PressResponder` exactly the way
 * `Tooltip` does — so the pressable child registers wherever it sits beneath
 * it, and the `ActionTooltip` in between is harmless: nested `PressResponder`s
 * merge with the context above them and both register
 * (`react-aria/dist/private/interactions/PressResponder.mjs`), which is what
 * keeps DEF-02's "rendered without a pressable child" warning away.
 *
 * **The days are resolved when the menu renders, not when the row does.** The
 * popover mounts only while it is open, so the resolved dates never reach the
 * server render and there is no hydration mismatch to suppress — unlike the
 * row's own due-date label, which does render on the server and carries
 * `suppressHydrationWarning` for it (`TodoDueDate`).
 *
 * **While a write is in flight the trigger is `aria-disabled`, never
 * `disabled`, and that is a focus decision rather than a styling one**
 * (review F1). The browser blurs a control the moment it acquires the
 * `disabled` attribute, so marking this one disabled on `markPending` dropped
 * focus to `<body>` for the length of the request — a keyboard user parked at
 * the top of the document for as long as their connection was slow, which is
 * precisely the failure `src/lib/rowFocus.ts` exists to prevent for the toggle.
 * Measured with the `PATCH` held open for 2s: `document.activeElement` was
 * `<body>` for the whole window.
 *
 * Nothing about the appearance or the announcement changes. HeroUI dims
 * `[aria-disabled="true"]` from the same rule as `:disabled`
 * (`@heroui/styles/dist/components/button.css`), and `aria-disabled` is what
 * assistive technology reads either way. What changes is that the control stays
 * focusable, so the user is still standing where they pressed.
 *
 * **The refusal moves to the open handler, and it had to.** `disabled` was not
 * actually preventing the second write it was there for: with the trigger
 * disabled mid-flight, a second `Enter` still reached the menu and sent a
 * second `PATCH` — two writes to the same column, free to land in either order.
 * Controlling `isOpen` and declining to open while pending refuses it at the
 * one place that can see the pending state, and it is refused visibly, on a
 * control the user can still see they are on.
 */
const RescheduleMenu = ({
  todo,
  isDisabled,
  showTooltip,
  onReschedule,
  onPickDate,
}: RescheduleMenuProps) => {
  const [isOpen, setIsOpen] = useState(false);

  const menuLabel = `Reschedule "${todo.title}"`;

  /**
   * The pending guard. `MenuTrigger` asks to open on press, on `Enter`, on
   * `Space` and on `ArrowDown`; refusing here covers all four with one rule,
   * where the trigger's own `disabled` attribute covered them by making the
   * control unreachable — and, as it turned out, did not actually cover them.
   *
   * Only *opening* is refused. A close is always honoured, so nothing can
   * strand the menu open.
   */
  const handleOpenChange = (nextOpen: boolean) => {
    if (nextOpen && isDisabled) return;

    setIsOpen(nextOpen);
  };

  return (
    <Dropdown isOpen={isOpen} onOpenChange={handleOpenChange}>
      <ActionTooltip label={RESCHEDULE_TOOLTIP} isEnabled={showTooltip}>
        <Button
          variant="ghost"
          size="sm"
          isIconOnly
          className={ICON_BUTTON_SIZING}
          /*
            `aria-disabled`, not `isDisabled` — see the note on this component.
            The state it announces is identical and HeroUI dims it identically;
            what it does not do is take focus off the control the user is
            standing on. `undefined` rather than `false` so the attribute is
            absent rather than present-and-false.
          */
          aria-disabled={isDisabled || undefined}
          /*
            Names the record, not the control. Three rows of `Reschedule`
            buttons are indistinguishable to a screen reader otherwise — the
            lesson the Undo buttons taught (`docs/DESIGN.md` §7.13).
          */
          aria-label={menuLabel}
          /*
            Names this row's trigger so focus can be put back on it after the
            reschedule moves the row into another section and React rebuilds it
            (`src/lib/rowFocus.ts` → `restoreRescheduleFocus`).
          */
          {...rescheduleTriggerProps(todo.id)}
        >
          <CalendarIcon />
        </Button>
      </ActionTooltip>
      <Dropdown.Popover placement="bottom end">
        {/*
          react-aria gives the menu keyboard operation for free — Enter, Space
          and ArrowDown open it, arrows and typeahead move through it, Escape
          and a click outside close it, and focus returns to the trigger. What
          it does not give is a *name*: without this the menu is announced as an
          unlabelled list of five items, on a screen that may hold twenty of
          them. It borrows the trigger's name rather than inventing a second.
        */}
        <Dropdown.Menu aria-label={menuLabel}>
          <Dropdown.Section>
            {QUICK_RESCHEDULE_DAYS.map((option) => {
              const { dueAt, preview } = rescheduleDay(option.dayOffset);

              return (
                <Dropdown.Item
                  key={option.id}
                  /*
                    Typeahead and the collection's own text extraction read
                    this rather than walking the element tree, so without it a
                    user typing "t" would match nothing.
                  */
                  textValue={option.label}
                  onAction={() => onReschedule(todo, dueAt)}
                >
                  <span className="flex w-full items-center justify-between gap-6">
                    <span>{option.label}</span>
                    {/*
                      The resolved date, so `Next week` states what it means at
                      the moment of the decision instead of after it
                      (`docs/DESIGN.md` §7.19).

                      A plain `<span>`, deliberately, where the rest of the app
                      would reach for `Typography`. react-aria's `MenuItem`
                      publishes a `TextContext` whose `label` slot carries the
                      id the item points its `aria-labelledby` at, and
                      `Typography` consumes it — so rendering the date through
                      it made the date *the item's whole accessible name*:
                      `Today` was announced as `Aug 19`, the one word that says
                      what pressing it does silently dropped. With no element
                      claiming the slot, the name is the item's full text and
                      both halves are announced. Pinned by
                      `e2e/reschedule.spec.ts`.
                    */}
                    <span className="text-sm text-muted">{preview}</span>
                  </span>
                </Dropdown.Item>
              );
            })}
          </Dropdown.Section>
          <Dropdown.Section>
            <Dropdown.Item
              textValue={PICK_A_DATE_LABEL}
              onAction={() => onPickDate(todo)}
            >
              {PICK_A_DATE_LABEL}
            </Dropdown.Item>
            <Dropdown.Item
              textValue={CLEAR_DUE_DATE_LABEL}
              /*
                Disabled rather than hidden when there is nothing to clear: a
                menu that changes length between rows is harder to learn than
                one item that is plainly unavailable, and this is the only item
                whose availability depends on the row.
              */
              isDisabled={todo.dueAt === null}
              onAction={() => onReschedule(todo, null)}
            >
              {CLEAR_DUE_DATE_LABEL}
            </Dropdown.Item>
          </Dropdown.Section>
        </Dropdown.Menu>
      </Dropdown.Popover>
    </Dropdown>
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

      {/*
        `gap-2`, not `gap-1`. §6.3 asks for ≥8px between adjacent targets and
        this cluster had 4px — survivable while it held two controls, and the
        thing that makes a mis-tap likely once it holds three. `ml-auto` keeps
        the cluster right-aligned whether it shares the row's first line or has
        wrapped onto one of its own.
      */}
      <div className="ml-auto flex shrink-0 items-center gap-2 transition-opacity motion-reduce:transition-none lg:opacity-0 lg:group-focus-within:opacity-100 lg:group-hover:opacity-100">
        <RescheduleMenu
          todo={todo}
          isDisabled={isPending}
          showTooltip={showTooltips}
          onReschedule={onReschedule}
          /* `Pick a date…` is the existing edit modal, not a second picker. */
          onPickDate={onEdit}
        />
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
