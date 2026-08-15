import axios from "axios";

/**
 * The one shared axios instance (`docs/CONVENTIONS.md` → HTTP).
 * Services import this rather than calling `axios.get` directly.
 *
 * Note: application data in this app moves through server actions, which do
 * not need axios. This instance is here for real HTTP endpoints (route
 * handlers) so that base URL, credentials and timeout are configured once.
 */
const API_BASE_URL = process.env.NEXT_PUBLIC_API_BASE_URL ?? "/api";
const REQUEST_TIMEOUT_MS = 15000;

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

// Single hook point for cross-cutting concerns. Errors are deliberately
// re-rejected untouched: formatting belongs to `getErrorMessage`, and
// services must not reshape responses.
http.interceptors.response.use(
  (response) => response,
  (error) => Promise.reject(error),
);

export default http;
