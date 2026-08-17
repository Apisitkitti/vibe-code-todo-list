import type { Page } from "@playwright/test";

import { markedCompleteToast, markedNotCompleteToast } from "./support/copy";
import { expect, test, type TodosScreen } from "./support/fixtures";

/**
 * NFR-04 — the Undo toast must be reachable by keyboard inside its window, and
 * focus must not be lost or trapped when a toast appears and expires.
 *
 * QA measured the old behaviour end to end (`docs/QA-REPORT.md` §A3): a
 * keyboard toggle under `?status=active` removes the row, focus falls to
 * `<body>`, and the toast is the last thing in the document — three tab stops
 * behind every remaining row, against a 12s timeout. At 19 todos it was not
 * reachable at any human pace. The fix is in `src/lib/rowFocus.ts`: land focus
 * back on the row that took the removed row's place, then step onto the Undo.
 *
 * **Why the list here is deliberately long.** The defect was length-dependent,
 * so a three-todo account passed it. Eight todos puts more than twenty tab
 * stops between where focus used to land and the toast, which is well past the
 * point QA showed the timer wins. A fix that only works on a short list fails
 * this spec.
 */

const LIST_SIZE = 8;
const TOGGLED_TITLE = "row one keyboard toggle";

/** What has focus, named by the contract attribute rather than by geometry. */
const activeSlot = async (page: Page): Promise<string> =>
  page.evaluate(() => {
    const active = document.activeElement;

    if (active === null || active === document.body) return "body";

    return (
      active.closest("[data-slot]")?.getAttribute("data-slot") ??
      active.tagName.toLowerCase()
    );
  });

/**
 * Establishes keyboard modality before landing on the row.
 *
 * The rescue is deliberately keyboard-only, and react-aria decides modality
 * from real events — so this presses a real Tab rather than assuming it. The
 * subsequent `focus()` is how the test skips the tab-walk *into* the list,
 * which is not what is under test; the walk *out* of it is.
 */
const focusFirstRowFromKeyboard = async (page: Page, title: string) => {
  await page.keyboard.press("Tab");
  await page
    .getByRole("checkbox", { name: `Mark "${title}" as complete` })
    .evaluate((element: HTMLElement) => {
      element.focus();
    });
};

const seedList = async (todos: TodosScreen, page: Page) => {
  await todos.quickAdd(TOGGLED_TITLE);
  await expect(page.locator("main").getByText(TOGGLED_TITLE)).toBeVisible();

  for (let index = 1; index < LIST_SIZE; index += 1) {
    await todos.quickAdd(`filler row ${index}`);
    await expect(page.locator("main").getByText(`filler row ${index}`)).toBeVisible();
  }
};

