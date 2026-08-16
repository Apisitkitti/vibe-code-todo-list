import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";

import { prisma } from "@/lib/prisma";
import { getSession } from "@/lib/session";

import {
  badRequestResponse,
  malformedBodyResponse,
  notFoundResponse,
  toFieldErrors,
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
 * An unrecognised key produces a zod issue with an empty path, so there is no
 * field to blame and the generic "that request wasn't valid" would leave the
 * caller guessing which route they wanted.
 */
const STATUS_BODY_ONLY_MESSAGE =
  "This route takes only “completed”; use PATCH /api/todos/[id] to save the todo's fields.";

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
    const fieldErrors = toFieldErrors(parsed.error);

    return Object.keys(fieldErrors).length > 0
      ? badRequestResponse(fieldErrors)
      : malformedBodyResponse(STATUS_BODY_ONLY_MESSAGE);
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
