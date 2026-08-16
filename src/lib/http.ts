import axios, { isAxiosError } from "axios";

import { SIGN_IN_PATH, signInPathWithNext } from "@/lib/routes";

/**
 * The one shared axios instance (`docs/CONVENTIONS.md` → HTTP).
 * Services import this rather than calling `axios.get` directly.
 */
const API_BASE_URL = process.env.NEXT_PUBLIC_API_BASE_URL ?? "/api";
const REQUEST_TIMEOUT_MS = 15000;
const UNAUTHORIZED_STATUS = 401;

export const http = axios.create({
  baseURL: API_BASE_URL,
  timeout: REQUEST_TIMEOUT_MS,
  // Session auth is cookie based, so credentials must ride along.
  withCredentials: true,
  headers: {
    Accept: "application/json",
    "Content-Type": "application/json",
  },
});

/**
 * A session that expires mid-visit used to strand the user: the request failed
 * with a 401, the list showed "Sign in again to continue" beside a Try again
 * button that could only fail again, the header still showed them signed in,
 * and nothing on the page led to sign-in. `src/proxy.ts` only redirects a full
 * navigation, so the page they were already on never re-checked (QA DEF-13,
 * `docs/PRD.md` US-03).
 *
 * Sending them to sign-in with the current path preserved is the same
 * treatment `requireUser()` gives a server render, so the two paths now agree.
 * A full assignment rather than a router push: the session is gone, so every
 * cached client state above this call is stale and worth discarding.
 */
const redirectToSignIn = () => {
  if (typeof window === "undefined") return;

  const { pathname, search } = window.location;

  // Already heading there — a second assignment would fight the first, and a
  // 401 raised by the sign-in page itself must not loop.
  if (pathname === SIGN_IN_PATH) return;

  window.location.assign(signInPathWithNext(`${pathname}${search}`));
};

// Errors are otherwise re-rejected untouched: formatting belongs to
// `getErrorMessage`, and services must not reshape responses.
http.interceptors.response.use(
  (response) => response,
  (error: unknown) => {
    if (isAxiosError(error) && error.response?.status === UNAUTHORIZED_STATUS) {
      redirectToSignIn();
    }

    return Promise.reject(error);
  },
);

export default http;
