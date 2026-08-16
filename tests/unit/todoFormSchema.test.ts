import { describe, expect, test } from "vitest";

import { todoFormSchema } from "@/app/todos/components/form";
import { NOTE_MAX_LENGTH, TITLE_MAX_LENGTH } from "@/lib/todo";

/**
 * The schema is the trust boundary: the route handlers re-parse every body
 * with this exact object, so its messages are API responses and not only form
 * copy.
 *
 * The wrong-type cases are the ones worth having. A browser form can only ever
 * submit strings, so `{"note": 5}` is unreachable through the UI — but the API
 * is open to direct calls, and without a per-type message zod renders its own
 * English ("Invalid input: expected string, received number") straight into a
 * field error (QA DEF-07, DEF-09).
 */

const firstMessage = (result: ReturnType<typeof todoFormSchema.safeParse>) => {
  if (result.success) throw new Error("Expected the parse to fail.");

  return result.error.issues[0]?.message;
};

const messageFor = (
  input: unknown,
  field: string,
): string | undefined => {
  const result = todoFormSchema.safeParse(input);

  if (result.success) throw new Error("Expected the parse to fail.");

  return result.error.issues.find((issue) => issue.path[0] === field)?.message;
};

const valid = { title: "Buy milk", priority: "medium" as const };

describe("a body the form would send", () => {
  test("parses, applying defaults for the optional fields", () => {
    const result = todoFormSchema.safeParse(valid);

    expect(result.success).toBe(true);
    expect(result.data).toEqual({
      title: "Buy milk",
      note: "",
      priority: "medium",
      dueAt: "",
    });
  });

  test("trims the title and the note", () => {
    const result = todoFormSchema.safeParse({
      title: "  Buy milk  ",
      note: "  from the shop  ",
      priority: "high",
    });

    expect(result.data?.title).toBe("Buy milk");
    expect(result.data?.note).toBe("from the shop");
  });

  test("accepts every priority the app offers", () => {
    for (const priority of ["low", "medium", "high"]) {
      expect(todoFormSchema.safeParse({ ...valid, priority }).success).toBe(true);
    }
  });

  test("accepts a due date in the wire format", () => {
    expect(
      todoFormSchema.safeParse({ ...valid, dueAt: "2026-08-16" }).success,
    ).toBe(true);
  });

  /**
   * The schema is not `.strict()`, so an unknown key is dropped rather than
   * rejected. That is what makes a spoofed `userId` in a POST body harmless —
   * it never reaches the `create` call. Pinned here because switching this to
   * strict would change the API's answer to a real request.
   */
  test("drops an unknown key instead of failing", () => {
    const result = todoFormSchema.safeParse({ ...valid, userId: "someone-else" });

    expect(result.success).toBe(true);
    expect(result.data).not.toHaveProperty("userId");
  });
});

describe("title", () => {
  test("is required", () => {
    expect(messageFor({ priority: "medium" }, "title")).toBe("Enter a title.");
  });

  test("cannot be empty", () => {
    expect(messageFor({ ...valid, title: "" }, "title")).toBe("Enter a title.");
  });

  test("cannot be only whitespace", () => {
    expect(messageFor({ ...valid, title: "     " }, "title")).toBe(
      "Enter a title.",
    );
  });

  test("has a length limit that names the real number", () => {
    expect(
      messageFor({ ...valid, title: "x".repeat(TITLE_MAX_LENGTH + 1) }, "title"),
    ).toBe(`Keep the title under ${TITLE_MAX_LENGTH} characters.`);
  });

  test("accepts exactly the limit", () => {
    expect(
      todoFormSchema.safeParse({ ...valid, title: "x".repeat(TITLE_MAX_LENGTH) })
        .success,
    ).toBe(true);
  });

  test("reports the wrong type in the app's own words", () => {
    expect(messageFor({ ...valid, title: 5 }, "title")).toBe("Enter a title.");
  });

  test("a null title does not leak zod's wording", () => {
    expect(messageFor({ ...valid, title: null }, "title")).toBe("Enter a title.");
  });
});

describe("note", () => {
  test("is optional", () => {
    expect(todoFormSchema.safeParse(valid).data?.note).toBe("");
  });

  test("has a length limit that names the real number", () => {
    expect(
      messageFor({ ...valid, note: "x".repeat(NOTE_MAX_LENGTH + 1) }, "note"),
    ).toBe(`Keep the note under ${NOTE_MAX_LENGTH} characters.`);
  });

  /**
   * DEF-09: the wrong-type answer used to be the too-long message, which
   * described a limit the caller never came near.
   */
  test("a number is a type error, not a length error", () => {
    expect(messageFor({ ...valid, note: 5 }, "note")).toBe(
      "The note must be text.",
    );
  });

  test("an object is a type error too", () => {
    expect(messageFor({ ...valid, note: { text: "hi" } }, "note")).toBe(
      "The note must be text.",
    );
  });
});

describe("priority", () => {
  const expected = "Choose a priority: low, medium, high.";

  test("is required", () => {
    expect(messageFor({ title: "Buy milk" }, "priority")).toBe(expected);
  });

  test("rejects a value outside the list", () => {
    expect(messageFor({ ...valid, priority: "urgent" }, "priority")).toBe(
      expected,
    );
  });

  test("rejects the wrong type", () => {
    expect(messageFor({ ...valid, priority: 1 }, "priority")).toBe(expected);
  });

  test("is case sensitive", () => {
    expect(messageFor({ ...valid, priority: "HIGH" }, "priority")).toBe(expected);
  });
});

describe("dueAt", () => {
  const expected = "Enter a valid date (YYYY-MM-DD).";

  test("is optional", () => {
    expect(todoFormSchema.safeParse(valid).data?.dueAt).toBe("");
  });

  test("rejects a date that does not exist", () => {
    expect(messageFor({ ...valid, dueAt: "2026-02-31" }, "dueAt")).toBe(expected);
  });

  test("rejects free text", () => {
    expect(messageFor({ ...valid, dueAt: "tomorrow" }, "dueAt")).toBe(expected);
  });

  test("rejects the wrong type", () => {
    expect(messageFor({ ...valid, dueAt: 20260816 }, "dueAt")).toBe(expected);
  });
});

describe("a body that is not an object at all", () => {
  test.each([
    ["null", null],
    ["a bare string", "buy milk"],
    ["an array", [{ title: "Buy milk" }]],
    ["a number", 7],
  ])("%s fails without throwing", (_label, body) => {
    const result = todoFormSchema.safeParse(body);

    expect(result.success).toBe(false);
    expect(firstMessage(result)).toBeTypeOf("string");
  });
});
