import {
  CREATE_FAILURE,
  DELETE_FAILURE,
  EDIT_FAILURE,
  INTERNAL_ERROR_MESSAGE,
  LIST_ERROR_TITLE,
  TOGGLE_FAILURE,
  TRY_AGAIN_LABEL,
  UNDO_FAILURE,
  addedToast,
  deletedToast,
  doneCount,
  markedCompleteToast,
  markedNotCompleteToast,
  restoredToast,
  updatedToast,
} from "./support/copy";
import {
  TODO_ITEM_URL,
  TODO_LIST_URL,
  TODO_STATUS_URL,
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
/** A second row, so the `N of M done` counter has room to move. */
const SECOND_TITLE = "Book the venue";

test.describe("fault injection — writes", () => {
  test("500 on create shows copy-deck wording and does not add the todo", async ({
    signedIn: page,
    todos,
  }) => {
    await page.route(TODO_LIST_URL, async (route) => {
      if (route.request().method() !== "POST") return route.fallback();

      await fulfilApiError(route, 500, "INTERNAL", INTERNAL_ERROR_MESSAGE);
    });

    await todos.openCreate();
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

    await todos.openCreate();
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

  test("500 on toggle reverts the optimistic tick", async ({ signedIn: page, todos }) => {
    await todos.createTodo(TODO_TITLE);
    // A second todo, so the counter has somewhere to move to and from.
    await todos.createTodo(SECOND_TITLE);
    await expect(todos.doneCounter).toHaveText(doneCount(0, 2));

    /*
      Held, not fulfilled immediately, and that is the whole design of this
      test. The toggle is optimistic now (review m-7), so there are two
      distinct facts to prove and a fault that answers instantly can only ever
      show the second: that the box ticked *before* the server was consulted,
      and that it went back when the server refused. Holding the response opens
      the in-flight window and makes the first one observable.

      A gate, not a sleep — released by the test, never by a timer.
    */
    let releaseToggle = () => {};
    const toggleHeld = new Promise<void>((resolve) => {
      releaseToggle = resolve;
    });

    await page.route(TODO_STATUS_URL, async (route) => {
      await toggleHeld;
      await fulfilOpaqueError(route, 500);
    });

    await todos.toggle(TODO_TITLE, true);

    // 1. The tick lands under the finger, with nothing confirmed.
    await expect(todos.checkbox(TODO_TITLE)).toBeChecked();
    /*
      The counter moves with the flip. It is the one number this branch
      computes by hand — `reloadSilently()` used to be the only thing that ever
      corrected it, and the toggle path no longer calls it — so it is asserted
      as the string the user reads, not as a field on an object (review MA-2).
    */
    await expect(todos.doneCounter).toHaveText(doneCount(1, 2));
    // The row says the change is not yet a fact: dimmed and locked, so a
    // second press cannot race the PATCH still in flight (review m-4).
    await expect(todos.rowByText(TODO_TITLE)).toHaveAttribute("aria-busy", "true");
    // Nothing has claimed success while the write is still in the air.
    await expectNoFalseSuccess(todos.toasts, markedCompleteToast(TODO_TITLE));

    releaseToggle();

    await expect(todos.toasts.filter({ hasText: TOGGLE_FAILURE })).toBeVisible();
    await expectNoTransportLeak(todos.toasts);

    /*
      2. The revert, which is the only correctness property an optimistic
      write has: a refused toggle must leave the row exactly as it was.
      Removing the rollback from `runToggle`'s `catch` turns this red — the
      box stays ticked and the app has told the user something that did not
      happen. `docs/REVIEW.md` E-2 is the reason this test is not optional.
    */
    await expect(todos.checkbox(TODO_TITLE)).not.toBeChecked();
    await expect(todos.rowByText(TODO_TITLE)).toHaveAttribute("aria-busy", "false");
    // And the counter comes back with it — a revert that untick-ed the box but
    // left the header saying `1 of 2 done` is still a list disagreeing with
    // the database.
    await expect(todos.doneCounter).toHaveText(doneCount(0, 2));
    await expectNoFalseSuccess(todos.toasts, markedCompleteToast(TODO_TITLE));
  });

  test("500 on a toggle under Active brings the row back into the list", async ({
    signedIn: page,
    todos,
  }) => {
    await todos.createTodo(TODO_TITLE);
    await todos.createTodo(SECOND_TITLE);

    await page.goto("/todos?status=active");
    await expect(todos.rowByText(TODO_TITLE)).toBeVisible();

    let releaseToggle = () => {};
    const toggleHeld = new Promise<void>((resolve) => {
      releaseToggle = resolve;
    });

    await page.route(TODO_STATUS_URL, async (route) => {
      await toggleHeld;
      await fulfilOpaqueError(route, 500);
    });

    await todos.toggle(TODO_TITLE, true);

    /*
      Under a status filter the flip does not tick a box — it removes the row
      (`docs/PRD.md` US-07 ruling, US-10). So the revert has more to undo than
      a boolean: reverting the value while leaving the row absent would leave
      the filtered list showing fewer rows than a reload of the same URL,
      which is the exact property the ruling exists to protect.
    */
    await expect(todos.rowByText(TODO_TITLE)).toHaveCount(0);
    await expect(todos.doneCounter).toHaveText(doneCount(1, 2));

    releaseToggle();

    await expect(todos.toasts.filter({ hasText: TOGGLE_FAILURE })).toBeVisible();
    await expectNoTransportLeak(todos.toasts);

    await expect(todos.rowByText(TODO_TITLE)).toBeVisible();
    await expect(todos.checkbox(TODO_TITLE)).not.toBeChecked();
    await expect(todos.doneCounter).toHaveText(doneCount(0, 2));
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

  /*
    There was a "500 on a create-Undo" test here, and it is gone rather than
    rewritten. It failed the `DELETE` that a create's Undo issued and asserted
    the todo survived — but a create no longer offers an Undo at all
    (`docs/DESIGN.md` §7.15), so there is no request to fail and no button to
    press. Nothing about it could be salvaged into a test of current
    behaviour: the closest thing, a failing delete, is `fault-injection`'s
    delete test above, which already exists and goes through the confirm
    dialog rather than a toast.

    That a create raises no action at all is asserted directly, in
    `e2e/undo-semantics.spec.ts` → "added toasts are receipts, not controls".
  */

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

  test("500 on a toggle-Undo reverts the flip-back and leaves the todo complete", async ({
    signedIn: page,
    todos,
  }) => {
    await todos.createTodo(TODO_TITLE);
    await todos.toggle(TODO_TITLE, true);
    await expect(todos.checkbox(TODO_TITLE)).toBeChecked();

    /*
      Undo runs the same `runToggle` as the press it reverses, so it is
      optimistic in the same way and must revert in the same way. Held for the
      same reason as the toggle test above: the un-tick has to be observable
      before the failure lands, or this only ever proves the box never moved.
    */
    let releaseUndo = () => {};
    const undoHeld = new Promise<void>((resolve) => {
      releaseUndo = resolve;
    });

    // A toggle-Undo flips it back through the same status route.
    await page.route(TODO_STATUS_URL, async (route) => {
      await undoHeld;
      await fulfilOpaqueError(route, 500);
    });

    await todos.pressUndo();

    await expect(todos.checkbox(TODO_TITLE)).not.toBeChecked();
    await expect(todos.rowByText(TODO_TITLE)).toHaveAttribute("aria-busy", "true");

    releaseUndo();

    await expect(todos.toasts.filter({ hasText: UNDO_FAILURE })).toBeVisible();
    await expectNoTransportLeak(todos.toasts);

    // The flip-back was refused, so the tick the first press earned comes back.
    await expect(todos.checkbox(TODO_TITLE)).toBeChecked();
    await expect(todos.rowByText(TODO_TITLE)).toHaveAttribute("aria-busy", "false");
    // And nothing may claim the un-completion happened.
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
   * A session that dies mid-visit must not strand the user.
   *
   * It used to: `getErrorMessage` maps every failure to a string, so a 401
   * arrived as an ordinary red toast, the app stayed on `/todos`, the header
   * still showed a signed-in avatar, and the only escape was a manual reload —
   * `src/proxy.ts` checks the cookie on a document request, and nothing in the
   * client did. QA reached it by signing out and pressing Back, which is
   * `docs/PRD.md` US-03's acceptance criterion verbatim (DEF-13).
   *
   * The shared axios instance now redirects on a 401, carrying the current
   * path, so the client agrees with what `requireUser()` does on the server.
   */
  test("a mid-session 401 sends the user to sign in, keeping where they were", async ({
    signedIn: page,
    todos,
  }) => {
    await todos.createTodo(TODO_TITLE);

    // A real expiry, not a mocked one: drop the session cookie and let the
    // server issue the 401 itself.
    await page.context().clearCookies();

    await todos.toggle(TODO_TITLE, true);

    // Sign-in, with the page they were on preserved for the round trip back.
    await expect(page).toHaveURL(/\/sign-in\?next=%2Ftodos$/);
    await expect(page.getByRole("heading", { name: "Welcome back" })).toBeVisible();

    // And it is a real sign-in page, not a shell: the form is there to use.
    await expect(page.getByLabel("Email")).toBeVisible();
  });
});
