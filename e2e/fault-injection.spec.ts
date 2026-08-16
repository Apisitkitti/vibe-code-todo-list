import {
  CREATE_FAILURE,
  DELETE_FAILURE,
  EDIT_FAILURE,
  INTERNAL_ERROR_MESSAGE,
  LIST_ERROR_TITLE,
  TOGGLE_FAILURE,
  TRY_AGAIN_LABEL,
  UNAUTHORIZED_MESSAGE,
  UNDO_FAILURE,
  addedToast,
  deletedToast,
  markedCompleteToast,
  markedNotCompleteToast,
  removedToast,
  restoredToast,
  updatedToast,
} from "./support/copy";
import {
  TODO_ITEM_URL,
  TODO_LIST_URL,
  TODO_STATUS_URL,
  expectAbsentNow,
  expectNoFalseSuccess,
  expectNoTransportLeak,
  fulfilApiError,
  fulfilOpaqueError,
} from "./support/assertions";
import { expect, test } from "./support/fixtures";

/**
 * Fault injection — the gap that made two real defects invisible.
 *
 * Every test here forces a failure the happy path never sees and asserts what
 * the *user* is left looking at. Two things are checked every time:
 *
 *   1. the message is copy-deck wording, never a raw axios string;
 *   2. there is no false success — a failed write must not report as done,
 *      and must not leave the list showing something that did not happen.
 *
 * `getErrorMessage` has two branches, and both are exercised deliberately:
 * a 500 carrying the API's `{ code, message }` body surfaces that message,
 * while an opaque failure (an HTML 502 from a proxy, a dropped connection)
 * has no message to read and must fall through to the caller's copy-deck
 * fallback. The second branch is the one that would leak "Request failed with
 * status code 500" if the fallback were ever dropped.
 */

/*
  Deliberately not substrings of one another: `filter({ hasText })` matches on
  substring, so "Ship the release" would also match a row titled "Ship the
  release notes" and an assertion that the old title is gone would never pass.
*/
const TODO_TITLE = "Ship the release";
const EDITED_TITLE = "Draft the changelog";

test.describe("fault injection — writes", () => {
  test("500 on create shows copy-deck wording and does not add the todo", async ({
    signedIn: page,
    todos,
  }) => {
    await page.route(TODO_LIST_URL, async (route) => {
      if (route.request().method() !== "POST") return route.fallback();

      await fulfilApiError(route, 500, "INTERNAL", INTERNAL_ERROR_MESSAGE);
    });

    await page.getByRole("button", { name: "New todo", exact: true }).click();
    await todos.submitCreate(TODO_TITLE);

    // The API's own message is what the user reads when the body is intact.
    await expect(todos.toasts.filter({ hasText: INTERNAL_ERROR_MESSAGE })).toBeVisible();
    await expectNoTransportLeak(todos.toasts);

    // No false success: the modal stays open holding the typed values so the
    // work is not lost (`TodoFormModal.handleValidSubmit` returns before
    // `closeForm`), and the row was never added.
    await expect(page.getByRole("dialog")).toBeVisible();
    await expect(todos.rowByText(TODO_TITLE)).toHaveCount(0);
    await expectNoFalseSuccess(todos.toasts, addedToast(TODO_TITLE));
  });

  test("an opaque 500 on create falls back to the copy deck, not to axios", async ({
    signedIn: page,
    todos,
  }) => {
    await page.route(TODO_LIST_URL, async (route) => {
      if (route.request().method() !== "POST") return route.fallback();

      await fulfilOpaqueError(route, 502);
    });

    await page.getByRole("button", { name: "New todo", exact: true }).click();
    await todos.submitCreate(TODO_TITLE);

    await expect(todos.toasts.filter({ hasText: CREATE_FAILURE })).toBeVisible();
    await expectNoTransportLeak(todos.toasts);
    await expect(todos.rowByText(TODO_TITLE)).toHaveCount(0);
    await expectNoFalseSuccess(todos.toasts, addedToast(TODO_TITLE));
  });

  test("500 on edit keeps the old title and reports the failure", async ({
    signedIn: page,
    todos,
  }) => {
    await todos.createTodo(TODO_TITLE);

    await page.route(TODO_ITEM_URL, async (route) => {
      if (route.request().method() !== "PATCH") return route.fallback();

      await fulfilOpaqueError(route, 500);
    });

    await todos.openEdit(TODO_TITLE);
    await todos.submitEdit(EDITED_TITLE);

    await expect(todos.toasts.filter({ hasText: EDIT_FAILURE })).toBeVisible();
    await expectNoTransportLeak(todos.toasts);

    // The list must still show the record as it really is.
    await expect(page.getByRole("dialog")).toBeVisible();
    await expect(todos.rowByText(EDITED_TITLE)).toHaveCount(0);
    await expect(todos.rowByText(TODO_TITLE)).toBeVisible();
    await expectNoFalseSuccess(todos.toasts, updatedToast(EDITED_TITLE));
  });

  test("500 on toggle leaves the checkbox unchecked", async ({ signedIn: page, todos }) => {
    await todos.createTodo(TODO_TITLE);

    await page.route(TODO_STATUS_URL, async (route) => {
      await fulfilOpaqueError(route, 500);
    });

    await todos.toggle(TODO_TITLE, true);

    await expect(todos.toasts.filter({ hasText: TOGGLE_FAILURE })).toBeVisible();
    await expectNoTransportLeak(todos.toasts);

    /*
      The checkbox is deliberately not optimistic (`TodoRow`: "the box holds
      its current state until the server confirms"), so a failed toggle must
      leave it exactly as it was — this is the assertion that would catch a
      regression to optimistic rendering without rollback.
    */
    await expect(todos.checkbox(TODO_TITLE)).not.toBeChecked();
    await expectNoFalseSuccess(todos.toasts, markedCompleteToast(TODO_TITLE));
  });

  test("500 on delete keeps the row and reports the failure", async ({
    signedIn: page,
    todos,
  }) => {
    await todos.createTodo(TODO_TITLE);

    await page.route(TODO_ITEM_URL, async (route) => {
      if (route.request().method() !== "DELETE") return route.fallback();

      await fulfilOpaqueError(route, 500);
    });

    await todos.openDelete(TODO_TITLE);
    await todos.confirmDelete();

    await expect(todos.toasts.filter({ hasText: DELETE_FAILURE })).toBeVisible();
    await expectNoTransportLeak(todos.toasts);

    /*
      `handleDelete` calls `removeTodoLocally` only inside the success branch,
      so a failed delete must NOT drop the row — the optimistic removal added
      for QA DEF-11 must not have widened into an unconditional one.
    */
    await expect(todos.rowByText(TODO_TITLE)).toBeVisible();
    await expectNoFalseSuccess(todos.toasts, deletedToast(TODO_TITLE));
  });
});

