import { getSessionCookie } from "better-auth/cookies";
import { NextResponse, type NextRequest } from "next/server";

import {
  PATHNAME_HEADER,
  SIGN_IN_PATH,
  SIGN_UP_PATH,
  TODOS_PATH,
  signInPathWithNext,
} from "@/lib/routes";

/**
 * Optimistic redirects only. This is NOT authorization: it looks at the
 * presence of a cookie, never at its validity. Real enforcement lives in
 * `requireUser()` inside every server component and route handler
 * (`docs/STACK.md`, `docs/PRD.md` NFR-02).
 */
const AUTH_PATHS = [SIGN_IN_PATH, SIGN_UP_PATH];

export const proxy = (request: NextRequest) => {
  const { nextUrl } = request;
  const { pathname } = nextUrl;

  const hasSessionCookie = getSessionCookie(request) !== null;
  const isAuthPath = AUTH_PATHS.includes(pathname);
  const isProtectedPath =
    pathname === TODOS_PATH || pathname.startsWith(`${TODOS_PATH}/`);

  if (!hasSessionCookie && isProtectedPath) {
    // Preserve the originally requested path (`docs/PRD.md` US-04).
    const target = signInPathWithNext(`${pathname}${nextUrl.search}`);

    return NextResponse.redirect(new URL(target, nextUrl.origin));
  }

  if (hasSessionCookie && isAuthPath) {
    return NextResponse.redirect(new URL(TODOS_PATH, nextUrl.origin));
  }

  // Next does not expose the pathname to `headers()`, so stamp it on the
  // forwarded request. `requireUser()` reads it to build `?next=` when a
  // present-but-invalid cookie fails the real session check.
  const requestHeaders = new Headers(request.headers);
  requestHeaders.set(PATHNAME_HEADER, `${pathname}${nextUrl.search}`);

  return NextResponse.next({ request: { headers: requestHeaders } });
};

export const config = {
  matcher: ["/sign-in", "/sign-up", "/todos/:path*"],
};
