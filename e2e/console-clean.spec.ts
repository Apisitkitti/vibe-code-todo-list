import type { ConsoleMessage, Page } from "@playwright/test";

import {
  CANCEL_LABEL,
  CREATE_MODAL_HEADING,
  MORE_OPTIONS_LABEL,
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
