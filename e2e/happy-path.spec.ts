import {
  DELETE_CONFIRM_HEADING,
  EDIT_MODAL_HEADING,
  PAGE_HEADING,
  SIGN_IN_HEADING,
  ACCOUNT_MENU_LABEL,
  SIGN_OUT_LABEL,
  addedToast,
  deleteConfirmBody,
  deletedToast,
  markedCompleteToast,
  markedNotCompleteToast,
  updatedToast,
} from "./support/copy";
import { expect, test } from "./support/fixtures";

/**
 * The end-to-end path a real user takes, in one test, against the real API and
 * the real database. Everything else in this suite injects a fault; this is
 * the spec that proves the app works when nothing is wrong.
 */

const TODO_TITLE = "Buy milk";
const EDITED_TITLE = "Buy oat milk";

test.describe("happy path", () => {
  test("signs up, creates, edits, toggles, undoes the toggle, deletes and signs out", async ({
    signedIn: page,
    account,
    todos,
  }) => {
    // Sign-up happened in the fixture; landing on /todos is the proof.
    await expect(page).toHaveURL(/\/todos$/);
    await expect(page.getByRole("heading", { name: PAGE_HEADING })).toBeVisible();

    // ── Create ───────────────────────────────────────────────────────────────
    // A brand-new account has no "New todo" toolbar button — the empty state
    // carries the only copy of that call to action (TodoListScreen: `hasTodos`).
    await page
      .getByRole("button", { name: "New todo", exact: true })
      .click();
    await todos.submitCreate(TODO_TITLE);

    await expect(todos.row(TODO_TITLE)).toBeVisible();
    // Create does not confirm — it fires and offers Undo (CONVENTIONS: Mutation UX).
    await expect(todos.toastTitles.filter({ hasText: addedToast(TODO_TITLE) })).toBeVisible();
    await expect(todos.undoButton).toBeVisible();

    // ── Edit ─────────────────────────────────────────────────────────────────
    await todos.openEdit(TODO_TITLE);
    await expect(page.getByRole("heading", { name: EDIT_MODAL_HEADING })).toBeVisible();
    await todos.submitEdit(EDITED_TITLE);

    await expect(todos.row(EDITED_TITLE)).toBeVisible();
    await expect(todos.rowByText(TODO_TITLE)).toHaveCount(0);
    await expect(
      todos.toastTitles.filter({ hasText: updatedToast(EDITED_TITLE) }),
    ).toBeVisible();

    // ── Toggle complete ──────────────────────────────────────────────────────
    await todos.toggle(EDITED_TITLE, true);

    await expect(todos.checkbox(EDITED_TITLE)).toBeChecked();
    await expect(
      todos.toastTitles.filter({ hasText: markedCompleteToast(EDITED_TITLE) }),
    ).toBeVisible();

    // ── Undo the toggle ──────────────────────────────────────────────────────
    /*
      Toasts auto-dismiss after 4s (HeroUI's DEFAULT_TOAST_TIMEOUT; the app
      never overrides it), so the Undo window is genuinely short. The click
      below is web-first — it waits for the button rather than for a duration —
      and nothing slow runs between the assertion above and this press.
    */
    await todos.pressUndo();

    await expect(todos.checkbox(EDITED_TITLE)).not.toBeChecked();
    await expect(
      todos.toastTitles.filter({ hasText: markedNotCompleteToast(EDITED_TITLE) }),
    ).toBeVisible();

    // ── Delete, which is the one action that still confirms ───────────────────
    await todos.openDelete(EDITED_TITLE);

    await expect(
      todos.confirmDialog.getByRole("heading", { name: DELETE_CONFIRM_HEADING }),
    ).toBeVisible();
    await expect(todos.confirmDialog).toContainText(deleteConfirmBody(EDITED_TITLE));

    await todos.confirmDelete();

    await expect(todos.confirmDialog).toBeHidden();
    await expect(todos.rowByText(EDITED_TITLE)).toHaveCount(0);
    await expect(
      todos.toastTitles.filter({ hasText: deletedToast(EDITED_TITLE) }),
    ).toBeVisible();

    // ── Sign out ─────────────────────────────────────────────────────────────
    await page.getByRole("button", { name: ACCOUNT_MENU_LABEL }).click();
    await page.getByRole("menuitem", { name: SIGN_OUT_LABEL }).click();

    await expect(page).toHaveURL(/\/sign-in/);
    await expect(page.getByRole("heading", { name: SIGN_IN_HEADING })).toBeVisible();

    // The account still exists until the fixture tears it down.
    expect(account.email).toContain("@e2e.invalid");
  });
});