test.describe("NFR-04 — Undo reachability and focus", () => {
  test("a keyboard toggle that removes the row lands focus on Undo, and Enter restores it", async ({
    signedIn,
    todos,
  }) => {
    await seedList(todos, signedIn);

    // The filter that makes the toast the only route back (US-07).
    await signedIn.goto("/todos?status=active");
    await expect(signedIn.locator("main").getByText(TOGGLED_TITLE)).toBeVisible();

    await focusFirstRowFromKeyboard(signedIn, TOGGLED_TITLE);
    expect(await activeSlot(signedIn)).not.toBe("body");

    await signedIn.keyboard.press("Space");

    // The row leaves the filtered list, and its Undo is the only way back.
    await expect(
      signedIn.locator("main").getByText(TOGGLED_TITLE),
    ).toHaveCount(0);
    await expect(
      todos.toastTitles.filter({ hasText: markedCompleteToast(TOGGLED_TITLE) }),
    ).toBeVisible();

    /*
      The whole criterion, in one assertion: focus is *on* the Undo, with no
      tab-walk in between and therefore no dependence on how many todos the
      account has. Before the fix this read "body".
    */
    await expect
      .poll(() => activeSlot(signedIn))
      .toBe("toast-action-button");

    // And it is genuinely operable from there, not merely focused.
    await signedIn.keyboard.press("Enter");

    await expect(signedIn.locator("main").getByText(TOGGLED_TITLE)).toBeVisible();
    await expect(
      todos.toastTitles.filter({
        hasText: markedNotCompleteToast(TOGGLED_TITLE),
      }),
    ).toBeVisible();
  });

  test("focus is neither lost nor trapped when the toast goes away", async ({
    signedIn,
    todos,
  }) => {
    await seedList(todos, signedIn);

    await signedIn.goto("/todos?status=active");
    await expect(signedIn.locator("main").getByText(TOGGLED_TITLE)).toBeVisible();

    await focusFirstRowFromKeyboard(signedIn, TOGGLED_TITLE);
    await signedIn.keyboard.press("Space");

    await expect.poll(() => activeSlot(signedIn)).toBe("toast-action-button");

    /*
      Not trapped: Tab out of the toast has to move focus somewhere real. A
      region that held focus would report the action button again.
    */
    await signedIn.keyboard.press("Tab");
    expect(await activeSlot(signedIn)).not.toBe("toast-action-button");
    expect(await activeSlot(signedIn)).not.toBe("body");

    // Back onto Undo, then spend the toast — the "expires while it had focus"
    // half of the criterion. Focus must land somewhere, not on `<body>`.
    await signedIn.keyboard.press("Shift+Tab");
    await expect.poll(() => activeSlot(signedIn)).toBe("toast-action-button");

    await signedIn.keyboard.press("Enter");

    await expect(todos.undoButton).toHaveCount(0);
    await expect.poll(() => activeSlot(signedIn)).not.toBe("body");
  });

  test("a pointer toggle does not pull focus into the toast, even with a row focused", async ({
    signedIn,
    todos,
  }) => {
    await seedList(todos, signedIn);

    await signedIn.goto("/todos?status=active");
    await expect(signedIn.locator("main").getByText(TOGGLED_TITLE)).toBeVisible();

    /*
      The case that makes the modality gate load-bearing rather than
      decorative. A bare mouse press is not enough on its own: react-aria does
      not focus a checkbox on pointer press, so focus is already on `<body>`
      and the rescue would decline for want of an anchor whatever the gate
      said. Putting a row under the keyboard *first* and then clicking a
      different row is the shape where focus **is** in the list and the press
      **is** a pointer — the only thing standing between that and a hijacked
      Undo is the modality check.
    */
    await focusFirstRowFromKeyboard(signedIn, "filler row 1");
    expect(await activeSlot(signedIn)).not.toBe("body");

    await todos.toggle(TOGGLED_TITLE, true);

    await expect(
      todos.toastTitles.filter({ hasText: markedCompleteToast(TOGGLED_TITLE) }),
    ).toBeVisible();

    /*
      A pointer user is not standing anywhere, and arming Undo under a Space
      press they meant for the row they had tabbed to would be a worse bug
      than the one being fixed.
    */
    await expect
      .poll(() => activeSlot(signedIn))
      .not.toBe("toast-action-button");
  });
});

/**
 * K2 — the list that empties.
 *
 * The rescue has two steps: land back in the list, then step onto the Undo.
 * When the toggled row was the *only* row, step 1 has nowhere to land —
 * `nextFocusIndex` returns `null` and focus is still on `<body>`. Step 2 then
 * has to be the thing that catches it, which is exactly the state where
 * nothing else can.
 *
 * This is not an edge case dressed up as one: a one-item active list is where
 * a user finishes their last todo, and US-07 makes the toast the only route
 * back from it.
 */
test.describe("NFR-04 — the last row in the list", () => {
  test("emptying the list still lands focus on Undo", async ({
    signedIn,
    todos,
  }) => {
    await todos.quickAdd(TOGGLED_TITLE);
    await expect(signedIn.locator("main").getByText(TOGGLED_TITLE)).toBeVisible();

    await signedIn.goto("/todos?status=active");
    await expect(signedIn.locator("main").getByText(TOGGLED_TITLE)).toBeVisible();

    await focusFirstRowFromKeyboard(signedIn, TOGGLED_TITLE);
    await signedIn.keyboard.press("Space");

    // The list is now empty — the empty state has replaced every row.
    await expect(signedIn.locator("main").getByText(TOGGLED_TITLE)).toHaveCount(0);
    await expect(
      todos.toastTitles.filter({ hasText: markedCompleteToast(TOGGLED_TITLE) }),
    ).toBeVisible();

    await expect.poll(() => activeSlot(signedIn)).toBe("toast-action-button");

    await signedIn.keyboard.press("Enter");
    await expect(signedIn.locator("main").getByText(TOGGLED_TITLE)).toBeVisible();
  });
});

