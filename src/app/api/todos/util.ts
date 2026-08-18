import type { Prisma, Todo } from "@/generated/prisma/client";

import { prisma } from "@/lib/prisma";
import {
  CREATED_VIA_VALUES,
  type TodoCreatedVia,
  type TodoItemData,
  type TodoListResult,
} from "@/lib/todo";

/**
 * Everything the `/api/todos` handlers share: turning rows into the response
 * bodies, and the reads that follow a write.
 *
 * The response types are `TodoItemData` and `TodoListResult` from
 * `@/lib/todo` — the same types the client already uses. There is no separate
 * API model layer, because a second declaration of the same todo is only
 * something to keep in sync. Error shapes live in `./errors.ts`.
 */

/**
 * The order the list is read in — urgency first, and the whole of the ordering
 * rule in one place.
 *
 *  1. `completed asc` — done work sits under live work, always. Unchanged, and
 *     the reason it stays first is that a completed todo's due date is history:
 *     an overdue-but-finished row must not lead the list.
 *  2. `dueAt asc`, **nulls last** — the sequencing this whole change exists
 *     for. Ascending dates put the most overdue row first and run forward
 *     through today into the future; `nulls: "last"` parks undated todos after
 *     every dated one instead of Postgres's default of sorting NULLs high.
 *     Note what this buys: the section boundaries the client draws (overdue /
 *     today / upcoming / no date) are *cuts in this sequence*, never a
 *     reordering of it, so the server needs no idea what day it is.
 *  3. `priority desc` — the tie-break between todos sharing a due date, and
 *     the only place priority sequences anything. It is deliberately *below*
 *     the date: a low-priority todo due today is more urgent than a high one
 *     due next month, and ranking priority first would put the date back to
 *     being decoration. The `Priority` enum is declared `low, medium, high`
 *     (`prisma/schema.prisma`), so Postgres orders it in that declaration
 *     order and `desc` yields high → medium → low. Getting that backwards is
 *     silent, which is why `tests/api/ordering.test.ts` asserts it directly.
 *  4. `createdAt desc` — the last resort, and today's behaviour preserved:
 *     among todos with the same date and priority, newest first.
 *
 * Served by `@@index([userId, completed, dueAt])`, which matches the `where`
 * scope plus the two leading sort keys.
 */
export const TODO_LIST_ORDER_BY: Prisma.TodoOrderByWithRelationInput[] = [
  { completed: "asc" },
  { dueAt: { sort: "asc", nulls: "last" } },
  { priority: "desc" },
  { createdAt: "desc" },
];

/** Dates cross the wire as ISO strings; the client never sees a `Date`. */
export const toTodoResponse = (todo: Todo): TodoItemData => {
  return {
    id: todo.id,
    title: todo.title,
    note: todo.note,
    priority: todo.priority,
    completed: todo.completed,
    dueAt: todo.dueAt ? todo.dueAt.toISOString() : null,
    createdAt: todo.createdAt.toISOString(),
  };
};

export const toTodoListResponse = (
  todos: Todo[],
  totalCount: number,
  completedCount: number,
): TodoListResult => {
  return {
    todos: todos.map(toTodoResponse),
    totalCount,
    completedCount,
  };
};

/**
 * Re-read after a write, through the same ownership filter, so a response can
 * never carry a row the caller does not own.
 */
export const findOwnedTodo = (id: string, userId: string) => {
  return prisma.todo.findFirst({ where: { id, userId } });
};

/**
 * Completion is only ever changed through `/status`. Both the create and the
 * save handlers use this to reject a body that carries it, rather than
 * parsing it away and returning a success the caller will misread.
 */
export const mentionsCompleted = (body: unknown): boolean => {
  return typeof body === "object" && body !== null && "completed" in body;
};

/** `request.json()` throws on a malformed body; the caller gets `null`. */
export const readJsonBody = async (request: Request): Promise<unknown> => {
  return await request.json().catch(() => null);
};

