import { NextResponse, type NextRequest } from "next/server";

import { todoFormSchema } from "@/app/todos/components/form";
import { prisma } from "@/lib/prisma";
import { getSession } from "@/lib/session";
import { parseDueDate } from "@/lib/todo";

import {
  badRequestResponse,
  malformedBodyResponse,
  notFoundResponse,
  toFieldErrors,
  unauthorizedResponse,
} from "../errors";
import { findOwnedTodo, readJsonBody, toTodoResponse } from "../util";

/**
 * `completed` belongs to the status route. Accepting it here and dropping it
 * would return a 200 that looks like the checkbox was saved — the silent
 * no-op QA caught before the routes were split (review m-5, QA DEF-06).
 */
const COMPLETED_NOT_HERE_MESSAGE =
  "Use PATCH /api/todos/[id]/status to change completion; this route saves the todo's fields.";

const mentionsCompleted = (body: unknown): boolean => {
  return typeof body === "object" && body !== null && "completed" in body;
};

/**
 * The todo's own fields. Completion is deliberately not one of them — it has
 * its own route at `PATCH /api/todos/[id]/status`, so one request can never
 * half-mean "save" and half-mean "toggle".
 *
 * Every write is scoped by `{ id, userId }` in the same statement, so a todo
 * owned by another user matches zero rows and comes back as 404 — never as
 * data (`docs/PRD.md` NFR-01).
 */
export const PATCH = async (request: NextRequest, context: RouteContext<"/api/todos/[id]">) => {
  const session = await getSession();

  if (!session?.user) return unauthorizedResponse();

  const { id } = await context.params;
  const body = await readJsonBody(request);

  if (mentionsCompleted(body)) {
    return malformedBodyResponse(COMPLETED_NOT_HERE_MESSAGE);
  }

  const parsed = todoFormSchema.safeParse(body);

  if (!parsed.success) return badRequestResponse(toFieldErrors(parsed.error));

  const { title, note, priority, dueAt } = parsed.data;
  const parsedDueAt = parseDueDate(dueAt);

  const result = await prisma.todo.updateMany({
    where: { id, userId: session.user.id },
    data: {
      title,
      note: note === "" ? null : note,
      priority,
      dueAt: parsedDueAt === "invalid" ? null : parsedDueAt,
    },
  });

  if (result.count === 0) return notFoundResponse();

  const todo = await findOwnedTodo(id, session.user.id);

  if (!todo) return notFoundResponse();

  return NextResponse.json(toTodoResponse(todo));
};

export const DELETE = async (_request: NextRequest, context: RouteContext<"/api/todos/[id]">) => {
  const session = await getSession();

  if (!session?.user) return unauthorizedResponse();

  const { id } = await context.params;

  const result = await prisma.todo.deleteMany({
    where: { id, userId: session.user.id },
  });

  if (result.count === 0) return notFoundResponse();

  return new NextResponse(null, { status: 204 });
};
