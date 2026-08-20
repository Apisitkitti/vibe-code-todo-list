import { betterAuth } from "better-auth";
import { prismaAdapter } from "better-auth/adapters/prisma";
import { beforeAll, describe, expect, test } from "vitest";

import { IP_ADDRESS_HEADERS, RATE_LIMIT_RULES, auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";

import { deleteTestUsers } from "../support/factory";

/**
 * The sign-in limiter.
 *
 * **The numbers are asserted as literals on purpose.** An earlier version of
 * this file derived every expectation from `RATE_LIMIT_RULES` and claimed in
 * its own docblock to pin them; it did not. Setting `max` to 3 passed, and
 * setting it to 60 passed — a six-fold loosening of the sign-in limit would
 * have shipped green. A test that reads its expectations from the thing under
 * test only proves the code is self-consistent. So the literals below are
 * duplicated deliberately, and changing the limit is meant to fail here and
 * make someone say why in a diff.
 *
 * **This builds its own better-auth instance instead of using `@/lib/auth`, and
 * that is a finding rather than a shortcut.** The real instance sets
 * `enabled: isProduction`, and it has to: better-auth keys buckets on `ip|path`
 * (`createRateLimitKey`), so every test in the e2e suite — each one signing up
 * an account, all from 127.0.0.1 — draws from a single bucket. Enabled outside
 * production, `/sign-up/email` at 10 an hour would throttle that suite into
 * failure, and the failure would look like a broken sign-up rather than a
 * working limiter. Turning the limits down until the suite fits would be the
 * wrong repair: they exist for production traffic, where one IP is roughly one
 * person, not for a runner where one IP is the whole suite.
 *
 * **`auth.api.*` bypasses the limiter; `auth.handler` does not.** Verified with
 * a limit of 2: through the handler the third attempt returned 429, while
 * `auth.api.signInEmail` returned 401 indefinitely. The limiter runs in the
 * request pipeline that only the handler traverses. That is why every request
 * below goes through `limitedAuth.handler` — driving `auth.api` instead would
 * produce a test that passes with the limiter switched off entirely.
 *
 * It is also why `tests/support/factory.ts` is unaffected by any of this: it
 * signs up through `auth.api.signUpEmail`. Nothing in the application relies on
 * that bypass for a credential path — the only `auth.api.*` call in `src/` is
 * `getSession`, and sign-in and sign-up reach `auth.handler` through
 * `/api/auth/[...all]`. But a future caller reaching for `auth.api.signInEmail`
 * would silently be unthrottled, which is worth knowing before someone does.
 *
 * Storage is `"memory"` rather than the `"database"` production uses. The
 * question here is whether a rule holds at its configured count, and the answer
 * is the same either way; memory also keeps this from depending on the
 * `rateLimit` table, so it still runs against a database that has not had
 * `0001_add_rate_limit` applied.
 */

const EMAIL_DOMAIN = "@rate-limit.test";

/** Duplicated from `src/lib/auth.ts` on purpose — see the note above. */
const EXPECTED_SIGN_IN = { window: 600, max: 10 };
const EXPECTED_SIGN_UP = { window: 3600, max: 10 };

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
  // The shipped list, imported rather than restated, so deleting it from
  // `src/lib/auth.ts` fails the per-address tests below.
  advanced: { ipAddress: { ipAddressHeaders: IP_ADDRESS_HEADERS } },
});

/**
 * A sign-in attempt for an account that does not exist, from a given address.
 * Whether the password is right is beside the point: the limiter runs on the
 * way in, before the handler looks anything up, so a wrong guess is counted
 * exactly like a right one — which is what makes it a defence against guessing.
 */
const attemptSignIn = (headers: Record<string, string> = {}) =>
  limitedAuth.handler(
    new Request("http://localhost:3000/api/auth/sign-in/email", {
      method: "POST",
      headers: { "content-type": "application/json", ...headers },
      body: JSON.stringify({
        email: `nobody${EMAIL_DOMAIN}`,
        password: "not-the-real-password",
      }),
    }),
  );

/** Drains one address's allowance, returning the statuses seen. */
const exhaust = async (headers: Record<string, string>, attempts: number) => {
  const statuses: number[] = [];

  for (let i = 0; i < attempts; i += 1) {
    statuses.push((await attemptSignIn(headers)).status);
  }

  return statuses;
};

beforeAll(async () => {
  await deleteTestUsers(EMAIL_DOMAIN);
});

/**
 * Asserted against `auth.options` — the shipped instance — rather than against
 * the exported constants, because the constants being correct proves nothing
 * about their being *wired*.
 *
 * This block exists because the first attempt at the per-address tests below
 * did not catch what it claimed to. Deleting the whole `advanced.ipAddress`
 * block from `src/lib/auth.ts` left them green: they build their own instance
 * and pass it `IP_ADDRESS_HEADERS` directly, so they exercised the constant and
 * never the configuration. Verified by making that deletion and watching the
 * suite stay green, which is the only way to know a guard guards anything.
 */
