/**
 * The header store that stands in for Next's request headers.
 *
 * `next/headers` is the only thing these tests mock. `@/lib/session` is left
 * alone deliberately: the routes call their own `getSession()`, which runs a
 * real better-auth lookup against a real session row, so what is under test is
 * real cookie parsing and real session validation. A signed-out case is then
 * genuinely "no cookie was sent" rather than "the mock was told to return
 * null", which is the only version of that test worth having.
 */

let store = new Headers();

/** Read by the `next/headers` mock. */
export const currentRequestHeaders = (): Headers => store;

export const setRequestHeaders = (headers: Headers): void => {
  store = headers;
};

/**
 * better-auth resolves its base URL from the request in development, so a
 * direct `auth.api.*` call with no `host` throws "Dynamic baseURL could not be
 * resolved". Route handlers get these for free from the real server.
 */
export const AUTH_ORIGIN_HEADERS = (): Headers =>
  new Headers({ host: "localhost:3000", origin: "http://localhost:3000" });

/**
 * Signed out: no cookie at all, rather than a cookie the lookup will reject.
 *
 * `Host` and `Origin` stay, because a real signed-out request has them — a
 * browser sends them whether or not anyone is logged in. Dropping them made
 * better-auth throw "Dynamic baseURL could not be resolved" before it ever
 * looked for a session, which would have turned every signed-out assertion
 * into a test that passed for the wrong reason.
 */
export const clearRequestHeaders = (): void => {
  store = AUTH_ORIGIN_HEADERS();
};

export const headersWithCookie = (cookie: string): Headers => {
  const headers = AUTH_ORIGIN_HEADERS();

  headers.set("cookie", cookie);

  return headers;
};
