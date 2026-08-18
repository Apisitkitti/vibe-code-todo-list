import type { Page } from "@playwright/test";

import { countRequests, TODO_ITEM_URL } from "./support/assertions";
import {
  addedToast,
  markedCompleteToast,
  markedNotCompleteToast,
  STATUS_FILTER_ARIA_LABEL,
  STATUS_FILTER_LABELS,
} from "./support/copy";
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
 *
 * ── Two blind spots this file used to have (QA DEF-25 §4, DEF-26 §5) ────────
 *
 * 1. **It navigated between seeding and acting.** `page.goto("/todos?status=
 *    active")` destroys every outstanding toast, so every test here ran on a
 *    screen with exactly one toast on it — the single state in which selecting
 *    a toast by stack position happens to select the right one. The filter is
 *    now chosen through the filter bar, which is what a user does and what
 *    leaves the seed's `added` toasts standing.
 * 2. **It asserted the shape of the focused element, not its identity.**
 *    `data-slot === "toast-action-button"` is satisfied by *any* toast's Undo,
 *    including one belonging to a different todo, whose Undo is a `DELETE`.
 *    Focus is now named by the title of the toast that owns it.
 *
 * Both were load-bearing: the suite was green through a Critical defect that
 * destroyed user data, in two independent ways.
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
 * **Which** toast has focus, read from its own title.
 *
 * The assertion the old spec could not make. A toast stack is many buttons of
 * identical shape wired to entirely different mutations — an `added` toast's
 * Undo deletes the row it created, an `updated` toast's reverts an edit, and
 * the toggle's own restores the completion. Naming the owner is the only way a
 * test can tell "the right Undo" from "an Undo".
 */
const focusedToastTitle = async (page: Page): Promise<string | null> =>
  page.evaluate(() => {
    const active = document.activeElement;

    if (active === null || active === document.body) return null;

    return (
      active.closest('[data-slot="toast"]')?.querySelector('[data-slot="toast-title"]')
        ?.textContent ?? null
    );
  });

const statusFilter = (page: Page, status: keyof typeof STATUS_FILTER_LABELS) =>
  page
    .getByRole("radiogroup", { name: STATUS_FILTER_ARIA_LABEL })
    .getByRole("radio", { name: STATUS_FILTER_LABELS[status], exact: true });

/**
 * Selects `Active` the way a user does — **not** by navigating to the URL.
 *
 * `router.replace` from the filter bar re-renders the list without tearing the
 * document down, so the toasts raised by the seed are still on screen when the
 * toggle happens. That is the ordinary state this feature lives in (`
 * UNDO_WINDOW_MS` is 12s precisely so toasts linger) and the state DEF-25
 * needs. A `goto` here would sterilise it.
 */
const chooseActiveFilter = async (page: Page) => {
  await statusFilter(page, "active").click();
  await expect(page).toHaveURL(/status=active/);
};

/**
 * Establishes keyboard modality before landing on the row.
 *
 * The rescue is deliberately keyboard-only, and react-aria decides modality
 * from real events — so this presses a real Tab rather than assuming it. The
 * subsequent `focus()` is how the test skips the tab-walk *into* the list,
 * which is not what is under test; the walk *out* of it is.
 */