test.describe("fault injection — the Undo request itself", () => {
  /*
    Each test lets the original write succeed and installs the fault only
    afterwards, so the failure lands on the Undo request and nothing else. No
    request counting is needed: the route simply does not exist until the write
    it would have broken is already done.
  */

  test("500 on a create-Undo reports failure and keeps the todo", async ({
    signedIn: page,
    todos,
  }) => {
    await todos.createTodo(TODO_TITLE);
    await expect(todos.undoButton).toBeVisible();

    // A create-Undo deletes the todo it just made.
    await page.route(TODO_ITEM_URL, async (route) => {
      if (route.request().method() !== "DELETE") return route.fallback();

      await fulfilOpaqueError(route, 500);
    });

    await todos.pressUndo();

    await expect(todos.toasts.filter({ hasText: UNDO_FAILURE })).toBeVisible();
    await expectNoTransportLeak(todos.toasts);

    // The undo failed, so the todo it would have removed is still there.
    await expect(todos.rowByText(TODO_TITLE)).toBeVisible();
    await expectNoFalseSuccess(todos.toasts, removedToast(TODO_TITLE));
  });

  test("500 on an edit-Undo reports failure and keeps the new values", async ({
    signedIn: page,
    todos,
  }) => {
    await todos.createTodo(TODO_TITLE);
    await todos.editTodo(TODO_TITLE, EDITED_TITLE);
    await expect(todos.rowByText(EDITED_TITLE)).toBeVisible();

    // An edit-Undo writes the pre-edit values back through the same PATCH.
    await page.route(TODO_ITEM_URL, async (route) => {
      if (route.request().method() !== "PATCH") return route.fallback();

      await fulfilOpaqueError(route, 500);
    });

    await todos.pressUndo();

    await expect(todos.toasts.filter({ hasText: UNDO_FAILURE })).toBeVisible();
    await expectNoTransportLeak(todos.toasts);

    await expect(todos.rowByText(EDITED_TITLE)).toBeVisible();
    await expect(todos.rowByText(TODO_TITLE)).toHaveCount(0);
    await expectNoFalseSuccess(todos.toasts, restoredToast(TODO_TITLE));
  });

  test("500 on a toggle-Undo reports failure and leaves the todo complete", async ({
    signedIn: page,
    todos,
  }) => {
    await todos.createTodo(TODO_TITLE);
    await todos.toggle(TODO_TITLE, true);
    await expect(todos.checkbox(TODO_TITLE)).toBeChecked();

    // A toggle-Undo flips it back through the same status route.
    await page.route(TODO_STATUS_URL, async (route) => {
      await fulfilOpaqueError(route, 500);
    });

    await todos.pressUndo();

    await expect(todos.toasts.filter({ hasText: UNDO_FAILURE })).toBeVisible();
    await expectNoTransportLeak(todos.toasts);

    await expect(todos.checkbox(TODO_TITLE)).toBeChecked();
    // The flip-back never happened, so nothing may claim it did.
    await expectNoFalseSuccess(todos.toasts, markedNotCompleteToast(TODO_TITLE));
  });
});

