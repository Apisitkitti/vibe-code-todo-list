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
 * Ordered by preference, and exported so `tests/api/rateLimit.test.ts` can
 * exercise the list that actually ships rather than a copy of it.
 *
 * **When better-auth cannot resolve a trustworthy address it does not limit
 * less precisely — it falls back to a single shared `no-trusted-ip` bucket per
 * path**, which would make the sign-in rule below ten attempts per ten minutes
 * for the entire application. The failure mode of getting this list wrong is an
 * outage on the login path, not a weaker limit.
 *
 * `getIPFromHeader` returns `null` for any multi-hop `x-forwarded-for` unless
 * `trustedProxies` is configured, because trusting the leftmost entry would let
 * a caller mint a fresh bucket per request. Vercel sets its own single-value
 * header and overwrites `x-forwarded-for` with the immediate client address for
 * that same anti-spoofing reason, so the preferred header is listed first and
 * `x-forwarded-for` is kept last for local and other runtimes. A header name
 * that does not exist simply does not match, so this list cannot resolve worse
 * than the default.
 *
 * Per-address bucketing and this precedence are both covered by
 * `tests/api/rateLimit.test.ts`. What remains unverifiable off Vercel is which
 * header the platform actually sends; better-auth logs "Rate limiting could not
 * determine a client IP" once per process on the fallback path, and that line
 * in the logs after a deploy is the signal that this list is wrong.
 */
export const IP_ADDRESS_HEADERS = [
  "x-vercel-forwarded-for",
  "x-real-ip",
  "x-forwarded-for",
];

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
 * **This reduces guessing rather than solving it.** Buckets are keyed
 * `ip|path` with no per-account counter, so credential stuffing spread across
 * addresses gets a fresh allowance per address. A per-account failure counter,
 * or a lockout with a recovery path, is what would address that — and neither
 * is much use while there is no password reset to recover through.
 *
 * The window is per address, not per person: an office behind one NAT shares a
 * single sign-in bucket, as it does for sign-up. Everything else keeps
 * better-auth's default of 100 per 10 seconds, because tightening the global
 * bucket would reach `/get-session`, which runs on every page load and is
 * shared by everyone behind that same NAT.
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
    // it is load-bearing rather than incidental: the limiter keys on
    // `ip|path`, so every test in the e2e suite — each signing up its own
    // account, all from 127.0.0.1 — draws from one bucket. Enabled outside
    // production, the suite would rate-limit itself. See
    // `tests/api/rateLimit.test.ts`, which builds its own instance rather than
    // turning this on globally.
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

  advanced: {
    ipAddress: { ipAddressHeaders: IP_ADDRESS_HEADERS },
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
