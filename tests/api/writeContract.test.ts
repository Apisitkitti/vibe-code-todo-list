import {
  afterAll,
  beforeAll,
  beforeEach,
  describe,
  expect,
  test,
  vi,
} from "vitest";

import { currentRequestHeaders, headersWithCookie, setRequestHeaders } from "../support/headers";

vi.mock("next/headers", () => ({
  headers: async () => currentRequestHeaders(),
}));

import { PATCH as patchDue } from "@/app/api/todos/[id]/due/route";
import { PATCH as patchFields } from "@/app/api/todos/[id]/route";
import { PATCH as patchStatus } from "@/app/api/todos/[id]/status/route";
import { POST } from "@/app/api/todos/route";
import { prisma } from "@/lib/prisma";

import {
  createTestUser,
  createTodo,
  deleteTestUsers,
  readTodo,
  type TestUser,
} from "../support/factory";
import { idContext, jsonRequest, readError, readTodoBody } from "../support/request";

/**
 * The rule that completion is changed only by `/status`, never by a save.
 *
 * This is review m-5 / QA DEF-06: a body mixing `completed` with form fields
 * used to return a 200 having applied half of it, so the client believed a
 * toggle had happened that never did. It took two review rounds to settle, and
 * the whole of it lives in two easily-deleted places — `mentionsCompleted` on
 * the write routes, and `.strict()` on the status schema. Neither had a test.
 *
 * Every rejection below is checked by its effect as well as its status: a 400
 * that still wrote half the body would be the original bug wearing a different
 * status code.
 */

const EMAIL_DOMAIN = "@contract.test";

let user: TestUser;
let todo: { id: string };

const ORIGINAL_TITLE = "Original title";
const ORIGINAL_NOTE = "Original note";

beforeAll(async () => {
  await deleteTestUsers(EMAIL_DOMAIN);
  user = await createTestUser(`writer${EMAIL_DOMAIN}`);
});

afterAll(async () => {
  await deleteTestUsers(EMAIL_DOMAIN);
});

beforeEach(async () => {
  await prisma.todo.deleteMany({ where: { userId: user.id } });

  todo = await createTodo(user.id, {
    title: ORIGINAL_TITLE,
    note: ORIGINAL_NOTE,
    priority: "low",
    completed: false,
  });

  setRequestHeaders(headersWithCookie(user.cookie));
});

const formBody = (title: string) => ({ title, priority: "high", dueAt: "" });

describe("POST /api/todos refuses a body carrying completed", () => {
  test("is a 400 rather than a 201 that ignored half the request", async () => {
    const response = await POST(
      jsonRequest("/api/todos", "POST", {
        ...formBody("Already done"),
        completed: true,
      }),
    );

    expect(response.status).toBe(400);

    const body = await readError(response);

    expect(body.code).toBe("BAD_REQUEST");
    expect(body.message).toBe(
      "Completion is changed by the checkbox, not by saving the todo.",
    );
  });

  test("creates nothing at all", async () => {
    const before = await prisma.todo.count({ where: { userId: user.id } });

    await POST(
      jsonRequest("/api/todos", "POST", {
        ...formBody("Already done"),
        completed: true,
      }),
    );

    expect(await prisma.todo.count({ where: { userId: user.id } })).toBe(before);
  });

  /** `completed: false` is still completion arriving on the wrong route. */
  test("rejects it even when the value is false", async () => {
    const response = await POST(
      jsonRequest("/api/todos", "POST", {
        ...formBody("Not done"),
        completed: false,
      }),
    );

    expect(response.status).toBe(400);
  });

  test("a body with no completed key is still accepted", async () => {
    const response = await POST(
      jsonRequest("/api/todos", "POST", formBody("Perfectly ordinary")),
    );

    expect(response.status).toBe(201);
    expect((await readTodoBody(response)).completed).toBe(false);
  });
});

