import type { TodoItemData, TodoListResult } from "./todo";

/**
 * The local half of an optimistic write: how a `TodoListResult` changes when
 * the user acts, and how it changes back when the server refuses.
 *
 * This lives here, as pure functions over the result, rather than inline in
 * `TodoListScreen`, for one reason: **the revert is the only correctness
 * property optimistic state has, and a property with no verifier is not a
 * property** (`docs/REVIEW.md` E-2). A browser cannot be asked to prove that
 * a rollback restores the exact value, the exact count and the exact section;
 * these functions can, and `tests/unit/todoListState.test.ts` does.
 *
 * Two invariants hold across every function:
 *
 *  1. **Position is never changed.** The server owns the sequence
 *     (`src/app/api/todos/util.ts` → `TODO_LIST_ORDER_BY`) and the client owns
 *     only the section cuts (`src/lib/todoGroups.ts`). Re-sorting here would
 *     put a second ordering authority in the app. A flip therefore moves a row
 *     between sections — which is the visible effect — without moving it past
 *     its neighbours inside one.
 *  2. **A no-op returns the identical object.** That is what makes a revert
 *     safe to run unconditionally: reverting a flip that never landed, or that
 *     was already reverted, changes nothing and re-renders nothing.
 *
 * `totalCount` and `completedCount` are counts of the *account*, not of the
 * filtered page (`src/app/api/todos/route.ts` counts without the filter
 * clauses), so a toggle moves `completedCount` by exactly one and never
 * touches `totalCount`.
 */

/** Counts are unsigned; a stale reconcile must not drive one below zero. */
const clampCount = (count: number) => Math.max(0, count);

/**
 * Applies — or reverts — a completion flip.
 *
 * Both directions are the same operation because the revert is not an inverse
 * that has to be derived: the caller knows the value the row held before it
 * pressed, and writing that value back is the whole rollback. Passing the
 * value rather than "undo the last thing" is what stops a revert from
 * guessing.
 */
export const setTodoCompleted = (
  result: TodoListResult,
  todoId: string,
  completed: boolean,
): TodoListResult => {
  const current = result.todos.find((todo) => todo.id === todoId);

  if (!current || current.completed === completed) return result;

  return {
    todos: result.todos.map((todo) =>
      todo.id === todoId ? { ...todo, completed } : todo,
    ),
    totalCount: result.totalCount,
    completedCount: clampCount(result.completedCount + (completed ? 1 : -1)),
  };
};

/**
 * Reconciles the optimistic guess with the row the server actually wrote.
 *
 * `PATCH /api/todos/[id]/status` already returns the authoritative
 * `TodoItemData` and the list used to throw it away and refetch everything
 * (`docs/REVIEW.md` m-7, §2.2). Splicing it in is that second round trip
 * deleted: the guess is replaced by fact, and `completedCount` is corrected by
 * the difference between the two rather than assumed to be right.
 *
 * A row that is not on screen is not added. The list is a *filtered* page, and
 * an id absent from it is absent because the filter excluded it — inserting it
 * would show the user a row their filter says they should not be looking at,
 * at a position no ordering rule chose.
 */
export const replaceTodo = (
  result: TodoListResult,
  saved: TodoItemData,
): TodoListResult => {
  const current = result.todos.find((todo) => todo.id === saved.id);

  if (!current) return result;

  const completedDelta = Number(saved.completed) - Number(current.completed);

  return {
    todos: result.todos.map((todo) => (todo.id === saved.id ? saved : todo)),
    totalCount: result.totalCount,
    completedCount: clampCount(result.completedCount + completedDelta),
  };
};
