import type { Locator, Page } from "@playwright/test";

import {
  TODO_STATUS_URL,
  expectAbsentNow,
  fulfilOpaqueError,
} from "./support/assertions";
import {
  markedCompleteToast,
  restoredToast,
  STATUS_FILTER_ARIA_LABEL,
  STATUS_FILTER_LABELS,
  TOGGLE_FAILURE,
  undoActionLabel,
  updatedToast,
} from "./support/copy";
import {
  expect,
  settleToastTransitions,
  test,
  type TodosScreen,
} from "./support/fixtures";

/**
 * Which Undo the slot is holding — asserted by **pressing** rather than by
 * naming.
 *
 * The e2e mutation audit's Cause B: `claimActionPress` keyed on nothing instead
 * of the toast's token (`T4`) and `dismissActionToast` unscoped from the record
 * (`T3`) each survived 46 tests, across `undo-focus`, `undo-semantics` and
 * `receipts-against-the-undo`. Both guards are about *which* toast or *which*
 * record, and every spec in the suite presses `todos.undoButton` — the
 * frontmost, live button — and then asserts counts and accessible names.
 *
 * **A name is a claim about identity; a press is a test of it.**
 * `undo-semantics.spec.ts:335` gets within one line: it identifies the outgoing
 * toast and then asserts the *name* of the incoming one. Naming a wrong button
 * is not the same claim as pressing it, and the difference is the whole of what
 * `T4` walked through.
 *
 * The unit audit reached the same seam from the other side and said so —
 * `R13`, dropping the token from `undoActionSelector` and leaving a bare
 * `[data-slot="toast-action-button"]`, survives the unit suite because every
 * unit test injects `findAction`. The unit tests pin the identity *rule*;
 * nothing there pins that the production selector implements it. Two audits
 * pointing at one seam from opposite directions, so it is closed once, here,
 * where both are observable.
 */

const ANCHOR = "anchor";
const ANCHOR_EDITED = "anchor edited";
const OTHER = "other";

const seedRows = async (todos: TodosScreen, titles: string[]) => {
  /*
    Each add is waited for. `quickAdd` fills and presses Enter without waiting,
    and the bar clears asynchronously, so consecutive unwaited adds lose
    writes — the same note `undo-semantics.spec.ts` carries.
  */
  for (const title of titles) {
    await todos.quickAdd(title);
    await expect(todos.rowByText(title)).toBeVisible();
  }
};

/** The action button belonging to one named toast, whichever deck slot it is in. */
const undoFor = (page: Page, toastTitle: string): Locator =>
  page.getByRole("button", {
    name: undoActionLabel(toastTitle),
    exact: true,
  });

/**
 * Selects `Active` the way a user does — **not** by navigating to the URL.
 *
 * Borrowed from `undo-focus.spec.ts`, with its reason: `router.replace` from
 * the filter bar re-renders the list without tearing the document down, so
 * toasts raised before the filter changed are still on screen. A `goto` would
 * sterilise exactly the state these tests need.
 */
const chooseActiveFilter = async (page: Page) => {
  await page
    .getByRole("radiogroup", { name: STATUS_FILTER_ARIA_LABEL })
    .getByRole("radio", { name: STATUS_FILTER_LABELS.active, exact: true })
    .click();
  await expect(page).toHaveURL(/status=active/);
};

interface ActionButtonFrame {
  t: number;
  labels: string[];
}

declare global {
  interface Window {
    __actionButtonTimeline?: () => ActionButtonFrame[];
  }
}

/**
 * Records, every animation frame, the accessible names of every action button
 * in the DOM — one entry per change, so the result is the sequence of distinct
 * states rather than a sample count.
 *
 * The DOM and not the screen, deliberately. During a view transition the *old*
 * toast is still painted, but what is painted is a `::view-transition`
 * pseudo-element snapshot, not an element — it has no listeners and cannot be
 * pressed. So "how many Undos can the user press right now" is a question about
 * `document`, and a screenshot would answer it wrongly.
 */
const recordActionButtons = async (page: Page) => {
  await page.evaluate(() => {
    const ACTION = '[data-slot="toast-action-button"]';
    const timeline: ActionButtonFrame[] = [];
    const start = performance.now();
    let running = true;

    const frame = () => {
      if (!running) return;

      const labels = Array.from(
        document.querySelectorAll<HTMLElement>(ACTION),
      ).map((button) => button.getAttribute("aria-label") ?? "?");
      const last = timeline[timeline.length - 1];

      if (
        last === undefined ||
        last.labels.length !== labels.length ||
        last.labels.some((name, index) => name !== labels[index])
      ) {
        timeline.push({ t: Math.round(performance.now() - start), labels });
      }

      requestAnimationFrame(frame);
    };

    requestAnimationFrame(frame);

    window.__actionButtonTimeline = () => {
      running = false;

      return timeline;
    };
  });
};

