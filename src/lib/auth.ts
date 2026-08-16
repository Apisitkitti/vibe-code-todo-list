import { betterAuth } from "better-auth";
import { prismaAdapter } from "better-auth/adapters/prisma";
import { nextCookies } from "better-auth/next-js";

import { prisma } from "@/lib/prisma";

const isProduction = process.env.NODE_ENV === "production";

/** Any port, so `next dev` can fall back to 3001 when 3000 is taken. */
const LOCAL_HOSTS = ["localhost:*", "127.0.0.1:*"];
const LOCAL_ORIGINS = ["http://localhost:*", "http://127.0.0.1:*"];

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
const baseURL = isProduction
  ? process.env.BETTER_AUTH_URL
  : { allowedHosts: LOCAL_HOSTS, protocol: "http" as const };

export const auth = betterAuth({
  baseURL,
  trustedOrigins: isProduction ? [] : LOCAL_ORIGINS,
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
