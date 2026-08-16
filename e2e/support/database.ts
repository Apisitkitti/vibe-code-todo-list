import { resolve } from "node:path";

import { Client } from "pg";

import { resolveTestDatabaseUrl } from "./testDatabaseUrl";

/**
 * Teardown, and nothing else.
 *
 * ── Why this file still guards as hard as it does ──────────────────────────
 *
 * The suite now targets a throwaway database — `./testDatabaseUrl.ts` refuses
 * hosted hosts, anything not named `*_test`, and the app's own URL — so the
 * catastrophic case this guard was written for should no longer be reachable.
 *
 * The guard stays anyway, at full strength, because the two protections fail
 * differently: the connection guard is one function that could be bypassed by
 * a future `TEST_DATABASE_URL` pointed somewhere unwise, or by a proxy that
 * makes a hosted database look local. There is no delete-account endpoint, so
 * removing a test account goes through raw SQL, and a mistake there is not a
 * failing test — it is a data-loss incident. Defence in depth is cheap here
 * and the failure mode is not.
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
 * The same target the dev server was started with.
 *
 * Deliberately NOT the app's `DATABASE_URL` from `.env`: this client and the
 * server under test must agree, and `resolveTestDatabaseUrl` is the single
 * place that decides which database that is. Reading `.env` here would let the
 * teardown client drift onto production even while the app was pointed
 * somewhere safe.
 *
 * Playwright transpiles TypeScript to CommonJS, so `import.meta` is not
 * available here and `__dirname` is.
 */
const getClient = async (): Promise<Client> => {
  if (client) return client;

  const next = new Client({
    connectionString: resolveTestDatabaseUrl(resolve(__dirname, "../..")),
  });

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
