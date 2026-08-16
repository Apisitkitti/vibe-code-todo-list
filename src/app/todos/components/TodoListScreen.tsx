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

import { PAGE_HEADING, TRY_AGAIN_LABEL } from "@/app/todos/constants";
import { ConfirmDialog } from "@/components/ConfirmDialog";
import { getErrorMessage } from "@/lib/getErrorMessage";
import type { TodoItemData, TodoListFilters, TodoListResult } from "@/lib/todo";
import { replaceTodo, setTodoCompleted } from "@/lib/todoListState";
import {
  deleteTodo,
  getTodoList,
  toggleTodo,
  updateTodo,
} from "@/service/todo.service";

import type { TodoFormValues } from "./form";
import { TodoEmptyState } from "./TodoEmptyState";
import { TodoFilters } from "./TodoFilters";
import { TodoFormModal } from "./TodoFormModal";
import { TodoGroupedList } from "./TodoGroupedList";
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

/** Rendered twice: the toolbar button and the brand-new-account empty state. */
const NEW_TODO_LABEL = "New todo";

/**
 * Failure fallbacks from the copy deck (`docs/DESIGN.md` §7.9, §7.13, §7.15),
 * named because each is now read from more than one place: the toggle and its
 * Undo share one code path, and both kinds of Undo report the same wording.
 */
const TOGGLE_FAILURE_MESSAGE = "Couldn’t update the todo. Try again.";
const UNDO_FAILURE_MESSAGE = "Couldn’t undo that. Try again.";

