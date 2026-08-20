import { NextResponse, type NextRequest } from "next/server";

import { prisma } from "@/lib/prisma";
import { getSession } from "@/lib/session";
import { parseDueDate } from "@/lib/todo";
import { todoFormSchema } from "@/lib/todo.schema";

import {
  badRequestResponse,
  completionNotHereResponse,
  notFoundResponse,
  toFieldErrors,
  unauthorizedResponse,
} from "../errors";
import {
  findOwnedTodo,
  mentionsCompleted,
  readJsonBody,
  toTodoResponse,
} from "../util";

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

  if (mentionsCompleted(body)) return completionNotHereResponse();

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
