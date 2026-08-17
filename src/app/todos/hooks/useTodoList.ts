"use client";

import { useEffect, useRef, useState } from "react";

import { getErrorMessage } from "@/lib/getErrorMessage";
import type { TodoListFilters, TodoListResult } from "@/lib/todo";
import { getTodoList } from "@/service/todo.service";

/**
 * The list's data half: what is on screen, whether it is still arriving, and
 * every way of asking for it again.
 *
 * **This is a move, not a change.** Every line below came out of
 * `TodoListScreen` unaltered — the same state, the same order, the same
 * render-time filter flag, the same effect with the same dependency array and
 * the same `isCurrent` guard. The comments came with it, because they document
 * decisions that are still being made here rather than there. Nothing about
 * behaviour is different, which is the only property that makes this diff
 * reviewable at all.
 *
 * What stayed in the screen is everything that decides *what a mutation
 * means*: the toasts and their Undo, the confirm dialog, the modal, and the
 * optimistic toggle. Those read this state and write back through the setters
 * returned here; they are not list plumbing and moving them would have made
 * this a behaviour change wearing a refactor's clothes.
 */

const EMPTY_RESULT: TodoListResult = {
  todos: [],
  totalCount: 0,
  completedCount: 0,
};

export interface UseTodoListReturn {
  result: TodoListResult;
  /** For the optimistic writes, which own the arithmetic in `todoListState`. */
  setResult: React.Dispatch<React.SetStateAction<TodoListResult>>;
  isLoading: boolean;
  loadError: string | null;
  pendingTodoIds: ReadonlySet<string>;
  markPending: (todoId: string) => void;
  clearPending: (todoId: string) => void;
  removeTodoLocally: (todoId: string, wasCompleted: boolean) => void;
  reloadWithSkeleton: () => void;
  reloadSilently: () => void;
  retry: () => void;
  /**
   * How many loads have *landed*. Read before and after a write to find out
   * whether a reload threw the optimistic arithmetic away mid-flight.
   */
  readLandedLoads: () => number;
}

export const useTodoList = (filters: TodoListFilters): UseTodoListReturn => {
  const [result, setResult] = useState<TodoListResult>(EMPTY_RESULT);
  const [isLoading, setIsLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
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
   * That is the whole of the argument for keeping the treatment, and it is
   * enough on its own.
   *
   * `docs/DESIGN.md` §8.3.2 suggests dropping the dimming from a toggle once
   * it is optimistic. Not taken here, because it was written about perceived
   * latency and was not reasoning about races — and because a locked but
   * *undimmed* row is the worst of the three: it ignores you without saying
   * why. Note the lock and the dim are separable (`isDisabled` +
   * `pointer-events-none` is the guard, `opacity-60` only the signal), so
   * dropping the opacity alone remains open; that is a designer's call, filed
   * as review MI-6 against the §4.8 / §8.3.2 contradiction. The dim is in any
   * case half of what it was, a toggle now being one round trip, not two.
   */
  const [pendingTodoIds, setPendingTodoIds] = useState<ReadonlySet<string>>(
    new Set(),
  );
  // Bumped after every mutation to re-run the load below — one fetch path for
  // the initial render, a filter change, a retry and a refresh alike.
  const [reloadToken, setReloadToken] = useState(0);
  const [lastFilterKey, setLastFilterKey] = useState<string | null>(null);

  /**
   * How many list loads have *landed* — incremented where the load effect
   * replaces `result`, which is the single event that throws a toggle's
   * optimistic arithmetic away.
   *
   * A toggle reads it before its write and again after, and asks the server
   * when the two differ (`runToggle`). Counting landed loads rather than
   * requested ones is deliberate and was the second attempt at this guard:
   * `reloadToken` is bumped only by `requestReload()`, so a guard watching it
   * saw a create, a delete and an Undo but **not a filter change**, which
   * re-runs the load through the `status` / `priority` / `query` dependencies
   * and never touches the token. A filter change is the easiest way for a user
   * to land a reload inside a toggle's flight window and is the trigger the
   * defect was reported against (`docs/REVIEW.md` MA-2, third bullet), so a
   * token comparison closed every case except the reported one.
   *
   * A load that is superseded (`isCurrent === false`) or that fails does not
   * count: neither replaces `result`, so neither is anything to reconcile
   * against.
   */
  const landedLoadsRef = useRef(0);

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

  const readLandedLoads = () => landedLoadsRef.current;

  useEffect(() => {
    let isCurrent = true;

    void getTodoList({ status, priority, query })
      .then((nextResult) => {
        if (!isCurrent) return;

        // Counted here, at the one line that discards a toggle's optimistic
        // arithmetic, so every way of starting a load is covered by
        // construction rather than by remembering to bump a token.
        landedLoadsRef.current += 1;
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

  return {
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
  };
};
