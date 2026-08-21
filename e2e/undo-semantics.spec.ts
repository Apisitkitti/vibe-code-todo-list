import {
  addedToast,
  deletedToast,
  markedCompleteToast,
  markedNotCompleteToast,
  restoredToast,
  UNDO_LABEL,
  undoActionLabel,
  updatedToast,
} from "./support/copy";
import {
  TODO_STATUS_URL,
  countRequests,
  expectAbsentNow,
} from "./support/assertions";
import {
  expect,
  settleToastTransitions,
  test,
  type TodosScreen,
} from "./support/fixtures";

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
      removed from `showUndoableSuccess` this point-in-time read returns one
      per surviving edit instead of 1 — 2 here, and 3 when the create still
      armed one of its own — while the retrying form passed happily. The
      contract is "already gone by the time the later write lands", and only an
      immediate read says that.
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
      **The outstanding Undo is an edit's, not a create's.** It used to be a
      create's, which was the shortest way to arm one — but a create no longer
      offers Undo at all (`docs/DESIGN.md` §7.15), so that setup can no longer
      construct the precondition. Stated plainly, because it is the kind of
      change that deserves suspicion: this rewrite turns a red test green. The
      old version fails at its own precondition — `expect(undoButton)
      .toBeVisible()` times out, never reaching the assertion under test — and
      the honest justification is that the setup became impossible, not that
      the test became vacuous. An earlier version of this comment claimed it
      would silently pass as `0 === 0`; the review ran it and it does not
      (review F-1). The edit is the same collision with the same mechanism,
      and it is the one that still exists.

      The collision: `handleDelete` calls `dismissUndo` before it starts.
      Without it the edit's Undo would sit there offering to write values back
      to a row that no longer exists, and pressing it would 404 — reporting a
      failure for a mutation that had already succeeded.
    */
    await todos.editTodo(TODO_TITLE, SECOND_TITLE);
    await expect(
      todos.toastTitles.filter({ hasText: updatedToast(SECOND_TITLE) }),
    ).toBeVisible();

    /*
      **Waited for, not read once.** This is a *precondition* — it establishes
      that there is an Undo to disarm — and the file's argument for
      point-in-time reads does not apply to it. That argument is about
      *absence*: a retrying "count is zero" would be satisfied by the toast's
      own expiry and would pass even if nothing dismissed anything, which is
      why the two reads at the end of this test stay one-shot. Presence has no
      such failure mode; retrying can only wait for a thing that either
      appears or does not.

      Read once, it was the flakiest line in the suite — 3 failures in 14
      whole-file runs, none in 16 runs of the test alone. HeroUI raises every
      toast inside `startViewTransition`, so the button exists a frame or two
      after the toast is "shown", and a bare `count()` sampled that gap. Same
      view transition as the Undo-press timing this suite already documents,
      arriving from the other side: there it made a visible control unclickable,
      here it makes a real control briefly uncountable.
    */
    await expect(todos.undoButton).toBeVisible();
    expect(await todos.undoButton.count()).toBe(1);

    await todos.openDelete(SECOND_TITLE);
    await todos.confirmDelete();

    await expect(
      todos.toastTitles.filter({ hasText: deletedToast(SECOND_TITLE) }),
    ).toBeVisible();
    await expect(todos.rowByText(SECOND_TITLE)).toHaveCount(0);

    /*
      The edit-Undo is gone: the delete dismissed it before it started.
      Read once rather than retried, for the same reason as the test above —
      a retrying assertion would be satisfied by the toast's own expiry and
      would pass even if nothing dismissed anything.
    */
    const armedAfterDelete = await todos.undoButton.count();

    expect(
      armedAfterDelete,
      "the delete must leave no Undo pointing at the row it removed",
    ).toBe(0);

    // And nothing reports the undo path having run — the row is not back
    // under its pre-edit title.
    await expect(
      todos.toasts.filter({ hasText: restoredToast(TODO_TITLE) }),
    ).toHaveCount(0);
    await expect(todos.rowByText(TODO_TITLE)).toHaveCount(0);
  });
});

