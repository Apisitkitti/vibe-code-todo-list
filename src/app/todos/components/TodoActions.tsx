"use client";

import { useState, type ReactNode } from "react";

import { Button, Dropdown, Tooltip } from "@heroui/react";

import {
  NEXT_WEEK_DAY_OFFSET,
  TODAY_DAY_OFFSET,
  TOMORROW_DAY_OFFSET,
  rescheduleDay,
} from "@/lib/date";
import { rescheduleTriggerProps } from "@/lib/rowFocus";
import type { TodoItemData } from "@/lib/todo";

/**
 * The three controls a todo carries — reschedule, edit, delete — and the menu
 * behind the first of them.
 *
 * **Extracted from `TodoRow` when the board arrived, and shared rather than
 * copied, because the sharing is the accessibility argument.** The board's
 * drag has no keyboard equivalent of its own; what makes it operable from a
 * keyboard is that every card carries this same reschedule menu, whose items
 * write the same due dates a drop writes (`src/lib/todoBoard.ts` → `boardMove`).
 * A second, parallel menu on the card would make that claim true on the day it
 * was written and false the first time one of the two was changed. One
 * component is the only version of it a reviewer does not have to re-verify.
 *
 * Nothing about the row's behaviour changed in the move: the same markup, the
 * same `aria-label`s, the same pending semantics, and the comments came with
 * the decisions they record.
 */

export const ICON_BUTTON_SIZING = "min-h-11 min-w-11 sm:min-h-9 sm:min-w-9";

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
 * date, which is the most common single edit, without the modal. On the board
 * it is also the keyboard equivalent of the drag (`docs/DESIGN.md` §8.8).
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
            reschedule moves the row into another section — or the card into
            another column — and React rebuilds it (`src/lib/rowFocus.ts` →
            `restoreRescheduleFocus`).
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

export interface TodoActionsProps {
  todo: TodoItemData;
  isPending: boolean;
  showTooltips: boolean;
  /** Positioning is the caller's: a row right-aligns them, a card does not. */
  className: string;
  onEdit: (todo: TodoItemData) => void;
  /** `dueAt` is the `YYYY-MM-DD` wire day, or `null` to clear it. */
  onReschedule: (todo: TodoItemData, dueAt: string | null) => void;
  onDelete: (todo: TodoItemData) => void;
}

/**
 * The cluster, in the order a row has always shown it.
 *
 * `gap-2`, not `gap-1`. §6.3 asks for ≥8px between adjacent targets and this
 * cluster had 4px — survivable while it held two controls, and the thing that
 * makes a mis-tap likely once it holds three.
 */
export const TodoActions = ({
  todo,
  isPending,
  showTooltips,
  className,
  onEdit,
  onReschedule,
  onDelete,
}: TodoActionsProps) => {
  return (
    <div className={`flex shrink-0 items-center gap-2 ${className}`}>
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
  );
};
