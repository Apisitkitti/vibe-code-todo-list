import type { Page } from "@playwright/test";

import {
  CANCEL_LABEL,
  CREATE_MODAL_HEADING,
  MORE_OPTIONS_LABEL,
  TITLE_FIELD_LABEL,
} from "./support/copy";
import { expect, test } from "./support/fixtures";

/**
 * The create modal is one dialog per opening (PM backlog #2).
 *
 * `createSeq` feeds the modal's `key`, so every extra bump is a remount: React
 * discards the mounted form and builds a new one from `createDraft`, taking
 * whatever the user had typed since it opened with it. Nothing on screen says
 * so — the dialog is still there, still headed `New todo`, and the title field
 * has simply gone back to the draft.
 *
 * **The reason this survived is that a mouse cannot reach it.** By the time a
 * second click could land, the backdrop is up and `isDismissable` closes the
 * dialog on that press instead — a real double-click opens and dismisses, and
 * never re-keys anything. What reaches the button is a press carrying no
 * pointer events, so nothing reads it as an interaction outside the overlay:
 * a **virtual click**, which is what a screen reader's activation, voice
 * control and `element.click()` all produce. That is a real user, on the
 * assistive path, losing typed text silently — and it is the only way to drive
 * the defect, which is why this spec drives it that way rather than with
 * `dblclick`.
 */

const DRAFT_LINE = "Draft the quarterly report tomorrow high";
const DRAFT_TITLE = "Draft the quarterly report";
const TYPED_AFTER_OPENING = "Something the user typed in the dialog";

/**
 * Counts dialog elements entering and leaving the document.
 *
 * A remount is a removal followed by an insertion, which is invisible to any
 * assertion made after it has settled — the dialog looks the same either way.
 * Only watching the DOM as it happens can tell "still the dialog you opened"
 * from "a replacement that looks like it".
 */
const watchDialogMounts = async (page: Page) => {
  await page.evaluate(() => {
    const counters = { mounts: 0, removals: 0 };

    (window as unknown as { __dialogCounters: typeof counters }).__dialogCounters =
      counters;

    const holdsDialog = (node: Node) =>
      node instanceof HTMLElement &&
      node.querySelector('[data-slot="modal-dialog"]') !== null;

    new MutationObserver((records) => {
      for (const record of records) {
        record.addedNodes.forEach((node) => {
          if (holdsDialog(node)) counters.mounts += 1;
        });
        record.removedNodes.forEach((node) => {
          if (holdsDialog(node)) counters.removals += 1;
        });
      }
    }).observe(document.body, { childList: true, subtree: true });
  });
};

const readDialogMounts = (page: Page) =>
  page.evaluate(
    () =>
      (window as unknown as { __dialogCounters: { mounts: number; removals: number } })
        .__dialogCounters,
  );

/**
 * Activates the button the way assistive technology does: a `click` with no
 * pointer events behind it. react-aria's `usePress` treats it as a press;
 * nothing treats it as an interaction outside the overlay.
 */
const virtualPressMoreOptions = (page: Page) =>
  page.evaluate((label) => {
    const button = [...document.querySelectorAll("button")].find(
      (candidate) => candidate.textContent?.trim() === label,
    );

    if (!button) throw new Error(`No button labelled ${label}`);

    button.click();
  }, MORE_OPTIONS_LABEL);

test.describe("More options opens one dialog per opening", () => {
  test("a second press while the dialog is open keeps the dialog and the typed text", async ({
    todos,
    signedIn: page,
  }) => {
    const titleField = page.getByRole("textbox", { name: TITLE_FIELD_LABEL });

    await todos.quickAddInput.fill(DRAFT_LINE);
    await watchDialogMounts(page);

    await page
      .getByRole("button", { name: MORE_OPTIONS_LABEL, exact: true })
      .click();
    await expect(
      page.getByRole("heading", { name: CREATE_MODAL_HEADING }),
    ).toBeVisible();
    // The handoff worked: the bar's reading arrived, so what follows is edited
    // on top of it rather than typed from nothing.
    await expect(titleField).toHaveValue(DRAFT_TITLE);

    await titleField.fill(TYPED_AFTER_OPENING);

    await virtualPressMoreOptions(page);

    /*
      The user-visible half. A remount rebuilds the form from `createDraft`, so
      the field would read `DRAFT_TITLE` again — the exact text the user had
      just replaced, which is why it is the assertion that says what the defect
      costs rather than merely that it happened.
    */
    await expect(titleField).toHaveValue(TYPED_AFTER_OPENING);
    await expect(page.getByRole("dialog")).toBeVisible();

    /*
      And the mechanical half, because the two are separable: a remount that
      happened to restore the same text would still be a remount, and would
      still have dropped focus and any field error on the way through.
    */
    expect(await readDialogMounts(page)).toEqual({ mounts: 1, removals: 0 });
  });

  /**
   * The handoff's invariant, from the outside: two presses, one question, one
   * answer. `ask` supersedes rather than overwrites precisely so a stranded
   * opener is impossible (`src/lib/handoff.ts`, Senior F5) — the guard must
   * not have traded that away for the fix. A superseded opener would answer
   * `false` early and focus the bar out from under the open dialog; an
   * unanswered one would leave the bar's `await` hanging forever, so its text
   * would never come back on the dismissal.
   */
  test("two presses leave exactly one question, answered once by the dismissal", async ({
    todos,
    signedIn: page,
  }) => {
    const dialog = page.getByRole("dialog");

    await todos.quickAddInput.fill(DRAFT_LINE);
    await watchDialogMounts(page);

    await page
      .getByRole("button", { name: MORE_OPTIONS_LABEL, exact: true })
      .click();
    await expect(dialog).toBeVisible();

    await virtualPressMoreOptions(page);

    // Focus is still where the dialog put it, not pulled back to the bar by an
    // opener that was answered early.
    await expect(page.getByRole("textbox", { name: TITLE_FIELD_LABEL })).toBeFocused();

    await dialog.getByRole("button", { name: CANCEL_LABEL, exact: true }).click();
    await expect(dialog).toHaveCount(0);

    // DEF-23 still holds for both openers: nothing committed, nothing lost.
    await expect(todos.quickAddInput).toBeFocused();
    await expect(todos.quickAddInput).toHaveValue(DRAFT_LINE);
    await expect(todos.row(DRAFT_TITLE)).toHaveCount(0);

    // And the modal is reopenable, which is what proves the guard released.
    await page
      .getByRole("button", { name: MORE_OPTIONS_LABEL, exact: true })
      .click();
    await expect(dialog).toBeVisible();

    expect((await readDialogMounts(page)).mounts).toBe(2);
  });
});
