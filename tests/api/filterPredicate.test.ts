import { afterAll, beforeAll, describe, expect, test, vi } from "vitest";

import {
  currentRequestHeaders,
  headersWithCookie,
  setRequestHeaders,
} from "../support/headers";

vi.mock("next/headers", () => ({
  headers: async () => currentRequestHeaders(),
}));

import { GET } from "@/app/api/todos/route";
import type { TodoItemData, TodoListFilters } from "@/lib/todo";
import {
  PRIORITY_FILTER_VALUES,
  STATUS_FILTER_VALUES,
} from "@/lib/todo";
import { todoMatchesFilters } from "@/lib/todoListState";

import {
  createTestUser,
  createTodo,
  deleteTestUsers,
  type TestUser,
} from "../support/factory";
import { getRequest, readList } from "../support/request";

/**
 * `todoMatchesFilters` against the handler it claims to mirror.
 *
 * The quick-add bar tells the user their new todo is *hidden by your filters*,
 * and that sentence is only worth saying if it is true. Restating the three
 * clauses in a unit test cannot establish that — it asserts the predicate
 * agrees with itself. Two things can make it disagree with the list, and
 * neither is visible from `src/lib`:
 *
 *  1. **Postgres and JavaScript do not lowercase alike.** `İ` (U+0130) folds
 *     to a bare `i` under glibc, which is what `ILIKE` uses, and to `i` plus a
 *     combining dot in JavaScript. That divergence is why the toast once said
 *     "hidden" about a row sitting in the list.
 *  2. **The server's search changes.** Backlog #4 added `note` to the `OR`,
 *     at which point a todo whose note matches is returned by the handler
 *     while a title-only predicate still calls it hidden — silently, and with
 *     no test in `src/lib` able to notice. This file is what noticed: the
 *     `Call the vet` seed below carries `about milk` as its note and was
 *     already here, so widening the handler alone turned it red. It was the
 *     hypothetical this test was written for, and it behaved as advertised.
 *
 * So the property asserted here is the one that actually matters, and it is
 * deliberately **one-directional**:
 *
 * > every todo the predicate calls hidden is genuinely absent from the
 * > response.
 *
 * The converse is not asserted and must not be. `fold` deliberately folds
 * further than any collation will, so the predicate may call a row visible
 * that the database does not return — the cost of that is a plain toast
 * instead of an explanatory one, where the cost of the other direction is a
 * sentence that is a lie.
 */

const EMAIL_DOMAIN = "@filter-predicate.test";

let owner: TestUser;

const asOwner = () => setRequestHeaders(headersWithCookie(owner.cookie));

/** Chosen to exercise every clause, and the two that fold badly. */
const SEEDS = [
  { title: "Buy milk", priority: "high" as const },
  { title: "Buy oat MILK", priority: "low" as const },
  { title: "Call the vet", priority: "medium" as const, note: "about milk" },
  { title: "Done already", priority: "medium" as const, completed: true },
  { title: "Finished milk run", priority: "low" as const, completed: true },
  // U+0130. Lowercases to `i` in Postgres and to `i` + U+0307 in JavaScript.
  { title: "İstanbul trip", priority: "medium" as const },
  // Combining acute, for the accent-folding direction.
  { title: "Café receipts", priority: "high" as const },
];

const QUERIES = ["", "milk", "MILK", "istanbul", "İstanbul", "cafe", "zzz"];

const listWith = async (filters: TodoListFilters): Promise<TodoItemData[]> => {
  const params = new URLSearchParams({
    status: filters.status,
    priority: filters.priority,
    query: filters.query,
  });
  const response = await GET(getRequest(`/api/todos?${params.toString()}`));

  expect(response.status).toBe(200);

  return (await readList(response)).todos;
};

beforeAll(async () => {
  await deleteTestUsers(EMAIL_DOMAIN);
  owner = await createTestUser(`owner${EMAIL_DOMAIN}`);
  asOwner();

  for (const seed of SEEDS) {
    await createTodo(owner.id, seed);
  }
});

afterAll(async () => {
  await deleteTestUsers(EMAIL_DOMAIN);
});

describe("todoMatchesFilters against the real GET /api/todos", () => {
  test("never calls a todo hidden that the handler actually returns", async () => {
    // Everything the account has, as the client would hold it.
    const everything = await listWith({
      status: "all",
      priority: "all",
      query: "",
    });

    expect(everything).toHaveLength(SEEDS.length);

    for (const status of STATUS_FILTER_VALUES) {
      for (const priority of PRIORITY_FILTER_VALUES) {
        for (const query of QUERIES) {
          const filters: TodoListFilters = { status, priority, query };
          const visibleIds = new Set(
            (await listWith(filters)).map((todo) => todo.id),
          );

          for (const todo of everything) {
            if (todoMatchesFilters(todo, filters)) continue;

            expect(
              visibleIds.has(todo.id),
              `predicate called “${todo.title}” hidden under ` +
                `${status}/${priority}/“${query}”, but the handler returned it`,
            ).toBe(false);
          }
        }
      }
    }
  });

  /**
   * The specific row the review found. Whichever way this Postgres folds
   * `İ`, the predicate must not be the one claiming it is hidden — that is
   * what `fold` in `todoListState.ts` exists for.
   */
  test("does not call the İstanbul row hidden under an ASCII search", async () => {
    const filters: TodoListFilters = {
      status: "all",
      priority: "all",
      query: "istanbul",
    };
    const everything = await listWith({
      status: "all",
      priority: "all",
      query: "",
    });
    const istanbul = everything.find((todo) =>
      todo.title.startsWith("İstanbul"),
    );

    expect(istanbul).toBeDefined();
    expect(todoMatchesFilters(istanbul!, filters)).toBe(true);
  });
});
