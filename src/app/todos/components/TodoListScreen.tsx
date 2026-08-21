"use client";

import { useEffect, useRef, useState } from "react";

import {
  Alert,
  Button,
  Card,
  Typography,
  useMediaQuery,
  useOverlayState,
} from "@heroui/react";
import { useFocusVisible } from "react-aria";

import {
  PAGE_HEADING,
  QUICK_ADD_EXAMPLE,
  TRY_AGAIN_LABEL,
} from "@/app/todos/constants";
import { useTodoList } from "@/app/todos/hooks/useTodoList";
import { ConfirmDialog } from "@/components/ConfirmDialog";
import { formatDueDate } from "@/lib/date";
import { getErrorMessage } from "@/lib/getErrorMessage";
import { createHandoff } from "@/lib/handoff";
import {
  focusIsUnclaimed,
  focusRowAfterRemoval,
  focusUndoAction,
  nextUndoToken,
  readFocusedRow,
  restoreRescheduleFocus,
  restoreToggleFocus,
  undoTokenProps,
} from "@/lib/rowFocus";
import {
  claimActionPress,
  dismissActionToast,
  showActionToast,
  showSupersedingReceipt,
  showYieldingReceipt,
  toast,
} from "@/lib/toast";
import {
  DEFAULT_FORM_FOCUS,
  toDueDateInputValue,
  type TodoFormFocus,
  type TodoItemData,
  type TodoListFilters,
  type TodoView,
} from "@/lib/todo";
import { boardColumns } from "@/lib/todoBoard";
import { groupTodos, type TodoGroup } from "@/lib/todoGroups";
import {
  applyCompletion,
  applyDueDate,
  replaceTodo,
  todoMatchesFilters,
  todoMatchesStatusFilter,
} from "@/lib/todoListState";
import {
  deleteTodo,
  rescheduleTodo,
  toggleTodo,
  updateTodo,
} from "@/service/todo.service";

/*
  The schema's real home, not the form barrel. `TodoFormValues` is the write
  contract — the route handlers re-parse with it — and this screen wants the
  contract, not a form component, so it says so.
*/
import type { TodoFormValues } from "@/lib/todo.schema";
import { QuickAddBar } from "./QuickAddBar";
import { TodoBoard } from "./TodoBoard";
import { TodoBoardSkeleton } from "./TodoBoardSkeleton";
import { TodoEmptyState } from "./TodoEmptyState";
import {
  LABELLED_CONTROL_SIZING,
  PAGE_HEADING_BLOCK,
  PAGE_HEADING_ROW,
} from "@/lib/styles";

import { useTodosUrlSync } from "@/app/todos/hooks/useTodosUrlSync";

import { TodoFilters } from "./TodoFilters";
import { TodoFormModal } from "./TodoFormModal";
import { TodoGroupedList } from "./TodoGroupedList";
import { TodoListHeaderLine } from "./TodoListHeaderLine";
import { TodoListSkeleton } from "./TodoListSkeleton";
import { ViewToggle } from "./ViewToggle";

const DESKTOP_MEDIA_QUERY = "(min-width: 640px)";

/**
 * Where the board becomes a board (`docs/DESIGN.md` §8.8, §4.11).
 *
 * Five columns need roughly 200px each to hold a readable title beside a
 * 44×44 checkbox; below `lg` there is not room, and the honest answers to "what
 * happens on a phone" were a two-column compromise, a sideways scroller whose
 * drop targets are off screen, or the list. **It is the list**, and that is not
 * a failure mode: the list already groups by the same five sections, stacked —
 * so a phone gets the board's information in the shape a phone can read it,
 * and it gets the reschedule menu, which is the whole of the board's write
 * vocabulary. The drag is the only thing lost, and a drag is the one part that
 * was never going to work there anyway: it collides head-on with vertical touch
 * scrolling, and the disambiguating long-press would make the gesture slower
 * than the menu it replaces (§8.1 makes this argument for the checkbox; it is
 * the same argument).
 *
 * **`(pointer: fine)` as well as the width, because the width alone left half
 * of this argument reasoned about and not implemented.** The paragraph above
 * rules the board out on a phone for two reasons — five columns do not fit,
 * *and* HTML5 drag does not fire from touch — but a query on width alone only
 * enforces the first. An iPad in landscape is wider than `lg` and has no fine
 * pointer, so it was being handed a board whose cards cannot be dragged:
 * pulling one scrolls the page instead, nothing happens, and nothing on screen
 * says why. That is worse than not offering the view, because the affordance
 * is visibly there.
 *
 * The *primary* pointer is the right thing to ask about rather than
 * `any-pointer`, which answers "is any fine pointer available" — true of a
 * tablet with a stylus in a drawer or a trackpad in a case, while the user's
 * hands are on the glass. `hover: hover` would be a proxy for the same thing
 * and says less about whether a drag can be started.
 *
 * `?view=board` in the URL is **kept** while this is showing the list, rather
 * than rewritten to `view=list`. The user did not change their mind; their
 * window is narrow. Rotating a tablet or widening a window puts the board back
 * without them having to ask twice, and a link shared from a phone still opens
 * as a board on a desktop.
 */
const BOARD_MEDIA_QUERY = "(min-width: 1024px) and (pointer: fine)";

/**
 * How long an Undo stays offered. HeroUI's 4s default is a reasonable life for
 * "here is what happened" and a poor one for "you have this long to change
 * your mind" — it can expire while the reader is still finishing the sentence
 * that told them Undo was there. Both the designer and the Senior called it
 * too short before anyone was looking for it.
 *
 * It used to be the margin that kept the toast usable at all — the first
 * ~400ms of an action toast was inert while HeroUI's view transition owned
 * hit-testing, and a replaced toast's Undo was dead for ~740ms
 * (`docs/DESIGN.md` §4.10, measured in `e2e/toast-dead-window.spec.ts`).
 * **That is no longer true**: the queue in
 * `src/lib/toast.ts` takes §4.10's `wrapUpdate` escape hatch, and the measured
 * dead window on both paths is now 0ms. The 12s stands on its own argument
 * about reading time, which was always the better one.
 */
const UNDO_WINDOW_MS = 12_000;

/**
 * How long `Todo “{title}” added — hidden by your filters` stays up
 * (`docs/DESIGN.md` §7.17).
 *
 * **Its own 12s, not borrowed from `UNDO_WINDOW_MS`**, and the deck says so
 * explicitly. It is the longer of the two receipts because it is the longer
 * sentence and there is nothing on screen to re-read it from — the row it
 * describes is the one the filter swallowed. Tying it to the Undo window would
 * make a change to how long a reversal is offered silently change how long the
 * only account of an invisible write is readable.
 *
 * The visible receipt takes no constant at all: §7.17 gives it the queue's own
 * default, so it is left as the default rather than restated here.
 */
const HIDDEN_RECEIPT_WINDOW_MS = 12_000;

/**
 * The empty state's call to action (`docs/DESIGN.md` §7.18). It no longer
 * opens the modal — it moves focus to the quick-add bar, which is the one
 * capture path, so the label describes that rather than a dialog.
 */
const ADD_TODO_LABEL = "Add a todo";

