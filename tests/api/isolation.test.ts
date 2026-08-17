import {
  afterAll,
  beforeAll,
  beforeEach,
  describe,
  expect,
  test,
  vi,
} from "vitest";

import {
  clearRequestHeaders,
  currentRequestHeaders,
  headersWithCookie,
  setRequestHeaders,
} from "../support/headers";

vi.mock("next/headers", () => ({
  headers: async () => currentRequestHeaders(),
}));

import { DELETE as deleteTodo, PATCH as patchFields } from "@/app/api/todos/[id]/route";
import { PATCH as patchStatus } from "@/app/api/todos/[id]/status/route";
import { GET, POST } from "@/app/api/todos/route";
import { prisma } from "@/lib/prisma";

import {
  createTestUser,
  createTodo,
  deleteTestUsers,
  readTodo,
  type TestUser,
} from "../support/factory";
import {
  deleteRequest,
  getRequest,
  idContext,
  jsonRequest,
  readError,
  readList,
  readTodoBody,
} from "../support/request";

/**
 * The cross-user isolation matrix from `docs/QA-REPORT.md` §3.1, as tests.
 *
 * Until now this guarantee was re-proved by a human reading a diff and judging
 * it safe. Everything here is the machine version of that judgement: two real
 * users, real cookies, real session lookups, and B reaching for A's rows
 * through every endpoint that exists.
 *
 * Two rules the assertions follow throughout:
 *
 *  - A refusal is checked by its *effect* wherever a write was attempted, not
 *    only by its status code. A 404 that still wrote the row passes a
 *    status-only test, and on these routes that is a live possibility rather
 *    than a theoretical one: the 404 is produced by a scoped re-read that runs
 *    *after* the write, so losing the scope on the write alone changes nothing
 *    a caller can see.
 *  - A refusal must never be a 500. A crash that happens to deny access is not
 *    the same guarantee, and it leaks that something was there to crash on.
 *
 * Two groups deliberately assert less. `GET` cases check the returned rows
 * only, because a read has no effect to re-read. The signed-out `GET` and the
 * forged-cookie case check the status alone, for the same reason.
 */

const EMAIL_DOMAIN = "@isolation.test";

let userA: TestUser;
let userB: TestUser;

/** A's row, recreated before each test so one test cannot mask another. */
let todoOfA: { id: string; title: string; completed: boolean };
let todoOfB: { id: string };

const A_TITLE = "Buy milk";
const A_NOTE = "Semi-skimmed, from the corner shop";

/**
 * B's own row. Its note shares no word with A's title or note, so a search
 * that finds it says something about the note clause and nothing about scope,
 * and vice versa.
 */
const B_TITLE = "B's own errand";
const B_NOTE = "Ring the caterer before Friday";

const NONEXISTENT_ID = "totally-made-up-id-xyz";

const asUser = (user: TestUser) =>
  setRequestHeaders(headersWithCookie(user.cookie));

const validBody = (title: string) => ({ title, priority: "low", dueAt: "" });

beforeAll(async () => {
  await deleteTestUsers(EMAIL_DOMAIN);
  userA = await createTestUser(`a${EMAIL_DOMAIN}`);
  userB = await createTestUser(`b${EMAIL_DOMAIN}`);
});

afterAll(async () => {
  await deleteTestUsers(EMAIL_DOMAIN);
});

beforeEach(async () => {
  await prisma.todo.deleteMany({
    where: { userId: { in: [userA.id, userB.id] } },
  });

  todoOfA = await createTodo(userA.id, {
    title: A_TITLE,
    note: A_NOTE,
    priority: "high",
  });
  todoOfB = await createTodo(userB.id, {
    title: B_TITLE,
    // B's own note, so the note clause can be shown to *work* and not only to
    // be scoped — see the second control in "search stays inside the caller's
    // own rows".
    note: B_NOTE,
  });

  asUser(userB);
});

