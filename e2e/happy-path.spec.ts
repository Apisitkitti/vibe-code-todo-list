import {
  DELETE_CONFIRM_HEADING,
  editModalHeading,
  PAGE_HEADING,
  SIGN_IN_HEADING,
  ACCOUNT_MENU_LABEL,
  SIGN_OUT_LABEL,
  addedToast,
  deleteConfirmBody,
  deletedToast,
  doneCount,
  markedCompleteToast,
  markedNotCompleteToast,
  updatedToast,
} from "./support/copy";
import {
  TODO_LIST_URL,
  TODO_STATUS_URL,
  countRequests,
  expectAbsentNow,
} from "./support/assertions";
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
    // The toolbar `New todo` button is retired (PM backlog #1). This exercises
    // the modal path, which is now reached from the bar's `More options`; the
    // bar's own keyboard journey is `e2e/quick-add.spec.ts`.
    await todos.openCreate();
    await todos.submitCreate(TODO_TITLE);

    await expect(todos.row(TODO_TITLE)).toBeVisible();
    /*
      Create does not confirm — it fires and reports (CONVENTIONS: Mutation
      UX). The receipt is the whole of it: a create's Undo was a `DELETE` and
      was withdrawn (`docs/DESIGN.md` §7.15), so this path offers no action.
      Asserted here rather than only in `undo-semantics.spec.ts` because this
      is the spec that walks the whole journey, and the Undo it presses further
      down belongs to the toggle — leaving the count unasserted here would let
      a create-Undo come back without this test noticing.
    */
    await expect(todos.toastTitles.filter({ hasText: addedToast(TODO_TITLE) })).toBeVisible();
    await expectAbsentNow(
      todos.undoButton,
      "a create offered an Undo on the happy path",
    );

    // ── Edit ─────────────────────────────────────────────────────────────────
    await todos.openEdit(TODO_TITLE);
    await expect(
      page.getByRole("heading", { name: editModalHeading(TODO_TITLE) }),
    ).toBeVisible();
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

  /**
   * The cost m-7 was actually about, pinned so it cannot creep back.
   *
   * A toggle used to be two sequential HTTP requests: the `PATCH`, whose
   * authoritative response body was discarded, and then a full `GET
   * /api/todos` to fetch that same row again — two session lookups and nine
   * database queries for one checkbox, measured against a real Postgres
   * (`docs/REVIEW.md` MA-1, which corrects §2.1's original figure of seven).
   * Splicing the `PATCH` response into local state deletes the second request
   * outright, taking it to one request and four queries.
   *
   * Asserted as a *count*, because a reinstated `reloadSilently()` would not
   * change a single thing the other tests look at — the list would still be
   * right, just fetched twice — so nothing else in this suite would notice.
   */
  test("a toggle is one request, with no list refetch behind it", async ({
    signedIn: page,
    todos,
  }) => {
    await todos.createTodo(TODO_TITLE);

    /*
      Reload first, so the counters start from a settled page: creating a todo
      legitimately refetches the list (a create can move the row or drop it out
      of the filter, so it keeps its reload), and that GET must not be counted
      against the toggle.
    */
    await page.reload();
    await expect(todos.row(TODO_TITLE)).toBeVisible();
    await expect(todos.doneCounter).toHaveText(doneCount(0, 1));

    const statusRequests = countRequests(page, TODO_STATUS_URL, "PATCH");
    const listRequests = countRequests(page, TODO_LIST_URL, "GET");

    await todos.toggle(TODO_TITLE, true);

    await expect(todos.checkbox(TODO_TITLE)).toBeChecked();
    await expect(
      todos.toastTitles.filter({ hasText: markedCompleteToast(TODO_TITLE) }),
    ).toBeVisible();

    expect(statusRequests.count, "a toggle writes exactly once").toBe(1);
    expect(
      listRequests.count,
      "the PATCH already returned the row — refetching the list is the round trip m-7 removed",
    ).toBe(0);

    /*
      And the counter is right without that refetch. `reloadSilently()` was
      incidentally the only thing that ever corrected it, so with the refetch
      gone this number is now pure client arithmetic — the one value on this
      branch computed by hand (review MA-2).
    */
    await expect(todos.doneCounter).toHaveText(doneCount(1, 1));
  });
});
