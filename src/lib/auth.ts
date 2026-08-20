import { betterAuth } from "better-auth";
import { prismaAdapter } from "better-auth/adapters/prisma";
import { nextCookies } from "better-auth/next-js";

import { prisma } from "@/lib/prisma";

const isProduction = process.env.NODE_ENV === "production";

/** Any port, so `next dev` can fall back to 3001 when 3000 is taken. */
const LOCAL_HOSTS = ["localhost:*", "127.0.0.1:*"];

/**
 * Production pins the base URL to `BETTER_AUTH_URL`. Deriving it from the
 * request there would mean trusting the `Host` header, which an attacker
 * controls — that is how callback and reset links get poisoned.
 *
 * Development derives it from the request instead, restricted to loopback
 * hosts. Pinning it to port 3000 meant a second project holding that port
 * broke every auth call with `Invalid origin`, and the only way to run this
 * app was to kill the other one.
 */
const resolveBaseURL = () => {
  if (!isProduction) {
    return { allowedHosts: LOCAL_HOSTS, protocol: "http" as const };
  }

  const productionURL = process.env.BETTER_AUTH_URL;

  // Leaving it unset does not fall back to something safe: better-auth would
  // derive the origin from the request, which is the Host-header trust this
  // whole branch exists to avoid. Fail at boot instead of shipping that.
  if (!productionURL) {
    throw new Error(
      "BETTER_AUTH_URL must be set in production — auth would otherwise derive its origin from the request Host header.",
    );
  }

  return productionURL;
};

/**
 * Sign-in is the credential-guessing surface, and on this product a successful
 * guess is unrecoverable: there is no password reset, so an attacker who gets
 * in owns the account and the real owner has no way back. That asymmetry is
 * what these numbers are chosen against, not a generic "be careful".
 *
 * better-auth already ships a default of 3 attempts per 10 seconds on
 * `/sign-in`, `/sign-up`, `/change-password` and `/change-email`
 * (`getDefaultSpecialRules`). Ten seconds is the wrong unit for guessing: it
 * still permits 1,080 attempts an hour from one address, which walks a common
 * password list in days. What limits an online attacker is the sustained rate,
 * so these rules widen the window instead of shrinking the burst.
 *
 * `/sign-in/email` — 10 per 10 minutes, so 60 an hour. The burst is
 * deliberately larger than better-auth's 3: a person who has genuinely
 * forgotten which password they used, with no reset link to fall back on,
 * should not be locked out for mistyping four times. The hourly rate is what
 * was tightened — from 1,080 to 60 — and the burst is what was loosened, which
 * costs an attacker nothing they can use and costs a real user much less.
 *
 * `/sign-up/email` — 10 per hour, against bulk account creation. Higher than
 * one because a shared office address is one IP to this limiter, and the cost
 * of a false refusal here is a person who never becomes a user.
 *
 * Everything else keeps better-auth's default of 100 per 10 seconds. Tightening
 * the global bucket would reach `/get-session`, which runs on every page load
 * and is shared by everyone behind one NAT — the blast radius of getting that
 * number wrong is far worse than the abuse it would prevent.
 *
 * Paths are matched after `baseURL`'s own prefix is stripped
 * (`normalizePathname`), so these read `/sign-in/email`, not
 * `/api/auth/sign-in/email`.
 */
export const RATE_LIMIT_RULES = {
  "/sign-in/email": { window: 60 * 10, max: 10 },
  "/sign-up/email": { window: 60 * 60, max: 10 },
};

export const auth = betterAuth({
  baseURL: resolveBaseURL(),
  rateLimit: {
    // better-auth's own default is production-only, spelled out here because
    // it is load-bearing rather than incidental: the e2e suite signs up an
    // account per test and the limiter keys on `ip|path`, so all 248 tests
    // share one bucket from 127.0.0.1. Enabled outside production, the suite
    // would rate-limit itself. See `tests/api/rateLimit.test.ts`, which
    // builds its own instance rather than turning this on globally.
    enabled: isProduction,

    // Not "memory", which is the default. Vercel runs this as serverless
    // functions, and an in-process Map gives every warm instance its own
    // counter — the effective ceiling becomes the configured one times the
    // number of instances, and it resets on each cold start. The `rateLimit`
    // table is one shared bucket per `ip|path` and the adapter's increment is
    // atomic. It is why `prisma/migrations/0001_add_rate_limit` exists.
    storage: "database",
    customRules: RATE_LIMIT_RULES,
  },

  /**
   * **The limiter is only per-user if the client IP resolves, and the failure
   * mode is an outage rather than a weaker limit.** better-auth keys buckets on
   * `ip|path`; when it cannot establish a trustworthy IP it falls back to one
   * shared `no-trusted-ip` bucket per path, which would make the rule above ten
   * sign-ins per ten minutes *for the entire application*.
   *
   * The default is `x-forwarded-for` alone, and `getIPFromHeader` deliberately
   * returns `null` for a multi-hop chain unless `trustedProxies` is set —
   * anything else would let a caller spoof the leftmost entry and get a fresh
   * bucket per request. So a header carrying more than one hop resolves to
   * nothing, and the fallback is what a login page would feel.
   *
   * Vercel's own header carries a single client address, so it is preferred and
   * `x-forwarded-for` is kept as the fallback for local and any other runtime.
   * An unknown header name simply does not match and costs nothing.
   *
   * **Unverified against production — this is the one thing here that could not
   * be checked locally.** better-auth logs "Rate limiting could not determine a
   * client IP" exactly once per process when it falls back; that line appearing
   * in the Vercel logs after the first deploy is the signal that this list is
   * wrong, and it should be looked for deliberately rather than waited for.
   */
  advanced: {
    ipAddress: {
      ipAddressHeaders: ["x-vercel-forwarded-for", "x-real-ip", "x-forwarded-for"],
    },
  },
  database: prismaAdapter(prisma, {
    provider: "postgresql",
  }),
  emailAndPassword: {
    enabled: true,
    minPasswordLength: 8,
  },
  session: {
    expiresIn: 60 * 60 * 24 * 7,
    updateAge: 60 * 60 * 24,
  },
  plugins: [nextCookies()],
});

export type Session = typeof auth.$Infer.Session;