describe("B cannot reach A's todo", () => {
  test("GET /api/todos returns only B's own rows", async () => {
    const response = await GET(getRequest("/api/todos"));
    const body = await readList(response);

    expect(response.status).toBe(200);
    expect(body.todos.map((todo) => todo.id)).toEqual([todoOfB.id]);
    expect(body.todos.some((todo) => todo.title === A_TITLE)).toBe(false);
    // The counts are a second way A's rows could leak — as a number.
    expect(body.totalCount).toBe(1);
  });

  test("PATCH /api/todos/[id] is a 404 and writes nothing", async () => {
    const response = await patchFields(
      jsonRequest(`/api/todos/${todoOfA.id}`, "PATCH", validBody("HACKED BY B")),
      idContext(todoOfA.id),
    );

    expect(response.status).toBe(404);
    expect((await readError(response)).code).toBe("NOT_FOUND");

    const after = await readTodo(todoOfA.id);

    expect(after?.title).toBe(A_TITLE);
    expect(after?.note).toBe(A_NOTE);
    expect(after?.priority).toBe("high");
  });

  test("PATCH /api/todos/[id]/status is a 404 and does not toggle", async () => {
    const response = await patchStatus(
      jsonRequest(`/api/todos/${todoOfA.id}/status`, "PATCH", {
        completed: true,
      }),
      idContext(todoOfA.id),
    );

    expect(response.status).toBe(404);
    expect((await readError(response)).code).toBe("NOT_FOUND");
    expect((await readTodo(todoOfA.id))?.completed).toBe(false);
  });

  test("DELETE /api/todos/[id] is a 404 and the row survives", async () => {
    const response = await deleteTodo(
      deleteRequest(`/api/todos/${todoOfA.id}`),
      idContext(todoOfA.id),
    );

    expect(response.status).toBe(404);
    expect((await readError(response)).code).toBe("NOT_FOUND");
    expect(await readTodo(todoOfA.id)).not.toBeNull();
  });

  test("no refusal is ever a 500", async () => {
    const responses = await Promise.all([
      patchFields(
        jsonRequest(`/api/todos/${todoOfA.id}`, "PATCH", validBody("x")),
        idContext(todoOfA.id),
      ),
      patchStatus(
        jsonRequest(`/api/todos/${todoOfA.id}/status`, "PATCH", {
          completed: true,
        }),
        idContext(todoOfA.id),
      ),
      deleteTodo(
        deleteRequest(`/api/todos/${todoOfA.id}`),
        idContext(todoOfA.id),
      ),
    ]);

    expect(responses.map((response) => response.status)).toEqual([404, 404, 404]);
  });
});

/**
 * If a foreign id answered differently from an unused one — a different
 * message, a different status, even a different latency class — the API would
 * confirm that somebody else's todo exists. `docs/PRD.md` NFR-01.
 */
describe("a foreign id is indistinguishable from a nonexistent one", () => {
  test("PATCH /api/todos/[id] answers identically", async () => {
    const foreign = await patchFields(
      jsonRequest(`/api/todos/${todoOfA.id}`, "PATCH", validBody("x")),
      idContext(todoOfA.id),
    );
    const missing = await patchFields(
      jsonRequest(`/api/todos/${NONEXISTENT_ID}`, "PATCH", validBody("x")),
      idContext(NONEXISTENT_ID),
    );

    expect(foreign.status).toBe(missing.status);
    expect(await readError(foreign)).toEqual(await readError(missing));
    // Matching each other is not enough on its own: with the scope dropped
    // from the `updateMany`, both calls still answer 404 — the 404 comes from
    // the scoped re-read that follows — while the foreign one has already
    // rewritten the row.
    expect((await readTodo(todoOfA.id))?.title).toBe(A_TITLE);
  });

  test("PATCH /api/todos/[id]/status answers identically", async () => {
    const foreign = await patchStatus(
      jsonRequest(`/api/todos/${todoOfA.id}/status`, "PATCH", {
        completed: true,
      }),
      idContext(todoOfA.id),
    );
    const missing = await patchStatus(
      jsonRequest(`/api/todos/${NONEXISTENT_ID}/status`, "PATCH", {
        completed: true,
      }),
      idContext(NONEXISTENT_ID),
    );

    expect(foreign.status).toBe(missing.status);
    expect(await readError(foreign)).toEqual(await readError(missing));
    expect((await readTodo(todoOfA.id))?.completed).toBe(false);
  });

  test("DELETE /api/todos/[id] answers identically", async () => {
    const foreign = await deleteTodo(
      deleteRequest(`/api/todos/${todoOfA.id}`),
      idContext(todoOfA.id),
    );
    const missing = await deleteTodo(
      deleteRequest(`/api/todos/${NONEXISTENT_ID}`),
      idContext(NONEXISTENT_ID),
    );

    expect(foreign.status).toBe(missing.status);
    expect(await readError(foreign)).toEqual(await readError(missing));
    expect(await readTodo(todoOfA.id)).not.toBeNull();
  });
});

/**
 * The highest-value case on the list. The "search notes too" change (backlog
 * #4) is a one-line edit to this `where` clause, and a reviewer would
 * reasonably classify it as unrelated to authorization — which is exactly how
 * the user scope gets dropped from it. Moving to an `OR` is the specific
 * hazard: written at the wrong nesting level, `{ userId }` stops being ANDed
 * with the search and every user's rows match.
 *
 * **Two controls, not one, now that two fields are searched.** A refusal test
 * only means something if the search it is running could have succeeded. The
 * title control alone was enough while `title` was the only clause; with
 * `note` in the predicate, "a term inside A's note matches nothing" would pass
 * just as happily against a `where` whose note clause had been dropped
 * altogether. So B's own note is searched too, and the pair separates the two
 * failure modes: a broken clause fails the control, a broken scope fails the
 * refusal.
 */
