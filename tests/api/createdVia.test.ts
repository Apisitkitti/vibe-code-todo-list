import { afterAll, beforeAll, describe, expect, test, vi } from "vitest";

import {
  currentRequestHeaders,
  headersWithCookie,
  setRequestHeaders,
} from "../support/headers";

vi.mock("next/headers", () => ({
  headers: async () => currentRequestHeaders(),
}));

import { POST } from "@/app/api/todos/route";
import { prisma } from "@/lib/prisma";
import type { TodoItemData } from "@/lib/todo";

import {
  createTestUser,
  createTodo,
  deleteTestUsers,
  readTodo,
  type TestUser,
} from "../support/factory";
import { jsonRequest, readError, readTodoBody } from "../support/request";

/**
 * `createdVia` — which capture surface a todo was created through
 * (PM backlog #5).
 *
 * Analytics-facing, so the assertions here are about the **column**, not about
 * anything on screen: the value has no UI, is not in the response body, and
 * cannot be changed after the fact. That makes it exactly the kind of field
 * that rots silently — nothing a user does will ever reveal that it stopped
 * being written, or that it started being written wrongly, which is the whole
 * argument for pinning it at this level.
 *
 * The three cases that matter are the three answers a create can give: it said
 * which surface, it did not say, or it said something that is not a surface.
 * They get three different outcomes on purpose.
 */

const EMAIL_DOMAIN = "@created-via.test";

let owner: TestUser;

const asOwner = () => setRequestHeaders(headersWithCookie(owner.cookie));

const createBody = (title: string, extra: Record<string, unknown> = {}) => ({
  title,
  priority: "medium",
  dueAt: "",
  ...extra,
});

const postTodo = (title: string, extra: Record<string, unknown> = {}) =>
  POST(jsonRequest("/api/todos", "POST", createBody(title, extra)));

beforeAll(async () => {
  await deleteTestUsers(EMAIL_DOMAIN);
  owner = await createTestUser(`owner${EMAIL_DOMAIN}`);
  asOwner();
});

afterAll(async () => {
  await deleteTestUsers(EMAIL_DOMAIN);
});

describe("POST /api/todos records the capture surface", () => {
  test("stores `quickAdd` when the bar created it", async () => {
    const response = await postTodo("From the bar", { createdVia: "quickAdd" });

    expect(response.status).toBe(201);

    const saved = await readTodoBody(response);

    expect((await readTodo(saved.id))?.createdVia).toBe("quickAdd");
  });

  test("stores `form` when the modal created it", async () => {
    const response = await postTodo("From the form", { createdVia: "form" });

    expect(response.status).toBe(201);

    const saved = await readTodoBody(response);

    expect((await readTodo(saved.id))?.createdVia).toBe("form");
  });

  /**
   * A create that does not participate still succeeds. This is a measurement,
   * and a measurement is never a good enough reason to refuse to save
   * somebody's todo — so the column records "not said" rather than the route
   * recording a 400.
   */
  test("stores nothing at all when the caller does not say", async () => {
    const response = await postTodo("Said nothing");

    expect(response.status).toBe(201);

    const saved = await readTodoBody(response);

    expect((await readTodo(saved.id))?.createdVia).toBeNull();
  });

  /**
   * Saying something that is not a surface is a different mistake from saying
   * nothing, and gets a different answer. Silently dropping it would be the
   * half-applied write `docs/CONVENTIONS.md` rules out — a 201 that looks like
   * it recorded what it was told and did not.
   */
  test("refuses a value that is not a capture surface, and writes no row", async () => {
    const before = await prisma.todo.count({ where: { userId: owner.id } });
    const response = await postTodo("Telepathy", { createdVia: "telepathy" });

    expect(response.status).toBe(400);
    expect((await readError(response)).code).toBe("BAD_REQUEST");
    expect(await prisma.todo.count({ where: { userId: owner.id } })).toBe(before);
  });

  /**
   * Not user-facing, and the response body is the boundary that says so. A
   * field that leaks into it becomes something the client can read, then
   * something the client depends on, and then not analytics any more.
   */
  test("keeps the value out of the response body", async () => {
    const response = await postTodo("Not in the body", { createdVia: "form" });
    const body: TodoItemData = await readTodoBody(response);

    expect(body).not.toHaveProperty("createdVia");
  });

  /**
   * The migration's half of the promise. Rows written without going through
   * the route — which is what every row in the table was before this column
   * existed — carry no value, because the column has no `@default`. A default
   * would have backfilled the whole table with an answer nobody measured, and
   * the analytics this exists for would read it as data.
   */
  test("a row that predates the distinction says nothing rather than guessing", async () => {
    const row = await createTodo(owner.id, { title: "Predates the column" });

    expect((await readTodo(row.id))?.createdVia).toBeNull();
  });
});
