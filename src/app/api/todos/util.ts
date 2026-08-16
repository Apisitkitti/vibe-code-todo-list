import { prisma } from "@/lib/prisma";

/**
 * Helpers the `/api/todos` handlers share. Building a response body is not
 * one of them — each model in `./model.ts` constructs itself.
 */

/**
 * Re-read after a write, through the same ownership filter, so a response can
 * never carry a row the caller does not own.
 */
export const findOwnedTodo = (id: string, userId: string) => {
  return prisma.todo.findFirst({ where: { id, userId } });
};

/** `request.json()` throws on a malformed body; the caller gets `null`. */
export const readJsonBody = async (request: Request): Promise<unknown> => {
  return await request.json().catch(() => null);
};
