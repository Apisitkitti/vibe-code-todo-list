import { cache } from "react";

import { headers } from "next/headers";
import { redirect } from "next/navigation";

import { auth } from "@/lib/auth";
import { PATHNAME_HEADER, signInPathWithNext } from "@/lib/routes";

/**
 * Data access layer entry point. Every server component and route handler
 * that touches user data must go through one of these.
 */

export const getSession = cache(async () => {
  return auth.api.getSession({ headers: await headers() });
});

export const requireUser = async () => {
  const session = await getSession();

  if (!session?.user) {
    // This is the branch that runs when the cookie is present but expired or
    // invalid — the proxy waves those through, so it never got the chance to
    // build the redirect. Preserve the requested path (`docs/PRD.md` US-04).
    const requestedPath = (await headers()).get(PATHNAME_HEADER);

    redirect(signInPathWithNext(requestedPath));
  }

  return session.user;
};
