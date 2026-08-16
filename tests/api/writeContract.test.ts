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
