import { NextResponse, type NextRequest } from "next/server";
import { z, type ZodError } from "zod";

import { prisma } from "@/lib/prisma";
import { getSession } from "@/lib/session";
import { parseDueDate } from "@/lib/todo";

import {
  malformedBodyResponse,
  notFoundResponse,
  unauthorizedResponse,
} from "../../errors";
import { findOwnedTodo, readJsonBody, toTodoResponse } from "../../util";

/**
 * The due date has its own route, for the same reason completion does: a
 * reschedule from the row must not be able to carry a field edit
 * (`docs/CONVENTIONS.md` → Splitting an API folder, `docs/PM-PROPOSAL.md` §3
 * #5). `strict()` is what enforces it — a body carrying anything besides
 * `dueAt` is rejected rather than quietly ignored, which is the half-applied
 * write DEF-06 was about, reached from a third direction.
 *
 * `null` is the *only* spelling of "no due date" here. The form schema uses
 * `""` for that, because a cleared text field produces an empty string; this
 * route is called by code rather than by a form, so it takes the value the
 * column actually holds and refuses the second spelling. One meaning, one
 * encoding.
 */
const todoDueSchema = z.object({ dueAt: z.string().nullable() }).strict();

/**
 * Three mistakes, three answers. Telling somebody who sent only `dueAt` that
 * the route takes only `dueAt` helps nobody, and telling somebody who sent
 * `2026-02-31` that the shape is wrong sends them looking in the wrong place.
 *
 * None of these carries a field error. `dueAt` *is* a form field, so the shared
 * mapping would happily attach one — but there is no form behind this route,
 * and a field error against an input that is not on screen is an error the user
 * cannot act on. They are shown through `toast.danger` instead
 * (`docs/DESIGN.md` §7.19).
 */
const DUE_BODY_ONLY_MESSAGE =
  "Only the due date can be changed here. Save the todo's other fields separately.";
const DUE_TYPE_MESSAGE =
  "A due date must be a YYYY-MM-DD date, or null to clear it.";
const DUE_DATE_INVALID_MESSAGE = "Enter a valid date.";

const hasUnrecognisedKey = (error: ZodError) =>
  error.issues.some((issue) => issue.code === "unrecognized_keys");

/**
 * Scoped by `{ id, userId }` in the same statement, so another user's todo
 * matches zero rows and comes back as 404 (`docs/PRD.md` NFR-01). Undo calls
 * this same route with the previous value, so it is authorised identically —
 * it is a reschedule, not a privileged rollback (`docs/CONVENTIONS.md` →
 * Mutation UX).
 */
export const PATCH = async (
  request: NextRequest,
  context: RouteContext<"/api/todos/[id]/due">,
) => {
  const session = await getSession();

  if (!session?.user) return unauthorizedResponse();

  const { id } = await context.params;
  const body = await readJsonBody(request);
  const parsed = todoDueSchema.safeParse(body);

  if (!parsed.success) {
    return malformedBodyResponse(
      hasUnrecognisedKey(parsed.error) ? DUE_BODY_ONLY_MESSAGE : DUE_TYPE_MESSAGE,
    );
  }

  /*
    `parseDueDate` is the app's one date parser and it is strict, so
    `2026-02-31` is refused rather than rolled forward into March. Its third
    answer — `null`, which it gives for a string that is empty **or contains
    nothing but whitespace** — is refused here too: clearing is spelled `null`
    on this route, and accepting `""` as a second spelling would let a caller
    clear a date while believing it had sent one.

    Note this is about a string with no date in it, not about stray spaces
    around one: `parseDueDate` trims first, so `" 2026-08-23 "` parses and is
    accepted, exactly as the form schema accepts it. Only a value that trims
    away to nothing reaches the 400.
  */
  const dueAt = parsed.data.dueAt;
  const parsedDueAt = dueAt === null ? null : parseDueDate(dueAt);

  if (parsedDueAt === "invalid" || (dueAt !== null && parsedDueAt === null)) {
    return malformedBodyResponse(DUE_DATE_INVALID_MESSAGE);
  }

  const result = await prisma.todo.updateMany({
    where: { id, userId: session.user.id },
    data: { dueAt: parsedDueAt },
  });

  if (result.count === 0) return notFoundResponse();

  const todo = await findOwnedTodo(id, session.user.id);

  if (!todo) return notFoundResponse();

  return NextResponse.json(toTodoResponse(todo));
};