describe("PATCH /api/todos/[id] refuses a body carrying completed", () => {
  const mixedBody = {
    title: "Renamed and completed",
    priority: "high",
    dueAt: "",
    completed: true,
  };

  test("is a 400 with the wording that names the checkbox", async () => {
    const response = await patchFields(
      jsonRequest(`/api/todos/${todo.id}`, "PATCH", mixedBody),
      idContext(todo.id),
    );

    expect(response.status).toBe(400);
    expect((await readError(response)).message).toBe(
      "Completion is changed by the checkbox, not by saving the todo.",
    );
  });

  /**
   * The heart of DEF-06. The dangerous outcome was never the status code — it
   * was the save going through with the completion quietly dropped.
   */
  test("writes neither the fields nor the completion", async () => {
    await patchFields(
      jsonRequest(`/api/todos/${todo.id}`, "PATCH", mixedBody),
      idContext(todo.id),
    );

    const after = await readTodo(todo.id);

    expect(after?.title).toBe(ORIGINAL_TITLE);
    expect(after?.note).toBe(ORIGINAL_NOTE);
    expect(after?.priority).toBe("low");
    expect(after?.completed).toBe(false);
  });

  test("rejected before validation, so a bad title cannot mask it", async () => {
    const response = await patchFields(
      jsonRequest(`/api/todos/${todo.id}`, "PATCH", {
        ...mixedBody,
        title: "",
      }),
      idContext(todo.id),
    );

    expect(response.status).toBe(400);
    expect((await readError(response)).message).toBe(
      "Completion is changed by the checkbox, not by saving the todo.",
    );
  });

  test("the same body without completed saves normally", async () => {
    const response = await patchFields(
      jsonRequest(`/api/todos/${todo.id}`, "PATCH", formBody("Renamed only")),
      idContext(todo.id),
    );

    expect(response.status).toBe(200);
    expect((await readTodo(todo.id))?.title).toBe("Renamed only");
  });
});

/**
 * `.strict()` on the status schema. Without it an extra key is silently
 * dropped, which is the same silent half-application from the other direction:
 * the caller's title change vanishes and they are told everything went fine.
 */
describe("PATCH /api/todos/[id]/status takes completion and nothing else", () => {
  const STATUS_ONLY_MESSAGE =
    "Only completion can be changed here. Save the todo's other fields separately.";

  test("rejects a body that also carries a title", async () => {
    const response = await patchStatus(
      jsonRequest(`/api/todos/${todo.id}/status`, "PATCH", {
        completed: true,
        title: "Sneaked in",
      }),
      idContext(todo.id),
    );

    expect(response.status).toBe(400);
    expect((await readError(response)).message).toBe(STATUS_ONLY_MESSAGE);
  });

  test("toggles nothing when it rejects", async () => {
    await patchStatus(
      jsonRequest(`/api/todos/${todo.id}/status`, "PATCH", {
        completed: true,
        title: "Sneaked in",
      }),
      idContext(todo.id),
    );

    const after = await readTodo(todo.id);

    expect(after?.completed).toBe(false);
    expect(after?.title).toBe(ORIGINAL_TITLE);
  });

  test("rejects any unknown key, even a harmless-looking one", async () => {
    const response = await patchStatus(
      jsonRequest(`/api/todos/${todo.id}/status`, "PATCH", {
        completed: true,
        updatedAt: "2026-08-16",
      }),
      idContext(todo.id),
    );

    expect(response.status).toBe(400);
    expect((await readError(response)).message).toBe(STATUS_ONLY_MESSAGE);
  });

  /**
   * A different mistake deserves a different answer: telling someone who sent
   * only `completed` that the route takes only `completed` is no help at all.
   */
  test("a non-boolean completed gets the type message, not the extra-key one", async () => {
    const response = await patchStatus(
      jsonRequest(`/api/todos/${todo.id}/status`, "PATCH", {
        completed: "yes",
      }),
      idContext(todo.id),
    );

    expect(response.status).toBe(400);
    expect((await readError(response)).message).toBe(
      "Completion must be true or false.",
    );
  });

  test("a missing completed gets the type message", async () => {
    const response = await patchStatus(
      jsonRequest(`/api/todos/${todo.id}/status`, "PATCH", {}),
      idContext(todo.id),
    );

    expect(response.status).toBe(400);
    expect((await readError(response)).message).toBe(
      "Completion must be true or false.",
    );
  });

  test("a lone completed is accepted and does toggle", async () => {
    const response = await patchStatus(
      jsonRequest(`/api/todos/${todo.id}/status`, "PATCH", { completed: true }),
      idContext(todo.id),
    );

    expect(response.status).toBe(200);
    expect((await readTodoBody(response)).completed).toBe(true);
    expect((await readTodo(todo.id))?.completed).toBe(true);
  });

  test("and can toggle back", async () => {
    await patchStatus(
      jsonRequest(`/api/todos/${todo.id}/status`, "PATCH", { completed: true }),
      idContext(todo.id),
    );
    await patchStatus(
      jsonRequest(`/api/todos/${todo.id}/status`, "PATCH", { completed: false }),
      idContext(todo.id),
    );

    expect((await readTodo(todo.id))?.completed).toBe(false);
  });
});

