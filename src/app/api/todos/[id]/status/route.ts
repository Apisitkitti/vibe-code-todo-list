import { NextResponse, type NextRequest } from "next/server";
import { z, type ZodError } from "zod";

import { prisma } from "@/lib/prisma";
import { getSession } from "@/lib/session";

import {
  malformedBodyResponse,
  notFoundResponse,
  unauthorizedResponse,
} from "../../errors";
import { findOwnedTodo, readJsonBody, toTodoResponse } from "../../util";

/**
 * Completion has its own route so it cannot be confused with a field edit.
 * `strict()` keeps it that way: a body carrying anything besides `completed`
 * is rejected rather than quietly ignored, which is what used to make a mixed
 * body look like a successful save (review m-5, QA DEF-06).
 */
const todoStatusSchema = z.object({ completed: z.boolean() }).strict();

/**
 * Two different mistakes, two different messages. Both end up here without a
 * field to blame — `completed` is not one of the form's fields, so the shared
 * field-error mapping drops it — and answering "this route only takes
 * completed" to someone who *did* send only `completed` is worse than saying
 * nothing.
 */
const STATUS_BODY_ONLY_MESSAGE =
  "Only completion can be changed here. Save the todo's other fields separately.";
const COMPLETED_TYPE_MESSAGE = "Completion must be true or false.";

const hasUnrecognisedKey = (error: ZodError) =>
  error.issues.some((issue) => issue.code === "unrecognized_keys");

/**
 * Scoped by `{ id, userId }` in the same statement, so another user's todo
 * matches zero rows and comes back as 404 (`docs/PRD.md` NFR-01). Undo calls
 * this same route, so it is authorised identically.
 */
export const PATCH = async (
  request: NextRequest,
  context: RouteContext<"/api/todos/[id]/status">,
) => {
  const session = await getSession();

  if (!session?.user) return unauthorizedResponse();

  const { id } = await context.params;
  const body = await readJsonBody(request);
  const parsed = todoStatusSchema.safeParse(body);

  if (!parsed.success) {
    return malformedBodyResponse(
      hasUnrecognisedKey(parsed.error)
        ? STATUS_BODY_ONLY_MESSAGE
        : COMPLETED_TYPE_MESSAGE,
    );
  }

  const result = await prisma.todo.updateMany({
    where: { id, userId: session.user.id },
    data: { completed: parsed.data.completed },
  });

  if (result.count === 0) return notFoundResponse();

  const todo = await findOwnedTodo(id, session.user.id);

  if (!todo) return notFoundResponse();

  return NextResponse.json(toTodoResponse(todo));
};
