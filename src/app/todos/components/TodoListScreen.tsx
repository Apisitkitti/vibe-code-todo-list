"use client";

import { useEffect, useRef, useState } from "react";

import {
  Alert,
  Button,
  Card,
  Typography,
  toast,
  useMediaQuery,
  useOverlayState,
} from "@heroui/react";
import { useRouter } from "next/navigation";
import { useFocusVisible } from "react-aria";

import { PAGE_HEADING, TRY_AGAIN_LABEL } from "@/app/todos/constants";
import { useTodoList } from "@/app/todos/hooks/useTodoList";
import { ConfirmDialog } from "@/components/ConfirmDialog";
import { getErrorMessage } from "@/lib/getErrorMessage";
import { createHandoff } from "@/lib/handoff";
import {
  focusIsUnclaimed,
  focusRowAfterRemoval,
  focusUndoAction,
  nextUndoToken,
  readFocusedRow,
  undoTokenProps,
} from "@/lib/rowFocus";
import type { TodoItemData, TodoListFilters } from "@/lib/todo";
import { groupTodos, type TodoGroup } from "@/lib/todoGroups";
import {
  applyCompletion,
  replaceTodo,
  todoMatchesFilters,
  todoMatchesStatusFilter,
} from "@/lib/todoListState";
import { deleteTodo, toggleTodo, updateTodo } from "@/service/todo.service";

import type { TodoFormValues } from "./form";
import { QuickAddBar } from "./QuickAddBar";
import { TodoEmptyState } from "./TodoEmptyState";
import { TodoFilters } from "./TodoFilters";
import { TodoFormModal } from "./TodoFormModal";
import { TodoGroupedList } from "./TodoGroupedList";
import { TodoListHeaderLine } from "./TodoListHeaderLine";
import { TodoListSkeleton } from "./TodoListSkeleton";

const TODOS_PATH = "/todos";
const DESKTOP_MEDIA_QUERY = "(min-width: 640px)";

/**
 * How long an Undo stays offered. HeroUI's 4s default is a reasonable life for
 * "here is what happened" and a poor one for "you have this long to change
 * your mind" — it can expire while the reader is still finishing the sentence
 * that told them Undo was there. Both the designer and the Senior called it
 * too short before anyone was looking for it.
 *
 * It is also the margin that keeps the toast usable at all: the first ~400ms
 * of an action toast is inert while HeroUI's view transition owns hit-testing
 * (`docs/DESIGN.md` §4.10). Shortening this window without taking the
 * `wrapUpdate` escape hatch would eat into a control that is already dead on
 * arrival.
 */
const UNDO_WINDOW_MS = 12_000;

/**
 * The empty state's call to action (`docs/DESIGN.md` §7.18). It no longer
 * opens the modal — it moves focus to the quick-add bar, which is the one
 * capture path, so the label describes that rather than a dialog.
 */
const ADD_TODO_LABEL = "Add a todo";

/**
 * Failure fallbacks from the copy deck (`docs/DESIGN.md` §7.9, §7.13, §7.15),
 * named because each is now read from more than one place: the toggle and its
 * Undo share one code path, and both kinds of Undo report the same wording.
 */
const TOGGLE_FAILURE_MESSAGE = "Couldn’t update the todo. Try again.";
const UNDO_FAILURE_MESSAGE = "Couldn’t undo that. Try again.";

/** The word on the button (`docs/DESIGN.md` §7.13, §7.15). */
const UNDO_LABEL = "Undo";

/**
 * What a screen reader announces for an Undo (`docs/DESIGN.md` §7.13).
 *
 * The visible word is `Undo` on every one of them, and `UNDO_WINDOW_MS` is 12s
 * precisely so several stand at once — so a sighted user tabbing forward reads
 * which toast they are in, and a screen-reader user hears "Undo, button" three
 * times with nothing to tell a completion-revert from a `DELETE`. QA raised
 * this on the deferred `Tab` ×2 hazard (`docs/QA-REPORT.md` §8): the two
 * presses are the same for everyone, but only some users can see what they
 * land on.
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

interface EmptyStateCopy {
  heading: string;
  body: string;
  actionLabel?: string;
  onAction?: () => void;
}

export interface TodoListScreenProps {
  filters: TodoListFilters;
}

/**
 * Owns the list: it loads todos over HTTP through the service, and decides per
 * mutation whether the answer is already in hand.
 *
 * A create refetches, because it can place a row anywhere or outside the
 * filter entirely. A toggle does not: it applies the change locally and
 * reconciles with the row the write returned (`runToggle`).
 */
