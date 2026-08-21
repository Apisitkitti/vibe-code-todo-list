import { describe, expect, test } from "vitest";
import { z } from "zod";

import { toFieldErrors } from "@/app/api/todos/errors";
import { TODO_FIELD_NAMES } from "@/lib/todo.schema";

/**
 * The mapping from a zod failure to the errors an input can display.
 *
 * Tested here, at the function, rather than through a 400 body — and that is
 * a finding rather than a convenience. Both of this module's rules are
 * currently *unreachable* through `POST /api/todos` and `PATCH
 * /api/todos/[id]`, because `todoFormSchema` is a non-strict `z.object` whose
 * keys are exactly `TODO_FIELD_NAMES`:
 *
 *   - an extra key is stripped without an issue, so no issue's path can name
 *     a field the form does not know about;
 *   - no field carries two checks that can fail on the same value, so no
 *     field ever collects two messages.
 *
 * Measured, not assumed: parsing `{title:"",priority:"urgent",dueAt:"nope",
 * note:5}` yields exactly four issues, one per field, every path a form field
 * name. `{completed:true, updatedAt:1}` alongside a valid body parses clean.
 * So an assertion at the route that "`completed` never appears in
 * `fieldErrors`" would pass with the guard *and* without it — it cannot
 * distinguish them, which is why the audit's suggested route-level assertion
 * does not close these two.
 *
 * Which leaves the question of whether the guard is worth pinning at all,
 * given nothing can reach it today. It is, and this is not `findOwnedTodo`'s
 * situation: that guard is redundant behind another guard that will still be
 * there tomorrow, whereas this one is load-bearing the instant the schema
 * moves — a `.strict()`, a nested object, a field renamed on one side only.
 * Review m-6 asked for it precisely so that a future schema change cannot
 * quietly type unknown paths through to the client. A guard whose whole job
 * is to survive a change to its neighbour is tested at its own interface.
 *
 * The errors below are produced by real schemas, not by hand-built issue
 * objects, so they stay honest if zod's internals change underneath.
 */

/** Stands in for the schema having gained a key the form has no input for. */
const schemaThatMovedOn = z.object({
  title: z.string("Enter a title."),
  completed: z.boolean("Completion must be true or false."),
});

/** Stands in for one field collecting more than one complaint. */
const fieldWithTwoChecks = z.object({
  title: z
    .string()
    .min(5, "the first complaint")
    .regex(/^A/, "the second complaint"),
});

const errorFrom = (schema: z.ZodType, value: unknown): z.ZodError => {
  const parsed = schema.safeParse(value);

  if (parsed.success) throw new Error("fixture parsed clean; it must not");

  return parsed.error;
};

describe("toFieldErrors — one message per input", () => {
  test("gives each field the message zod raised for it", () => {
    const fieldErrors = toFieldErrors(
      errorFrom(schemaThatMovedOn, { title: 5, completed: true }),
    );

    expect(fieldErrors).toEqual({ title: "Enter a title." });
  });

  /**
   * First, not last. An input shows one error, and it should be the one the
   * schema states first — the later complaint is usually a consequence of the
   * earlier one, and showing it sends the user to fix the wrong thing.
   */
  test("keeps the first complaint about a field and ignores the rest", () => {
    const fieldErrors = toFieldErrors(errorFrom(fieldWithTwoChecks, { title: "bcd" }));

    expect(fieldErrors.title).toBe("the first complaint");
  });

  test("the second complaint about that field is genuinely raised, so the case above is not vacuous", () => {
    const messages = errorFrom(fieldWithTwoChecks, { title: "bcd" }).issues.map(
      (issue) => issue.message,
    );

    expect(messages).toEqual(["the first complaint", "the second complaint"]);
  });
});

describe("toFieldErrors — where it must NOT fire", () => {
  /**
   * Review m-6. A zod path the form has no input for must be dropped here
   * rather than cast into `TodoFieldErrors` and discovered by the client,
   * which would mark an input that does not exist — or, for `completed`,
   * report a form error for something no form controls.
   */
  test("a path the form has no input for is dropped, not typed through", () => {
    const fieldErrors = toFieldErrors(
      errorFrom(schemaThatMovedOn, { title: "Fine", completed: "yes" }),
    );

    expect(fieldErrors).toEqual({});
    expect(Object.keys(fieldErrors)).not.toContain("completed");
  });

  test("it drops the unknown path without dropping a known one beside it", () => {
    const fieldErrors = toFieldErrors(
      errorFrom(schemaThatMovedOn, { title: 5, completed: "yes" }),
    );

    expect(fieldErrors).toEqual({ title: "Enter a title." });
  });

  /** An issue at the root blames the body, not any one input. */
  test("an issue with no path at all names no field", () => {
    const fieldErrors = toFieldErrors(errorFrom(schemaThatMovedOn, "not an object"));

    expect(fieldErrors).toEqual({});
  });

  /**
   * The list it matches against is the form's own, so this is the assertion
   * that would go red if `TODO_FIELD_NAMES` and the schema ever drifted.
   */
  test("every key it can produce is one of the form's own field names", () => {
    const fieldErrors = toFieldErrors(
      errorFrom(schemaThatMovedOn, { title: 5, completed: "yes" }),
    );

    for (const key of Object.keys(fieldErrors)) {
      expect(TODO_FIELD_NAMES as readonly string[]).toContain(key);
    }
  });
});
