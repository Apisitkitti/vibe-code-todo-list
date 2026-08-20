import { resolve } from "node:path";

import { Client } from "pg";

import { resolveTestDatabaseUrl } from "./testDatabaseUrl";

/**
 * Fails fast, with a usable message, when the test database is not ready.
 *
 * This deliberately VERIFIES rather than migrates. An earlier version ran
 * `prisma db push` here, and that was wrong on two counts: a test run should
 * not silently reshape a database as a side effect of being started, and
 * `db push` is a destructive operation whose blast radius depends entirely on
 * where it is pointed — precisely the thing a suite should not decide on the
 * developer's behalf. (Prisma agrees: its CLI now refuses `db push` outright
 * when it detects it was invoked by an AI agent.)
 *
 * So the contract is: preparing the database is an explicit, human action, run
 * once. This checks it happened and otherwise says exactly what to do.
 */

/** The tables `prisma/schema.prisma` maps to, via its `@@map` names. */
const REQUIRED_TABLES = ["user", "session", "account", "verification", "todo"];

const globalSetup = async () => {
  const projectRoot = resolve(__dirname, "../..");
  // Throws on a hosted host, a database not named `*_test`, or the app's own
  // URL — so the suite cannot even look at production, let alone write to it.
  const databaseUrl = resolveTestDatabaseUrl(projectRoot);

  const client = new Client({ connectionString: databaseUrl });

  // `migrate deploy` rather than `db push`, so a developer's database is built
  // the same way CI's and production's are. Neither Prisma command accepts a
  // `--url` flag any more (7.9.1: only `db push` still has one), so the URL is
  // pinned by setting DATABASE_URL for the command — `prisma.config.ts` reads
  // it through `env()`, and `process.loadEnvFile` does not overwrite a
  // variable that is already set, so this beats `.env` rather than losing to
  // it.
  const setupHint =
    `Prepare it once with:\n` +
    `  createdb todo_app_test\n` +
    `  DATABASE_URL='${databaseUrl}' npx prisma migrate deploy\n\n` +
    `If the database already has these tables from the db-push era, it has ` +
    `no migration history and the command above will stop with P3005. ` +
    `Baseline it once, which records the migration as applied without ` +
    `re-running it:\n` +
    `  DATABASE_URL='${databaseUrl}' npx prisma migrate resolve --applied 0_init\n` +
    `  DATABASE_URL='${databaseUrl}' npx prisma migrate deploy\n\n` +
    `Or point the suite elsewhere with TEST_DATABASE_URL (it must be a ` +
    `non-hosted host and named *_test).`;

  try {
    await client.connect();
  } catch (error) {
    const detail = error instanceof Error ? error.message : String(error);

    throw new Error(
      `Cannot reach the test database at ${databaseUrl}.\n\n${setupHint}\n\nUnderlying error:\n${detail}`,
    );
  }

  try {
    const found = await client.query<{ table_name: string }>(
      `SELECT table_name FROM information_schema.tables
        WHERE table_schema = 'public' AND table_name = ANY($1)`,
      [REQUIRED_TABLES],
    );

    const present = new Set(found.rows.map((row) => row.table_name));
    const missing = REQUIRED_TABLES.filter((table) => !present.has(table));

    if (missing.length > 0) {
      throw new Error(
        `The test database at ${databaseUrl} is missing ${missing.join(", ")}.\n\n${setupHint}`,
      );
    }
  } finally {
    await client.end();
  }
};

export default globalSetup;
