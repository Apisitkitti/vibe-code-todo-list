import { betterAuth } from "better-auth";
import { prismaAdapter } from "better-auth/adapters/prisma";
import { beforeAll, describe, expect, test } from "vitest";

import { RATE_LIMIT_RULES } from "@/lib/auth";
import { prisma } from "@/lib/prisma";

import { deleteTestUsers } from "../support/factory";

/**
 * The sign-in limiter, pinned at the numbers rather than at "it is configured".
 *
 * A limiter is the kind of setting that can be switched off in a refactor
 * without a single test noticing, and the thing it protects — an account with
 * no password reset behind it, so a successful guess is permanent — is the
 * worst outcome this product has. So the assertion is on the response an
 * eleventh attempt actually gets.
 *
 * **This builds its own better-auth instance instead of testing `@/lib/auth`
 * directly, and that is a finding rather than a shortcut.** The real instance
 * sets `enabled: isProduction`, and it has to: better-auth keys its buckets on
 * `ip|path` (`createRateLimitKey`), so every test in the e2e suite — all of
 * which sign up an account, all of them from 127.0.0.1 — draws from one
 * bucket. Enabled outside production, `/sign-up/email` at 10 an hour would
 * throttle the suite into failure somewhere around the eleventh test, and the
 * failure would look like a broken sign-up rather than a working limiter.
 *
 * Turning the limiter down until the suite fits would be the wrong repair: the
 * numbers exist for production traffic, where one IP is roughly one person, not
 * for a test runner where one IP is the entire suite. What the suite needs is
 * to not be a special case in production config — hence an instance built here,
 * sharing the exported `RATE_LIMIT_RULES` so the numbers under test are the
 * numbers that ship.
 *
 * Storage is `"memory"` here rather than the `"database"` production uses. The
 * question this file asks is "does the rule hold at the configured count", and
 * the answer is the same either way; using memory also keeps the test from
 * depending on the `rateLimit` table, which is what lets it run against a
 * database that has not had `0001_add_rate_limit` applied yet.
 */

const EMAIL_DOMAIN = "@rate-limit.test";
const SIGN_IN_RULE = RATE_LIMIT_RULES["/sign-in/email"];

const limitedAuth = betterAuth({
  // Static, so nothing has to be resolved from a request header.
  baseURL: "http://localhost:3000",
  database: prismaAdapter(prisma, { provider: "postgresql" }),
  emailAndPassword: { enabled: true, minPasswordLength: 8 },
  rateLimit: {
    enabled: true,
    storage: "memory",
    customRules: RATE_LIMIT_RULES,
  },
});

/**
 * A sign-in attempt for an account that does not exist. Whether the password
 * is right is beside the point: the limiter runs on the way in, before the
 * handler looks anything up, so a wrong guess is counted exactly like a right
 * one — which is the property that makes it a defence against guessing.
 */
const attemptSignIn = () =>
  limitedAuth.handler(
    new Request("http://localhost:3000/api/auth/sign-in/email", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        email: `nobody${EMAIL_DOMAIN}`,
        password: "not-the-real-password",
      }),
    }),
  );

beforeAll(async () => {
  await deleteTestUsers(EMAIL_DOMAIN);
});

describe("sign-in rate limiting", () => {
  test(`allows ${SIGN_IN_RULE.max} attempts and refuses the next one`, async () => {
    const statuses: number[] = [];

    for (let attempt = 0; attempt < SIGN_IN_RULE.max + 1; attempt += 1) {
      statuses.push((await attemptSignIn()).status);
    }

    const allowed = statuses.slice(0, SIGN_IN_RULE.max);
    const refused = statuses[SIGN_IN_RULE.max];

    // Every attempt inside the limit reaches the handler and is rejected on
    // the credentials — a 401, not a 429. Asserting this rather than only the
    // final refusal is what stops the test passing on a limiter set to zero.
    expect(allowed.every((status) => status !== 429)).toBe(true);
    expect(refused).toBe(429);
  });

  test("says how long to wait", async () => {
    // The bucket is already full from the test above: same key, same window,
    // and the window is ten minutes, so nothing has expired in between.
    const response = await attemptSignIn();

    expect(response.status).toBe(429);

    // better-auth sends `X-Retry-After`, not the standard `Retry-After`.
    // Pinned because it is the header a client would have to read, and it is
    // easy to "correct" to the standard spelling and break every caller.
    const retryAfter = Number(response.headers.get("x-retry-after"));

    expect(retryAfter).toBeGreaterThan(0);
    expect(retryAfter).toBeLessThanOrEqual(SIGN_IN_RULE.window);
  });
});