/**
 * Arms an Undo on `ANCHOR` by editing it, and returns that toast's own button.
 *
 * An edit rather than a toggle, so the reversal the stale button would run is a
 * different *kind* from the write that supersedes it — a restored title is
 * visible in the list, where a re-flipped checkbox on a row that may have been
 * filtered out is not. That is what makes the assertion below readable as
 * "the stale reversal ran" rather than as a count.
 */
const armAnchorUndo = async (page: Page, todos: TodosScreen): Promise<Locator> => {
  await todos.editTodo(ANCHOR, ANCHOR_EDITED);
  await expect(
    todos.toastTitles.filter({ hasText: updatedToast(ANCHOR_EDITED) }),
  ).toBeVisible();
  await settleToastTransitions(page);

  const outgoing = undoFor(page, updatedToast(ANCHOR_EDITED));

  await expect(outgoing).toHaveCount(1);

  return outgoing;
};

test.describe("the standing Undo is this write's, and there is no other to reach", () => {
  /**
   * The precondition that makes `T4` unreachable from a browser — which is a
   * finding against the audit, and this test is what holds it true.
   *
   * **`T4` cannot be closed the way the audit proposes, and the reason is
   * measurable.** The audit says to press the outgoing action button during a
   * repeat write, on the strength of `claimActionPress`'s own docblock: *"for a
   * window after a repeat write the DOM holds two action buttons for the same
   * todo"*. On `develop` at `2d12e17` it does not. Recorded per animation frame
   * across both supersede shapes:
   *
   * | | outgoing gone | incoming arrives | overlap |
   * |---|---|---|---|
   * | repeat write, same todo | t=39ms | t=58ms | none — 19ms with **no** button |
   * | supersede, different todo | — | t=78ms | none — the label swaps between frames |
   *
   * The docblock is describing the defect it *replaced*, not current behaviour,
   * and the audit read it as a live description. What actually overlaps during
   * the transition is the `::view-transition` pseudo-element snapshot of the
   * old toast — painted, but not an element, with no listeners and nothing to
   * press. So there is never a stale button in the DOM for a user to reach, by
   * pointer, by keyboard or through a screen reader.
   *
   * That makes `T4` an **equivalent mutant at this layer**: the button's token
   * is always the standing toast's token, so `outstandingAction?.token !== token`
   * and `outstandingAction === null` cannot disagree. It is not unpinned — the
   * unit audit reports `R6`, `R11` and `TO2` all red on the identity rule, which
   * is the layer that can call `claimActionPress` with a stale token directly,
   * and per the testing doctrine that is the lowest layer that can fail for the
   * reason we care about.
   *
   * What e2e can hold is the invariant the equivalence rests on. If this ever
   * goes red, two action buttons are mounted at once, `T4` stops being
   * equivalent, and the press test the audit asked for becomes both possible
   * and necessary.
   */
  test("only ever one Undo is mounted, so there is never a stale one to press", async ({
    signedIn: page,
    todos,
  }) => {
    await seedRows(todos, [ANCHOR, OTHER]);
    await armAnchorUndo(page, todos);

    await recordActionButtons(page);

    // A write to a different record. Under the cap this replaces the edit's
    // Undo rather than standing beside it.
    await todos.toggle(OTHER, true);
    await expect(
      todos.toastTitles.filter({ hasText: markedCompleteToast(OTHER) }),
    ).toBeVisible();
    await settleToastTransitions(page);

    const timeline = await page.evaluate(() => window.__actionButtonTimeline?.());

    /*
      The claim, asserted before the non-vacuity guard below so that a run which
      breaks the invariant reports *that* rather than reporting the guard. The
      first draft had these the other way round and went red under a cap
      mutation with a message about the recording, which is red for the wrong
      reason even though the number was right.
    */
    expect(
      (timeline ?? []).filter((frame) => frame.labels.length > 1),
      "two action buttons were mounted at once — T4 is no longer an equivalent mutant and needs the press test the audit asked for",
    ).toEqual([]);

    /*
      And the recording saw the handover at all, or the assertion above is
      satisfied by a screen that never changed. Deliberately a test of presence
      rather than of the exact frame — the invariant is what is being pinned
      here, not the sequence.
    */
    expect(
      (timeline ?? []).some((frame) =>
        frame.labels.includes(undoActionLabel(markedCompleteToast(OTHER))),
      ),
      "the recording never saw this toggle's Undo arrive, so the invariant above was never tested",
    ).toBe(true);

    // And the one that is mounted is live, not a leftover that merely looks it.
    await undoFor(page, markedCompleteToast(OTHER)).click();
    await expect(todos.checkbox(OTHER)).not.toBeChecked();
    await expectAbsentNow(
      todos.toasts.filter({ hasText: restoredToast(ANCHOR) }),
      "pressing the standing Undo ran the superseded reversal instead of its own",
    );
    await expect(todos.rowByText(ANCHOR_EDITED)).toBeVisible();
  });

  /**
   * `R13`, which is the same seam seen from the unit suite.
   *
   * After a toggle whose row leaves the section, focus is moved onto **this**
   * toggle's Undo, and `undoActionSelector` finds it by the token minted for
   * that one toast. Drop the token and the selector becomes
   * `[data-slot="toast-action-button"]`, which the *outgoing* toast's button
   * satisfies equally well — and `document.querySelector` returns the first
   * match in document order, not the frontmost one.
   *
   * So the discriminating setup needs an older action button still mounted when
   * the new one arrives, which is what the edit above provides. Asserting the
   * focused button's accessible name is what tells the two apart; asserting
   * that *something* has focus does not.
   */
  test("focus lands on the toggle's own Undo, not on the one still mounted behind it", async ({
    signedIn: page,
    todos,
  }) => {
    await seedRows(todos, [ANCHOR, OTHER]);
    await armAnchorUndo(page, todos);

    /*
      `Active`, because the focus rescue only runs when the flip removes the row
      from the view the user is looking at — under the default `All` the row
      stays, focus has somewhere to be, and step 2 never runs at all. Measured:
      without this the assertion below is vacuous, and the first draft of this
      test failed on it.
    */
    await chooseActiveFilter(page);

    /*
      A keyboard toggle, because the rescue is also gated on `isFocusVisible` —
      a pointer press moves no focus, so a clicked checkbox would leave this
      assertion vacuous for the second reason.
    */
    await page.getByRole("checkbox", { name: new RegExp(OTHER) }).focus();
    await page.keyboard.press("Space");

    await expect(
      todos.toastTitles.filter({ hasText: markedCompleteToast(OTHER) }),
    ).toBeVisible();

    await expect(undoFor(page, markedCompleteToast(OTHER))).toBeFocused();
  });
});

