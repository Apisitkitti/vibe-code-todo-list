import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";

/**
 * Where the suite is allowed to point Prisma.
 *
 * The app's own `DATABASE_URL` is a pooled Neon branch that holds real user
 * data. These tests write and delete rows through the real Prisma client, so
 * the single most important thing this file does is make it hard to run them
 * against that database by accident. The rules below are deliberately
 * paranoid: a false refusal costs a developer a minute, a false permission
 * costs somebody their todos.
 */

const DEFAULT_TEST_DATABASE_URL =
  "postgresql://postgres@127.0.0.1:5432/todo_app_test";

/** Matches `prisma.config.ts` — `.env.local` wins when both exist. */
const APP_ENV_FILES = [".env.local", ".env"];

const DATABASE_URL_PATTERN = /^\s*DATABASE_URL\s*=\s*(.*)$/m;

/**
 * Reads the app's URL without calling `process.loadEnvFile`, which would put
 * the production connection string into this process's environment — exactly
 * the value we are trying to keep away from the test client.
 */
const readAppDatabaseUrl = (projectRoot: string): string | null => {
  for (const file of APP_ENV_FILES) {
    const path = resolve(projectRoot, file);

    if (!existsSync(path)) continue;

    const match = DATABASE_URL_PATTERN.exec(readFileSync(path, "utf8"));

    if (!match) return null;

    return match[1].trim().replace(/^["']|["']$/g, "");
  }

  return null;
};

/** `postgresql://user@host:5432/todo_app_test` → `todo_app_test`. */
const readDatabaseName = (url: URL): string => url.pathname.replace(/^\//, "");

/**
 * Hosted Postgres providers whose databases are, by definition, not a
 * throwaway. A local container or a Neon *branch* proxied to localhost is
 * fine; the vendor's own hostname is not.
 */
const HOSTED_DATABASE_HOSTS = [
  "neon.tech",
  "supabase.co",
  "rds.amazonaws.com",
  "render.com",
];

export const resolveTestDatabaseUrl = (projectRoot: string): string => {
  const candidate = process.env.TEST_DATABASE_URL ?? DEFAULT_TEST_DATABASE_URL;

  let parsed: URL;

  try {
    parsed = new URL(candidate);
  } catch {
    throw new Error(
      `TEST_DATABASE_URL is not a valid URL: ${candidate}. Expected something like ${DEFAULT_TEST_DATABASE_URL}.`,
    );
  }

  const appDatabaseUrl = readAppDatabaseUrl(projectRoot);

  if (appDatabaseUrl !== null && appDatabaseUrl === candidate) {
    throw new Error(
      "Refusing to run: TEST_DATABASE_URL is the same as the app's DATABASE_URL. These tests truncate the users they create; point them at a throwaway database.",
    );
  }

  const hostedProvider = HOSTED_DATABASE_HOSTS.find((host) =>
    parsed.hostname.endsWith(host),
  );

  if (hostedProvider) {
    throw new Error(
      `Refusing to run against a hosted database (${hostedProvider}). Use a local Postgres or a disposable branch proxied to localhost, and set TEST_DATABASE_URL.`,
    );
  }

  const databaseName = readDatabaseName(parsed);

  if (!databaseName.endsWith("_test")) {
    throw new Error(
      `Refusing to run: the test database is named "${databaseName}", which does not end in "_test". Rename it so an accident is visible in the connection string.`,
    );
  }

  return candidate;
};

export { DEFAULT_TEST_DATABASE_URL };
