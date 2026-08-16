import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import type { TodoPriority } from "@/lib/todo";

import { AUTH_ORIGIN_HEADERS } from "./headers";

/**
 * Real users, created through the real sign-up endpoint.
 *
 * Nothing here inserts a session row by hand. The cookie these tests send is
 * the one better-auth actually issued, so the routes' `getSession()` does a
 * genuine lookup and the isolation assertions rest on the real auth path
 * rather than on a fixture that agrees with itself.
 */

export interface TestUser {
  id: string;
  email: string;
  /** The `Set-Cookie` better-auth issued at sign-up, replayed as `Cookie`. */
  cookie: string;
}

const PASSWORD = "correct-horse-battery";

export const createTestUser = async (email: string): Promise<TestUser> => {
  const result = await auth.api.signUpEmail({
    body: { name: email.split("@")[0], email, password: PASSWORD },
    headers: AUTH_ORIGIN_HEADERS(),
    returnHeaders: true,
  });

  const cookie = result.headers.get("set-cookie");

  if (!cookie) {
    throw new Error(`Sign-up returned no Set-Cookie for ${email}.`);
  }

  return { id: result.response.user.id, email, cookie };
};

export interface TodoSeed {
  title: string;
  note?: string | null;
  priority?: TodoPriority;
  completed?: boolean;
  dueAt?: Date | null;
}

export const createTodo = (userId: string, seed: TodoSeed) => {
  return prisma.todo.create({
    data: {
      title: seed.title,
      note: seed.note ?? null,
      priority: seed.priority ?? "medium",
      completed: seed.completed ?? false,
      dueAt: seed.dueAt ?? null,
      userId,
    },
  });
};

/**
 * Cascades to sessions, accounts and todos via the schema's `onDelete`, so the
 * suite leaves nothing behind. Scoped to the calling file's own email domain:
 * `fileParallelism` is off, but a stray truncate would still be the kind of
 * thing that only shows up as a confusing failure three files later.
 */
export const deleteTestUsers = async (emailDomain: string) => {
  await prisma.user.deleteMany({ where: { email: { endsWith: emailDomain } } });
};

/** A todo read straight from the database, bypassing every route filter. */
export const readTodo = (id: string) => {
  return prisma.todo.findUnique({ where: { id } });
};