/**
 * The one Undo on screen has to say what it undoes — QA's §8 addition,
 * surviving the cap that removed the stack it was written against.
 *
 * **What changed and what did not.** The original test stood three Undos up at
 * once and asserted that no two answered to the same name. That state is now
 * unreachable: at most one action-bearing toast stands at a time
 * (`src/lib/toast.ts`), so the recipe yields one button and the "no two alike"
 * property becomes unfalsifiable — the same reasoning §7.15 already forced on
 * QA's original two-`added`-toasts version.
 *
 * Stated plainly, because it is the kind of rewrite that deserves suspicion:
 * this turns a red test green, and the honest justification is that the
 * precondition became impossible, not that the assertion became inconvenient.
 * The old body fails at `toHaveCount(3)` against a screen holding exactly one.
 *
 * What is left is still falsifiable, and it is the half that carries the
 * accessibility argument. The name must be **this** toast's subject: a name
 * that dropped the subject, or one left describing the reversal the cap just
 * took away, both fail below. The second of those is a real hazard the cap
 * created rather than an invented one — the outgoing toast is still mounted
 * for a window after it is closed, so "the Undo on screen" and "the Undo the
 * app thinks is armed" can disagree, and only the name says which is which.
 */
test.describe("Undo accessible names", () => {
  const TARGET = "target";
  const KEEPME = "keepme";
  const ANCHOR = "anchor";
  const ANCHOR_EDITED = "anchor edited";

  test("the standing Undo is named for its own toast, not the one it replaced", async ({
    signedIn: page,
    todos,
  }) => {
    /*
      Each add is waited for. `quickAdd` fills and presses Enter without
      waiting for anything, and the bar clears asynchronously — three in a row
      unwaited lose two of the three writes.
    */
    for (const title of [ANCHOR, KEEPME, TARGET]) {
      await todos.quickAdd(title);
      await expect(todos.rowByText(title)).toBeVisible();
    }

    // An edit first, so the reversal being named is a different *kind* from
    // the toggle that replaces it below.
    await todos.editTodo(ANCHOR, ANCHOR_EDITED);
    await expect(
      todos.toastTitles.filter({ hasText: updatedToast(ANCHOR_EDITED) }),
    ).toBeVisible();

    const undoButtons = page.locator('[data-slot="toast-action-button"]');

    await expect(
      page.getByRole("button", {
        name: undoActionLabel(updatedToast(ANCHOR_EDITED)),
        exact: true,
      }),
    ).toHaveCount(1);

    // A write to a different record. Under the cap this replaces the edit's
    // Undo rather than standing beside it.
    await todos.toggle(KEEPME, true);
    await expect(
      todos.toastTitles.filter({ hasText: markedCompleteToast(KEEPME) }),
    ).toBeVisible();
    await settleToastTransitions(page);

    /*
      The name follows the slot. Read as a point-in-time count for the absent
      half, for the reason this file states throughout: a retrying
      `toHaveCount(0)` would be satisfied by the replaced toast expiring on its
      own twelve seconds later and would pass against an app that never
      replaced anything.
    */
    await expect(
      page.getByRole("button", {
        name: undoActionLabel(markedCompleteToast(KEEPME)),
        exact: true,
      }),
    ).toHaveCount(1);

    await expectAbsentNow(
      page.getByRole("button", {
        name: undoActionLabel(updatedToast(ANCHOR_EDITED)),
        exact: true,
      }),
      "the replaced edit's Undo was still reachable by its accessible name",
    );

    /*
      And the name is genuinely computed from `aria-label` rather than from the
      child text: the visible word is the bare `Undo` the copy deck asks for
      (§7.13), which is exactly why the name cannot be it.
    */
    const names = await undoButtons.evaluateAll((buttons) =>
      buttons.map((button) => button.getAttribute("aria-label")),
    );

    expect(names).toEqual([undoActionLabel(markedCompleteToast(KEEPME))]);
    await expect(undoButtons.first()).toHaveText(UNDO_LABEL);

    // `TARGET` is untouched throughout — it exists only so the screen holds
    // more than the two records the assertions name.
    await expect(todos.rowByText(TARGET)).toBeVisible();
  });
});