/**
 * The one place the quick-add vocabulary is taught (`docs/DESIGN.md` §7.18,
 * "Empty state teaching line"; §7.7 for which state may carry it).
 *
 * The parser is the one distinctive thing this product does, and until now it
 * was taught only in a placeholder that disappears on the first keystroke — so
 * the people who most need it are the ones who never finish reading it. A
 * tester reported it verbatim: *"I have no idea what 'high' means. Is that the
 * priority? Is that part of the syntax? Nobody told me, and I didn't figure it
 * out."*
 *
 * **The wording is the copy deck's, not this file's.** §7.18 already carried
 * the string; it is reproduced here rather than improvised, which is the rule
 * for every other string in this screen.
 *
 * `QUICK_ADD_EXAMPLE` is interpolated because the bar's placeholder shows the
 * same example and the two must not teach one parser two vocabularies. **Only
 * the example is shared, and the rest of this sentence is not
 * example-agnostic**: `pay rent`, `Friday` and `High` are that example's own
 * reading spelled out, so changing the constant means rewriting the deck entry
 * and this line with it. Said plainly here because the interpolation otherwise
 * reads like a promise that it adapts.
 *
 * Only the never-used branch of `resolveEmptyState` takes it — see the note on
 * `TodoEmptyState`'s `hint` prop, and §7.7, for why `No matches` must not.
 */
const QUICK_ADD_SYNTAX_HINT = `A day and a priority at the end are read — “${QUICK_ADD_EXAMPLE}” becomes “pay rent”, due Friday, High priority.`;

/**
 * Failure fallbacks from the copy deck (`docs/DESIGN.md` §7.9, §7.13, §7.15),
 * named because each is now read from more than one place: the toggle and its
 * Undo share one code path, and both kinds of Undo report the same wording.
 */
const TOGGLE_FAILURE_MESSAGE = "Couldn’t update the todo. Try again.";
const RESCHEDULE_FAILURE_MESSAGE = "Couldn’t change the due date. Try again.";
const UNDO_FAILURE_MESSAGE = "Couldn’t undo that. Try again.";

/** The word on the button (`docs/DESIGN.md` §7.13, §7.15). */
const UNDO_LABEL = "Undo";

/**
 * What a screen reader announces for an Undo (`docs/DESIGN.md` §7.13).
 *
 * The visible word is `Undo`, and the name is what tells a screen-reader user
 * which reversal it is. QA raised this against a *stack* of them
 * (`docs/QA-REPORT.md` §8), which the cap has since removed: at most one
 * action toast stands at a time (`src/lib/toast.ts`).
 *
 * **The name outlived the stack it was written for**, and deliberately. A lone
 * Undo is still reached by name — by the focus rescue, by every `getByRole` in
 * the suite, and by anyone navigating the toast region rather than looking at
 * it — and the toast it belongs to is still one of several on screen, since
 * receipts are outside the cap. "Undo, button" beside two `added` receipts
 * says nothing about what it would put back.
 *
 * The subject is the toast's own title rather than a second wording invented
 * here — `Todo “x” added`, `Todo “x” marked complete` — so the name says what
 * this Undo reverses and stays true wherever §7.11's copy goes. Building it
 * from the value it describes is `docs/CONVENTIONS.md`'s rule; a per-case
 * literal would be four more strings to keep in step with one.
 */
const undoActionLabel = (message: string) => `${UNDO_LABEL} — ${message}`;

/** What a toggle and its Undo do differently; everything else is shared. */
interface ToggleOutcome {
  onSuccess: () => void;
  failureMessage: string;
  /**
   * Whether the success path has to ask the server what the list looks like
   * now. True only when the write puts a row back, since local state cannot
   * choose the §2 position it returns to.
   */
  reloadOnSuccess: boolean;
}

/** What a reschedule and its Undo do differently; everything else is shared. */
interface RescheduleOutcome {
  onSuccess: (saved: TodoItemData) => void;
  failureMessage: string;
}

interface EmptyStateCopy {
  heading: string;
  body: string;
  /** Set by the never-used branch alone — see `resolveEmptyState`. */
  hint?: string;
  actionLabel?: string;
  onAction?: () => void;
}

export interface TodoListScreenProps {
  filters: TodoListFilters;
  view: TodoView;
}

/**
 * Owns the list: it loads todos over HTTP through the service, and decides per
 * mutation whether the answer is already in hand.
 *
 * A create refetches, because it can place a row anywhere or outside the
 * filter entirely. A toggle does not: it applies the change locally and
 * reconciles with the row the write returned (`runToggle`).
 */
