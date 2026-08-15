import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";

import { todoFormSchema } from "@/app/todos/components/form";
import { prisma } from "@/lib/prisma";
import { getSession } from "@/lib/session";
import { parseDueDate } from "@/lib/todo";

import {
  badRequestResponse,
  notFoundResponse,
  readJsonBody,
  toFieldErrors,
  toTodoItemData,
  unauthorizedResponse,
} from "../response";

/**
 * The toggle sends only this; it must never touch the other fields.
 *
 * `strict()` matters: dispatching on the mere presence of `completed` meant a
 * body that mixed toggle and form fields was treated as a toggle and its other
 * fields were silently dropped — a 200 that looked like a successful save
 * (review m-5). Mixed bodies now fail parsing and fall through to the form
 * branch, which rejects them properly.
 */
const todoToggleSchema = z.object({ completed: z.boolean() }).strict();

const isToggleBody = (body: unknown): boolean => {
  return todoToggleSchema.safeParse(body).success;
};

/**
 * `PATCH` serves both the edit form and the completion toggle. Either way the
 * write is scoped by `{ id, userId }` in the same statement, so a todo owned
 * by another user matches zero rows and comes back as 404 — never as data
 * (`docs/PRD.md` NFR-01).
 */
export const PATCH = async (request: NextRequest, context: RouteContext<"/api/todos/[id]">) => {
  const session = await getSession();

  if (!session?.user) return unauthorizedResponse();

  const { id } = await context.params;
  const body = await readJsonBody(request);

  if (isToggleBody(body)) {
    const parsed = todoToggleSchema.safeParse(body);

    if (!parsed.success) return badRequestResponse(toFieldErrors(parsed.error));

    const result = await prisma.todo.updateMany({
      where: { id, userId: session.user.id },
      data: { completed: parsed.data.completed },
    });

    if (result.count === 0) return notFoundResponse();
  } else {
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
  }

  // Re-read through the same ownership filter so the response cannot leak a
  // row the caller does not own.
  const todo = await prisma.todo.findFirst({
    where: { id, userId: session.user.id },
  });

  if (!todo) return notFoundResponse();

  return NextResponse.json(toTodoItemData(todo));
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
