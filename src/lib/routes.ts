/**
 * Route paths and the one `?next=` sanitiser, shared by the proxy, the data
 * access layer and the auth pages so the three cannot drift apart.
 */
export const TODOS_PATH = "/todos";
export const SIGN_IN_PATH = "/sign-in";
export const SIGN_UP_PATH = "/sign-up";

export const NEXT_PARAM = "next";

/**
 * Header the proxy stamps onto the forwarded request so server components can
 * recover the requested path. Next does not expose the pathname to
 * `headers()` on its own.
 */
export const PATHNAME_HEADER = "x-pathname";

/**
 * Accepts only a path that stays on this origin, and returns `null` for
 * everything else.
 *
 * A leading `//` or `/\` is a protocol-relative URL — under WHATWG parsing a
 * backslash is treated as a slash, so `new URL("/\\evil.com", origin)` resolves
 * to `https://evil.com/`. Anything with a backslash anywhere is rejected rather
 * than normalised, and so is a scheme-ish or absolute value.
 */
export const sanitiseNextPath = (value: string | string[] | undefined | null): string | null => {
  if (typeof value !== "string") return null;
  if (value.includes("\\")) return null;
  // Must be a single leading slash: rejects "", "todos", "//host", "https://host".
  if (!/^\/(?![/\\])/.test(value)) return null;

  return value;
};

/** `/sign-in`, carrying the requested path when there is a safe one to carry. */
export const signInPathWithNext = (value: string | string[] | undefined | null): string => {
  const nextPath = sanitiseNextPath(value);

  if (!nextPath) return SIGN_IN_PATH;

  const params = new URLSearchParams({ [NEXT_PARAM]: nextPath });

  return `${SIGN_IN_PATH}?${params.toString()}`;
};
