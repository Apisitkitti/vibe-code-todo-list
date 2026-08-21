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
import {
  DELETE,
  PATCH as patchFields,
} from "@/app/api/todos/[id]/route";
import { PATCH as patchStatus } from "@/app/api/todos/[id]/status/route";
import { POST } from "@/app/api/todos/route";
import { prisma } from "@/lib/prisma";
import { NOTE_MAX_LENGTH } from "@/lib/todo";

import {
  createTestUser,
  createTodo,
  deleteTestUsers,
  readTodo,
  type TestUser,
} from "../support/factory";
import {
  deleteRequest,
  idContext,
  jsonRequest,
  readError,
  readTodoBody,
} from "../support/request";

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

  /**
   * Stray spaces around a real date are *not* the same thing as a string with
   * no date in it. `parseDueDate` trims before parsing, exactly as the form
   * schema does, so this is accepted — and it is asserted because the route's
   * own comment says so, and a comment about parsing behaviour with no test
   * behind it is the thing this project keeps having to correct.
   */
  test("surrounding whitespace around a real date is accepted", async () => {
    const response = await patchDue(
      dueRequest({ dueAt: "  2026-08-23  " }),
      idContext(todo.id),
    );

    expect(response.status).toBe(200);
    expect((await readTodo(todo.id))?.dueAt?.toISOString()).toBe(
      "2026-08-23T00:00:00.000Z",
    );
  });

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

/**
 * What a *successful* delete answers.
 *
 * `isolation.test.ts` pins DELETE's 404 twice over — the cross-account refusal
 * is the property that file exists for — and nothing anywhere asserted the
 * success path. So the handler could answer `200 {ok:true}`, or a **500**,
 * having deleted the row, and the suite stayed green (mutation audit I3,
 * I3b). `deleteTodo` in the service layer branches on the response, and a
 * client reading a 500 as a failure would leave the row on screen after the
 * server had destroyed it — the disagreement between the screen and the
 * database that QA is told to look for.
 *
 * 204 rather than 200: there is no body worth sending, and the empty body is
 * part of the contract rather than an accident of having nothing to say.
 */
describe("DELETE /api/todos/[id] answers 204 with nothing in it", () => {
  test("reports 204, not a 200 with a body and not an error", async () => {
    const response = await DELETE(
      deleteRequest(`/api/todos/${todo.id}`),
      idContext(todo.id),
    );

    expect(response.status).toBe(204);
    expect(await response.text()).toBe("");
  });

  /** And the 204 is telling the truth: the row is gone from the database. */
  test("the row is actually gone, so the status is not a claim about nothing", async () => {
    await DELETE(deleteRequest(`/api/todos/${todo.id}`), idContext(todo.id));

    expect(await readTodo(todo.id)).toBeNull();
  });

  /**
   * The counterpart that keeps 204 meaning something: deleting the same row
   * twice is a 404 the second time, so 204 is "I deleted it" rather than "I
   * have nothing to say about this id".
   */
  test("deleting it again is a 404, so 204 means the row was there", async () => {
    await DELETE(deleteRequest(`/api/todos/${todo.id}`), idContext(todo.id));

    const response = await DELETE(
      deleteRequest(`/api/todos/${todo.id}`),
      idContext(todo.id),
    );

    expect(response.status).toBe(404);
  });
});

/**
 * What `POST` stores in `note`.
 *
 * `note` was asserted on the *update* path and never on create, so the create
 * handler could store every note as `NULL` (mutation audit C14b) — silently
 * discarding the 2000-character field where the detail actually lives — or
 * store `""` where the schema means "no note" (C14), with 492 tests passing.
 *
 * The `"" -> NULL` mapping is not cosmetic: `null` is what the row renderer
 * and `todoMatchesFilters` read as "there is no note", and an empty string is
 * a note that happens to be empty. Both handlers do it, and only one of them
 * was watched.
 */
describe("POST /api/todos stores the note it was given", () => {
  test("keeps a supplied note verbatim", async () => {
    const response = await POST(
      jsonRequest("/api/todos", "POST", {
        ...formBody("With a note"),
        note: "Ring the caterer first",
      }),
    );

    expect(response.status).toBe(201);

    const body = await readTodoBody(response);

    expect(body.note).toBe("Ring the caterer first");
    expect((await readTodo(body.id))?.note).toBe("Ring the caterer first");
  });

  /** An omitted note is no note, and no note is `NULL` rather than `""`. */
  test("stores no note as null when the key is absent altogether", async () => {
    const response = await POST(
      jsonRequest("/api/todos", "POST", formBody("Without a note")),
    );

    expect(response.status).toBe(201);

    const body = await readTodoBody(response);

    expect(body.note).toBeNull();
    expect((await readTodo(body.id))?.note).toBeNull();
  });

  /** A cleared textarea sends `""`, and that is the same thing as no note. */
  test("stores an empty note as null too, the way a save does", async () => {
    const response = await POST(
      jsonRequest("/api/todos", "POST", { ...formBody("Cleared note"), note: "" }),
    );

    expect(response.status).toBe(201);

    const body = await readTodoBody(response);

    expect(body.note).toBeNull();
    expect((await readTodo(body.id))?.note).toBeNull();
  });

  /** Trimmed on the way in, like the title, so whitespace is not a note. */
  test("stores a note that is only whitespace as null", async () => {
    const response = await POST(
      jsonRequest("/api/todos", "POST", { ...formBody("Blank note"), note: "   " }),
    );

    expect(response.status).toBe(201);
    expect((await readTodoBody(response)).note).toBeNull();
  });
});

