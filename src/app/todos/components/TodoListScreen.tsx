"use client";

import { useEffect, useState } from "react";

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
import { deleteTodo, getTodoList, toggleTodo } from "@/service/todo.service";

import { TodoEmptyState } from "./TodoEmptyState";
import { TodoFilters } from "./TodoFilters";
import { TodoFormModal } from "./TodoFormModal";
import { TodoListSkeleton } from "./TodoListSkeleton";
import { TodoRow } from "./TodoRow";

const TODOS_PATH = "/todos";
const DESKTOP_MEDIA_QUERY = "(min-width: 640px)";

/** Rendered twice: the toolbar button and the brand-new-account empty state. */
const NEW_TODO_LABEL = "New todo";

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
 * Owns the list: it loads todos over HTTP through the service, and reloads
 * after every mutation (`docs/CONVENTIONS.md` → Server actions — auth only).
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
   * its request was still in flight (review m-4). That matters more now that
   * the per-row signal is the only one these mutations show.
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
   * For a toggle or a delete. The user knows exactly which row they acted on
   * and that row already shows its own pending state, so blanking the whole
   * list to report it is disproportionate — and it throws away their scroll
   * position.
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
   * Undo re-runs the very same endpoint, so it is authorised and scoped to the
   * session user exactly like the original flip — not a privileged shortcut.
   */
  const undoToggle = async (todo: TodoItemData, restoredCompleted: boolean) => {
    markPending(todo.id);

    try {
      await toggleTodo(todo.id, restoredCompleted);
      toast.success(
        restoredCompleted
          ? `Todo “${todo.title}” marked complete`
          : `Todo “${todo.title}” marked not complete`,
      );
      reloadSilently();
    } catch (error) {
      toast.danger(getErrorMessage(error, "Couldn’t undo that. Try again."));
    } finally {
      clearPending(todo.id);
    }
  };

  /** The one mutation with no confirm dialog: it fires, then offers Undo. */
  const handleToggle = async (todo: TodoItemData, nextCompleted: boolean) => {
    markPending(todo.id);

    try {
      await toggleTodo(todo.id, nextCompleted);
      toast.success(
        nextCompleted
          ? `Todo “${todo.title}” marked complete`
          : `Todo “${todo.title}” marked not complete`,
        {
          actionProps: {
            children: "Undo",
            onPress: () => {
              void undoToggle(todo, !nextCompleted);
            },
          },
        },
      );
      reloadSilently();
    } catch (error) {
      // Nothing changed optimistically, so the row already shows the truth.
      toast.danger(
        getErrorMessage(error, "Couldn’t update the todo. Try again."),
      );
    } finally {
      clearPending(todo.id);
    }
  };

  const handleDelete = async () => {
    if (!pendingDelete) return;

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

    return (
      <ul className="divide-y divide-border-secondary">
        {result.todos.map((todo) => (
          <TodoRow
            key={todo.id}
            todo={todo}
            isPending={
              pendingTodoIds.has(todo.id) ||
              (isDeleting && pendingDelete?.id === todo.id)
            }
            showTooltips={isDesktop}
            onToggle={(target, nextCompleted) => {
              void handleToggle(target, nextCompleted);
            }}
            onEdit={openEdit}
            onDelete={setPendingDelete}
          />
        ))}
      </ul>
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
        onSaved={reloadWithSkeleton}
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