/**
 * The cap: **at most one action-bearing toast stands at a time**, whatever
 * record it belongs to (`src/lib/toast.ts`).
 *
 * The argument is that `Undo` meaning more than one thing at the moment
 * somebody reaches for it is worse than losing the older reversal. The
 * `aria-label` disambiguation stays — it is still the only thing that tells a
 * screen-reader user what the one button does — but it is no longer what holds
 * the feature up.
 *
 * **A test was removed from here, and this is the argument for it.** This
 * describe used to hold "a receipt neither takes the slot nor gives it up",
 * which asserted that a receipt raised after a toggle stood beside the Undo and
 * left it armed. §7.13.1 overturned exactly that: the visible-row receipt now
 * **yields** and is not raised at all, so the test's own precondition — the
 * receipt being visible — is no longer reachable and it fails there rather
 * than at anything it was written to protect.
 *
 * It is not deleted coverage. That test's own comment described the gap the
 * ruling then closed: the receipt "sits over the Undo's centre and takes the
 * press", which it worked around by activating the Undo from the keyboard.
 * `e2e/receipts-against-the-undo.spec.ts` replaces it with the behaviour that
 * actually shipped, and asserts the pointer reachability the old test had to
 * concede.
 *
 * **The cost, accepted deliberately and recorded here so it is not
 * rediscovered as a bug.** A second write within the 12s window takes the
 * first Undo away. For a toggle that is free: the checkbox reverses it in one
 * press. For a **reschedule** it is not — the previous date is on neither the
 * row nor any toast — so an older reschedule becomes genuinely unrecoverable.
 * The copy fix that would have covered it (`moved from Aug 22 to Aug 26`) was
 * declined on the grounds that it lengthens every common case to buy a rare
 * one. `an older reschedule is unrecoverable once a second write lands` below
 * pins that as intended behaviour rather than leaving it to be found.
 */
test.describe("one action toast at a time", () => {
  const FIRST = "first";
  const SECOND = "second";

  test("a write to another record replaces the standing Undo", async ({
    todos,
  }) => {
    for (const title of [FIRST, SECOND]) {
      await todos.quickAdd(title);
      await expect(todos.rowByText(title)).toBeVisible();
    }

    await todos.toggle(FIRST, true);
    await expect(
      todos.toastTitles.filter({ hasText: markedCompleteToast(FIRST) }),
    ).toBeVisible();
    await expect(todos.undoButton).toHaveCount(1);

    await todos.toggle(SECOND, true);
    await expect(
      todos.toastTitles.filter({ hasText: markedCompleteToast(SECOND) }),
    ).toBeVisible();

    /*
      Point-in-time, not retried. Both toasts have a 12s life, so a retrying
      assertion would watch the first expire and report a cap that is not
      there. This is the read that separates "closed by the cap" from "closed
      by the clock", and it is the assertion the mutation has to break.
    */
    expect(
      await todos.undoButton.count(),
      "a second action toast must leave exactly one armed Undo",
    ).toBe(1);
  });

  /**
   * The accepted cost, pinned as behaviour.
   *
   * A reschedule's Undo holds the only copy of the date the row used to have.
   * A second write inside the window takes it, and nothing on screen can
   * reconstruct it. This test exists so that a future reader finds a decision
   * rather than a defect — and so that restoring the older Undo, or adding the
   * `moved from … to …` copy, is a deliberate change that turns a test red.
   */
  test("an older reschedule is unrecoverable once a second write lands", async ({
    todos,
  }) => {
    await todos.quickAdd(FIRST);
    await expect(todos.rowByText(FIRST)).toBeVisible();
    await todos.quickAdd(SECOND);
    await expect(todos.rowByText(SECOND)).toBeVisible();

    await todos.reschedule(FIRST, "Today");
    await expect(
      todos.toastTitles.filter({ hasText: `“${FIRST}” due Today` }),
    ).toBeVisible();

    await todos.toggle(SECOND, true);
    await expect(
      todos.toastTitles.filter({ hasText: markedCompleteToast(SECOND) }),
    ).toBeVisible();

    expect(
      await todos.undoButton.count(),
      "the reschedule's Undo is gone, and that is the accepted trade",
    ).toBe(1);

    /*
      Named, not merely counted: the one that survives is the toggle's. A cap
      that closed the *newer* toast would also leave a count of one and would
      be the opposite behaviour.
    */
    await expectAbsentNow(
      todos.toasts.filter({ hasText: `“${FIRST}” due Today` }).locator(
        '[data-slot="toast-action-button"]',
      ),
      "the replaced reschedule still offered its Undo",
    );
  });
});