describe("search stays inside the caller's own rows", () => {
  test("A's exact title matches nothing for B", async () => {
    const response = await GET(
      getRequest(`/api/todos?query=${encodeURIComponent(A_TITLE)}`),
    );
    const body = await readList(response);

    expect(response.status).toBe(200);
    expect(body.todos).toEqual([]);
  });

  test("a case-insensitive match on A's title still matches nothing", async () => {
    const response = await GET(getRequest("/api/todos?query=buy%20MILK"));

    expect((await readList(response)).todos).toEqual([]);
  });

  test("a term inside A's note matches nothing", async () => {
    const response = await GET(getRequest("/api/todos?query=semi-skimmed"));

    expect((await readList(response)).todos).toEqual([]);
  });

  /**
   * The control. Without it, a search that silently returned nothing at all
   * would satisfy every assertion above and prove nothing whatsoever.
   */
  test("B's own title is still found, so the empty results above mean something", async () => {
    const response = await GET(getRequest("/api/todos?query=errand"));
    const body = await readList(response);

    expect(body.todos.map((todo) => todo.id)).toEqual([todoOfB.id]);
  });

  /**
   * The second control, and the one that makes "a term inside A's note matches
   * nothing" a statement about *scope*. `caterer` appears in exactly one note
   * in the database and in no title anywhere, so this can only pass through
   * the clause backlog #4 added.
   */
  test("B's own note is found, so the note clause is genuinely exercised", async () => {
    const response = await GET(getRequest("/api/todos?query=caterer"));
    const body = await readList(response);

    expect(response.status).toBe(200);
    expect(body.todos.map((todo) => todo.id)).toEqual([todoOfB.id]);
  });

  /** Case-insensitively, the same as the title clause it joins. */
  test("a note match is case-insensitive, like the title match beside it", async () => {
    const response = await GET(getRequest("/api/todos?query=CATERER"));

    expect((await readList(response)).todos.map((todo) => todo.id)).toEqual([
      todoOfB.id,
    ]);
  });
});

describe("signed out, every endpoint refuses and writes nothing", () => {
  beforeEach(() => {
    clearRequestHeaders();
  });

  test("GET /api/todos is a 401", async () => {
    const response = await GET(getRequest("/api/todos"));

    expect(response.status).toBe(401);
    expect((await readError(response)).code).toBe("UNAUTHORIZED");
  });

  test("POST /api/todos is a 401 and creates nothing", async () => {
    const before = await prisma.todo.count();

    const response = await POST(
      jsonRequest("/api/todos", "POST", validBody("Sneaked in")),
    );

    expect(response.status).toBe(401);
    expect((await readError(response)).code).toBe("UNAUTHORIZED");
    expect(await prisma.todo.count()).toBe(before);
  });

  test("PATCH /api/todos/[id] is a 401 and the row is untouched", async () => {
    const response = await patchFields(
      jsonRequest(`/api/todos/${todoOfA.id}`, "PATCH", validBody("Rewritten")),
      idContext(todoOfA.id),
    );

    expect(response.status).toBe(401);
    expect((await readTodo(todoOfA.id))?.title).toBe(A_TITLE);
  });

  test("PATCH /api/todos/[id]/status is a 401 and nothing toggles", async () => {
    const response = await patchStatus(
      jsonRequest(`/api/todos/${todoOfA.id}/status`, "PATCH", {
        completed: true,
      }),
      idContext(todoOfA.id),
    );

    expect(response.status).toBe(401);
    expect((await readTodo(todoOfA.id))?.completed).toBe(false);
  });

  test("DELETE /api/todos/[id] is a 401 and the row survives", async () => {
    const response = await deleteTodo(
      deleteRequest(`/api/todos/${todoOfA.id}`),
      idContext(todoOfA.id),
    );

    expect(response.status).toBe(401);
    expect(await readTodo(todoOfA.id)).not.toBeNull();
  });

  test("an expired or forged cookie is refused like no cookie at all", async () => {
    setRequestHeaders(
      headersWithCookie("better-auth.session_token=forged.signature"),
    );

    const response = await GET(getRequest("/api/todos"));

    expect(response.status).toBe(401);
  });
});

/**
 * Ownership comes from the session. The form schema is not `.strict()`, so a
 * stray `userId` is dropped in parsing rather than rejected — this pins the
 * behaviour that matters (whose row it becomes) instead of how it is ignored.
 */
describe("a spoofed userId in the body is ignored", () => {
  test("POST /api/todos files the todo under the session user", async () => {
    const response = await POST(
      jsonRequest("/api/todos", "POST", {
        ...validBody("Filed by B"),
        userId: userA.id,
      }),
    );

    expect(response.status).toBe(201);

    const created = await readTodo((await readTodoBody(response)).id);

    expect(created?.userId).toBe(userB.id);
    expect(created?.userId).not.toBe(userA.id);
  });

  test("the spoofed-to user's list is unaffected", async () => {
    await POST(
      jsonRequest("/api/todos", "POST", {
        ...validBody("Filed by B"),
        userId: userA.id,
      }),
    );

    asUser(userA);

    const body = await readList(await GET(getRequest("/api/todos")));

    expect(body.todos.map((todo) => todo.title)).toEqual([A_TITLE]);
  });
});