/**
 * The body's `createdVia`, if it carried one.
 *
 * Parsed on its own rather than added to `todoFormSchema`, because it is not a
 * field of the todo: it records the act of creating one. Putting it in the
 * form schema would hand it to `TodoForm`, to `TODO_FIELD_NAMES` and to the
 * field-error mapping, none of which should ever see it — and a field error
 * against a key with no input to attach to is an error the user cannot act on.
 *
 * Three answers, deliberately distinct, because two of them are not the same
 * mistake:
 *
 *  - a member → record it;
 *  - **absent** → `undefined`, and the row stores `NULL`. A caller that does
 *    not participate still gets its todo saved; this is a measurement, and a
 *    measurement is never a good enough reason to refuse somebody's write;
 *  - **present and not a member** → `"invalid"`, and the route answers `400`.
 *    Dropping it silently would be the half-applied write
 *    `docs/CONVENTIONS.md` rules out — a `201` that looks like it recorded
 *    what it was told and did not.
 *
 * The `"invalid"` sentinel rather than a thrown error or a `null` mirrors
 * `parseDueDate` in `@/lib/todo`, which distinguishes the same three cases for
 * the same reason.
 */
export const readCreatedVia = (
  body: unknown,
): TodoCreatedVia | undefined | "invalid" => {
  if (typeof body !== "object" || body === null) return undefined;
  if (!("createdVia" in body)) return undefined;

  const value = (body as { createdVia: unknown }).createdVia;

  return (CREATED_VIA_VALUES as readonly unknown[]).includes(value)
    ? (value as TodoCreatedVia)
    : "invalid";
};

/**
 * LIKE's three metacharacters — the two wildcards and the escape character
 * itself.
 *
 * One character class in one pass, deliberately. `\` has to be escaped too,
 * and doing that as a separate `replace` would have to run *first*: a second
 * pass over the output would revisit the backslashes the first pass had just
 * introduced and turn `\%` into `\\%`, a literal backslash followed by a live
 * wildcard. A single pass cannot see its own output, so the ordering question
 * does not arise.
 */
const LIKE_METACHARACTERS = /[\\%_]/g;

/**
 * Makes a user's search term mean itself.
 *
 * Prisma's `contains` compiles to `ILIKE '%' || $1 || '%'`. Binding `$1` as a
 * parameter is what stops SQL injection, and it is *all* it stops: `ILIKE`
 * interprets `%`, `_` and `\` inside the bound value afterwards, so until this
 * ran a search box was quietly a pattern box. Measured against the real
 * Postgres before the fix (`tests/api/searchWildcards.test.ts`):
 *
 *  - `50% off` returned `50 things to sell off` as well — `%` stood for any
 *    run of characters, so a user looking for a discount got nonsense.
 *  - `%` alone returned the entire account.
 *  - `a_b` also returned `plan axb review` — `_` stood for any one character.
 *  - `C:\temp` returned the row **without** the backslash and not the row
 *    with it: `\t` escaped the `t` down to a plain `t`. The one case where the
 *    defect hides the very row the user is looking for.
 *
 * Escaping here rather than reaching for `$queryRaw` keeps the `where` a
 * Prisma object, which is what keeps the `userId` scope and the `OR` arms
 * checkable by reading them (see the security note in `route.ts`). Postgres's
 * default LIKE escape character is `\`, so no `ESCAPE` clause is needed and
 * none can be passed through `contains` anyway.
 *
 * This also puts the server back in step with `todoMatchesFilters`
 * (`src/lib/todoListState.ts`), which mirrors this predicate on the client
 * with `String.prototype.includes` and has always been literal. The two
 * disagreeing is what makes the quick-add bar's *hidden by your filters*
 * message wrong rather than merely unhelpful.
 */
export const escapeLikePattern = (term: string): string => {
  return term.replace(LIKE_METACHARACTERS, (match) => `\\${match}`);
};
