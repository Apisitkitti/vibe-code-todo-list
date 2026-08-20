import type { Prisma } from "@/generated/prisma/client";

import { NextResponse, type NextRequest } from "next/server";

import { prisma } from "@/lib/prisma";
import { getSession } from "@/lib/session";
import {
  parseDueDate,
  parsePriorityFilter,
  parseStatusFilter,
} from "@/lib/todo";
import { todoFormSchema } from "@/lib/todo.schema";

import {
  badRequestResponse,
  completionNotHereResponse,
  createdViaNotValidResponse,
  toFieldErrors,
  unauthorizedResponse,
} from "./errors";
import {
  TODO_LIST_ORDER_BY,
  escapeLikePattern,
  mentionsCompleted,
  readCreatedVia,
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

  /*
    Backlog #4: the note is searched as well as the title. The note is the
    2000-character field where the detail actually lives, so a search that
    could not see it answered `No matches` about todos the user had written
    the term into themselves.

    **The `OR` sits *beside* `userId`, never around it.** Prisma ANDs the
    top-level keys of a `where`, so this reads `userId = me AND (title ~ q OR
    note ~ q)` — the scope still constrains every branch. Nesting it the other
    way, or folding `userId` into one arm, makes the other arm unscoped and
    turns a search box into a reader of everybody's todos; that is the whole
    reason this one line was reviewed as a security change. `userId` is set
    above and is not touched here, which is the property to check when reading
    this diff.

    `mode: "insensitive"` on both, matching the title behaviour this widens
    rather than inventing a second rule for the second field.

    **`escapeLikePattern` is what makes the term mean itself.** `contains`
    compiles to `ILIKE '%' || $1 || '%'`, and binding `$1` stops injection but
    not LIKE's own metacharacters — `%`, `_` and `\` were all live inside the
    user's text until this call. Both arms get it, because either one left raw
    reproduces the whole defect on its own. See `escapeLikePattern` in
    `./util.ts` for what was measured before it.
  */
  if (query !== "") {
    const term = escapeLikePattern(query);

    where.OR = [
      { title: { contains: term, mode: "insensitive" } },
      { note: { contains: term, mode: "insensitive" } },
    ];
  }

  const [todos, totalCount, completedCount] = await Promise.all([
    // `where` is untouched by the ordering change — it still starts from the
    // session user's id and nothing was added to or moved inside it.
    prisma.todo.findMany({ where, orderBy: TODO_LIST_ORDER_BY }),
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

  /*
    Which capture surface the caller says it is (PM backlog #5). Read before
    the form parse and rejected before anything is written, so a body that
    names a surface nobody has still leaves the table alone — the alternative
    is a 201 that recorded something other than what it was told.

    `undefined` is a different answer from an invalid one and is allowed
    through: the column is nullable and stores "not said" (see
    `readCreatedVia`).
  */
  const createdVia = readCreatedVia(body);

  if (createdVia === "invalid") return createdViaNotValidResponse();

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
      createdVia,
      // Ownership comes from the session, never from the request.
      userId: session.user.id,
    },
  });

  return NextResponse.json(toTodoResponse(todo), { status: 201 });
};
