import type { ConsoleMessage, Page } from "@playwright/test";

import {
  CANCEL_LABEL,
  CREATE_MODAL_HEADING,
  MORE_OPTIONS_LABEL,
  SIGN_IN_HEADING,
  SIGN_UP_HEADING,
} from "./support/copy";
import { expect, test } from "./support/fixtures";

/**
 * The browser console, asserted rather than read (review MI-7, QA DEF-02).
 *
 * The suite has never captured console output, which is why one warning has
 * been in every log this project has produced without ever failing anything.
 * QA's finding was that it is the *only* console output in any run — 12
 * occurrences in one walkthrough, 6 in another, one unique message — so the
 * gap was never noise drowning it out. There was simply no assertion.
 *
 * DEF-02 is `A PressResponder was rendered without a pressable child`, and it
 * is ours rather than HeroUI's. `Modal`'s root is react-aria's `DialogTrigger`
 * (`node_modules/@heroui/react/dist/components/modal/modal.js` → `ModalRoot`),
 * which wraps its children in a `PressResponder` unconditionally so a
 * `Modal.Trigger` beneath it can register as the pressable that opens the
 * dialog. `docs/DESIGN.md` §4.5 says explicitly not to use `Modal.Trigger`
 * here — the same modal is opened from the quick-add bar and from every row's
 * edit button — so nothing ever registers, and the responder warns once per
 * mount. `ConfirmDialog` had the identical defect and closed it the identical
 * way (`docs/REVIEW.md`, DEF-02 row): render the `Backdrop` directly and give
 * it the controlled props, since `ModalOverlay` builds its own overlay state
 * from `isOpen` / `onOpenChange` and provides the context the dialog, the
 * close trigger and Escape all read.
 *
 * This spec is deliberately about the whole console rather than that one
 * string. A suite that asserts only the warning it knows about learns nothing
 * the next time a different one appears.
 */

/**
 * Next's dev server is what serves this suite (see `playwright.config.ts`), so
 * its own development chatter is not the application's output and is not what
 * is being asserted here.
 */
const DEV_SERVER_NOISE = [
  /\[Fast Refresh\]/,
  /Download the React DevTools/,
  /^\[HMR\]/,
  /react-devtools/i,
];

const isApplicationMessage = (message: ConsoleMessage) => {
  if (!["error", "warning"].includes(message.type())) return false;

  return !DEV_SERVER_NOISE.some((pattern) => pattern.test(message.text()));
};

const captureConsole = (page: Page) => {
  const messages: string[] = [];

  page.on("console", (message) => {
    if (isApplicationMessage(message)) {
      messages.push(`${message.type()}: ${message.text()}`);
    }
  });
  page.on("pageerror", (error) => {
    messages.push(`pageerror: ${error.message}`);
  });

  return messages;
};

test("the todos screen and its create modal log nothing to the console", async ({
  todos,
  signedIn: page,
}) => {
  /*
    Attached after sign-up, which the `signedIn` fixture has already driven —
    this is about `/todos` and the modal it owns, and a reload gives the
    listener the page's whole life rather than the tail of it.
  */
  const messages = captureConsole(page);

  await page.reload();
  await expect(page.getByRole("heading", { name: "Your todos" })).toBeVisible();

  /*
    The modal is mounted for the whole life of the screen — `TodoListScreen`
    renders `TodoFormModal` unconditionally — so the warning is raised by the
    page load and not by opening the dialog. Opening it anyway, because the
    assertion should cover the surface the defect was reported against rather
    than the cheapest way to reach it.
  */
  await page.getByRole("button", { name: MORE_OPTIONS_LABEL, exact: true }).click();
  await expect(
    page.getByRole("heading", { name: CREATE_MODAL_HEADING }),
  ).toBeVisible();

  await page
    .getByRole("dialog")
    .getByRole("button", { name: CANCEL_LABEL, exact: true })
    .click();
  await expect(page.getByRole("dialog")).toHaveCount(0);

  // Creating through the modal exercises the dialog's own submit path, which
  // is where a second responder would be introduced if one ever were.
  await todos.createTodo("Console check");

  expect(messages).toEqual([]);
});