/**
 * `.strict()` on the due-date schema, and the same argument that settled the
 * status route: an extra key silently dropped is a half-applied write reported
 * as a success. A reschedule from the row must not be able to carry a field
 * edit (`docs/PM-PROPOSAL.md` §3 #5), and this is the only thing enforcing it.
 *
 * Every rejection is checked by its effect as well as its status, because a
 * 400 that still moved the date would be the original defect wearing a
 * different status code.
 */
describe("PATCH /api/todos/[id]/due takes a due date and nothing else", () => {
  const DUE_BODY_ONLY_MESSAGE =
    "Only the due date can be changed here. Save the todo's other fields separately.";
  const DUE_TYPE_MESSAGE =
    "A due date must be a YYYY-MM-DD date, or null to clear it.";
  const DUE_DATE_INVALID_MESSAGE = "Enter a valid date.";

  const dueRequest = (body: unknown) =>
    jsonRequest(`/api/todos/${todo.id}/due`, "PATCH", body);

  test("a lone dueAt is accepted and is stored at UTC midnight", async () => {
    const response = await patchDue(
      dueRequest({ dueAt: "2026-08-23" }),
      idContext(todo.id),
    );

    expect(response.status).toBe(200);
    expect((await readTodoBody(response)).dueAt).toBe("2026-08-23T00:00:00.000Z");
    expect((await readTodo(todo.id))?.dueAt?.toISOString()).toBe(
      "2026-08-23T00:00:00.000Z",
    );
  });

  test("null clears the due date", async () => {
    await patchDue(dueRequest({ dueAt: "2026-08-23" }), idContext(todo.id));

    const response = await patchDue(dueRequest({ dueAt: null }), idContext(todo.id));

    expect(response.status).toBe(200);
    expect((await readTodoBody(response)).dueAt).toBeNull();
    expect((await readTodo(todo.id))?.dueAt).toBeNull();
  });

  test("it touches nothing but the date", async () => {
    await patchDue(dueRequest({ dueAt: "2026-08-23" }), idContext(todo.id));

    const after = await readTodo(todo.id);

    expect(after?.title).toBe(ORIGINAL_TITLE);
    expect(after?.note).toBe(ORIGINAL_NOTE);
    expect(after?.priority).toBe("low");
    expect(after?.completed).toBe(false);
  });

  test("rejects a body that also carries a title", async () => {
    const response = await patchDue(
      dueRequest({ dueAt: "2026-08-23", title: "Sneaked in" }),
      idContext(todo.id),
    );

    expect(response.status).toBe(400);
    expect((await readError(response)).message).toBe(DUE_BODY_ONLY_MESSAGE);
  });

  test("and writes neither the title nor the date when it rejects", async () => {
    await patchDue(
      dueRequest({ dueAt: "2026-08-23", title: "Sneaked in" }),
      idContext(todo.id),
    );

    const after = await readTodo(todo.id);

    expect(after?.title).toBe(ORIGINAL_TITLE);
    expect(after?.dueAt).toBeNull();
  });

  /** Completion has its own route too; this one must not become a second door. */
  test("rejects a body that also carries completed", async () => {
    const response = await patchDue(
      dueRequest({ dueAt: "2026-08-23", completed: true }),
      idContext(todo.id),
    );

    expect(response.status).toBe(400);
    expect((await readError(response)).message).toBe(DUE_BODY_ONLY_MESSAGE);
    expect((await readTodo(todo.id))?.completed).toBe(false);
  });

  test("rejects any unknown key, even a harmless-looking one", async () => {
    const response = await patchDue(
      dueRequest({ dueAt: "2026-08-23", updatedAt: "2026-08-16" }),
      idContext(todo.id),
    );

    expect(response.status).toBe(400);
    expect((await readError(response)).message).toBe(DUE_BODY_ONLY_MESSAGE);
  });

  /** A different mistake deserves a different answer, as on `/status`. */
  test.each([
    ["a number", 20260823],
    ["a boolean", false],
    ["an object", { year: 2026 }],
  ])("a dueAt that is %s gets the type message", async (_label, value) => {
    const response = await patchDue(
      dueRequest({ dueAt: value }),
      idContext(todo.id),
    );

    expect(response.status).toBe(400);
    expect((await readError(response)).message).toBe(DUE_TYPE_MESSAGE);
  });

  test("a missing dueAt gets the type message", async () => {
    const response = await patchDue(dueRequest({}), idContext(todo.id));

    expect(response.status).toBe(400);
    expect((await readError(response)).message).toBe(DUE_TYPE_MESSAGE);
  });

  /**
   * Strict parsing, the same as everywhere else: `2026-02-31` is refused rather
   * than rolled forward into March, so nobody is silently given a date they did
   * not ask for.
   */
  test.each([
    ["a day that does not exist in that month", "2026-02-31"],
    ["a month above twelve", "2026-13-01"],
    ["a full ISO timestamp", "2026-08-23T00:00:00.000Z"],
    ["a slash-separated date", "2026/08/23"],
    ["free text", "next tuesday"],
  ])("refuses %s and writes nothing", async (_label, value) => {
    const response = await patchDue(
      dueRequest({ dueAt: value }),
      idContext(todo.id),
    );

    expect(response.status).toBe(400);
    expect((await readError(response)).message).toBe(DUE_DATE_INVALID_MESSAGE);
    expect((await readTodo(todo.id))?.dueAt).toBeNull();
  });

  /**
   * Clearing is spelled `null` on this route and only `null`. The form schema
   * uses `""` for the same thing, because a cleared text field produces one —
   * accepting it here as a second spelling would let a caller clear a date
   * while believing it had sent one.
   */
  test.each([["an empty string", ""], ["whitespace", "   "]])(
    "refuses %s rather than treating it as a clear",
    async (_label, value) => {
      await patchDue(dueRequest({ dueAt: "2026-08-23" }), idContext(todo.id));

      const response = await patchDue(
        dueRequest({ dueAt: value }),
        idContext(todo.id),
      );

      expect(response.status).toBe(400);
      expect((await readError(response)).message).toBe(DUE_DATE_INVALID_MESSAGE);
      // Still the date it had: a refused clear must not clear.
      expect((await readTodo(todo.id))?.dueAt?.toISOString()).toBe(
        "2026-08-23T00:00:00.000Z",
      );
    },
  );

  /** Undo is an ordinary reschedule: the previous value, written back. */
  test("writing the previous value back restores it exactly", async () => {
    await patchDue(dueRequest({ dueAt: "2026-08-16" }), idContext(todo.id));
    await patchDue(dueRequest({ dueAt: "2026-08-23" }), idContext(todo.id));
    await patchDue(dueRequest({ dueAt: "2026-08-16" }), idContext(todo.id));

    expect((await readTodo(todo.id))?.dueAt?.toISOString()).toBe(
      "2026-08-16T00:00:00.000Z",
    );
  });
});

describe("a body that is not usable JSON", () => {
  test("POST answers 400 rather than throwing", async () => {
    const request = new Request("http://localhost:3000/api/todos", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: "{not json",
    });

    const response = await POST(request as never);

    expect(response.status).toBe(400);
  });

  test("PATCH /due answers 400 rather than throwing", async () => {
    const request = new Request(
      `http://localhost:3000/api/todos/${todo.id}/due`,
      {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: "{not json",
      },
    );

    const response = await patchDue(request as never, idContext(todo.id));

    expect(response.status).toBe(400);
  });

  test("PATCH /status answers 400 rather than throwing", async () => {
    const request = new Request(
      `http://localhost:3000/api/todos/${todo.id}/status`,
      {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: "{not json",
      },
    );

    const response = await patchStatus(request as never, idContext(todo.id));

    expect(response.status).toBe(400);
  });
});