test.describe("fault injection — the list load", () => {
  test("an aborted list load shows the error slot, and Try again recovers", async ({
    signedIn: page,
    todos,
  }) => {
    /*
      `route.abort("failed")` is the closest thing to going offline mid-request:
      axios rejects with no `response`, so `getErrorMessage` has nothing to read
      and must use the fallback. Its own message here would be "Network Error".
    */
    await page.route(TODO_LIST_URL, async (route) => {
      if (route.request().method() !== "GET") return route.fallback();

      await route.abort("failed");
    });

    await page.reload();

    /*
      HeroUI's `Alert` carries no ARIA role — only `data-slot="alert-root"` —
      so the role cannot be the handle here. Worth noting on its own: the list
      error is announced to nobody.
    */
    const alert = page
      .locator('[data-slot="alert-root"]')
      .filter({ hasText: LIST_ERROR_TITLE });

    await expect(alert).toBeVisible();
    await expect(alert).toContainText(INTERNAL_ERROR_MESSAGE);
    await expectNoTransportLeak(alert);

    const retry = page.getByRole("button", { name: TRY_AGAIN_LABEL, exact: true });

    await expect(retry).toBeVisible();

    // Lift the fault, then prove the retry actually refetches.
    await page.unroute(TODO_LIST_URL);
    await retry.click();

    await expect(alert).toHaveCount(0);
    await expect(page.getByRole("heading", { name: "Your todos" })).toBeVisible();
    // A brand-new account: the empty state is the proof the load succeeded.
    await expect(todos.listSkeleton).toHaveCount(0);
  });
});

test.describe("fault injection — a mid-session 401", () => {
  /**
   * DOCUMENTS CURRENT BEHAVIOUR — this is a defect record, not an endorsement.
   *
   * `docs/DESIGN.md` §7.9 specifies a "Session expired" state with the title
   * `You've been signed out` and the description `Sign in again to continue.`
   * That copy is NOT implemented anywhere: `grep` finds the string only as the
   * default message of `ApiErrorCode.Unauthorized` in `src/lib/apiError.ts`.
   *
   * Nothing on the client inspects a response status. `getErrorMessage` maps
   * every failure to a string, so a 401 is reported exactly like a 500 — as an
   * ordinary red toast — and the app stays on `/todos` with no route change,
   * no re-auth prompt, and no way forward except a manual reload. The session
   * is gone but the UI keeps offering mutations that can only fail.
   *
   * The assertions below pin that behaviour so the day it is fixed, this test
   * fails and gets rewritten to assert the §7.9 copy instead.
   */
  test("a mid-session 401 dead-ends: a toast, no redirect, no session-expired copy", async ({
    signedIn: page,
    todos,
  }) => {
    await todos.createTodo(TODO_TITLE);

    // A real expiry, not a mocked one: drop the session cookie and let the
    // server issue the 401 itself.
    await page.context().clearCookies();

    await todos.toggle(TODO_TITLE, true);

    // What the user actually gets: the API's 401 message, as a plain toast.
    await expect(todos.toasts.filter({ hasText: UNAUTHORIZED_MESSAGE })).toBeVisible();
    await expectNoTransportLeak(todos.toasts);

    // The dead-end, asserted explicitly.
    await expect(page).toHaveURL(/\/todos$/);
    await expect(page.getByRole("heading", { name: "Your todos" })).toBeVisible();
    // Both quote styles, since §7.9 is written with a typographic apostrophe
    // and an implementation might reasonably use either. Read once, so this
    // means "never rendered" rather than "no longer rendered".
    await expectAbsentNow(
      page.getByText("You’ve been signed out"),
      "§7.9's session-expired copy is still unimplemented",
    );
    await expectAbsentNow(
      page.getByText("You've been signed out"),
      "§7.9's session-expired copy is still unimplemented",
    );
    // The toggle did not happen, and the row still invites another doomed try.
    await expect(todos.checkbox(TODO_TITLE)).not.toBeChecked();

    // Only a full navigation escapes, and only because `src/proxy.ts` checks
    // for the cookie on a document request. Nothing in the client does this.
    await page.reload();
    await expect(page).toHaveURL(/\/sign-in/);
  });
});