/**
 * The other half of the same change: with the cap, every action toast is a
 * close-then-add, and a close-then-add is where HeroUI's view transition costs
 * the most (`docs/DESIGN.md` §4.10).
 *
 * Measured on this branch with a real pointer press: **swallowed at 729ms,
 * landing at 760ms** from the user's own press, against 357–417ms for a lone
 * add. `e2e/toast-dead-window.spec.ts` is the harness. `src/lib/toast.ts`
 * builds the queue with `wrapUpdate: fn => fn()`, which is the escape hatch
 * §4.10 names, and this is the test that says it is still taken.
 *
 * **It has to be a real pointer press.** Keyboard activation does not
 * hit-test, and `onPress` called directly does not either, so both are blind
 * to the whole defect — §4.10 says so and this is the test that would
 * otherwise be written the useless way.
 */
test.describe("an armed Undo is live on its first frame", () => {
  const TITLE = "immediate";

  test("a press as soon as the button exists is not swallowed", async ({
    signedIn: page,
    todos,
  }) => {
    await todos.quickAdd(TITLE);
    await expect(todos.rowByText(TITLE)).toBeVisible();

    // An Undo already standing, so the write under test is the close-then-add
    // the cap makes ordinary rather than a lone add.
    await todos.toggle(TITLE, true);
    await expect(todos.undoButton).toHaveCount(1);
    await settleToastTransitions(page);

    const patches = countRequests(page, TODO_STATUS_URL, "PATCH");

    /*
      The second write. Its toast replaces the standing one, so the queue does
      a close and an add — two chained view transitions under HeroUI's default,
      and none at all under ours.
    */
    await todos.toggle(TITLE, false);

    /*
      Waits in the page for the *new* button's first frame and returns its
      centre in the same round trip, so nothing between the button existing and
      the press costs time that would hide the defect. The button is named by
      its `aria-label`: the replaced one is still mounted for a window after it
      is closed, and pressing that one proves nothing.
    */
    const target = await page.evaluate(
      async (selector) => {
        const until = (predicate: () => Element | null) =>
          new Promise<Element>((resolve) => {
            const tick = () => {
              const found = predicate();

              if (found) resolve(found);
              else requestAnimationFrame(tick);
            };

            tick();
          });

        const button = await until(() => document.querySelector(selector));
        const rect = button.getBoundingClientRect();

        return { x: rect.left + rect.width / 2, y: rect.top + rect.height / 2 };
      },
      '[data-slot="toast-action-button"][aria-label*="marked not complete"]',
    );

    const before = patches.count;

    await page.mouse.click(target.x, target.y);

    /*
      The undo's own request. Waited for by its effect rather than by a
      duration: the row goes back to complete only if the press reached the
      button.
    */
    await expect(todos.checkbox(TITLE)).toBeChecked();

    expect(
      patches.count - before,
      "a press on the first frame of a replaced toast must reach the button",
    ).toBe(1);
  });
});

/**
 * An `added` toast is a receipt and nothing else (`docs/DESIGN.md` §7.15).
 *
 * The action it used to carry was a `DELETE`, and it sat in a tab-ordered
 * region beside Undos that put things back — so `Tab` ×2 from the toast the
 * focus rescue had just moved to reached an unconfirmed destructive control
 * on a record the user had not touched (§6.8, QA §8). Removing the action
 * removed the target; the sentence stays, because a create still has to
 * report itself and §7.17's `hidden by your filters` variant is the only
 * explanation a filtered-out row ever gets.
 *
 * **Both create paths are pinned**, because they are two call sites: the bar
 * and the modal report through `handleQuickAdded` and `handleSaved`
 * respectively, and an action restored to either one is the defect back.
 *
 * The absence assertions are one-shot `expectAbsentNow` reads rather than
 * retrying `toHaveCount(0)`, for the reason that helper documents: a toast
 * expires on its own, so a retrying "no action button" would be satisfied by
 * the whole toast going away and would pass against code that still renders
 * the button.
 */
