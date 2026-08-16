import { expect, type Locator, type Page, type Route } from "@playwright/test";

import { AXIOS_LEAK_PATTERNS } from "./copy";

/**
 * Shared assertions and fault injectors.
 *
 * The fault injectors deliberately fulfil rather than abort where the point is
 * a server error, and abort where the point is a transport failure — the two
 * take different branches through `getErrorMessage` and the difference is the
 * whole subject of the fault-injection spec.
 */

/** The API's own error body: `{ code, message }` per `src/lib/apiError.ts`. */
export const apiErrorBody = (code: string, message: string) =>
  JSON.stringify({ code, message });

/**
 * A 500 that still speaks the API's contract. `getErrorMessage` reads
 * `response.data.message`, so this is what the user ends up reading.
 */
export const fulfilApiError = async (
  route: Route,
  status: number,
  code: string,
  message: string,
) => {
  await route.fulfill({
    status,
    contentType: "application/json",
    body: apiErrorBody(code, message),
  });
};

/**
 * A 500 that does NOT speak the contract — an HTML error page from a proxy or
 * load balancer, which is what a real outage usually looks like from the
 * browser. There is no `message` to read, so `getErrorMessage` must fall
 * through to the caller's copy-deck fallback. This is the case that would
 * expose a raw axios string if the fallback were ever removed.
 */
export const fulfilOpaqueError = async (route: Route, status: number) => {
  await route.fulfill({
    status,
    contentType: "text/html",
    body: "<html><body>502 Bad Gateway</body></html>",
  });
};

/**
 * Asserts that nothing the user can read is transport noise. `getErrorMessage`
 * exists precisely to keep axios's own `message` ("Request failed with status
 * code 500", "Network Error") off the screen, and this is the assertion that
 * proves it still does.
 */
export const expectNoTransportLeak = async (locator: Locator) => {
  const texts = await locator.allInnerTexts();
  const joined = texts.join("\n");

  for (const pattern of AXIOS_LEAK_PATTERNS) {
    expect(
      joined,
      `raw transport text leaked to the user: ${pattern}`,
    ).not.toMatch(pattern);
  }
};

/**
 * Point-in-time check that nothing on screen is claiming success.
 *
 * This MUST NOT be written as `await expect(toasts.filter(...)).toHaveCount(0)`.
 * That assertion retries, and HeroUI toasts self-expire after four seconds
 * (`DEFAULT_TOAST_TIMEOUT`, never overridden by the app), so a retrying
 * "count is zero" sits and watches a false success toast expire and then
 * reports a pass. Demonstrated in review: making a failed toggle also raise
 * its success toast — the app lying to the user — left the retrying form green
 * and merely slower, 6.5s instead of 2.3s.
 *
 * Reading once, after the failure has already been asserted and the durable
 * state has settled, is what makes the absence mean "it never appeared"
 * instead of "it is not here any more".
 */
export const expectNoFalseSuccess = async (
  toasts: Locator,
  ...forbidden: string[]
) => {
  const onScreen = (await toasts.allInnerTexts()).join("\n");

  for (const message of forbidden) {
    expect(
      onScreen,
      `a failed mutation reported success: "${message}"`,
    ).not.toContain(message);
  }
};

/**
 * The same one-shot read for anything else whose absence is the assertion.
 * Retrying would again let a briefly-present element pass as never-present.
 */
export const expectAbsentNow = async (locator: Locator, reason: string) => {
  expect(await locator.count(), reason).toBe(0);
};

/**
 * Counts requests without changing them. Used to prove a press produced
 * exactly one request — the double-press guard's actual contract.
 */
export interface RequestCounter {
  get count(): number;
}

export const countRequests = (page: Page, match: RegExp, method: string): RequestCounter => {
  let count = 0;

  page.on("request", (request) => {
    if (request.method() === method && match.test(request.url())) count += 1;
  });

  return {
    get count() {
      return count;
    },
  };
};

/** URL shapes for the three todo endpoints, used by routes and counters alike. */
export const TODO_LIST_URL = /\/api\/todos(\?|$)/;
/** `[id]` only — excludes `/status`, which is a different mutation. */
export const TODO_ITEM_URL = /\/api\/todos\/[^/?]+$/;
export const TODO_STATUS_URL = /\/api\/todos\/[^/?]+\/status$/;
