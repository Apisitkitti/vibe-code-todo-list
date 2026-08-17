import type {
  TodoItemData,
  TodoListFilters,
  TodoListResult,
  TodoStatusFilter,
} from "./todo";

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
 * Three invariants hold across every function:
 *
 *  1. **Position is never changed.** The server owns the sequence
 *     (`src/app/api/todos/util.ts` → `TODO_LIST_ORDER_BY`) and the client owns
 *     only the section cuts (`src/lib/todoGroups.ts`). Re-sorting here would
 *     put a second ordering authority in the app. A row is moved between
 *     sections, or removed — never re-sequenced.
 *  2. **A row is never added.** A row that is absent is absent because a
 *     filter excluded it, and only the server knows the `docs/PRD.md` §2 place
 *     it would return to. Putting a row back is a refetch, not arithmetic.
 *  3. **A no-op returns the identical object**, so a revert that has nothing
 *     to undo re-renders nothing.
 *
 * `totalCount` and `completedCount` are counts of the *account*, not of the
 * filtered page (`src/app/api/todos/route.ts` counts without the filter
 * clauses), so a toggle moves `completedCount` by exactly one, never touches
 * `totalCount`, and does both even when the row it describes has just left the
 * filtered list.
 */

/** Counts are unsigned; a stale reconcile must not drive one below zero. */
const clampCount = (count: number) => Math.max(0, count);

/**
 * Whether a todo with this completion belongs in a list under this filter.
 *
 * The status filter is the only filter a toggle can move a row across —
 * priority and the search query read fields a toggle does not write — which is
 * why this takes a status and not the whole `TodoListFilters`.
 */
export const todoMatchesStatusFilter = (
  completed: boolean,
  status: TodoStatusFilter,
): boolean => {
  return status === "all" || (status === "completed") === completed;
};

/**
 * Case- and accent-insensitive containment, folded hard enough that no
 * plausible database collation matches *less* than this does.
 *
 * The reason it is deliberately loose: JavaScript and Postgres do not agree
 * about lowercasing, and the disagreement is not hypothetical. `İ` (U+0130)
 * lowercases to `i` under glibc, which is what `ILIKE` uses, and to `i` plus a
 * combining dot (U+0069 U+0307) in JavaScript — so `İstanbul` matches a search
 * for `istanbul` in the database and did **not** match here, which is exactly
 * how the toast came to say "hidden" about a row sitting in the list.
 * Decomposing and dropping the combining marks closes that case, and every
 * other one shaped like it, by folding at least as far as any collation will.
 *
 * Folding further than the server is safe **in one direction only**, and that
 * is the whole design: this can now say "visible" about a row the database
 * would not have returned (`café` vs a search for `cafe`), and the cost of
 * that is a plain toast instead of an explanatory one. It can no longer say
 * "hidden" about a row that is on screen, which is the error that makes the
 * app look like it is lying.
 */
const fold = (value: string) =>
  value
    .normalize("NFD")
    .replace(/\p{M}/gu, "")
    .toLowerCase();

/**
 * Whether a todo would appear in the list the user is currently looking at —
 * or, read honestly, **whether we are certain it would not**.
 *
 * This is **not** used to put a row on screen — invariant 2 stands, and the
 * server remains the only authority on where a row goes. It answers a
 * narrower question the quick-add bar has to ask: *the todo you just made is
 * not in front of you — is that because it is hidden, or because something
 * went wrong?* Without an answer, capturing under an active filter looks
 * exactly like a silent failure, which is the one thing that makes a capture
 * bar untrustworthy.
 *
 * The clauses mirror `GET /api/todos` (`src/app/api/todos/route.ts`): status
 * against `completed` and priority by equality — both exact comparisons over
 * an enum and a boolean, where no collation is involved and the two languages
 * cannot disagree — and the query as a substring of the **title**, the same
 * field the server searches today.
 *
 * That last clause is the one that can drift, in two ways: the Unicode
 * disagreement `fold` handles, and a future change to what the server searches
 * — backlog #4 would add `note` to the `OR` and falsify this file silently.
 * Neither is caught by restating the clauses in a unit test, so
 * `tests/api/filterPredicate.test.ts` asserts the property that actually
 * matters against the real handler: **anything this calls hidden is genuinely
 * absent from the response.** The converse is not asserted, because it is not
 * required — see `fold`.
 *
 * It reads no `where` clause and grants no access; it is arithmetic over a row
 * the server already returned to this user.
 */
export const todoMatchesFilters = (
  todo: TodoItemData,
  filters: TodoListFilters,
): boolean => {
  if (!todoMatchesStatusFilter(todo.completed, filters.status)) return false;

  if (filters.priority !== "all" && todo.priority !== filters.priority) {
    return false;
  }

  if (filters.query !== "" && !fold(todo.title).includes(fold(filters.query))) {
    return false;
  }

  return true;
};

/**
 * Applies — or reverts — a completion flip, and drops the row when the change
 * takes it out of the current filter.
 *
 * Both directions are the same operation because the revert is not an inverse
 * that has to be derived: the caller knows the value the row held before it
 * pressed, and writing that value back is the rollback. Passing the value
 * rather than "undo the last thing" is what stops a revert from guessing.
 *
 * **The removal is a product ruling, not an optimisation** (`docs/PRD.md`
 * US-07 → "under a status filter", US-10). A list under `Active` shows only
 * active todos *at every moment*, not only after a reload; a row kept on
 * screen under a `Completed` heading inside that view would make one filter
 * mean two things depending on what the viewer had just pressed. So the row
 * leaves at the moment of the change, and the counts — which describe the
 * account, not the page — move anyway.
 *
 * Reverting that removal is deliberately *not* possible here: see invariant 2.
 * `TodoListScreen` refetches instead, which is what puts the row back in its
 * §2 place rather than at whichever index this function last saw it.
 */
export const applyCompletion = (
  result: TodoListResult,
  todoId: string,
  completed: boolean,
  status: TodoStatusFilter,
): TodoListResult => {
  const current = result.todos.find((todo) => todo.id === todoId);

  if (!current || current.completed === completed) return result;

  const staysVisible = todoMatchesStatusFilter(completed, status);

  return {
    todos: staysVisible
      ? result.todos.map((todo) =>
          todo.id === todoId ? { ...todo, completed } : todo,
        )
      : result.todos.filter((todo) => todo.id !== todoId),
    totalCount: result.totalCount,
    completedCount: clampCount(result.completedCount + (completed ? 1 : -1)),
  };
};

/**
 * Reconciles the optimistic guess with the row the server actually wrote.
 *
 * `PATCH /api/todos/[id]/status` already returns the authoritative
 * `TodoItemData` and the list used to throw it away and refetch everything
 * (`docs/REVIEW.md` m-7, §2.1). Splicing it in is that second round trip
 * deleted: the guess is replaced by fact.
 *
 * `completedCount` is corrected **by difference**, not by assuming the guess
 * was right, and that is the line that makes a mid-flight reload survivable:
 * if a `GET` lands between the press and the response, local state holds the
 * *pre-write* row, and `saved.completed − current.completed` still comes out
 * at exactly one. An assumed `+1` would double-count it.
 *
 * A row that is not on screen is not added — invariant 2. That is also the
 * documented limit of this function: when the row is absent, the count it
 * would have corrected is left alone, so the caller has to refetch if it needs
 * the number to be right (`docs/REVIEW.md` MA-2).
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