test.describe("added toasts are receipts, not controls", () => {
  /*
    The whole toast, not its title: the assertions below count what is *inside*
    it, so the locator has to be the container rather than the `toast-title`
    slot the other tests in this file filter on.
  */
  const receiptFor = (todos: TodosScreen, title: string) =>
    todos.toasts.filter({ hasText: addedToast(title) });

  const ACTION_BUTTON = '[data-slot="toast-action-button"]';

  test("a quick-add receipt offers no action at all", async ({
    signedIn: page,
    todos,
  }) => {
    await todos.quickAdd(TODO_TITLE);
    await expect(todos.rowByText(TODO_TITLE)).toBeVisible();

    /*
      Presence first, and waited for — this is the precondition, and it is also
      half the contract: the receipt must still be raised. Without it the
      absence assertions below would pass against an app that had stopped
      reporting creates entirely.
    */
    const receipt = receiptFor(todos, TODO_TITLE);

    await expect(receipt).toBeVisible();

    await expectAbsentNow(
      receipt.locator(ACTION_BUTTON),
      "an `added` toast rendered an action button",
    );

    /*
      And by accessible name, which is the other way in: the rescue and a
      screen-reader user both reach these buttons by name, so a button that
      escaped the locator above would still be caught here.
    */
    await expectAbsentNow(
      page.getByRole("button", {
        name: undoActionLabel(addedToast(TODO_TITLE)),
        exact: true,
      }),
      "an `added` toast's Undo was still reachable by its accessible name",
    );
  });

  test("a modal create receipt offers no action either", async ({
    signedIn: page,
    todos,
  }) => {
    await todos.createTodo(TODO_TITLE);

    const receipt = receiptFor(todos, TODO_TITLE);

    await expect(receipt).toBeVisible();

    await expectAbsentNow(
      receipt.locator(ACTION_BUTTON),
      "a modal-created `added` toast rendered an action button",
    );
    await expectAbsentNow(
      page.getByRole("button", {
        name: undoActionLabel(addedToast(TODO_TITLE)),
        exact: true,
      }),
      "a modal-created `added` toast's Undo was reachable by name",
    );
  });

  /**
   * The discriminating case, and the reason this is one test rather than two
   * assertions in separate files: both toasts are on screen at the same
   * moment, from the same todo, and exactly one of them has an action.
   *
   * A change that dropped the action from the wrong toast kind — the edit's
   * instead of the create's — passes every assertion in the two tests above
   * and fails here.
   */
  test("an edit keeps its Undo while the added receipt beside it keeps none", async ({
    signedIn: page,
    todos,
  }) => {
    await todos.quickAdd(TODO_TITLE);
    await expect(todos.rowByText(TODO_TITLE)).toBeVisible();

    await todos.editTodo(TODO_TITLE, SECOND_TITLE);
    await expect(
      todos.toastTitles.filter({ hasText: updatedToast(SECOND_TITLE) }),
    ).toBeVisible();

    /*
      Both stand together: `UNDO_WINDOW_MS` is 12s and an edit dismisses only
      an *armed* Undo for the same row, of which the receipt is not one. The
      original toast therefore has not been closed and is genuinely beside the
      new one.
    */
    const receipt = receiptFor(todos, TODO_TITLE);

    await expect(receipt).toBeVisible();
    await expectAbsentNow(
      receipt.locator(ACTION_BUTTON),
      "the `added` receipt grew an action back when an edit followed it",
    );

    // The edit's Undo is untouched — same button, same accessible name.
    const updated = todos.toasts.filter({ hasText: updatedToast(SECOND_TITLE) });

    await expect(updated.locator(ACTION_BUTTON)).toHaveCount(1);
    await expect(
      page.getByRole("button", {
        name: undoActionLabel(updatedToast(SECOND_TITLE)),
        exact: true,
      }),
    ).toHaveCount(1);

    // Exactly one armed Undo on the whole screen, which is the property the
    // stack-shape argument in §6.8 turns on.
    expect(
      await todos.undoButton.count(),
      "a create and an edit must leave exactly one armed Undo between them",
    ).toBe(1);
  });
});
