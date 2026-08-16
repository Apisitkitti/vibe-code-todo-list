import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";

/**
 * Where this suite is allowed to point the application and its own teardown
 * client.
 *
 * The teardown guard in `./database.ts` bounds what may be *deleted*. It says
 * nothing about what is *connected to* — and the browser in these tests drives
 * the real app, which writes through whatever `DATABASE_URL` the dev server
 * was started with. So the previous default, the app's own `.env`, meant the
 * default target of a 16-spec suite that signs up accounts and deletes them
 * was the production Neon branch. That is what this file fixes: the default
 * is now a throwaway local database, and aiming at anything hosted has to be a
 * deliberate, and currently refused, act.
 *
 * The rules below are deliberately paranoid: a false refusal costs a developer
 * a minute, a false permission costs somebody their todos.
 *
 * ── Shared shape ───────────────────────────────────────────────────────────
 *
 * This intentionally mirrors `tests/setup/testDatabaseUrl.ts` on the sibling
 * Vitest branch — the same `TEST_DATABASE_URL` variable, the same default, and
 * the same three refusals — so the two suites are configured identically and a
 * developer learns one rule, not two. It is a separate file rather than an
 * import because that one belongs to another branch; if both land, they should
 * be merged into a single shared module rather than left as twins.
 */

/** The default target: local, disposable, and obviously not production. */
const DEFAULT_TEST_DATABASE_URL =
  "postgresql://postgres@127.0.0.1:5432/todo_app_test";

/** Matches `prisma.config.ts` — `.env.local` wins when both exist. */
const APP_ENV_FILES = [".env.local", ".env"];

const DATABASE_URL_PATTERN = /^\s*DATABASE_URL\s*=\s*(.*)$/m;

/**
 * Hosted Postgres providers whose databases are, by definition, not a
 * throwaway. A local container is fine; the vendor's own hostname is not.
 */
const HOSTED_DATABASE_HOSTS = [
  "neon.tech",
  "supabase.co",
  "rds.amazonaws.com",
  "render.com",
];

/**
 * Reads the app's URL *without* calling `process.loadEnvFile`, which would put
 * the production connection string into this process's environment — exactly
 * the value this module exists to keep away from the tests.
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
      "Refusing to run: TEST_DATABASE_URL is the same as the app's DATABASE_URL. This suite signs up accounts and deletes them; point it at a throwaway database.",
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
