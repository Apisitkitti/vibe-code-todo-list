import { resolve } from "node:path";

import { defineConfig, devices } from "@playwright/test";

import { resolveTestDatabaseUrl } from "./e2e/support/testDatabaseUrl";

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

/**
 * Not 3000 — see the note above — and overridable, because 3117 is only free
 * if this checkout is the only one running the suite.
 *
 * `reuseExistingServer` adopts whatever already answers on the port. With two
 * git worktrees on one machine that is not a convenience but a trap: the
 * second run adopts the first worktree's dev server and reports a pass for
 * code it never executed. That happened during the DEF-20 work, and it cost a
 * night of chasing flakes that were really one branch testing another's build.
 *
 * A worktree that runs its own suite sets `E2E_PORT` to something else. CI
 * leaves it unset: one checkout, one port, and `reuseExistingServer` is off
 * there anyway.
 */
const PORT = Number(process.env.E2E_PORT ?? 3117);
const BASE_URL = `http://127.0.0.1:${PORT}`;

/**
 * Resolved here, at config load, so the dev server this suite starts is handed
 * the test database rather than the app's own.
 *
 * This is the half that a delete-side guard cannot cover: the browser drives
 * the real app, so whatever `DATABASE_URL` the server booted with is what the
 * suite writes to. Pointing only the teardown client at a safe target would
 * leave every sign-up landing in production. `resolveTestDatabaseUrl` refuses
 * hosted hosts, any database not named `*_test`, and the app's own URL, so
 * aiming this suite at production is not something a stray env var can do by
 * accident.
 */
const TEST_DATABASE_URL = resolveTestDatabaseUrl(resolve(__dirname));

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
    {
      /*
        Mobile. Below both of the app's breakpoints, which changes real
        behaviour rather than just the layout: `showTooltips` is
        `useMediaQuery("(min-width: 640px)")` so row tooltips are not rendered
        at all, the row actions lose their `lg:opacity-0` hiding, and
        `TodoFormModal` switches to `size="full"` / `placement="bottom"`.

        The pointer specs are excluded — they assert hover affordances that by
        design do not exist here, and Pixel 7 emulates touch, where hover is
        not a thing. Everything else is viewport-independent and worth running
        twice.
      */
      name: "chromium-mobile",
      testIgnore: /pointer\.spec\.ts/,
      use: { ...devices["Pixel 7"] },
    },
  ],
  globalSetup: "./e2e/support/globalSetup.ts",
  webServer: {
    command: `npm run dev -- --port ${PORT} --hostname 127.0.0.1`,
    url: BASE_URL,
    timeout: WEB_SERVER_TIMEOUT_MS,
    /*
      The app reads `.env` on boot, so `DATABASE_URL` is overridden explicitly
      here — it is the only thing standing between a test sign-up and the
      production database.
    */
    env: { ...process.env, DATABASE_URL: TEST_DATABASE_URL },
    /*
      Reuse a server this suite already started, but never adopt or kill an
      unrelated process: on CI the port is always ours to bind.
    */
    reuseExistingServer: !process.env.CI,
    stdout: "pipe",
    stderr: "pipe",
  },
});