export const TodoListScreen = ({ filters, view }: TodoListScreenProps) => {
  /*
    The one writer of the `/todos` query string. It lives here rather than in
    `TodoFilters` because the view toggle writes the same URL and renders when
    the filter row does not — see `useTodosUrlSync` for what two writers cost.
  */
  const urlSync = useTodosUrlSync(filters, view);
  const {
    result,
    setResult,
    isLoading,
    loadError,
    pendingTodoIds,
    markPending,
    clearPending,
    removeTodoLocally,
    reloadWithSkeleton,
    reloadSilently,
    retry,
    readLandedLoads,
  } = useTodoList(filters);
  const [editingTodo, setEditingTodo] = useState<TodoItemData | null>(null);
  /**
   * Which field the editor opens on. Reset by every opener, so a `Pick a
   * date…` never leaves `dueAt` behind for the next plain `Edit` — the modal
   * stays mounted between openings, so nothing else would clear it.
   */
  const [editFocus, setEditFocus] = useState<TodoFormFocus>(DEFAULT_FORM_FOCUS);
  const [pendingDelete, setPendingDelete] = useState<TodoItemData | null>(null);
  const [isDeleting, setIsDeleting] = useState(false);
  /**
   * What `More options` had already read from the quick-add bar. Held here
   * rather than in the bar because the modal is the list's, and bumping
   * `createSeq` with it is what remounts the form onto a new draft — two
   * consecutive creates otherwise share one `key` and the second would open
   * on the first one's values.
   */
  const [createDraft, setCreateDraft] = useState<TodoFormValues | null>(null);
  const [createSeq, setCreateSeq] = useState(0);
  const formState = useOverlayState();

  /**
   * The quick-add input. Held here because one thing outside the bar moves
   * focus to it: the empty state's call to action, and nothing else — which is
   * the point. Focus after a submit is the bar's own business and never leaves
   * it (`docs/PRD.md` US-05).
   */
  const quickAddInputRef = useRef<HTMLInputElement>(null);

  const isDesktop = useMediaQuery(DESKTOP_MEDIA_QUERY);
  /*
    The view actually on screen, which is not always the view in the URL — see
    `BOARD_MEDIA_QUERY`. Everything below asks this rather than `view`, because
    the behaviours that differ (optimistic column membership, where focus goes
    after a move) belong to the board being *rendered*, not requested.
  */
  /*
    `initializeWithValue: false`, and it is a hydration fix rather than a
    preference. HeroUI's hook reads `matchMedia` during the *first client
    render* by default, while the server — which has no `matchMedia` — rendered
    its `defaultValue`. That is a genuine mismatch the moment the answer decides
    which component tree exists: the server sent a list and the client built a
    board over the top of it, and React threw the whole subtree away with
    "Hydration failed" in the console. `e2e/console-clean.spec.ts` treats that
    as a defect, correctly.

    Opting out makes the first client render agree with the server, and the
    layout effect inside the hook flips it before the browser paints — so the
    board still arrives without a visible flash, and the `isDesktop` query
    beside this one is left alone because it changes no markup.
  */
  const isWideEnoughForBoard = useMediaQuery(BOARD_MEDIA_QUERY, {
    initializeWithValue: false,
  });
  const isBoard = view === "board" && isWideEnoughForBoard;
  /**
   * Whether the user is driving from the keyboard. The focus rescue below only
   * runs then, and that restriction is the point: a pointer user's focus is
   * not a place they are standing, so moving it into a toast would arm Undo
   * under a Space press they meant for something else. react-aria's own toast
   * region draws the same line — on a removal it moves focus *out* of the
   * region in pointer modality.
   */
  const { isFocusVisible } = useFocusVisible();
  const { status, priority, query } = filters;

  /**
   * The outstanding `More options` handoff: what tells the quick-add bar
   * whether the modal it opened saved or was backed out of (QA DEF-23).
   *
   * A ref rather than state because nothing renders from it, and because it
   * has to be readable from a callback that may outlive the render it was made
   * in. `Handoff` owns the answer-exactly-once invariant.
   */
  const moreOptionsHandoff = useRef(createHandoff<boolean>());

  /**
   * The create the modal is already serving, or `null` when it is serving
   * none. What makes a second `More options` press join the opening it found
   * instead of starting a second one (`openCreate`).
   *
   * Deliberately *not* `formState.isOpen`, but not for the reason that reads
   * as obvious. An earlier version of this comment claimed two presses in one
   * task both read `isOpen === false` and so slip past a guard on it. The
   * review tried to demonstrate that and could not: React batches both
   * `setCreateSeq` calls into one render before the modal mounts, so the
   * same-task case produces a single mount and no re-key, and a guard on
   * `isOpen` passes the whole suite (review F-2). Anyone hunting for that
   * failure will not find it.
   *
   * What the ref actually buys is stated below — the second press is
   * *answered* rather than dropped — and an invariant that does not depend on
   * knowing when React commits. That is worth having on its own; it is not
   * worth defending with a failure mode nobody has produced.
   *
   * Holding the promise rather than a boolean is what lets the second press be
   * *answered* rather than merely ignored: it awaits the same outcome the
   * first one did, so `Handoff`'s answer-exactly-once invariant covers both
   * openers with one question. Cleared when that promise settles, which every
   * exit does — the save (`handleSaved`), the three dismissals (the
   * `formState.isOpen` effect) and unmount (the effect below it).
   */
  const outstandingCreate = useRef<Promise<boolean> | null>(null);

  /**
   * Disarms this row's outstanding Undo, if the standing one is its.
   *
   * **The bookkeeping moved to `src/lib/toast.ts`** and with it the rule: at
   * most one action-bearing toast stands at a time, whatever record it belongs
   * to. What used to be a `Map<todoId, key>` here is a single slot there,
   * because there is now only ever one thing in it. Everything the map
   * protected is still protected — an armed Undo never outlives the write it
   * describes (review M-1, M-2) — and the re-entrancy guard is stronger, since
   * the press is claimed by the toast's own token rather than by its row.
   *
   * `added` receipts are still deliberately outside all of this
   * (`docs/DESIGN.md` §7.15, §7.17): they carry no action, so neither thing
   * the slot protects applies to them, and the `hidden by your filters`
   * sentence is the only account a swallowed row ever gets.
   */
  const dismissUndo = (todoId: string) => dismissActionToast(todoId);

  /**
   * Reports a create, and decides which of the two receipts it is
   * (`docs/DESIGN.md` §7.17, ruled by §7.13.1).
   *
   * Both are receipts — no action, no token, no bookkeeping (§7.15). They are
   * **not** the same object, and the difference is whether the row is on
   * screen:
   *
   * | receipt | life | against a standing Undo |
   * |---|---|---|
   * | `added` | 4s (the queue's default) | yields — not raised at all |
   * | `added — hidden by your filters` | 12s | takes the slot, closing it |
   *
   * The exemption receipts used to have was granted to both by inheritance
   * rather than by argument. The first confirms something the list has already
   * confirmed, where the user is looking; the second describes a row nothing on
   * screen mentions. Where a sentence and a control compete for §4.10.1's one
   * operable slot, the sentence wins if it cannot be re-derived and the control
   * can.
   *
   * `todoMatchesFilters` only ever claims "hidden" when it is certain, and that
   * asymmetry now decides more than the wording: being wrong towards "visible"
   * costs a missing sentence, being wrong towards "hidden" costs a sentence
   * that is a lie *and* an Undo the user still had every right to.
   */
  /*
    A create can land outside the list the user is looking at, and the row then
    simply never appears. Inserting it anyway is not an option — a filtered list
    must match what a reload of the same URL would show at every moment
    (`docs/PRD.md` US-10, the rule the toggle already follows) — and clearing
    the filter on their behalf would throw away something they asked for. So the
    receipt says it.
  */
  const reportCreate = (saved: TodoItemData) => {
    if (todoMatchesFilters(saved, filters)) {
      /*
        No explicit timeout: §7.17's 4s is the queue's own default, and it is
        left as the default rather than restated so the two cannot drift.
      */
      showYieldingReceipt(`Todo “${saved.title}” added`);

      return;
    }

    showSupersedingReceipt(
      `Todo “${saved.title}” added — hidden by your filters`,
      HIDDEN_RECEIPT_WINDOW_MS,
    );
  };

  /**
   * Raises the Undo toast and returns the token that names **this** one.
   *
   * Two callers remain, and they are the two reversals that put a value back:
   * a toggle (§7.13) and an edit (§7.15). A create reports through
   * `reportCreate` instead — its Undo was a `DELETE`, which is the hazard
   * §6.8 records and this change closes.
   *
   * The token is what the focus rescue waits for (`src/lib/rowFocus.ts`). It
   * has to come back from here rather than be looked up afterwards, because
   * for a few frames the DOM holds two toasts for this same todo — the
   * outstanding `added` one that `dismissUndo` has just asked to close, whose
   * close is queued behind HeroUI's serialized view transition, and the one
   * being raised now. `undoToastKeys` can tell them apart by key but nothing
   * in the DOM carries that key, so the token is minted here and stamped on
   * the button itself (QA DEF-25).
   */
  const showUndoableSuccess = (
    todoId: string,
    message: string,
    undo: () => void,
  ) => {
    const token = nextUndoToken();

    /*
      No `dismissUndo` first any more: `showActionToast` closes whatever action
      toast was standing, for any record, which is the cap. The old call
      dismissed only this row's, and under a single slot that would have been
      the same thing on the common path and wrong on the one that matters —
      an Undo for a *different* row left armed beside a newer one.
    */
    showActionToast({
      todoId,
      token,
      message,
      timeout: UNDO_WINDOW_MS,
      actionProps: {
        children: UNDO_LABEL,
        /*
          The accessible name, which the visible word cannot be: it is `Undo`
          on every toast in the stack, and the stack is the ordinary case.
          `aria-label` overrides the child text for assistive technology and
          leaves the button reading `Undo` on screen, which is what the copy
          deck asks for in both places (§7.13).

          **Kept under the cap**, though the cap removes the stack it was
          written for. A single Undo still has to say what it reverses to
          anyone who reaches it by name rather than by looking at the toast
          above it, and the name is what the focus rescue and every
          `getByRole` in the suite ask for. It stops being the thing holding
          the feature up; it does not stop being right.
        */
        "aria-label": undoActionLabel(message),
        ...undoTokenProps(token),
        onPress: () => {
          /*
            Claimed by this toast's own token. Closing a toast does not remove
            it — the removal is deferred — so the press has to name which
            toast it came from rather than which row: after a repeat write two
            action buttons for one todo are briefly in the DOM, and only one
            of them is live.
          */
          if (!claimActionPress(token)) return;

          undo();
        },
      },
    });

    return token;
  };

  /**
   * The modal's only remaining create entry point: `More options` on the bar,
   * carrying whatever it had already read. There is no toolbar button any
   * more — one bar, and one modal behind it for a note or a date the
   * vocabulary cannot say.
   *
   * **Resolves `false` when the modal closes without saving**, which is what
   * lets the bar hold its text through a `Cancel`, an `Escape` and the close
   * `×` (QA DEF-23). The bar used to be emptied on the press, so backing out
   * of a dialog that committed nothing destroyed the line — the one lossy path
   * in a feature whose contract is that it never loses a keystroke.
   *
   * **A second press joins the create already outstanding rather than starting
   * another one.** Without the guard each press bumped `createSeq`, and
   * `createSeq` feeds the modal's `key`: a press landing after the dialog had
   * mounted re-keyed it, so React threw the mounted form away and built a new
   * one from `createDraft` — discarding whatever the user had typed into it
   * since it opened, mid-edit and with no indication anything had happened.
   *
   * A mouse cannot deliver that second press, which is why it survived this
   * long: the backdrop is up by then and `isDismissable` closes the dialog on
   * the press instead. A *virtual* click can — no pointer events, so nothing
   * reads it as an interaction outside — which is what a screen reader's
   * activation, voice control, and `element.click()` all produce. So the path
   * that reaches this is the assistive one, and it reached it silently.
   *
   * The draft is deliberately not refreshed from the second press. Taking the
   * newer reading would mean re-keying the modal to show it, which is the
   * remount this exists to prevent — and the bar cannot have changed between
   * two presses of its own button.
   */
  const openCreate = (draft: TodoFormValues) => {
    const outstanding = outstandingCreate.current;

    if (outstanding) return outstanding;

    setCreateDraft(draft);
    setCreateSeq((seq) => seq + 1);
    setEditingTodo(null);
    // A create always opens on `Title`; without this it would inherit whatever
    // the last `Pick a date…` set, since the modal is never unmounted.
    setEditFocus(DEFAULT_FORM_FOCUS);
    formState.open();

    /*
      `ask` still supersedes anything outstanding, and that is left exactly as
      it was (Senior F5, `src/lib/handoff.ts`): dropping a resolver is the
      "never resolves" case wearing a different hat, so the invariant has to
      hold for callers that have not thought about it. The guard above simply
      means this call site is no longer one of them — it never asks a second
      question while the first is unanswered, so the supersede is now a floor
      under `openCreate` rather than the thing keeping it correct.
    */
    const answered = moreOptionsHandoff.current.ask(false);

    outstandingCreate.current = answered;

    /*
      Attached before the promise is handed back, so it runs ahead of the
      awaiting `handleMoreOptions` continuation: by the time the bar acts on
      the answer, the next press can already open a fresh modal.
    */
    void answered.finally(() => {
      outstandingCreate.current = null;
    });

    return answered;
  };

  /**
   * Opens the editor on a record, and on the field the press asked for.
   *
   * `focus` is carried from the control rather than worked out here, because
   * here is where it cannot be worked out: `Edit` and `Pick a date…` hand over
   * the same todo, and the difference between them is the user's intent, which
   * is not a property of the row (`docs/DESIGN.md` §7.21).
   */
  const openEdit = (todo: TodoItemData, focus: TodoFormFocus = DEFAULT_FORM_FOCUS) => {
    setEditingTodo(todo);
    setEditFocus(focus);
    formState.open();
  };

  const focusQuickAdd = () => {
    quickAddInputRef.current?.focus();
  };

  /*
    The filters go back to their defaults and the view stays — the user asked
    to stop narrowing the list, not to leave the board (`CLEARED_FILTERS`).

    Pushed through the same owner as every other change, so clearing cannot
    discard a view press that has not landed yet. Writing the URL here directly
    is what made this a second unguarded writer.
  */
  const clearFilters = () => {
    urlSync.clearFilters();
  };

  /**
   * The modal writes; the list reports. Keeping the toast here is what lets a
   * later write dismiss an earlier Undo — the modal cannot see the toast it
   * raised two edits ago (review M-2).
   */
  /**
   * The bar's create. **No skeleton** (review MA-3): nothing closed over the
   * list, the toast is already on screen saying what happened, and blanking
   * every row to report a change to one of them is the disproportion the
   * delete path settled. It is worse than disproportionate under a filter that
   * hides the new row, where the list flashes and comes back identical — and
   * worse again during burst capture, where it would flash on every Enter.
   *
   * The refetch still happens; it is just quiet. The row arrives in its §2
   * place when the data lands, which is the same guarantee the skeleton gave.
   */
  /*
    No Undo. The bar's create used to raise one, and pressing it deleted the
    todo that had just been made (`docs/DESIGN.md` §7.15) — a `DELETE` behind a
    button reading `Undo`, stacked among reversals that put things back. The
    receipt still says what happened; the row it names is on screen, and its
    own Delete button is one press behind a confirm dialog.
  */
  const handleQuickAdded = (saved: TodoItemData) => {
    reloadSilently();

    reportCreate(saved);
  };

  /**
   * The modal's save. This one keeps the skeleton, and the difference is not
   * an inconsistency: the modal closing over an unchanged list is the gap m-8
   * was reported against, and there is a real moment where the dialog has gone
   * and nothing on screen has moved yet. The bar has no such moment.
   */
  const handleSaved = (saved: TodoItemData, previous: TodoFormValues | null) => {
    reloadWithSkeleton();

    const isEdit = previous !== null;

    /*
      Before the render that the modal's own close triggers, so the bar hears
      "saved" rather than the "dismissed" the close would otherwise report:
      `TodoFormModal` calls `closeForm()` and then `onSaved()` in one
      synchronous block, and this settles the handoff inside it. An edit never
      has one outstanding — the modal cannot be opened twice over — and if it
      somehow did, `false` is the answer that keeps the user's text.
    */
    moreOptionsHandoff.current.answer(!isEdit);

    /*
      The modal serves both writes, and only one of them offers a reversal.
      An edit's Undo restores the values the form opened on; a create's would
      have deleted the record, which is the action §7.15 withdrew — so the
      create reports and stops, exactly as the bar's does.

      Branched on `previous` rather than on `isEdit` so the narrowing is the
      compiler's: `undoEdit` requires the values it writes back, and reading
      them off a boolean would need a non-null assertion to say something the
      type already knows.
    */
    if (previous !== null) {
      showUndoableSuccess(saved.id, `Todo “${saved.title}” updated`, () => {
        void undoEdit(saved, previous);
      });

      return;
    }

    reportCreate(saved);
  };

  /**
   * Undo runs the same endpoint with the same authorization as the write it
   * reverses: the edited todo is written back to the values it held when the
   * form opened.
   *
   * **Edit-only since §7.15.** This used to take `previous: … | null` and
   * branch, with the `null` arm issuing a `DELETE` to reverse a create. That
   * arm is gone with the create's Undo rather than left unreachable — a
   * delete path still wired to an Undo helper is the thing a future caller
   * would find and reuse, and it is precisely the mutation this change exists
   * to keep out of the toast region.
   */
  const undoEdit = async (saved: TodoItemData, previous: TodoFormValues) => {
    markPending(saved.id);

    try {
      await updateTodo(saved.id, previous);
      toast.success(`Todo “${previous.title}” restored`);

      reloadSilently();
    } catch (error) {
      toast.danger(getErrorMessage(error, UNDO_FAILURE_MESSAGE));
    } finally {
      clearPending(saved.id);
    }
  };

  const toggledMessage = (title: string, completed: boolean) =>
    completed
      ? `Todo “${title}” marked complete`
      : `Todo “${title}” marked not complete`;

  /**
   * The optimistic flip, and the one path both a toggle and its Undo take.
   *
   * Undo is a toggle — the same endpoint, the same authorization, the same
   * value written to the same column — so it gets the same code rather than a
   * parallel copy that can drift. What differs is passed in.
   *
   * The sequence, and what each step costs (review m-7, §2.1–2.2):
   *
   *  1. Apply the change locally. Nothing is awaited first, so the box ticks
   *     under the finger and grouping re-sections immediately — a completed
   *     todo leaves `Overdue` and lands in `Completed` before the server
   *     agrees. Under a status filter the row *leaves the list* at that same
   *     moment instead (`docs/PRD.md` US-07, US-10).
   *  2. One `PATCH /api/todos/[id]/status` — 4 queries where the old
   *     `PATCH` + `GET` pair was 9 (review MA-1; one session lookup is two
   *     queries, because better-auth reads `session` and then `user`).
   *  3. Splice the row that request *already returned* into local state. The
   *     authoritative row used to be thrown away and a whole `GET /api/todos`
   *     issued to fetch it again; that second round trip is gone.
   *  4. On failure, write the previous value back. `!nextCompleted` is that
   *     value by construction — a toggle flips, so the state before the press
   *     is the negation of the state it asked for — and it is read from the
   *     press rather than from the row, which may have been replaced by then.
   *
   * **When the row has to come back, only the server can say where.** Local
   * state cannot re-insert a row in its §2 place (`todoListState.ts`
   * invariant 2), so the two cases that restore one refetch instead: a failed
   * toggle that had pushed the row out of the filter, and any successful Undo.
   * That is `reloadSilently`, the path that already exists for changes with no
   * single row to point at.
   *
   * The revert is the whole risk of this design, so it is deliberately dumb:
   * one call, one known value, no inference about what "undo" means.
   * `applyCompletion` is a no-op when the row already holds that value or is
   * no longer on screen, so running it is safe on any path where the row is
   * still ours to speak for. It is **not** a compare-and-set: a foreign writer
   * on another device, plus a list reload landing inside this flight window,
   * plus this request then failing, would write `!nextCompleted` over the
   * fresher truth. Three preconditions, filed as review MI-1 with a
   * compare-and-set follow-up — this comment is not a proof that it cannot
   * happen.
   *
   * A create still refetches (`reloadWithSkeleton`) and a toggle under the
   * default filter does not, which is not an inconsistency: a create can land
   * anywhere in the order, while a toggle changes one boolean on a row already
   * on screen.
   */
  const runToggle = async (
    todo: TodoItemData,
    nextCompleted: boolean,
    { onSuccess, failureMessage, reloadOnSuccess }: ToggleOutcome,
  ) => {
    /*
      Decided from the press and the filter alone, never from `result`: this
      runs from a toast callback that closed over an older render, so reading
      the list here would read a stale one. Under a filter every visible row
      matches it, so a flip either pushes the row out or — when the value being
      written is the one the filter wants — puts back a row that had already
      gone. Under "All" neither happens.
    */
    const leavesList = !todoMatchesStatusFilter(nextCompleted, status);
    const landedLoadsAtPress = readLandedLoads();

    markPending(todo.id);
    setResult((current) =>
      applyCompletion(current, todo.id, nextCompleted, status),
    );

    try {
      const saved = await toggleTodo(todo.id, nextCompleted);

      if (reloadOnSuccess) {
        reloadSilently();
      } else {
        /*
          A load landing between the press and this response replaces local
          state with a server count that predates the write — and the row it
          would have been corrected against may be gone with it (the user
          switched to `Completed`, say), so `replaceTodo` no-ops and the
          counter sits one low.

          It used to self-heal because every toggle refetched. It no longer
          does, which is the point of m-7, so nothing would put the number
          right for as long as the user keeps toggling (QA S-C, review MA-2).
          Comparing landed loads spends the extra request only on the
          interleaved case; an uninterrupted toggle is still one request.

          Landed loads, not `reloadToken`: a filter change reloads without
          bumping the token, and it is the likeliest way into this window.
          `e2e/mid-flight-reload.spec.ts` pins both triggers.
        */
        if (readLandedLoads() === landedLoadsAtPress) {
          setResult((current) => replaceTodo(current, saved));
        } else {
          reloadSilently();
        }
      }

      onSuccess();
    } catch (error) {
      if (leavesList) {
        // The row must reappear in its §2 place, and the counts with it.
        reloadSilently();
      } else {
        setResult((current) =>
          applyCompletion(current, todo.id, !nextCompleted, status),
        );
      }

      toast.danger(getErrorMessage(error, failureMessage));
    } finally {
      clearPending(todo.id);
    }
  };

  /**
   * Reports the flipped state with §7.11's toast, and arms no further Undo.
   *
   * Always reconciles with the server on success, unlike the press it
   * reverses. Under a status filter it has to — US-10 requires the row back in
   * its §2 place, which is a refetch by definition — and taking that path
   * unconditionally also closes the one case the filter test cannot see: an
   * Undo pressed after the filter moved, whose `status` here is the one
   * captured when the toast was raised. Undo is a corrective action inside a
   * 12s window, not the fifty-times-a-day press m-7 was about, so a round trip
   * to be certain is the right trade.
   */
  const undoToggle = async (todo: TodoItemData, restoredCompleted: boolean) => {
    await runToggle(todo, restoredCompleted, {
      onSuccess: () => {
        toast.success(toggledMessage(todo.title, restoredCompleted));
      },
      failureMessage: UNDO_FAILURE_MESSAGE,
      reloadOnSuccess: true,
    });
  };

  const handleToggle = async (todo: TodoItemData, nextCompleted: boolean) => {
    // Before the flip, not after: the row's outstanding Undo describes a state
    // it is leaving, and the toast region is live from the first frame now
    // that the change is visible immediately (review M-1, M-2).
    dismissUndo(todo.id);

    /*
      Read *before* the flip, because the flip is what destroys the answer: the
      optimistic update removes the row on the very next render, taking the
      checkbox the user is standing on with it (`docs/PRD.md` US-07). `null`
      means there is nothing to rescue — the row is staying, or the press came
      from a pointer, or focus was never on a row to begin with.
    */
    const focusAnchor =
      isFocusVisible && !todoMatchesStatusFilter(nextCompleted, status)
        ? readFocusedRow()
        : null;

    /*
      The identity of the Undo this toggle raises, and `null` for as long as it
      has raised none. Read after the write resolves, so it is the token of the
      toast that reports *this* toggle and no other (QA DEF-25).
    */
    let undoToken: string | null = null;

    const running = runToggle(todo, nextCompleted, {
      onSuccess: () => {
        undoToken = showUndoableSuccess(
          todo.id,
          toggledMessage(todo.title, nextCompleted),
          () => {
            void undoToggle(todo, !nextCompleted);
          },
        );
      },
      failureMessage: TOGGLE_FAILURE_MESSAGE,
      /*
        The row is either updated in place or correctly gone, and the counts
        moved with it either way — there is nothing left for a `GET` to tell
        us. This is the round trip m-7 removed.
      */
      reloadOnSuccess: false,
    });

    if (focusAnchor !== null) {
      /*
        Step 1, and it is deliberately not awaited behind the request: the row
        is already gone optimistically, so waiting for the server would leave
        focus on `<body>` for the whole round trip.

        It is also the fallback for every path step 2 cannot take — a refused
        write raises no Undo toast, and `focusIsUnclaimed` declines once the
        user has moved focus themselves. Running it first means focus is
        somewhere useful from the first frame whatever step 2 does next
        (`src/lib/rowFocus.ts`).
      */
      const rescuedRow = await focusRowAfterRemoval(focusAnchor);

      await running;

      /*
        Step 2, onto the Undo this toggle raised and no other. Guarded on focus
        being unclaimed — still on the exact row step 1 focused, or on `<body>`
        because the list emptied and step 1 had nowhere to land — so a user who
        has already moved themselves is not dragged into the toast. `rescuedRow`
        is why that can be said of a *neighbouring* row too: a slow write leaves
        time to tab one row across, and against "any row checkbox" that was
        indistinguishable from not having moved (QA DEF-28).

        Skipped entirely when the write failed, where the row comes back, no
        token is minted and there is no Undo to reach.
      */
      if (undoToken !== null) {
        await focusUndoAction(undoToken, () => focusIsUnclaimed(rescuedRow));
      }

      return;
    }

    await running;

    /*
      The board's toggle loses focus where the list's does not, and for the
      reason the reschedule already had: the card moves to another **column**,
      columns are separate subtrees, so React rebuilds the card and the
      checkbox the user was standing on goes with it. On the list the row
      merely slides between sections and — under the default filter — keeps its
      DOM node, so nothing was lost and nothing needed catching.

      Restored, not redirected. The card is still on screen and still theirs, so
      focus belongs back on the control they pressed, where the next `Space`
      un-completes what they just completed. Moving them to the toast's Undo —
      which is right on the list, where a filter has *removed* the row and the
      toast is the only route back — would arm a different mutation under that
      keypress for a card they can still see (`src/lib/rowFocus.ts` →
      `restoreToggleFocus`).

      Keyboard only, on §6.8's reasoning: a pointer user's focus is not a place
      they are standing, and the drag that reaches this is a pointer gesture.
      The helper declines unless focus is already on the floor, so a card that
      did not change column leaves focus exactly where it was.
    */
    if (isBoard && isFocusVisible) await restoreToggleFocus(todo.id);
  };

  /**
   * What the toast says a reschedule did, in the row's own words.
   *
   * Built from `formatDueDate` — the same function the row's label uses — so
   * the toast and the row can never describe one date two ways, and `Today`
   * means the viewer's today in both places rather than in one of them
   * (`src/lib/date.ts`). §7.11's pattern holds: it names the record and says
   * what happened to it.
   */
  const rescheduledMessage = (title: string, dueAt: string | null) =>
    dueAt === null
      ? `Todo “${title}” due date cleared`
      : `Todo “${title}” due ${formatDueDate(dueAt).label}`;

  /**
   * The one path a reschedule and its Undo both take. Undo is a reschedule —
   * same endpoint, same authorization, a different value written to the same
   * column — so it gets the same code rather than a parallel copy that can
   * drift (`docs/CONVENTIONS.md` → Mutation UX). What differs is passed in.
   *
   * **Deliberately not optimistic, unlike the toggle.** A completion flip
   * changes a boolean on a row that stays where it is; a due date changes the
   * row's place in the §2 sequence, and local state is forbidden from
   * re-sequencing (`src/lib/todoListState.ts`, invariants 1 and 2) because the
   * server owns the order. So an optimistic reschedule could only ever move the
   * row into the right *section* at the wrong position, and then correct itself
   * — a second visible move for a press that happens a few times a day, not
   * fifty. The row says it is busy through `aria-busy` and its disabled
   * controls, and the change appears once, where it belongs, when the refetch
   * lands.
   */
  const runReschedule = async (
    todo: TodoItemData,
    dueAt: string | null,
    { onSuccess, failureMessage }: RescheduleOutcome,
  ) => {
    markPending(todo.id);

    /*
      **The board's one departure from the paragraph above, and it is scoped to
      the board deliberately** (`docs/DESIGN.md` §8.8).

      On the list, a reschedule is a press on a menu item and the row slides
      under a different heading when the answer arrives; there is no promise to
      break, and the argument above — one visible move instead of two — holds.
      On the board the user has *carried the card to the column with their
      hand*, and a card that springs back until the server answers is a broken
      drag, whatever the round trip costs.

      What is applied is **membership only**. `applyDueDate` rewrites the field
      and leaves the sequence exactly as the server sent it, so the card re-cuts
      into its new column on the next render and nothing anywhere chooses a
      position (`todoListState` invariants 1 and 2 both hold). The refetch below
      then replaces the guess with the server's order.

      The menu takes this path too when the board is on screen, because the two
      have to behave identically — the menu *is* the keyboard's drag, and a
      keyboard user watching a card sit still while a mouse user's moves
      immediately would be the accessibility gap this feature exists to avoid.
    */
    const previousDueAt = todo.dueAt;

    if (isBoard) setResult((current) => applyDueDate(current, todo.id, dueAt));

    try {
      const saved = await rescheduleTodo(todo.id, dueAt);

      onSuccess(saved);
      // Only the server can say where the row goes now, so this is the same
      // refetch a restored row gets — see `runToggle`'s note on §2 position.
      reloadSilently();
    } catch (error) {
      /*
        The revert writes back the value the card held when the drop happened,
        read from the row rather than derived — the same rule the toggle's
        revert follows, and the reason `applyDueDate` takes a value instead of
        an instruction to undo.
      */
      if (isBoard) {
        setResult((current) => applyDueDate(current, todo.id, previousDueAt));
      }

      toast.danger(getErrorMessage(error, failureMessage));
    } finally {
      clearPending(todo.id);
    }
  };

  /** Reports the restored date with the same §7.21 toast, and arms no further Undo. */
  const undoReschedule = async (
    todo: TodoItemData,
    previousDueAt: string | null,
  ) => {
    await runReschedule(todo, previousDueAt, {
      onSuccess: (saved) => {
        toast.success(rescheduledMessage(saved.title, saved.dueAt));
      },
      failureMessage: UNDO_FAILURE_MESSAGE,
    });
  };

  /**
   * A due date is trivially reversible, so it fires immediately and offers Undo
   * rather than opening a confirm dialog (`docs/CONVENTIONS.md` → Mutation UX:
   * confirm what cannot be undone).
   */
  const handleReschedule = async (todo: TodoItemData, dueAt: string | null) => {
    /*
      The lock, and it lives here now rather than on the control (review F1).

      `pendingTodoIds` has always been the lock — `useTodoList` says so — but
      what *enforced* it was `isDisabled` on the row's buttons, and the
      reschedule trigger no longer carries that: a disabled control is blurred
      by the browser, which is the whole of F1. So the refusal moves to the one
      place that can see the pending set.

      It is not redundant with the menu's own open guard, and the difference is
      measurable. react-aria closes the menu *asynchronously* after an item is
      actioned — measured at more than 28ms in `next dev` — so `Enter` pressed
      twice in quick succession re-activates the item on a menu that is still
      open and never asks to open anything. Two `PATCH`es to the same column,
      free to land in either order. The open guard cannot see that press; this
      one can. Pinned by `e2e/reschedule.spec.ts`, which presses both inside
      that window and after it.
    */
    if (pendingTodoIds.has(todo.id)) return;

    // Before the write, like the toggle's: the row's outstanding Undo describes
    // a date it is leaving (review M-1, M-2).
    dismissUndo(todo.id);

    /*
      The value Undo puts back, read from the row **before** the write and never
      recomputed afterwards — recomputing "the date it used to have" is the same
      class of mistake as computing "next week" from the wrong anchor.

      `toDueDateInputValue` takes the calendar day off the stored instant by
      slicing the ISO string, so this is the *UTC* day the column already holds
      and no local conversion happens on this path. That is correct and it is
      the only place on this feature where local time must not be consulted: the
      previous value is a fact about the record, not about the viewer.
    */
    const previousDay = toDueDateInputValue(todo.dueAt);
    /*
      `""` is `toDueDateInputValue`'s answer for "no date", and it is the one
      spelling this route refuses — folding it to `null` here is what keeps the
      client from ever being the caller that sends it. Written as a check on
      the *value* rather than on `todo.dueAt` being `null`, because the value is
      what goes on the wire: guarding the input leaves any other falsy reading
      (an empty ISO string from a future response shape) to fall through as
      `""` and come back a 400 the user cannot act on.
    */
    const previousDueAt = previousDay === "" ? null : previousDay;

    await runReschedule(todo, dueAt, {
      onSuccess: (saved) => {
        showUndoableSuccess(
          saved.id,
          rescheduledMessage(saved.title, saved.dueAt),
          () => {
            void undoReschedule(saved, previousDueAt);
          },
        );
      },
      failureMessage: RESCHEDULE_FAILURE_MESSAGE,
    });

    /*
      Focus, and the decision is to **restore rather than redirect**
      (`src/lib/rowFocus.ts` → `restoreRescheduleFocus`).

      A reschedule can move the row into a different section, and sections are
      different `<section>` subtrees, so React rebuilds the row rather than
      moving it — taking the trigger the user is standing on with it, and
      dropping focus to `<body>` with nothing on screen to show for it. The
      toggle's answer to that is to move focus to the toast's Undo, and it is
      the right answer *there*, where the row is gone and the toast is the only
      route back. Here the row is still on screen and still the user's, so the
      right place for focus is the button they pressed — moving them to a toast
      instead would arm an Undo under their next `Space` and cost them the §6.8
      surprise for nothing.

      Keyboard only, on the same reasoning §6.8 gives: a pointer user's focus is
      not a place they are standing. Awaited after the write so the refetch that
      moves the row has been asked for; the helper itself waits for the row to
      actually be rebuilt and declines unless focus is on the floor, so a row
      that did not change section leaves focus exactly where react-aria's menu
      put it.
    */
    if (isFocusVisible) await restoreRescheduleFocus(todo.id);
  };

  const handleDelete = async () => {
    if (!pendingDelete) return;

    // The row is about to stop existing; an Undo still offering to change it
    // would 404 and report a failure for a mutation that succeeded.
    dismissUndo(pendingDelete.id);
    setIsDeleting(true);

    try {
      await deleteTodo(pendingDelete.id);
      toast.success(`Todo “${pendingDelete.title}” deleted`);
      // Drop the row now rather than waiting for the refetch. The server has
      // confirmed the delete, so this states a fact, not a guess — and without
      // it the row stayed on screen, undimmed and clickable, until the silent
      // refetch landed; toggling it in that window returned a 404 (QA DEF-11).
      // The skeleton used to hide this gap, which is why it only appears now
      // that a delete no longer blanks the list.
      removeTodoLocally(pendingDelete.id, pendingDelete.completed);
      reloadSilently();
    } catch (error) {
      toast.danger(
        getErrorMessage(error, "Couldn’t delete the todo. Try again."),
      );
    } finally {
      setIsDeleting(false);
      setPendingDelete(null);
    }
  };

  /**
   * The rows that should render as busy: the ones with a mutation in flight,
   * plus the one a confirmed delete is currently running against. The delete
   * is tracked separately because its pending state belongs to the dialog, not
   * to the row.
   */
  const rowPendingIds = (): ReadonlySet<string> => {
    if (!isDeleting || !pendingDelete) return pendingTodoIds;

    return new Set(pendingTodoIds).add(pendingDelete.id);
  };

  /** Reached from two branches: an explicit priority filter, and the fallback. */
  const noMatchingFilters = (): EmptyStateCopy => ({
    heading: "No todos match these filters",
    body: "Try a different status or priority.",
    actionLabel: "Clear filters",
    onAction: clearFilters,
  });

  const resolveEmptyState = (): EmptyStateCopy => {
    if (result.totalCount === 0) {
      return {
        heading: "Nothing here yet",
        body: "Add your first todo and it will show up here.",
        hint: QUICK_ADD_SYNTAX_HINT,
        actionLabel: ADD_TODO_LABEL,
        // Signposts the bar rather than opening a second way to do the same
        // thing (`docs/DESIGN.md` §7.18).
        onAction: focusQuickAdd,
      };
    }

    if (query !== "") {
      return {
        heading: "No matches",
        body: `No todos match “${query}”.`,
        actionLabel: "Clear search",
        onAction: clearFilters,
      };
    }

    if (priority !== "all") {
      return noMatchingFilters();
    }

    if (status === "active") {
      return {
        heading: "All caught up",
        body: "You have no active todos. Nice.",
      };
    }

    if (status === "completed") {
      return {
        heading: "Nothing completed yet",
        body: "Todos you finish will appear here.",
      };
    }

    return noMatchingFilters();
  };

  /**
   * The sections, cut once per render and shared by the list and the header
   * line above it (US-12).
   *
   * `null` while the list has not loaded and while it is showing a load
   * failure. Both are cases where `result.todos` is not what is on screen — a
   * filter change keeps the previous rows in `result` until the new ones land,
   * so counting them would report the old filter's numbers under the new
   * filter's heading — and US-12 asks for the date alone in the first case
   * anyway, so the counts never render as zero and then change.
   */
  const visibleGroups = (): TodoGroup[] | null => {
    if (isLoading || loadError !== null) return null;

    return groupTodos(result.todos);
  };

  const groups = visibleGroups();

  const renderList = () => {
    if (isLoading) return isBoard ? <TodoBoardSkeleton /> : <TodoListSkeleton />;

    if (loadError !== null) {
      return (
        <div className="flex flex-col items-start gap-3 px-4 py-6">
          <Alert status="danger">
            <Alert.Indicator />
            <Alert.Content>
              <Alert.Title>Couldn’t load your todos</Alert.Title>
              <Alert.Description>{loadError}</Alert.Description>
            </Alert.Content>
          </Alert>
          <Button
            variant="secondary"
            size="sm"
            className={LABELLED_CONTROL_SIZING}
            onPress={retry}
          >
            {TRY_AGAIN_LABEL}
          </Button>
        </div>
      );
    }

    /*
      The board shows the same empty state as the list rather than five empty
      columns, and this is the one place it deliberately does not show its
      structure. Five columns each saying "nothing" say nothing, and they would
      push the one thing worth showing — `Add your first todo`, or
      `Clear filters` — off the bottom of the board. The columns are how you
      read todos; there are none.
    */
    if (result.todos.length === 0) {
      const emptyState = resolveEmptyState();

      return (
        <TodoEmptyState
          heading={emptyState.heading}
          body={emptyState.body}
          hint={emptyState.hint}
          actionLabel={emptyState.actionLabel}
          onAction={emptyState.onAction}
        />
      );
    }

    /*
      Space between rows rather than rules between them, and the rows cut into
      urgency sections. Each row is already a rounded pill on hover, and
      hairlines running between floating pills made the list read as a ruled
      table that had been rounded by mistake — the contradiction the designer
      raised.
      Space is not the boundary, though: the rows share `--surface` with this
      Card, so the gap alone left nothing to see at rest. The boundary is the
      row's own outline (`TodoRow`); the gaps only keep the outlines apart.
    */
    if (isBoard) {
      return (
        <TodoBoard
          /*
            `boardColumns` over the same `result.todos` the list groups, so the
            two views can never disagree about which column a todo is in — they
            are the same cut, made by the same `todoGroupId`.
          */
          columns={boardColumns(result.todos)}
          pendingTodoIds={rowPendingIds()}
          vanishingTodoId={isDeleting ? (pendingDelete?.id ?? null) : null}
          showTooltips={isDesktop}
          onToggle={(target, nextCompleted) => {
            void handleToggle(target, nextCompleted);
          }}
          onEdit={openEdit}
          onReschedule={(target, dueAt) => {
            void handleReschedule(target, dueAt);
          }}
          onDelete={setPendingDelete}
        />
      );
    }

    return (
      <TodoGroupedList
        /*
          The same array the header line above is counting — one `groupTodos`
          call per render feeding both, which is what makes "the line and the
          list can never disagree" (US-12) a property of the code rather than
          something a test has to keep catching.

          Non-null by the time this line runs: `groups` is `null` only while
          loading or while showing a load failure, and both of those branches
          have already returned above. The `?? []` is the type narrowing, not a
          fallback anybody expects to take.
        */
        groups={groups ?? []}
        pendingTodoIds={rowPendingIds()}
        /*
          The one row §8.3.2 still gives a row-level pending treatment to: a
          confirmed delete is running against it and it is about to stop
          existing. Everything else that is busy is busy optimistically and
          says so through `aria-busy` and its disabled controls.
        */
        vanishingTodoId={isDeleting ? (pendingDelete?.id ?? null) : null}
        showTooltips={isDesktop}
        onToggle={(target, nextCompleted) => {
          void handleToggle(target, nextCompleted);
        }}
        onEdit={openEdit}
        onReschedule={(target, dueAt) => {
          void handleReschedule(target, dueAt);
        }}
        onDelete={setPendingDelete}
      />
    );
  };

  /**
   * The dialog closed. Anything still waiting on it was dismissed, not saved —
   * `handleSaved` settles the save case synchronously, before this runs — so
   * this is the single place that answers `Cancel`, `Escape` and the close `×`
   * alike, without the bar having to know which one the user reached for
   * (QA DEF-23). Inlined rather than calling `settleHandoff` so the effect owns
   * its whole dependency list.
   */
  useEffect(() => {
    if (formState.isOpen) return;

    moreOptionsHandoff.current.answer(false);
  }, [formState.isOpen]);

  /*
    Unmount is the third way the dialog can go away, and the only one with no
    close to observe — navigating off `/todos` with it open would otherwise
    leave the bar's `await` unreachable. Mount-lifetime, deliberately: a
    cleanup keyed to `isOpen` would run on the *open* transition too, and
    answer the handoff `openCreate` had just asked.
  */
  useEffect(
    () => () => {
      moreOptionsHandoff.current.answer(false);
    },
    [],
  );

  const hasTodos = result.totalCount > 0 && loadError === null;

  return (
    <>
      {/*
        The heading and the dated line are one block, not two of `main`'s
        sections (§7.19). They are one statement — what this page is and what
        day it is — and as peers under `main`'s `gap-6` they sat 24px apart,
        the same distance as the quick-add bar from the Card. `gap-1` inside;
        `main`'s `gap-6` then separates the block from the bar.

        `loading.tsx` renders the same two elements and takes the same
        constant, or the heading moves when the route settles (§4.8).
      */}
      <div className={PAGE_HEADING_BLOCK}>
        <div className={PAGE_HEADING_ROW}>
          <Typography.Heading level={1}>{PAGE_HEADING}</Typography.Heading>
          {hasTodos ? (
            <Typography type="body-sm" color="muted">
              {`${result.completedCount} of ${result.totalCount} done`}
            </Typography>
          ) : null}
        </div>

        {/*
          US-12. One plain-text line, below the app bar and above the list,
          reporting the viewer's today and the sizes of the two sections that
          answer "what now?". It is not gated on `hasTodos`: the date alone is
          the specified state for an empty list and for a list still loading,
          and a line that came and went would be a fourth thing moving on the
          page.
        */}
        <TodoListHeaderLine groups={groups} />
      </div>

      {/*
        Never gated on `hasTodos`, unlike the filter bar below it and unlike
        the "New todo" button it replaced. A capture bar that appears only once
        you have something to capture is not a capture bar, and this is also
        the control the empty state's call to action focuses.
      */}
      <QuickAddBar
        inputRef={quickAddInputRef}
        onCreated={handleQuickAdded}
        onMoreOptions={openCreate}
      />

      {/*
        The view toggle rides at the end of the filter row rather than on a
        shell band of its own (§4.11, and `TodoFilters` for what that buys). It
        is passed in rather than owned there because the view is a presentation
        choice and the rest of that row is the query the API is asked — the same
        split `page.tsx` makes when it reads the two apart.

        Not rendered below `lg`, where the board would not render even if it
        were chosen (`BOARD_MEDIA_QUERY`). A control that changes nothing is
        worse than an absent one: it would report `Board` as selected while the
        list was on screen, which is the control lying about the state it shows.

        **Not rendered, rather than hidden with `lg:` classes.** A
        `display: none` radiogroup is still a radiogroup in the document —
        `getByRole` skips it, so an accessibility-aware query cannot see the
        difference, but anything reading the DOM can, and one did: it gave
        `a11y-contrast.spec.ts` two elements matching
        `[role="radio"][aria-checked="true"]` where it expected the status
        filter's one. That was a real ambiguity and not only a test's problem —
        the mobile document was carrying a second, inert radiogroup named
        `Choose a view`, which is exactly the sort of thing that ends up
        announced to somebody. `e2e/board.spec.ts` asserts the absence at the
        DOM level for exactly that reason, so this must stay a render decision
        even now that the toggle sits inside a row that is itself conditional.

        Safe against hydration because `isWideEnoughForBoard` is the same
        two-pass reading the board itself uses: false on the server and on the
        first client render, so the markup agrees before the layout effect
        flips it.

        The `hasTodos` gate is now the filter row's own, which is where it
        always pointed: both controls were gated on it separately and for the
        same reason — there is nothing to look at two ways yet.
      */}
      {hasTodos ? (
        <TodoFilters
          filters={filters}
          query={urlSync.query}
          onQueryChange={urlSync.setQuery}
          onFilterChange={urlSync.push}
          viewToggle={
            isWideEnoughForBoard ? (
              <ViewToggle
                view={view}
                onSelectView={(next) => urlSync.push({ view: next })}
              />
            ) : undefined
          }
        />
      ) : null}

      <Card>
        <Card.Content className="p-0">{renderList()}</Card.Content>
      </Card>

      <TodoFormModal
        // Remounts the form so it starts from the right record's values — and,
        // on a create, from the right draft.
        key={editingTodo?.id ?? `create-${createSeq}`}
        state={formState}
        todo={editingTodo}
        draft={createDraft}
        autoFocusField={editFocus}
        onSaved={handleSaved}
      />

      <ConfirmDialog
        isOpen={pendingDelete !== null}
        heading="Delete this todo?"
        body={`“${pendingDelete?.title ?? ""}” will be permanently deleted. This can’t be undone.`}
        confirmLabel="Delete"
        pendingLabel="Deleting…"
        isDestructive
        isPending={isDeleting}
        onConfirm={handleDelete}
        onOpenChange={(isOpen) => {
          if (!isOpen && !isDeleting) setPendingDelete(null);
        }}
      />
    </>
  );
};