/**
 * The board, for the one thing that only this file can catch.
 *
 * The board is chosen by a media query, and a media query is a fact the server
 * does not have. HeroUI's `useMediaQuery` reads `matchMedia` during the *first
 * client render* by default, so the server rendered a list and the client built
 * a board over the top of it — React discarded the whole subtree with
 * "Hydration failed", and **every board test still passed**, because a
 * regenerated tree renders the same thing a moment later. Nothing but a console
 * assertion sees it.
 *
 * The fix is `initializeWithValue: false`, which makes the first client render
 * agree with the server and lets the hook's layout effect flip it before paint.
 * Restoring the default reintroduces the error here, which is the point of
 * pinning it.
 */
test("the board logs nothing to the console", async ({
  todos,
  signedIn: page,
  isMobile,
}) => {
  test.skip(isMobile === true, "the board needs a desktop viewport");

  await todos.quickAdd("Board console check");
  await expect(todos.row("Board console check")).toBeVisible();

  const messages = captureConsole(page);

  // A full navigation, so the listener sees the server-rendered document being
  // hydrated — which is the moment the mismatch happens.
  await page.goto("/todos?view=board");
  await expect(page.getByRole("heading", { name: "Your todos" })).toBeVisible();
  await expect(
    page.locator("main").getByRole("listitem").filter({ hasText: "Board console check" }),
  ).toBeVisible();

  expect(messages).toEqual([]);
});

/**
 * The two auth pages, which this spec did not cover until now.
 *
 * The gap was structural rather than accidental: every test in this file took
 * the `signedIn` fixture, and `signedIn` signs up — so the only view of
 * `/sign-up` any test in this suite ever had was the half-second it spent
 * filling the form on its way to `/todos`, with no listener attached and no
 * assertion on the far side. `/sign-in` was never visited at all.
 *
 * These are signed-out journeys, so they take the raw `page` and create no
 * account. That is also what makes them the right shape: an auth page is the
 * one surface in this app that a *signed-out* browser renders, and the
 * server's render of it is the first HTML a new user is ever handed.
 *
 * A mismatch here is not cosmetic. React discards the mismatched subtree and
 * rebuilds it, and these two screens are nothing but inputs — a field being
 * remounted underneath a cursor is how typed characters and focus go missing.
 * `/sign-up` is the app's second-most-important screen and the only one whose
 * failure costs a user who has not signed up yet.
 *
 * **These were written against a reported `/sign-up` hydration mismatch that
 * does not reproduce.** They have been watched failing — a `typeof window`
 * branch injected into `SignUpForm` turns them red with "Hydration failed" —
 * so a red here is real and is not this suite being new. What was tried, the
 * control that proved it can fail, and the conditions under which the report
 * should be reopened are in
 * `docs/decisions/2026-08-21-sign-up-hydration-does-not-reproduce.md`. Read it
 * before re-running that investigation.
 */
const expectCleanAuthPage = async (page: Page, path: string, heading: string) => {
  const messages = captureConsole(page);

  // A full navigation, so the listener sees the server-rendered document being
  // hydrated — the moment a mismatch is reported, and the only moment it is.
  await page.goto(path);
  await expect(page.getByRole("heading", { name: heading })).toBeVisible();

  /*
    Hydration errors are reported when React reconciles the server HTML, which
    it does after the first paint — so waiting for the heading is not on its
    own enough to have waited for the report. Touching a field is: it needs the
    client tree to be live and interactive, which is strictly later than
    hydration, and it exercises the input path the mismatch actually endangers.
  */
  const email = page.getByRole("textbox", { name: "Email" });

  await email.fill("console-check@e2e.invalid");
  await expect(email).toHaveValue("console-check@e2e.invalid");

  expect(messages).toEqual([]);
};

test("the sign-up page logs nothing to the console", async ({ page }) => {
  await expectCleanAuthPage(page, "/sign-up", SIGN_UP_HEADING);
});

test("the sign-in page logs nothing to the console", async ({ page }) => {
  await expectCleanAuthPage(page, "/sign-in", SIGN_IN_HEADING);
});
