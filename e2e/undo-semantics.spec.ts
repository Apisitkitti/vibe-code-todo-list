import {
  addedToast,
  deletedToast,
  markedCompleteToast,
  markedNotCompleteToast,
  removedToast,
  restoredToast,
  updatedToast,
} from "./support/copy";
import { TODO_STATUS_URL, countRequests } from "./support/assertions";
import { expect, test } from "./support/fixtures";

/**
 * Undo semantics — the behaviour no existing test covers and that two rounds
 * of review were spent on (review r-1, M-1, M-2).
 *
 * A note that shapes every test here: HeroUI toasts auto-dismiss after four
 * seconds (`DEFAULT_TOAST_TIMEOUT`, never overridden by the app), so an Undo
 * is only offered for that long. Where a test asserts a toast is *gone*, it
 * must therefore prove the app dismissed it rather than the clock — which is
 * why the "older Undo" test asserts on the count of armed Undos at the moment
 * the second write lands, instead of waiting for anything to expire.
 */

const TODO_TITLE = "Alpha";
const SECOND_TITLE = "Bravo";
const THIRD_TITLE = "Charlie";

test.describe("Undo semantics", () => {
  test("pressing Undo twice quickly sends exactly one request", async ({
    signedIn: page,
    todos,
  }) => {
    await todos.createTodo(TODO_TITLE);
    await todos.toggle(TODO_TITLE, true);
    await expect(
      todos.toastTitles.filter({ hasText: markedCompleteToast(TODO_TITLE) }),
    ).toBeVisible();

    const statusRequests = countRequests(page, TODO_STATUS_URL, "PATCH");

    /*
      Hold the Undo's request open until both clicks have happened, so the
      second press lands while the first is genuinely in flight. This is a
      gate, not a sleep: it is released by the test, never by a timer, so the
      race is reproduced deterministically rather than hopefully.

      The route is installed only now, after the real toggle already
      succeeded, so the only request it can ever see is the Undo's.
    */
    let releaseUndo = () => {};
    const undoHeld = new Promise<void>((resolve) => {
      releaseUndo = resolve;
    });

    /*
      `route.continue()`, not `route.fallback()`: falling back after awaiting
      does not forward the request to the network here, and the request is
      simply never sent. `continue()` is unambiguous — this handler is the last
      word and the request goes out.
    */
    await page.route(TODO_STATUS_URL, async (route) => {
      await undoHeld;
      await route.continue();
    });

    const undo = todos.undoButton;

    // Waits for the toast to stop animating into its stacked position before
    // anything reads or touches it.
    await expect(undo).toBeVisible();
    await undo.hover();

    /*
      Both presses are dispatched inside ONE browser task, and that detail is
      the entire test.

      This was verified by mutation, not assumed. With the guard removed from
      `showUndoableSuccess`, driving the second press through Playwright — a
      second `mouse.down()/up()` pair, or `dblclick()` — still produced exactly
      one request: every Playwright input call is a separate CDP round trip,
      and React unmounts the toast in the gap between them, so the second press
      lands on nothing and the test passes whether the guard exists or not.

      Dispatching both press sequences synchronously is what actually races the
      unmount. With the guard removed this produces two PATCHes and two
      "marked not complete" toasts; with it, one of each. That differential is
      what makes this test meaningful, and it is the reason it does not use the
      friendlier API.

      react-aria's `usePress` is driven by pointer events, so a bare `click()`
      is not enough — the full pointerdown / pointerup / click sequence is.
    */
    const pressed = await page.evaluate(() => {
      const button = document.querySelector<HTMLElement>(
        '[data-slot="toast-action-button"]',
      );

      if (!button) return false;

      const press = () => {
        const shared: PointerEventInit = {
          bubbles: true,
          cancelable: true,
          composed: true,
          button: 0,
          buttons: 1,
          pointerId: 1,
          pointerType: "mouse",
          isPrimary: true,
        };

        button.dispatchEvent(new PointerEvent("pointerdown", shared));
        button.dispatchEvent(new PointerEvent("pointerup", { ...shared, buttons: 0 }));
        button.dispatchEvent(
          new MouseEvent("click", {
            bubbles: true,
            cancelable: true,
            composed: true,
            button: 0,
          }),
        );
      };

      press();
      press();

      return true;
    });

    expect(pressed, "the Undo button must still be mounted to be pressed twice").toBe(
      true,
    );

    releaseUndo();

    // Wait for the undo to actually finish before counting, so the window in
    // which a second request could have appeared is closed by an observable
    // state change rather than by a duration.
    /*
      Settle on the outcome first, so the window in which a second request
      could still appear is closed by an observable state change rather than by
      a duration. The row ends up unchecked whether one undo ran or two, which
      is exactly why this is the wait and not the assertion.
    */
    await expect(todos.checkbox(TODO_TITLE)).not.toBeChecked();

    // The contract, asserted before anything more cosmetic: one press worth of
    // work reached the server.
    expect(
      statusRequests.count,
      "a double press must produce exactly one toggle request",
    ).toBe(1);

    /*
      Exactly one, not merely "at least one". A second undo raises a second
      identical toast, which is the user-visible half of the same defect.
    */
    await expect(
      todos.toastTitles.filter({ hasText: markedNotCompleteToast(TODO_TITLE) }),
    ).toHaveCount(1);
  });

  test("an older Undo is disarmed by a later edit and cannot overwrite it", async ({
    todos,
  }) => {
    await todos.createTodo(TODO_TITLE);
    await expect(todos.toastTitles.filter({ hasText: addedToast(TODO_TITLE) })).toBeVisible();

    // First edit: its Undo, if it survived, would restore "Alpha".
    await todos.editTodo(TODO_TITLE, SECOND_TITLE);
    await expect(
      todos.toastTitles.filter({ hasText: updatedToast(SECOND_TITLE) }),
    ).toBeVisible();

    // Second edit, immediately after — well inside the four-second toast life,
    // so anything that disappears here was dismissed, not expired.
    await todos.editTodo(SECOND_TITLE, THIRD_TITLE);
    await expect(
      todos.toastTitles.filter({ hasText: updatedToast(THIRD_TITLE) }),
    ).toBeVisible();

    /*
      The heart of it: exactly one Undo is armed. `showUndoableSuccess`
      dismisses the todo's outstanding toast before raising the new one, so the
      Undo that would have restored "Alpha" no longer exists (review M-2).

      Read once, deliberately — NOT `await expect(locator).toHaveCount(1)`.
      That assertion retries, and toasts expire on their own after four
      seconds, so it would sit there watching the stale Undos disappear by
      timeout and then report success. Verified by mutation: with the dismissal
      removed from `showUndoableSuccess` this point-in-time read returns 3
      while the retrying form passed happily. The contract is "already gone by
      the time the later write lands", and only an immediate read says that.
    */
    const armedUndos = await todos.undoButton.count();

    expect(armedUndos, "a later write must leave exactly one armed Undo").toBe(1);

    await todos.pressUndo();

    /*
      The surviving Undo restores the values the *second* form opened with —
      "Bravo" — and never jumps back past it to "Alpha". That is the whole
      point: an Undo can never overwrite a change the user made after it.
    */
    await expect(
      todos.toastTitles.filter({ hasText: restoredToast(SECOND_TITLE) }),
    ).toBeVisible();
    await expect(todos.rowByText(SECOND_TITLE)).toBeVisible();
    await expect(todos.rowByText(THIRD_TITLE)).toHaveCount(0);
    await expect(todos.rowByText(TODO_TITLE)).toHaveCount(0);
  });

  test("deleting a row disarms its outstanding Undo", async ({ todos }) => {
    await todos.createTodo(TODO_TITLE);

    /*
      A create-Undo is armed, and it deletes. Deleting the row by hand while
      that is live is the collision: without `dismissUndo` at the top of
      `handleDelete`, the toast would sit there offering to delete a row that
      no longer exists, and pressing it would 404 — reporting a failure for a
      mutation that had already succeeded.
    */
    expect(await todos.undoButton.count()).toBe(1);

    await todos.openDelete(TODO_TITLE);
    await todos.confirmDelete();

    await expect(
      todos.toastTitles.filter({ hasText: deletedToast(TODO_TITLE) }),
    ).toBeVisible();
    await expect(todos.rowByText(TODO_TITLE)).toHaveCount(0);

    /*
      The create-Undo is gone: the delete dismissed it before it started.
      Read once rather than retried, for the same reason as the test above —
      a retrying assertion would be satisfied by the toast's own four-second
      expiry and would pass even if nothing dismissed anything.
    */
    const armedAfterDelete = await todos.undoButton.count();

    expect(
      armedAfterDelete,
      "the delete must leave no Undo pointing at the row it removed",
    ).toBe(0);

    // And nothing reports the undo path having run.
    await expect(todos.toasts.filter({ hasText: removedToast(TODO_TITLE) })).toHaveCount(0);
  });
});