const focusRowFromKeyboard = async (page: Page, title: string) => {
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
  test("a keyboard toggle that removes the row lands focus on its own Undo, and Enter restores it", async ({
    signedIn,
    todos,
  }) => {
    await seedList(todos, signedIn);

    // The filter that makes the toast the only route back (US-07).
    await chooseActiveFilter(signedIn);
    await expect(signedIn.locator("main").getByText(TOGGLED_TITLE)).toBeVisible();

    await focusRowFromKeyboard(signedIn, TOGGLED_TITLE);
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
      The whole criterion, in one assertion: focus is *on* the Undo of the
      toast this toggle raised, with no tab-walk in between and therefore no
      dependence on how many todos the account has. Before the rescue existed
      this read "body"; while it selected by stack position it read the Undo of
      whichever `added` toast the seed had left frontmost.
    */
    await expect
      .poll(() => focusedToastTitle(signedIn))
      .toBe(markedCompleteToast(TOGGLED_TITLE));
    expect(await activeSlot(signedIn)).toBe("toast-action-button");

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

    await chooseActiveFilter(signedIn);
    await expect(signedIn.locator("main").getByText(TOGGLED_TITLE)).toBeVisible();

    await focusRowFromKeyboard(signedIn, TOGGLED_TITLE);
    await signedIn.keyboard.press("Space");

    await expect
      .poll(() => focusedToastTitle(signedIn))
      .toBe(markedCompleteToast(TOGGLED_TITLE));

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

    await expect.poll(() => activeSlot(signedIn)).not.toBe("body");
  });

  test("a pointer toggle does not pull focus into the toast, even with a row focused", async ({
    signedIn,
    todos,
  }) => {
    await seedList(todos, signedIn);

    await chooseActiveFilter(signedIn);
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
    await focusRowFromKeyboard(signedIn, "filler row 1");
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
 * DEF-25 — **Critical**. The rescue must not arm a mutation the user did not
 * ask for, on a record they never touched.
 *
 * QA's repro, constructed rather than waited for. Two quick-adds leave two
 * `added` toasts standing, each with an Undo that is a `DELETE` of the todo it
 * created. The toggle then dismisses its own row's `added` toast and raises a
 * success toast — but HeroUI serialises both through `startViewTransition`, so
 * for a stretch of frames the *frontmost* toast is `keepme`'s. A rescue that
 * asks for "the frontmost toast's action" gets that one, and the `Enter` that
 * §6.8 promises will undo the completion instead deletes `keepme`
 * permanently: no confirm, no undo behind it. Six of six for QA, verified
 * against the database.
 *
 * **Why the `PATCH` is held.** Without it the window is a race and the test
 * would be reporting the runner's frame rate. Holding the write until after
 * the dismissal's transition has committed makes `keepme`'s toast frontmost by
 * construction, so this fails on the old code every time rather than most of
 * the time.
 *
 * The assertion is the *owner* of the focused button and the absence of a
 * `DELETE` on the wire — not the button's `data-slot`, which the wrong toast
 * satisfies exactly as well.
 */
test.describe("DEF-25 — the rescue must focus this toggle's Undo, not a neighbour's", () => {
  const KEPT = "keepme";
  const TARGET = "target";

  test("a keyboard toggle beside an older Undo destroys nothing", async ({
    signedIn,
    todos,
  }) => {
    await todos.quickAdd(KEPT);
    await expect(signedIn.locator("main").getByText(KEPT)).toBeVisible();
    await todos.quickAdd(TARGET);
    await expect(signedIn.locator("main").getByText(TARGET)).toBeVisible();

    await chooseActiveFilter(signedIn);

    // Both `added` toasts are still offering their Undo — the state the 12s
    // window exists to create, and the state the old spec navigated away from.
    await expect(todos.toastTitles.filter({ hasText: addedToast(KEPT) })).toBeVisible();
    await expect(
      todos.toastTitles.filter({ hasText: addedToast(TARGET) }),
    ).toBeVisible();

    const deletes = countRequests(signedIn, TODO_ITEM_URL, "DELETE");

    /*
      Long enough for the dismissal of `target`'s own `added` toast to commit
      before the success toast is even queued, which is what puts a *different
      todo's* toast in the frontmost slot at the moment the rescue reads it.
    */
    const HELD_WRITE_MS = 700;

    await signedIn.route("**/api/todos/*/status", async (route) => {
      await new Promise((resolve) => setTimeout(resolve, HELD_WRITE_MS));
      await route.continue();
    });

    await focusRowFromKeyboard(signedIn, TARGET);
    await signedIn.keyboard.press("Space");

    await expect(
      todos.toastTitles.filter({ hasText: markedCompleteToast(TARGET) }),
    ).toBeVisible();

    /*
      The defect, stated as an assertion: the focused Undo belongs to the
      toggle that just happened. On the unfixed code this reads
      `Todo “keepme” added` — a different toast, a different todo, a different
      action.
    */
    await expect
      .poll(() => focusedToastTitle(signedIn))
      .toBe(markedCompleteToast(TARGET));

    // The key §6.8 tells the user activates Undo.
    await signedIn.keyboard.press("Enter");

    // It undid the completion, which is what it promised to do.
    await expect(signedIn.locator("main").getByText(TARGET)).toBeVisible();
    await expect(
      todos.toastTitles.filter({ hasText: markedNotCompleteToast(TARGET) }),
    ).toBeVisible();

    // And `keepme` was never touched — on the wire, on screen, and in the
    // database, which is the only one of the three that is not recoverable.
    expect(deletes.count, "a keypress aimed at Undo issued a DELETE").toBe(0);
    await expect(signedIn.locator("main").getByText(KEPT)).toBeVisible();

    const stored = await signedIn.request.get("/api/todos");

    expect(stored.ok()).toBe(true);

    const body = (await stored.json()) as {
      todos: { title: string }[];
      totalCount: number;
    };

    expect(body.totalCount).toBe(2);
    expect(body.todos.map((todo) => todo.title).sort()).toEqual([KEPT, TARGET]);
  });
});

/**
 * DEF-26 — **High**. The rescue must actually deliver focus, and keep it.
 *
 * QA measured focus ending on `<body>` in 8 of 12 trials — verbatim the
 * pre-fix state NFR-04 exists to eliminate — and on a toast *container*, which
 * has no action on it, in most of the rest. They measured the rate and not the
 * cause; the cause is the same wrong choice as DEF-25.
 *
 * Selecting by stack position lands focus on a toast that is **on its way
 * out**: `dismissUndo`'s `toast.close` is queued behind the same serialized
 * view transition as the add, so it commits a frame or two *after* the rescue
 * has already focused it. react-aria's `useToastRegion` watches for exactly
 * that — a focused toast being removed — and re-homes focus onto a
 * neighbouring toast container, or drops it on `<body>` when its own index
 * bookkeeping has not caught up. So the rescue was not failing to run. It ran,
 * onto a doomed toast, and had focus taken back off it.
 *
 * Which is why this test samples focus **after the stack has finished
 * churning** rather than on the first frame it settles. A test that only polls
 * until it sees an action button can pass on the ~20ms the wrong toast holds
 * focus before react-aria takes it away.
 */
test.describe("DEF-26 — the rescue delivers focus and keeps it", () => {
  /** The gaps QA varied: the toggle fired at 0ms, and after the stack settled. */
  for (const gapMs of [0, 1500]) {
    test(`focus survives the toast stack settling — ${gapMs}ms after the last quick-add`, async ({
      signedIn,
      todos,
    }) => {
      const titles = ["alpha", "bravo", "charlie", "delta"];

      for (const title of titles) {
        await todos.quickAdd(title);
        await expect(signedIn.locator("main").getByText(title)).toBeVisible();
      }

      await chooseActiveFilter(signedIn);
      await signedIn.waitForTimeout(gapMs);

      await focusRowFromKeyboard(signedIn, "delta");
      await signedIn.keyboard.press("Space");

      await expect(
        todos.toastTitles.filter({ hasText: markedCompleteToast("delta") }),
      ).toBeVisible();

      await expect
        .poll(() => focusedToastTitle(signedIn))
        .toBe(markedCompleteToast("delta"));

      /*
        The load-bearing half. Every re-homing QA saw happened within a few
        frames of the rescue landing, so the question is not where focus went
        but where it *stayed*. Long enough for the dismissal, the add and the
        stack's re-index to have all committed.
      */
      await signedIn.waitForTimeout(1500);

      expect(await activeSlot(signedIn)).toBe("toast-action-button");
      expect(await focusedToastTitle(signedIn)).toBe(markedCompleteToast("delta"));

      // Operable, not merely focused — the state QA found focus in most often
      // was the toast container, where `Space` and `Enter` do nothing at all.
      await signedIn.keyboard.press("Enter");

      await expect(signedIn.locator("main").getByText("delta")).toBeVisible();
    });
  }
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

    await chooseActiveFilter(signedIn);
    await expect(signedIn.locator("main").getByText(TOGGLED_TITLE)).toBeVisible();

    await focusRowFromKeyboard(signedIn, TOGGLED_TITLE);
    await signedIn.keyboard.press("Space");

    // The list is now empty — the empty state has replaced every row.
    await expect(signedIn.locator("main").getByText(TOGGLED_TITLE)).toHaveCount(0);
    await expect(
      todos.toastTitles.filter({ hasText: markedCompleteToast(TOGGLED_TITLE) }),
    ).toBeVisible();

    /*
      Named by owner, and it matters more here than anywhere: this row's own
      `added` toast is still on screen and is the one `dismissUndo` is closing.
      Its Undo deletes the todo. Focusing it would mean the user who finished
      their last todo presses `Enter` to un-finish it and destroys it instead.
    */
    await expect
      .poll(() => focusedToastTitle(signedIn))
      .toBe(markedCompleteToast(TOGGLED_TITLE));

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

    await chooseActiveFilter(signedIn);
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

    await focusRowFromKeyboard(signedIn, TOGGLED_TITLE);
    await signedIn.keyboard.press("Space");

    // The row comes back and the failure is reported.
    await expect(signedIn.locator("main").getByText(TOGGLED_TITLE)).toBeVisible();

    /*
      Focus is somewhere a keyboard user can carry on from — not on the floor,
      and not on a toast either. The seed's `added` toasts are still on screen
      here, so "no toast to move to" is now a claim about *this* toggle rather
      than about the screen being empty: a positional rescue would happily take
      one of them.
    */
    await expect.poll(() => activeSlot(signedIn)).not.toBe("body");
    expect(await focusedToastTitle(signedIn)).toBeNull();
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

    await chooseActiveFilter(signedIn);
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

    await focusRowFromKeyboard(signedIn, TOGGLED_TITLE);
    await signedIn.keyboard.press("Space");

    // The row is gone optimistically and step 1 has moved focus to a row.
    await expect(signedIn.locator("main").getByText(TOGGLED_TITLE)).toHaveCount(0);

    // The user moves on and starts typing the next todo.
    await todos.quickAddInput.click();
    await todos.quickAddInput.pressSequentially(TYPED);
    await expect(todos.quickAddInput).toBeFocused();

    release();

    await expect(
      todos.toastTitles.filter({ hasText: markedCompleteToast(TOGGLED_TITLE) }),
    ).toBeVisible();

    /*
      Step 2 fires on the frame the action button appears, so once the toast is
      on screen the steal has either happened or is one frame away. A bounded
      wait is the honest way to assert a negative here — a web-first assertion
      for "focus did not move" would pass on the frame before it did.
    */
    await signedIn.waitForTimeout(700);

    expect(await activeSlot(signedIn)).not.toBe("toast-action-button");
    await expect(todos.quickAddInput).toBeFocused();
    await expect(todos.quickAddInput).toHaveValue(TYPED);
  });
});

/**
 * QA DEF-28 — the guard has to name *which* row, not the kind of thing a row is.
 *
 * The describe above is the case the guard always got right: focus that leaves
 * the list entirely. `focusIsUnclaimed` used to answer "is the active element
 * one of the row checkboxes", which is true of every row on screen — so the
 * user who tabs from the rescued row to the row *next to it* was
 * indistinguishable from the user who has not moved at all, and had focus
 * yanked onto the toast when the write finally landed. QA reproduced it 3 of 3
 * against a 2500ms status write.
 *
 * The consequence is not cosmetic and it is why this is a regression test
 * rather than a nicety: the user walks to `victim` meaning to complete it,
 * focus is taken to `target`'s `Undo`, and the `Space` they meant for `victim`
 * un-completes `target`. Neither change they wanted reaches the database.
 *
 * It needs a slow write — at ordinary speed the toast arrives before there is
 * time to move — so the response is held open until the move is unambiguous,
 * the same device the quick-add test uses.
 */
test.describe("DEF-28 — the rescue stands down for a neighbouring row too", () => {
  /** The `aria-label` of whatever has focus. A row checkbox names its todo. */
  const activeAriaLabel = async (page: Page): Promise<string | null> =>
    page.evaluate(
      () => document.activeElement?.getAttribute("aria-label") ?? null,
    );

  const isRowCheckboxLabel = (label: string | null): label is string =>
    label !== null && label.startsWith('Mark "');

  /**
   * Walks forward with real `Tab` presses until a **different** row's checkbox
   * has focus, and returns how that row names itself.
   *
   * The number of stops between two checkboxes is the row's own edit and delete
   * buttons, which is a layout fact this test has no business pinning — the
   * `undo-focus` tab tables in `docs/DESIGN.md` §6.8 are where that lives. What
   * matters here is only that the user has arrived somewhere they chose.
   */
  const tabToNeighbouringRow = async (
    page: Page,
    from: string,
  ): Promise<string> => {
    const MAX_PRESSES = 8;
    const seen: (string | null)[] = [];

    for (let press = 0; press < MAX_PRESSES; press += 1) {
      await page.keyboard.press("Tab");

      const label = await activeAriaLabel(page);

      seen.push(label);

      if (isRowCheckboxLabel(label) && label !== from) return label;
    }

    throw new Error(
      `Tab left the list before reaching another row; saw ${JSON.stringify(seen)}`,
    );
  };

  /**
   * A row in the **middle** of the list, which `TOGGLED_TITLE` is not.
   *
   * The list is newest-first, so the seed's first todo is its last row: step 1
   * would land focus on the new last row, and the next `Tab` leaves the list
   * into the toast region — which is the case the describe above already
   * covers. Toggling a middle row is what puts a *neighbouring row* one Tab
   * walk away, and that is the whole distinction DEF-28 turns on.
   */
  const MIDDLE_TITLE = "filler row 4";

  test("a toast arriving does not steal focus from the row the user tabbed to", async ({
    signedIn,
    todos,
  }) => {
    await seedList(todos, signedIn);

    await chooseActiveFilter(signedIn);
    await expect(signedIn.locator("main").getByText(MIDDLE_TITLE)).toBeVisible();

    /*
      Held so the toast cannot arrive until the user has demonstrably chosen a
      different row. Without it this test would be racing the round trip, which
      is the 1-in-3 QA saw at ordinary speed and not something to assert on.
    */
    let release = () => {};
    const held = new Promise<void>((resolve) => {
      release = resolve;
    });

    await signedIn.route("**/api/todos/*/status", async (route) => {
      await held;
      await route.continue();
    });

    await focusRowFromKeyboard(signedIn, MIDDLE_TITLE);
    await signedIn.keyboard.press("Space");

    // The row is gone optimistically and step 1 has landed focus on the row
    // that took its place. That is the anchor the guard is entitled to.
    await expect(signedIn.locator("main").getByText(MIDDLE_TITLE)).toHaveCount(0);
    await expect
      .poll(() => activeAriaLabel(signedIn))
      .toMatch(/^Mark ".+" as complete$/);

    const rescued = await activeAriaLabel(signedIn);

    expect(isRowCheckboxLabel(rescued)).toBe(true);

    // The user chooses a different row, deliberately, while the write is still
    // in flight. This is `victim` in QA's repro.
    const chosen = await tabToNeighbouringRow(signedIn, rescued as string);

    expect(chosen).not.toBe(rescued);

    release();

    await expect(
      todos.toastTitles.filter({ hasText: markedCompleteToast(MIDDLE_TITLE) }),
    ).toBeVisible();

    /*
      Step 2 fires on the frame the action button appears, so once the toast is
      on screen the steal has either happened or is one frame away. A bounded
      wait is the honest way to assert a negative — a web-first assertion for
      "focus did not move" would pass on the frame before it did.
    */
    await signedIn.waitForTimeout(700);

    expect(await activeSlot(signedIn)).not.toBe("toast-action-button");
    expect(await focusedToastTitle(signedIn)).toBeNull();
    // Still on the row they chose, so their next `Space` toggles that row.
    expect(await activeAriaLabel(signedIn)).toBe(chosen);
  });
});