export const TodoListScreen = ({ filters }: TodoListScreenProps) => {
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

  const router = useRouter();
  const isDesktop = useMediaQuery(DESKTOP_MEDIA_QUERY);
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
   * One owner for every Undo toast, keyed by todo id.
   *
   * An Undo toast stays on screen for four seconds after it has been pressed
   * unless something closes it, and an armed Undo describes a state the todo
   * may no longer be in. Both problems are the same problem: a toast outliving
   * the write it belongs to (review M-1, M-2).
   *
   * A toggle and a delete dismiss the row's outstanding Undo before they
   * start. A save cannot — it runs inside the modal — so its dismissal happens
   * in `handleSaved` once the write resolves, which leaves the older Undo
   * armed for the length of that round trip. Unreachable today only because
   * the modal's backdrop covers the toast region and traps focus; a top-placed
   * toast or a non-modal editor would expose it (review r-2).
   *
   * **`added` receipts are deliberately not in here** (`docs/DESIGN.md`
   * §7.15). Everything this map protects is a property of an *armed* toast:
   * that it can still be pressed, and that what it would do describes a state
   * the row has since left. A receipt with no action has neither property, so
   * registering one would buy no protection and would keep the cost — two
   * toasts alive under one todo id while HeroUI's serialized view transition
   * works through the close and the add, which is the frame window DEF-25 and
   * DEF-26 both lived in. The receipt now simply expires on its own.
   */
  const undoToastKeys = useRef(new Map<string, string>());

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
   * Returns whether it dismissed anything, which is what makes it usable as a
   * re-entrancy guard: reading and clearing the key is atomic, so only the
   * first of two fast presses sees a key and runs the undo (review r-1).
   */
  const dismissUndo = (todoId: string) => {
    const key = undoToastKeys.current.get(todoId);

    if (!key) return false;

    toast.close(key);
    undoToastKeys.current.delete(todoId);

    return true;
  };

  /**
   * A toast that reports and stops — no action, no token, no bookkeeping.
   *
   * This is what an `added` toast is now (`docs/DESIGN.md` §7.15). It is a
   * separate function rather than a flag on `showUndoableSuccess` because
   * almost nothing that helper does applies: there is no action to mint a
   * token for, nothing for the focus rescue to wait on, and no armed control
   * that a later write has to disarm. Threading a `withUndo: false` through it
   * would leave every one of those branches to read past.
   *
   * **The 12s life is kept**, and that is the one thing it does borrow. The
   * decision was to remove the action, not the receipt: a create's toast that
   * suddenly outlived — or died before — the Undo toasts stacked beside it
   * would be a second change nobody asked for, and §7.17's `hidden by your
   * filters` sentence is the only account the user ever gets of a row the
   * filter swallowed, so it is the last one that should get shorter.
   */
  const showReceipt = (message: string) => {
    toast.success(message, { timeout: UNDO_WINDOW_MS });
  };

  /**
   * Raises the Undo toast and returns the token that names **this** one.
   *
   * Two callers remain, and they are the two reversals that put a value back:
   * a toggle (§7.13) and an edit (§7.15). A create reports through
   * `showReceipt` instead — its Undo was a `DELETE`, which is the hazard
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
    dismissUndo(todoId);

    const token = nextUndoToken();

    const key = toast.success(message, {
      timeout: UNDO_WINDOW_MS,
      actionProps: {
        children: UNDO_LABEL,
        /*
          The accessible name, which the visible word cannot be: it is `Undo`
          on every toast in the stack, and the stack is the ordinary case.
          `aria-label` overrides the child text for assistive technology and
          leaves the button reading `Undo` on screen, which is what the copy
          deck asks for in both places (§7.13).
        */
        "aria-label": undoActionLabel(message),
        ...undoTokenProps(token),
        onPress: () => {
          // Closing the toast does not remove it immediately — HeroUI defers
          // the unmount through a view transition, which can outlast a double
          // click. The key, not the toast, is what makes this fire once.
          if (!dismissUndo(todoId)) return;

          undo();
        },
      },
    });

    undoToastKeys.current.set(todoId, key);

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

  const openEdit = (todo: TodoItemData) => {
    setEditingTodo(todo);
    formState.open();
  };

  const focusQuickAdd = () => {
    quickAddInputRef.current?.focus();
  };

  const clearFilters = () => {
    router.replace(TODOS_PATH, { scroll: false });
  };

  /**
   * The modal writes; the list reports. Keeping the toast here is what lets a
   * later write dismiss an earlier Undo — the modal cannot see the toast it
   * raised two edits ago (review M-2).
   */
  /**
   * The receipt for a create, and the one sentence that stops a filtered list
   * from looking like a failure.
   *
   * A create can land outside the list the user is looking at, and the row
   * then simply never appears. Inserting it anyway is not an option — a
   * filtered list must match what a reload of the same URL would show at every
   * moment (`docs/PRD.md` US-10, the rule the toggle already follows) — and
   * clearing the filter on their behalf would throw away something they asked
   * for. So the receipt says it, and keeps its Undo.
   *
   * `todoMatchesFilters` only ever claims "hidden" when it is certain, and
   * that asymmetry is deliberate: being wrong in this direction costs a
   * missing sentence, being wrong in the other costs a sentence that is a lie.
   *
   * Both readings are receipts and neither carries an Undo (§7.15). The
   * hidden one is the reason the sentence matters more here than anywhere
   * else: it is the only evidence the user gets that the write happened at
   * all, since the row it describes is not on screen to speak for itself.
   */
  const createdMessage = (saved: TodoItemData) =>
    todoMatchesFilters(saved, filters)
      ? `Todo “${saved.title}” added`
      : `Todo “${saved.title}” added — hidden by your filters`;

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

    showReceipt(createdMessage(saved));
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

    showReceipt(createdMessage(saved));
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
    if (isLoading) return <TodoListSkeleton />;

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
            className="min-h-11 sm:min-h-9"
            onPress={retry}
          >
            {TRY_AGAIN_LABEL}
          </Button>
        </div>
      );
    }

    if (result.todos.length === 0) {
      const emptyState = resolveEmptyState();

      return (
        <TodoEmptyState
          heading={emptyState.heading}
          body={emptyState.body}
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
      <div className="flex items-baseline justify-between gap-4">
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
        the specified state for an empty list and for a list still loading, and
        a line that came and went would be a fourth thing moving on the page.
      */}
      <TodoListHeaderLine groups={groups} />

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

      {hasTodos ? <TodoFilters filters={filters} /> : null}

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