const EMPTY_RESULT: TodoListResult = {
  todos: [],
  totalCount: 0,
  completedCount: 0,
};

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
  const [result, setResult] = useState<TodoListResult>(EMPTY_RESULT);
  const [isLoading, setIsLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [editingTodo, setEditingTodo] = useState<TodoItemData | null>(null);
  const [pendingDelete, setPendingDelete] = useState<TodoItemData | null>(null);
  /**
   * A set, not one slot. Two quick toggles used to clear each other's pending
   * state — the second finishing wrote `null` and unlocked the first row while
   * its request was still in flight (review m-4).
   *
   * **What "pending" means changed when the toggle became optimistic, and the
   * set is why it still means something.** It no longer means "we are waiting
   * to find out what happened" — the row already shows the new state, ticked
   * and struck through, and has moved into `Completed`. It now means *this is
   * your change and it is not confirmed yet*, which is a different claim and
   * still worth making: the flip on screen is a promise the server has not
   * kept, and `opacity-60` is the only thing distinguishing it from a fact.
   *
   * It also stays load-bearing as a lock. `pointer-events-none` plus
   * `isDisabled` is what stops a second press — mouse or held Space — from
   * racing a PATCH that is still in flight and letting the two land out of
   * order (m-4, QA DEF-12). Optimism makes that *more* likely, not less: the
   * box now moves instantly, so a user who wants it back presses again
   * immediately rather than waiting for the first press to visibly resolve.
   *
   * `docs/DESIGN.md` §8.3.2 suggests dropping the dimming from a toggle once
   * it is optimistic. Not taken, and deliberately: §4.8 — the spec section,
   * not the proposal — pairs `opacity-60 pointer-events-none` *with* optimism
   * ("No spinner — these are optimistic"), and removing the treatment would
   * remove the m-4 guard along with it. The dim is also half of what it was,
   * because a toggle is now one round trip instead of two.
   */
  const [pendingTodoIds, setPendingTodoIds] = useState<ReadonlySet<string>>(
    new Set(),
  );
  const [isDeleting, setIsDeleting] = useState(false);
  // Bumped after every mutation to re-run the load below — one fetch path for
  // the initial render, a filter change, a retry and a refresh alike.
  const [reloadToken, setReloadToken] = useState(0);
  const [lastFilterKey, setLastFilterKey] = useState<string | null>(null);
  const formState = useOverlayState();

  const router = useRouter();
  const isDesktop = useMediaQuery(DESKTOP_MEDIA_QUERY);
  const { status, priority, query } = filters;
  const filterKey = `${status}|${priority}|${query}`;

  // Filters arrive as props from the URL, so the refetch they trigger starts
  // in the effect below — too late to raise the flag without a render showing
  // stale rows first. Adjusted during render instead, the same way
  // `TodoFilters` follows the URL. An effect here trips
  // `react-hooks/set-state-in-effect`.
  if (lastFilterKey !== filterKey) {
    setLastFilterKey(filterKey);
    setIsLoading(true);
  }

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
   */
  const undoToastKeys = useRef(new Map<string, string>());

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

  const showUndoableSuccess = (
    todoId: string,
    message: string,
    undo: () => void,
  ) => {
    dismissUndo(todoId);

    const key = toast.success(message, {
      timeout: UNDO_WINDOW_MS,
      actionProps: {
        children: "Undo",
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
  };

  const markPending = (todoId: string) => {
    setPendingTodoIds((ids) => new Set(ids).add(todoId));
  };

  const clearPending = (todoId: string) => {
    setPendingTodoIds((ids) => {
      const next = new Set(ids);

      next.delete(todoId);

      return next;
    });
  };

  /** Keeps the counts beside the heading honest until the refetch reconciles. */
  const removeTodoLocally = (todoId: string, wasCompleted: boolean) => {
    setResult((current) => ({
      todos: current.todos.filter((todo) => todo.id !== todoId),
      totalCount: Math.max(0, current.totalCount - 1),
      completedCount: wasCompleted
        ? Math.max(0, current.completedCount - 1)
        : current.completedCount,
    }));
  };

  const requestReload = () => {
    setReloadToken((token) => token + 1);
  };

  /**
   * For changes with no single row to point at: a create or an edit can move
   * the row, or drop it out of the current filter entirely. Without this the
   * modal closed on the write and left the old list on screen until the
   * refetch landed, which read as the app ignoring you — the same gap a
   * filter change had (review m-8).
   */
  const reloadWithSkeleton = () => {
    setIsLoading(true);
    requestReload();
  };

  /**
   * For a delete and for the Undo of a save. The user knows exactly which row
   * they acted on and that row already shows its own pending state, so
   * blanking the whole list to report it is disproportionate — and it throws
   * away their scroll position.
   *
   * A toggle no longer comes here at all. It has the authoritative row in
   * hand and splices it (`runToggle`), which is the second round trip m-7 was
   * about; this reload is for the writes that genuinely cannot say what the
   * list should now look like.
   */
  const reloadSilently = () => {
    requestReload();
  };

  const retry = () => {
    setLoadError(null);
    reloadWithSkeleton();
  };

  const openCreate = () => {
    setEditingTodo(null);
    formState.open();
  };

  const openEdit = (todo: TodoItemData) => {
    setEditingTodo(todo);
    formState.open();
  };

  const clearFilters = () => {
    router.replace(TODOS_PATH, { scroll: false });
  };

  /**
   * The modal writes; the list reports. Keeping the toast here is what lets a
   * later write dismiss an earlier Undo — the modal cannot see the toast it
   * raised two edits ago (review M-2).
   */
  const handleSaved = (saved: TodoItemData, previous: TodoFormValues | null) => {
    reloadWithSkeleton();

    const isEdit = previous !== null;

    showUndoableSuccess(
      saved.id,
      isEdit ? `Todo “${saved.title}” updated` : `Todo “${saved.title}” added`,
      () => {
        void undoSave(saved, previous);
      },
    );
  };

  /**
   * Undo runs the same endpoints with the same authorization as the write it
   * reverses. A created todo is deleted; an edited one is written back to the
   * values it held when the form opened.
   */
  const undoSave = async (saved: TodoItemData, previous: TodoFormValues | null) => {
    markPending(saved.id);

    try {
      if (previous) {
        await updateTodo(saved.id, previous);
        toast.success(`Todo “${previous.title}” restored`);
      } else {
        await deleteTodo(saved.id);
        toast.success(`Todo “${saved.title}” removed`);
        removeTodoLocally(saved.id, saved.completed);
      }

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
   * parallel copy that can drift. The two differ in exactly two respects, and
   * both are arguments: what they say on success, and which fallback they read
   * when the server refuses.
   *
   * The sequence, and what each step costs (review m-7, §2.1–2.2):
   *
   *  1. Flip the row locally. Nothing is awaited first, so the box ticks under
   *     the finger and grouping re-sections immediately — a completed todo
   *     leaves `Overdue` and lands in `Completed` before the server agrees.
   *  2. One `PATCH /api/todos/[id]/status`.
   *  3. Splice the row that request *already returned* into local state. The
   *     authoritative row used to be thrown away and a whole `GET /api/todos`
   *     issued to fetch it again; that second round trip is gone.
   *  4. On failure, write the previous value back. `!nextCompleted` is that
   *     value by construction — a toggle flips, so the state before the press
   *     is the negation of the state it asked for — and it is read from the
   *     press rather than from the row, which may have been replaced by then.
   *
   * The revert is the whole risk of this design, so it is deliberately dumb:
   * one call, one known value, no inference about what "undo" means, and no
   * dependence on the request having failed at any particular stage.
   * `setTodoCompleted` is a no-op when the row already holds that value, so
   * running it is safe even if the flip never applied.
   *
   * A create still refetches (`reloadWithSkeleton`) and this does not, which
   * is not an inconsistency: a create can land outside the current filter or
   * at a position only the server's ordering can choose, while a toggle
   * changes one boolean on a row already on screen.
   */
  const runToggle = async (
    todo: TodoItemData,
    nextCompleted: boolean,
    onSuccess: () => void,
    failureMessage: string,
  ) => {
    markPending(todo.id);
    setResult((current) => setTodoCompleted(current, todo.id, nextCompleted));

    try {
      const saved = await toggleTodo(todo.id, nextCompleted);

      setResult((current) => replaceTodo(current, saved));
      onSuccess();
    } catch (error) {
      setResult((current) =>
        setTodoCompleted(current, todo.id, !nextCompleted),
      );
      toast.danger(getErrorMessage(error, failureMessage));
    } finally {
      clearPending(todo.id);
    }
  };

  /** Reports the flipped state with §7.11's toast, and arms no further Undo. */
  const undoToggle = async (todo: TodoItemData, restoredCompleted: boolean) => {
    await runToggle(
      todo,
      restoredCompleted,
      () => {
        toast.success(toggledMessage(todo.title, restoredCompleted));
      },
      UNDO_FAILURE_MESSAGE,
    );
  };

  const handleToggle = async (todo: TodoItemData, nextCompleted: boolean) => {
    // Before the flip, not after: the row's outstanding Undo describes a state
    // it is leaving, and the toast region is live from the first frame now
    // that the change is visible immediately (review M-1, M-2).
    dismissUndo(todo.id);

    await runToggle(
      todo,
      nextCompleted,
      () => {
        showUndoableSuccess(
          todo.id,
          toggledMessage(todo.title, nextCompleted),
          () => {
            void undoToggle(todo, !nextCompleted);
          },
        );
      },
      TOGGLE_FAILURE_MESSAGE,
    );
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
        actionLabel: NEW_TODO_LABEL,
        onAction: openCreate,
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
        todos={result.todos}
        pendingTodoIds={rowPendingIds()}
        showTooltips={isDesktop}
        onToggle={(target, nextCompleted) => {
          void handleToggle(target, nextCompleted);
        }}
        onEdit={openEdit}
        onDelete={setPendingDelete}
      />
    );
  };

  useEffect(() => {
    let isCurrent = true;

    void getTodoList({ status, priority, query })
      .then((nextResult) => {
        if (!isCurrent) return;

        setResult(nextResult);
        setLoadError(null);
      })
      .catch((error: unknown) => {
        if (!isCurrent) return;

        setLoadError(
          getErrorMessage(error, "Something went wrong on our end."),
        );
      })
      .finally(() => {
        if (isCurrent) setIsLoading(false);
      });

    // A response that arrives after the filters moved on must not win.
    return () => {
      isCurrent = false;
    };
  }, [status, priority, query, reloadToken]);

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
        On a brand-new account the empty state carries its own "New todo"
        action, so this button would be the second copy of the same call to
        action on one screen. It comes back as soon as there is a todo — a
        filter that matches nothing still needs it, because that empty state
        offers "Clear filters" instead.
      */}
      {hasTodos ? (
        <Button
          variant="primary"
          className="min-h-11 w-full sm:w-auto sm:self-start"
          onPress={openCreate}
        >
          {NEW_TODO_LABEL}
        </Button>
      ) : null}

      {hasTodos ? <TodoFilters filters={filters} /> : null}

      <Card>
        <Card.Content className="p-0">{renderList()}</Card.Content>
      </Card>

      <TodoFormModal
        // Remounts the form so it starts from the right record's values.
        key={editingTodo?.id ?? "create"}
        state={formState}
        todo={editingTodo}
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