test.describe("a write that fails leaves another row's Undo exactly where it was", () => {
  /**
   * `T3`, and the harder half — it needs a *failing* write to be visible at
   * all.
   *
   * `dismissUndo(todo.id)` runs **before** a toggle, a reschedule and a delete,
   * and `src/lib/toast.ts` says why it is scoped in as many words: *"a write
   * that goes on to fail must leave another row's Undo exactly where it was."*
   * Unscoped, a write to row B closes row A's Undo; if B's write then fails, A's
   * Undo is gone for a write that never happened.
   *
   * The suite covered only the **success** path of a second write, and on that
   * path the two are indistinguishable: `showActionToast`'s own
   * `closeOutstanding()` produces the same visible outcome whether or not
   * `dismissUndo` already did it. The failure path is the only place they
   * differ, and nothing held or failed a write on B while A's Undo stood.
   *
   * The press at the end is the point. Asserting the button is still *on
   * screen* would pass against an app that closed the slot and left the button
   * mounted behind the deferred unmount — which is precisely the state
   * `toast-dead-window.spec.ts` documents existing. Only pressing it shows the
   * Undo is still **armed**.
   */
  test("a failed toggle on one row does not disarm the Undo standing for another", async ({
    signedIn: page,
    todos,
  }) => {
    await seedRows(todos, [ANCHOR, OTHER]);

    const anchorUndo = await armAnchorUndo(page, todos);

    /*
      An opaque 500, not one speaking the API's contract. `getErrorMessage`
      reads `response.data.message` when there is one, so a `fulfilApiError`
      here would put *that* string on screen and the assertion below would be
      waiting for a fallback the app had no reason to reach. A first draft of
      this test did exactly that and timed out on a toast that was on screen
      under a different wording.
    */
    await page.route(TODO_STATUS_URL, async (route) => {
      await fulfilOpaqueError(route, 500);
    });

    await todos.toggle(OTHER, true);

    // The write genuinely failed, so `dismissUndo` ran and nothing replaced it.
    await expect(todos.toasts.filter({ hasText: TOGGLE_FAILURE })).toBeVisible();
    await expect(todos.checkbox(OTHER)).not.toBeChecked();

    await settleToastTransitions(page);

    // Still there...
    await expect(anchorUndo).toHaveCount(1);

    // ...and still live, which is the half a count cannot answer.
    await anchorUndo.click();

    await expect(todos.rowByText(ANCHOR)).toBeVisible();
    await expect(
      todos.toastTitles.filter({ hasText: restoredToast(ANCHOR) }),
    ).toBeVisible();
  });
});