/**
 * What step 1 is actually for.
 *
 * Step 2 — moving onto the Undo — is what satisfies NFR-04's reachability
 * criterion, and on the happy path it catches focus whether or not step 1 ran.
 * Step 1 earns its place on the paths where **step 2 cannot run at all**, and
 * this is the plainest of them: a refused write raises no Undo toast, so there
 * is nothing to move to. Without step 1 focus stays on `<body>`, which is the
 * half of NFR-04 that is about focus never being lost rather than about Undo
 * being reachable.
 */
test.describe("NFR-04 — when there is no toast to move to", () => {
  test("a refused toggle still leaves focus in the list", async ({
    signedIn,
    todos,
  }) => {
    await seedList(todos, signedIn);

    await signedIn.goto("/todos?status=active");
    await expect(signedIn.locator("main").getByText(TOGGLED_TITLE)).toBeVisible();

    // No Undo is offered for a write that failed, so step 2 is skipped.
    await signedIn.route("**/api/todos/*/status", (route) =>
      route.fulfill({
        status: 500,
        contentType: "application/json",
        body: JSON.stringify({
          code: "INTERNAL",
          message: "Something went wrong on our end.",
        }),
      }),
    );

    await focusFirstRowFromKeyboard(signedIn, TOGGLED_TITLE);
    await signedIn.keyboard.press("Space");

    // The row comes back and the failure is reported.
    await expect(signedIn.locator("main").getByText(TOGGLED_TITLE)).toBeVisible();
    await expect(todos.undoButton).toHaveCount(0);

    // Focus is somewhere a keyboard user can carry on from — not on the floor.
    await expect.poll(() => activeSlot(signedIn)).not.toBe("body");
  });
});

/**
 * The half of the rescue that declines.
 *
 * `focusIsUnclaimed` exists to stop step 2 taking focus the user has already
 * put somewhere themselves. Every other test here exercises the rescue
 * *moving* focus; none of them notices if the guard stops working — replacing
 * its body with `return true` leaves them all green, because the pointer test
 * is carried by the modality gate rather than by this guard.
 *
 * The realistic shape of the failure is the expensive one: the toggle's write
 * is still in flight, the user has moved on and is typing the next todo, and
 * the toast arriving yanks the caret out of the input mid-word. Whatever they
 * type next goes to a button.
 */
test.describe("NFR-04 — the rescue stands down once the user has moved", () => {
  test("a toast arriving does not steal focus from the quick-add bar", async ({
    signedIn,
    todos,
  }) => {
    const TYPED = "the next todo, half typed";

    await seedList(todos, signedIn);

    await signedIn.goto("/todos?status=active");
    await expect(signedIn.locator("main").getByText(TOGGLED_TITLE)).toBeVisible();

    /*
      Held so the toast cannot arrive until the user is demonstrably somewhere
      else. Without this the test would be racing the round trip rather than
      asserting anything.
    */
    let release = () => {};
    const held = new Promise<void>((resolve) => {
      release = resolve;
    });

    await signedIn.route("**/api/todos/*/status", async (route) => {
      await held;
      await route.continue();
    });

    await focusFirstRowFromKeyboard(signedIn, TOGGLED_TITLE);
    await signedIn.keyboard.press("Space");

    // The row is gone optimistically and step 1 has moved focus to a row.
    await expect(signedIn.locator("main").getByText(TOGGLED_TITLE)).toHaveCount(0);

    // The user moves on and starts typing the next todo.
    await todos.quickAddInput.click();
    await todos.quickAddInput.pressSequentially(TYPED);
    await expect(todos.quickAddInput).toBeFocused();

    release();

    await expect(todos.undoButton).toBeVisible();

    /*
      Step 2 fires on the frame the action button appears, so once the button
      is visible the steal has either happened or is one frame away. A bounded
      wait is the honest way to assert a negative here — a web-first assertion
      for "focus did not move" would pass on the frame before it did.
    */
    await signedIn.waitForTimeout(700);

    expect(await activeSlot(signedIn)).not.toBe("toast-action-button");
    await expect(todos.quickAddInput).toBeFocused();
    await expect(todos.quickAddInput).toHaveValue(TYPED);
  });
});