describe("the shipped auth instance", () => {
  const options = auth.options;

  test("reads the client address from the configured headers", () => {
    expect(options.advanced?.ipAddress?.ipAddressHeaders).toEqual([
      "x-vercel-forwarded-for",
      "x-real-ip",
      "x-forwarded-for",
    ]);
  });

  test("keeps rate-limit buckets in the database, not in memory", () => {
    // Memory storage gives each warm serverless instance its own counter, so
    // the real ceiling would be this limit times the instance count.
    expect(options.rateLimit?.storage).toBe("database");
  });

  test("carries the sign-in and sign-up rules", () => {
    expect(options.rateLimit?.customRules).toEqual({
      "/sign-in/email": { window: 600, max: 10 },
      "/sign-up/email": { window: 3600, max: 10 },
    });
  });

  test("is disabled outside production, so the e2e suite is not throttled", () => {
    // NODE_ENV is `test` here. This is the line that keeps every e2e sign-up
    // from sharing one 127.0.0.1 bucket; see the note at the top of this file.
    expect(options.rateLimit?.enabled).toBe(false);
  });
});

describe("the configured limits", () => {
  test("sign-in is 10 attempts per 10 minutes", () => {
    expect(RATE_LIMIT_RULES["/sign-in/email"]).toEqual(EXPECTED_SIGN_IN);
  });

  test("sign-up is 10 attempts per hour", () => {
    expect(RATE_LIMIT_RULES["/sign-up/email"]).toEqual(EXPECTED_SIGN_UP);
  });

  test("the client address is read from Vercel's header first", () => {
    // Order is the assertion, not membership: `x-forwarded-for` last is what
    // makes a multi-hop chain lose to a single-value header rather than
    // resolving to nothing and sharing one bucket globally.
    expect(IP_ADDRESS_HEADERS).toEqual([
      "x-vercel-forwarded-for",
      "x-real-ip",
      "x-forwarded-for",
    ]);
  });
});

describe("sign-in rate limiting", () => {
  test("allows 10 attempts from one address and refuses the 11th", async () => {
    const address = { "x-vercel-forwarded-for": "203.0.113.10" };
    const statuses = await exhaust(address, 10);

    // Every attempt inside the limit reaches the handler and is rejected on the
    // credentials — 401, not 429. Asserting this too is what stops the test
    // passing against a limiter set to zero.
    expect(statuses).toHaveLength(10);
    expect(statuses.every((status) => status !== 429)).toBe(true);

    expect((await attemptSignIn(address)).status).toBe(429);
  });

  test("says how long to wait, and not longer than the window", async () => {
    const address = { "x-vercel-forwarded-for": "203.0.113.11" };

    await exhaust(address, 10);

    const response = await attemptSignIn(address);

    expect(response.status).toBe(429);

    // better-auth sends `X-Retry-After`, not the standard `Retry-After`. Pinned
    // because it is the header a client has to read, and it is an easy thing to
    // "correct" to the standard spelling and break every caller.
    const retryAfter = Number(response.headers.get("x-retry-after"));

    expect(retryAfter).toBeGreaterThan(0);
    expect(retryAfter).toBeLessThanOrEqual(EXPECTED_SIGN_IN.window);
  });
});

/**
 * The riskiest thing in `src/lib/auth.ts` had no test: deleting the whole
 * `advanced.ipAddress` block left the suite, tsc and eslint green. It matters
 * because when better-auth cannot resolve a trustworthy address it does not
 * merely limit less precisely — it falls back to a single shared
 * `no-trusted-ip` bucket per path, which would make the rule above ten sign-ins
 * per ten minutes for the entire application. The failure mode of getting this
 * wrong is an outage on the login path, not a weaker limit.
 */
describe("buckets are per address", () => {
  test("exhausting one address does not refuse another", async () => {
    const exhausted = { "x-vercel-forwarded-for": "203.0.113.1" };
    const untouched = { "x-vercel-forwarded-for": "203.0.113.2" };

    await exhaust(exhausted, 10);

    expect((await attemptSignIn(exhausted)).status).toBe(429);

    // A shared fallback bucket would make this 429 as well. 401 proves the key
    // includes the address.
    expect((await attemptSignIn(untouched)).status).toBe(401);
  });

  test("Vercel's header wins over x-forwarded-for", async () => {
    const address = "203.0.113.3";

    await exhaust(
      { "x-vercel-forwarded-for": address, "x-forwarded-for": "198.51.100.1" },
      10,
    );

    // Same Vercel header, different `x-forwarded-for`. Still 429, so the
    // bucket followed the preferred header — if `x-forwarded-for` were winning
    // this would be a fresh bucket and a 401.
    const response = await attemptSignIn({
      "x-vercel-forwarded-for": address,
      "x-forwarded-for": "198.51.100.99",
    });

    expect(response.status).toBe(429);
  });
});
