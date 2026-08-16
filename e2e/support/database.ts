import { resolve } from "node:path";

import { Client } from "pg";

/**
 * Teardown, and nothing else.
 *
 * ── Why this file is the most dangerous file in the suite ──────────────────
 *
 * `DATABASE_URL` points at the real Neon database, which holds production
 * data. There is no delete-account endpoint, so removing a test account has to
 * go through the database directly. A mistake here is not a failing test, it
 * is a production incident. Every rule below exists to make the blast radius
 * of a bug in this file as close to zero as it can be made.
 *
 * ── The bound ──────────────────────────────────────────────────────────────
 *
 * A row is only ever deleted when its email satisfies ALL of:
 *
 *   1. it equals — by full string equality in a parameterised query, never
 *      `LIKE`, never a prefix match, never an interpolated literal — an
 *      address this process generated and recorded;
 *   2. it matches `TEARDOWN_EMAIL_PATTERN`, which requires the literal `e2e-`
 *      prefix, a per-run id, an index, and the domain `e2e.invalid`;
 *   3. `.invalid` is the reserved TLD from RFC 2606, guaranteed by standard
 *      never to resolve. No human can hold an address there, so no real
 *      account can ever match.
 *
 * Deletion resolves that one email to exactly one `user.id` first, then
 * removes only rows carrying that id. The suite issues no range delete, no
 * prefix delete and no unparameterised SQL anywhere. If the guard rejects an
 * address, teardown throws and touches nothing: leaking a test account is
 * recoverable, deleting a real one is not.
 *
 * Child rows are removed explicitly rather than left to `onDelete: Cascade`.
 * The cascade is declared in `prisma/schema.prisma` and almost certainly
 * exists in the database, but "almost certainly" is not the standard for a
 * statement that runs against production — and an explicit delete bounded by
 * a resolved id is no less safe than an implicit one.
 *
 * `pg` is used rather than the generated Prisma client because that client is
 * ESM-only and Playwright transpiles this file to CommonJS. `pg` is already a
 * direct dependency of the app.
 */

/**
 * Reserved by RFC 2606 — guaranteed never to be a real, resolvable domain.
 * This is the outermost safety bound and must not be relaxed.
 */
const TEARDOWN_EMAIL_DOMAIN = "e2e.invalid";
const TEARDOWN_EMAIL_PREFIX = "e2e-";

/**
 * The exact shape `createAccountDetails` produces. Teardown refuses anything
 * else, so a bug that computed the wrong address throws instead of deleting.
 */
const TEARDOWN_EMAIL_PATTERN = /^e2e-[a-z0-9]+-\d+@e2e\.invalid$/;

let client: Client | null = null;

/**
 * `.env` is not loaded for us: Next loads it for the app, but this module runs
 * inside Playwright's own Node process. Node 24 reads it directly, so the
 * suite needs no dotenv dependency.
 *
 * Playwright transpiles TypeScript to CommonJS, so `import.meta` is not
 * available here and `__dirname` is; `process.cwd()` is the fallback.
 */
const loadDatabaseUrl = (): string => {
  if (!process.env.DATABASE_URL) {
    const candidates = [
      resolve(__dirname, "../../.env"),
      resolve(process.cwd(), ".env"),
    ];

    for (const candidate of candidates) {
      try {
        process.loadEnvFile(candidate);
        break;
      } catch {
        // Try the next candidate; the explicit error below covers "none of
        // them worked", which is the only outcome the caller cares about.
      }
    }
  }

  const url = process.env.DATABASE_URL;

  if (!url) {
    throw new Error(
      "DATABASE_URL is not set. E2E teardown needs it to remove the accounts the suite created.",
    );
  }

  return url;
};

const getClient = async (): Promise<Client> => {
  if (client) return client;

  const next = new Client({ connectionString: loadDatabaseUrl() });

  await next.connect();
  client = next;

  return client;
};

/**
 * The guard. Throws rather than returning a boolean so a caller cannot
 * accidentally ignore it.
 */
const assertDeletable = (email: string) => {
  if (
    !TEARDOWN_EMAIL_PATTERN.test(email) ||
    !email.startsWith(TEARDOWN_EMAIL_PREFIX) ||
    !email.endsWith(`@${TEARDOWN_EMAIL_DOMAIN}`)
  ) {
    throw new Error(
      `E2E teardown refused to delete "${email}": it is not an address this suite generates. ` +
        `Only ${String(TEARDOWN_EMAIL_PATTERN)} is deletable.`,
    );
  }
};

/**
 * Removes exactly one account and the rows that belong to it.
 *
 * Never throws on a miss: a test that failed before signing up has nothing to
 * remove, and turning that into a second error would bury the real failure. It
 * *does* throw when the guard rejects the address, because that means the
 * suite computed an email it does not understand and should stop.
 */
export const deleteTestAccount = async (email: string): Promise<void> => {
  assertDeletable(email);

  const connection = await getClient();

  const found = await connection.query<{ id: string }>(
    'SELECT id FROM "user" WHERE email = $1',
    [email],
  );

  const userId = found.rows[0]?.id;

  if (!userId) return;

  await connection.query("BEGIN");

  try {
    await connection.query('DELETE FROM "todo" WHERE "userId" = $1', [userId]);
    await connection.query('DELETE FROM "session" WHERE "userId" = $1', [userId]);
    await connection.query('DELETE FROM "account" WHERE "userId" = $1', [userId]);
    // Both predicates, so this can only ever match the row we just resolved.
    await connection.query('DELETE FROM "user" WHERE id = $1 AND email = $2', [
      userId,
      email,
    ]);
    await connection.query("COMMIT");
  } catch (error) {
    await connection.query("ROLLBACK");

    throw error;
  }
};

export const disconnectDatabase = async (): Promise<void> => {
  if (!client) return;

  await client.end();
  client = null;
};
