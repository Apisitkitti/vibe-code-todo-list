import type { Prisma } from "@/generated/prisma/client";

import { NextResponse, type NextRequest } from "next/server";

import { todoFormSchema } from "@/app/todos/components/form";
import { prisma } from "@/lib/prisma";
import { getSession } from "@/lib/session";
import {
  parseDueDate,
  parsePriorityFilter,
  parseStatusFilter,
} from "@/lib/todo";

import {
  badRequestResponse,
  completionNotHereResponse,
  toFieldErrors,
  unauthorizedResponse,
} from "./errors";
import {
  mentionsCompleted,
  readJsonBody,
  toTodoListResponse,
  toTodoResponse,
} from "./util";

const STATUS_PARAM = "status";
const PRIORITY_PARAM = "priority";
const QUERY_PARAM = "query";

/**
 * The trust boundary (`docs/CONVENTIONS.md` → Route handlers): session first,
 * schema second, and every Prisma clause scoped to the session user's id. The
 * client never supplies a user id — it could not be trusted if it did.
 */
export const GET = async (request: NextRequest) => {
  const session = await getSession();

  if (!session?.user) return unauthorizedResponse();

  const searchParams = request.nextUrl.searchParams;
  const status = parseStatusFilter(searchParams.get(STATUS_PARAM));
  const priority = parsePriorityFilter(searchParams.get(PRIORITY_PARAM));
  const query = (searchParams.get(QUERY_PARAM) ?? "").trim();

  const where: Prisma.TodoWhereInput = { userId: session.user.id };

  if (status !== "all") {
    where.completed = status === "completed";
  }

  if (priority !== "all") {
    where.priority = priority;
  }

  if (query !== "") {
    where.title = { contains: query, mode: "insensitive" };
  }

  const [todos, totalCount, completedCount] = await Promise.all([
    prisma.todo.findMany({
      where,
      orderBy: [{ completed: "asc" }, { createdAt: "desc" }],
    }),
    prisma.todo.count({ where: { userId: session.user.id } }),
    prisma.todo.count({ where: { userId: session.user.id, completed: true } }),
  ]);

  return NextResponse.json(
    toTodoListResponse(todos, totalCount, completedCount),
  );
};

export const POST = async (request: NextRequest) => {
  const session = await getSession();

  if (!session?.user) return unauthorizedResponse();

  const body = await readJsonBody(request);

  // A new todo is never created already-completed, and parsing `completed`
  // away would return a 201 whose body silently disagrees with the request.
  if (mentionsCompleted(body)) return completionNotHereResponse();

  const parsed = todoFormSchema.safeParse(body);

  if (!parsed.success) return badRequestResponse(toFieldErrors(parsed.error));

  const { title, note, priority, dueAt } = parsed.data;
  const parsedDueAt = parseDueDate(dueAt);

  const todo = await prisma.todo.create({
    data: {
      title,
      note: note === "" ? null : note,
      priority,
      dueAt: parsedDueAt === "invalid" ? null : parsedDueAt,
      // Ownership comes from the session, never from the request.
      userId: session.user.id,
    },
  });

  return NextResponse.json(toTodoResponse(todo), { status: 201 });
};
