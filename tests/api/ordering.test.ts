import { afterAll, beforeAll, beforeEach, describe, expect, test, vi } from "vitest";

import {
  currentRequestHeaders,
  headersWithCookie,
  setRequestHeaders,
} from "../support/headers";

vi.mock("next/headers", () => ({
  headers: async () => currentRequestHeaders(),
}));

import { GET } from "@/app/api/todos/route";
import { prisma } from "@/lib/prisma";
import { groupTodos } from "@/lib/todoGroups";

import {
  createTestUser,
  createTodo,
  deleteTestUsers,
  type TestUser,
} from "../support/factory";
import { getRequest, readList } from "../support/request";

/**
 * `GET /api/todos` sequences by urgency (`TODO_LIST_ORDER_BY`).
 *
 * These run against real Postgres because that is where the ordering actually
 * happens — a JS comparator asserted in a unit test would be a second opinion
 * about the order, not a check of the one that ships. Two things in particular
 * are only observable here:
 *
 *  - `nulls: "last"`. Postgres sorts NULLs *high* by default, so an undated
 *    todo would otherwise lead an ascending list — the exact opposite of the
 *    rule, and invisible in any test that only ever seeds due dates.
 *  - `priority: "desc"`. The `Priority` enum is declared `low, medium, high`,
 *    so Postgres orders it by declaration and `desc` means high-first. Getting
 *    that backwards silently sorts the least urgent work to the top, and
 *    nothing else in the app would complain.
 *
 * A second user is seeded throughout with rows that would sort *first* under
 * the new rule — the most overdue, highest-priority todos in the database. If
 * the ordering change ever displaced `userId` from the `where`, these are the
 * rows that would surface, so every assertion below doubles as an isolation
 * check on the clause `docs/QA-REPORT.md` §3 guards.
 */

const EMAIL_DOMAIN = "@ordering.test";

let owner: TestUser;
let stranger: TestUser;

const DAY_MS = 24 * 60 * 60 * 1000;

/** UTC midnight `offset` days from today — how the API stores every due date. */
const dueDay = (offset: number): Date => {
  const now = new Date();
  const utcMidnight = Date.UTC(
    now.getUTCFullYear(),
    now.getUTCMonth(),
    now.getUTCDate(),
  );

  return new Date(utcMidnight + offset * DAY_MS);
};

const asOwner = () => setRequestHeaders(headersWithCookie(owner.cookie));

const listTitles = async (path = "/api/todos"): Promise<string[]> => {
  const response = await GET(getRequest(path));
  const body = await readList(response);

  expect(response.status).toBe(200);

  return body.todos.map((todo) => todo.title);
};

beforeAll(async () => {
  await deleteTestUsers(EMAIL_DOMAIN);
  owner = await createTestUser(`owner${EMAIL_DOMAIN}`);
  stranger = await createTestUser(`stranger${EMAIL_DOMAIN}`);
});

afterAll(async () => {
  await deleteTestUsers(EMAIL_DOMAIN);
});

beforeEach(async () => {
  await prisma.todo.deleteMany({
    where: { userId: { in: [owner.id, stranger.id] } },
  });

  // Would sort to the very top of a list that lost its scoping.
  await createTodo(stranger.id, {
    title: "STRANGER very overdue",
    priority: "high",
    dueAt: dueDay(-3650),
  });
  await createTodo(stranger.id, { title: "STRANGER undated", priority: "high" });

  asOwner();
});

describe("the urgency sequence", () => {
  beforeEach(async () => {
    // Seeded out of order on purpose: creation order must not survive.
    await createTodo(owner.id, { title: "no date" });
    await createTodo(owner.id, { title: "next week", dueAt: dueDay(7) });
    await createTodo(owner.id, { title: "overdue", dueAt: dueDay(-2) });
    await createTodo(owner.id, { title: "tomorrow", dueAt: dueDay(1) });
    await createTodo(owner.id, { title: "long overdue", dueAt: dueDay(-30) });
    await createTodo(owner.id, { title: "today", dueAt: dueDay(0) });
  });

  test("runs overdue, then today, then upcoming, then undated", async () => {
    expect(await listTitles()).toEqual([
      "long overdue",
      "overdue",
      "today",
      "tomorrow",
      "next week",
      "no date",
    ]);
  });

  /**
   * The property the whole design rests on: the sections the client draws are
   * cuts in this one sequence, so the server never has to know what day it is.
   */
  test("undated todos come after every dated one, not before", async () => {
    const titles = await listTitles();

    expect(titles.indexOf("no date")).toBe(titles.length - 1);
  });

  test("no other user's rows appear, however they would have sorted", async () => {
    expect(
      (await listTitles()).some((title) => title.startsWith("STRANGER")),
    ).toBe(false);
  });
});

describe("completed todos stay last", () => {
  beforeEach(async () => {
    await createTodo(owner.id, { title: "active undated" });
    await createTodo(owner.id, {
      title: "done and overdue",
      completed: true,
      dueAt: dueDay(-5),
    });
    await createTodo(owner.id, { title: "active overdue", dueAt: dueDay(-1) });
    await createTodo(owner.id, {
      title: "done and due today",
      completed: true,
      dueAt: dueDay(0),
    });
  });

  /**
   * Completion outranks the due date. A finished todo that happens to be
   * overdue must not lead the list — it is the one row on screen with nothing
   * left to do about it.
   */
  test("a completed overdue todo sorts below every active one", async () => {
    expect(await listTitles()).toEqual([
      "active overdue",
      "active undated",
      "done and overdue",
      "done and due today",
    ]);
  });

  test("completed todos are themselves ordered by due date", async () => {
    const titles = await listTitles();

    expect(titles.slice(2)).toEqual(["done and overdue", "done and due today"]);
  });
});

