import { defineConfig, devices } from "@playwright/test";

/**
 * Playwright end-to-end harness.
 *
 * The app is served by `next dev` on a loopback port that is deliberately not
 * 3000: `src/lib/auth.ts` derives the auth base URL from the request in
 * development (restricted to `localhost:*` / `127.0.0.1:*`), so any loopback
 * port works and this suite never has to contend for 3000 with a running dev
 * server. A production `next start` would need `BETTER_AUTH_URL` pinned to the
 * same port, which is why dev mode is the right target here.
 */

/** Not 3000 — see the note above. */
const PORT = 3117;
const BASE_URL = `http://127.0.0.1:${PORT}`;

/**
 * `next dev` compiles routes on first request, so the first navigation in a
 * run pays a multi-second compile that has nothing to do with the behaviour
 * under test. These budgets are generous for that reason alone; every
 * assertion inside a test is still web-first and waits for a condition, never
 * for a duration.
 */
const WEB_SERVER_TIMEOUT_MS = 180_000;
const TEST_TIMEOUT_MS = 90_000;
const EXPECT_TIMEOUT_MS = 15_000;
const ACTION_TIMEOUT_MS = 20_000;

export default defineConfig({
  testDir: "./e2e",
  /*
    One worker. Accounts are isolated per test, so the database is not the
    constraint — the dev server is: parallel workers make one Next.js compiler
    serve several cold routes at once, which turns compile time into flake that
    looks like product failure.
  */
  workers: 1,
  fullyParallel: false,
  /*
    A retry would mask exactly the intermittent faults this suite exists to
    catch, so failures stay failures. CI gets `forbidOnly` instead.
  */
  retries: 0,
  forbidOnly: !!process.env.CI,
  timeout: TEST_TIMEOUT_MS,
  expect: { timeout: EXPECT_TIMEOUT_MS },
  reporter: process.env.CI ? [["list"], ["html", { open: "never" }]] : [["list"]],
  use: {
    baseURL: BASE_URL,
    actionTimeout: ACTION_TIMEOUT_MS,
    trace: "retain-on-failure",
    video: "retain-on-failure",
    screenshot: "only-on-failure",
  },
  projects: [
    {
      name: "chromium-desktop",
      /*
        1280×800. The row action buttons are `lg:opacity-0` until hover or
        focus-within, and `TodoRow`'s tooltips are gated on
        `(min-width: 640px)` — both need a real desktop viewport with a real
        pointer, which is the whole point of §4 of this suite.
      */
      use: { ...devices["Desktop Chrome"], viewport: { width: 1280, height: 800 } },
    },
  ],
  webServer: {
    command: `npm run dev -- --port ${PORT} --hostname 127.0.0.1`,
    url: BASE_URL,
    timeout: WEB_SERVER_TIMEOUT_MS,
    /*
      Reuse a server this suite already started, but never adopt or kill an
      unrelated process: on CI the port is always ours to bind.
    */
    reuseExistingServer: !process.env.CI,
    stdout: "pipe",
    stderr: "pipe",
  },
});