/**
 * What a 400 actually *says*, as opposed to the fact that it is a 400.
 *
 * `grep -rn "fieldErrors" tests/` returned nothing before this block existed.
 * `tests/api/` asserted `response.status` around forty times and never once
 * read a validation body, so the whole field-error mechanism could be deleted
 * — every 400 answering `fieldErrors: {}` and a generic sentence — with 492
 * tests passing. What a user gets from that is a form that refuses their
 * input and marks no field, or a toast with no sentence in it.
 *
 * The client is the reason these are contract, not decoration: `Form` wires
 * `fieldErrors` onto inputs by key, and `getErrorMessage` hands `message`
 * straight to `toast.danger`.
 *
 * Note what is *not* asserted here, deliberately. Two of this mechanism's
 * rules — dropping a zod path the form has no input for, and keeping the
 * first message per field rather than the last — cannot be reached through
 * these routes at all, because `todoFormSchema` is a non-strict `z.object`
 * whose keys are exactly the form's and no field of it collects two failing
 * checks. An assertion here that "`completed` never appears in `fieldErrors`"
 * would pass with the guard and without it. Those two live in
 * `tests/unit/toFieldErrors.test.ts`, at the function, which is the lowest
 * layer that can fail for the reason they exist.
 */
describe("a 400 from validation says which field and why", () => {
  const invalidBody = {
    title: "",
    note: "n".repeat(NOTE_MAX_LENGTH + 1),
    priority: "urgent",
    dueAt: "not a date",
  };

  test("POST marks every field the schema complained about, and only those", async () => {
    const response = await POST(jsonRequest("/api/todos", "POST", invalidBody));

    expect(response.status).toBe(400);

    const body = await readError(response);

    expect(Object.keys(body.fieldErrors ?? {}).sort()).toEqual([
      "dueAt",
      "note",
      "priority",
      "title",
    ]);
  });

  test("the message on a field is the one the person can act on", async () => {
    const response = await POST(jsonRequest("/api/todos", "POST", invalidBody));
    const body = await readError(response);

    expect(body.fieldErrors?.title).toBe("Enter a title.");
    expect(body.fieldErrors?.priority).toBe("Choose a priority: low, medium, high.");
  });

  /**
   * The top-level sentence is what `toast.danger` shows. Without it the code's
   * generic default surfaces instead, so the toast says "that request wasn't
   * valid" about a form that has already marked four fields — which is the
   * one thing it must not do.
   */
  test("the toast sentence is the first field's message, not the generic default", async () => {
    const response = await POST(jsonRequest("/api/todos", "POST", invalidBody));
    const body = await readError(response);

    expect(body.message).toBe("Enter a title.");
    expect(body.message).not.toBe("That request wasn’t valid.");
  });

  /** A single bad field marks that field alone — the block above is not just "everything". */
  test("only the offending field is marked when the rest of the body is fine", async () => {
    const response = await POST(
      jsonRequest("/api/todos", "POST", { ...formBody("Fine"), priority: "urgent" }),
    );

    expect(response.status).toBe(400);

    const body = await readError(response);

    expect(Object.keys(body.fieldErrors ?? {})).toEqual(["priority"]);
    expect(body.message).toBe("Choose a priority: low, medium, high.");
  });

  test("PATCH answers with the same shape, so the form reads one contract", async () => {
    const response = await patchFields(
      jsonRequest(`/api/todos/${todo.id}`, "PATCH", invalidBody),
      idContext(todo.id),
    );

    expect(response.status).toBe(400);

    const body = await readError(response);

    expect(body.fieldErrors?.title).toBe("Enter a title.");
    expect(body.message).toBe("Enter a title.");
  });

  /**
   * The counterpart, and the case that stops the four above from being read as
   * "a 400 always carries fieldErrors". A body the schema never got to see is
   * nobody's field, and marking one would send the user to an input that is
   * not the problem.
   */
  test("a 400 that no field is to blame for carries no fieldErrors at all", async () => {
    const response = await POST(
      jsonRequest("/api/todos", "POST", {
        ...formBody("Already done"),
        completed: true,
      }),
    );

    expect(response.status).toBe(400);

    const body = await readError(response);

    expect(body.fieldErrors).toBeUndefined();
    expect(body.message).toBe(
      "Completion is changed by the checkbox, not by saving the todo.",
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