describe("priority breaks a tie between todos sharing a due date", () => {
  beforeEach(async () => {
    await createTodo(owner.id, { title: "low today", priority: "low", dueAt: dueDay(0) });
    await createTodo(owner.id, { title: "high today", priority: "high", dueAt: dueDay(0) });
    await createTodo(owner.id, {
      title: "medium today",
      priority: "medium",
      dueAt: dueDay(0),
    });
  });

  /**
   * The silent one. `desc` on an enum declared `low, medium, high` gives
   * high-first; declared the other way round it would give low-first and
   * nothing would look broken.
   */
  test("high comes first, low last", async () => {
    expect(await listTitles()).toEqual(["high today", "medium today", "low today"]);
  });

  /**
   * The whole design rests on one claim: the sections are cuts through the
   * server's single ordering, not a re-sort of it. Both halves are pinned
   * separately — the server's sequence above, the section membership in
   * `todoGroups.test.ts` — and nothing asserted the join, which is where a
   * regression would actually land. If grouping ever reorders within a
   * section, or a section's members are not contiguous in the server's
   * sequence, flattening the groups stops reproducing the list.
   */
  test("grouping cuts the server order without resequencing it", async () => {
    const response = await GET(getRequest("/api/todos"));
    const body = await readList(response);

    const flattened = groupTodos(body.todos).flatMap((group) => group.todos);

    expect(flattened).toEqual(body.todos);
  });

  /**
   * Priority sits *below* the date on purpose: a low-priority todo due today
   * is more urgent than a high-priority one due next month. Ranking priority
   * first would put `dueAt` back to being decoration, which is the defect this
   * work exists to remove.
   */
  test("but it never outranks the due date itself", async () => {
    await createTodo(owner.id, {
      title: "high next month",
      priority: "high",
      dueAt: dueDay(30),
    });

    const titles = await listTitles();

    expect(titles.indexOf("low today")).toBeLessThan(titles.indexOf("high next month"));
  });

  test("and it orders undated todos too", async () => {
    await prisma.todo.deleteMany({ where: { userId: owner.id } });

    await createTodo(owner.id, { title: "low", priority: "low" });
    await createTodo(owner.id, { title: "high", priority: "high" });
    await createTodo(owner.id, { title: "medium", priority: "medium" });

    expect(await listTitles()).toEqual(["high", "medium", "low"]);
  });
});

describe("creation time is the last resort", () => {
  beforeEach(async () => {
    const dueAt = dueDay(2);

    await createTodo(owner.id, {
      title: "oldest",
      dueAt,
      createdAt: new Date("2026-01-01T00:00:00.000Z"),
    });
    await createTodo(owner.id, {
      title: "newest",
      dueAt,
      createdAt: new Date("2026-03-01T00:00:00.000Z"),
    });
    await createTodo(owner.id, {
      title: "middle",
      dueAt,
      createdAt: new Date("2026-02-01T00:00:00.000Z"),
    });
  });

  /** Newest first, which is the order the list had before this change. */
  test("same date, same priority: newest first", async () => {
    expect(await listTitles()).toEqual(["newest", "middle", "oldest"]);
  });

  test("but priority still beats it", async () => {
    await createTodo(owner.id, {
      title: "old but high",
      priority: "high",
      dueAt: dueDay(2),
      createdAt: new Date("2025-01-01T00:00:00.000Z"),
    });

    expect((await listTitles())[0]).toBe("old but high");
  });
});

describe("the order survives every filter, and so does the scoping", () => {
  beforeEach(async () => {
    await createTodo(owner.id, { title: "milk undated", priority: "high" });
    await createTodo(owner.id, { title: "milk overdue", priority: "low", dueAt: dueDay(-1) });
    await createTodo(owner.id, { title: "bread today", priority: "high", dueAt: dueDay(0) });
    await createTodo(owner.id, {
      title: "milk done",
      completed: true,
      dueAt: dueDay(-9),
    });
  });

  test("status=active", async () => {
    expect(await listTitles("/api/todos?status=active")).toEqual([
      "milk overdue",
      "bread today",
      "milk undated",
    ]);
  });

  test("status=completed", async () => {
    expect(await listTitles("/api/todos?status=completed")).toEqual(["milk done"]);
  });

  test("priority=high", async () => {
    expect(await listTitles("/api/todos?priority=high")).toEqual([
      "bread today",
      "milk undated",
    ]);
  });

  test("a search still orders by urgency", async () => {
    expect(await listTitles("/api/todos?query=milk")).toEqual([
      "milk overdue",
      "milk undated",
      "milk done",
    ]);
  });

  test("a search cannot reach the other user's rows through the new order", async () => {
    // The stranger's rows are the most overdue in the table, so a lost scope
    // would put them at the top of this result rather than hide them.
    expect(await listTitles("/api/todos?query=STRANGER")).toEqual([]);
  });

  test("the counts stay the caller's own", async () => {
    const response = await GET(getRequest("/api/todos"));
    const body = await readList(response);

    expect(body.totalCount).toBe(4);
    expect(body.completedCount).toBe(1);
  });

});
