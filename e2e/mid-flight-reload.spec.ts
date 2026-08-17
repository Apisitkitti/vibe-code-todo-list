import type { Page } from "@playwright/test";

import {
  STATUS_FILTER_ARIA_LABEL,
  STATUS_FILTER_LABELS,
  doneCount,
  markedCompleteToast,
} from "./support/copy";
import { TODO_STATUS_URL } from "./support/assertions";
import { expect, test } from "./support/fixtures";

/**
 * A reload landing *inside* a toggle's flight window (`docs/REVIEW.md` MA-2
 * third bullet, QA S-C).
 *
 * The header's `N of M done` describes the **account**, not the filtered page,
 * and since m-7 removed the post-toggle refetch the client maintains it by
 * arithmetic between server loads. That makes one interleaving load-bearing:
 *
 *  1. under `Active` the user completes a todo — the row leaves and
 *     `completedCount` goes up by one, both correct and both local;
 *  2. a reload lands while the `PATCH` is still in flight, and replaces local
 *     state with a server count computed *before* the write committed;
 *  3. the `PATCH` resolves, `replaceTodo` cannot find the row to reconcile
 *     against — invariant 2 says it must not add one back — and correctly
 *     no-ops;
 *  4. the header is one low, and stays one low through every subsequent
 *     toggle, because nothing on the toggle path refetches any more.
 *
 * The assertion is deliberately on the **rendered string**, not on a
 * `TodoListResult`. Every one of the 19 Vitest cases around this arithmetic
 * asserts the pure state, and all of them stay green through this defect: the
 * pure functions each do exactly what they document, and the bug is in what
 * the caller does *between* them. Only the browser can see it.
 *
 * The response is **held, not faulted**. The point is not a failure — the
 * write must succeed — it is that the window between the press and the
 * response is long enough for the user to touch the filter. A gate resolved by
 * the test, never a timer, and released into `route.continue()` so the real
 * handler does the real write; a mocked `PATCH` body would prove nothing about
 * a count the server owns.
 *
 * Note which side of the request is held. Holding it *before* it reaches the
 * server is the whole reproduction: the reload's `GET` must be answered from a
 * database where the write has not landed. Holding the *response* of a request
 * the server already committed is benign — the `GET` then carries the new
 * count already — which is why this uses `route.continue()` on release rather
 * than intercepting the reply.
 */

/** Deliberately not substrings of one another — see `filtered-toggle.spec.ts`. */
const TOGGLED_TITLE = "Ship the release";
const SECOND_TITLE = "Book the venue";
const THIRD_TITLE = "Water the plants";

const ACTIVE_URL = "/todos?status=active";

/** Seeded through the same scoped endpoint the browser uses, not a back door. */
const seedTodos = async (page: Page, titles: string[]) => {
  for (const title of titles) {
    const response = await page.request.post("/api/todos", {
      data: { title, note: "", priority: "medium", dueAt: "" },
    });

    expect(response.status()).toBe(201);
  }
};

/**
 * The status filter's own control, scoped to its group.
 *
 * Not `getByRole("button")`: single-selection `ToggleButtonGroup` renders a
 * radiogroup, so the buttons carry `role="radio"` and the button role matches
 * nothing at all. Scoping matters too — "All" is also the priority select's
 * value, and "Completed" is a section heading.
 */
const statusFilter = (page: Page, status: keyof typeof STATUS_FILTER_LABELS) =>
  page
    .getByRole("radiogroup", { name: STATUS_FILTER_ARIA_LABEL })
    .getByRole("radio", { name: STATUS_FILTER_LABELS[status], exact: true });

test.describe("a reload landing mid-toggle", () => {
  test("the counter still agrees with the server after a filter change interrupts a toggle", async ({
    signedIn: page,
    todos,
  }) => {
    await seedTodos(page, [TOGGLED_TITLE, SECOND_TITLE, THIRD_TITLE]);

    await page.goto(ACTIVE_URL);
    await expect(todos.rowByText(TOGGLED_TITLE)).toBeVisible();
    await expect(todos.doneCounter).toHaveText(doneCount(0, 3));

    /*
      A gate, not a sleep: the `PATCH` is parked here until the test opens it,
      so the reload below is guaranteed to be answered by a server that has not
      seen the write. Released into `route.continue()`, so the write is real.
    */
    let releaseToggle = () => {};
    const toggleHeld = new Promise<void>((resolve) => {
      releaseToggle = resolve;
    });

    await page.route(TODO_STATUS_URL, async (route) => {
      await toggleHeld;
      await route.continue();
    });

    await todos.toggle(TOGGLED_TITLE, true);

    // 1. The optimistic half: the row leaves the filtered list and the
    //    account-wide counter moves with it, before the server is consulted.
    await expect(todos.rowByText(TOGGLED_TITLE)).toHaveCount(0);
    await expect(todos.doneCounter).toHaveText(doneCount(1, 3));

    // 2. The interruption. A filter change is a reload with a different
    //    question, and it replaces local state wholesale — the arithmetic
    //    above is thrown away and the server's pre-write count takes its
    //    place. That regression to `0 of 3` is the reproduction, and asserting
    //    it here is what stops this test from passing for the wrong reason on
    //    a run where the reload never actually landed inside the window.
    await statusFilter(page, "completed").click();

    await expect(todos.doneCounter).toHaveText(doneCount(0, 3));
    await expect(todos.rowByText(TOGGLED_TITLE)).toHaveCount(0);

    // 3. Release. The write is real and it succeeds; there is no fault here.
    const patchResponse = page.waitForResponse(
      (response) =>
        TODO_STATUS_URL.test(response.url()) &&
        response.request().method() === "PATCH",
    );

    releaseToggle();

    expect((await patchResponse).status()).toBe(200);

    // The toggle reported success, so `runToggle` has run its success branch
    // to completion and the counter below is its settled answer, not a frame
    // caught mid-update.
    await expect(
      todos.toastTitles.filter({ hasText: markedCompleteToast(TOGGLED_TITLE) }),
    ).toBeVisible();

    /*
      4. The assertion this spec exists for. One todo of three is complete in
      the database; the header must say so. Without reconciliation
      `replaceTodo` no-ops against a list that no longer holds the row and the
      header sits at `0 of 3 done` — permanently, because no later toggle
      refetches.
    */
    await expect(todos.doneCounter).toHaveText(doneCount(1, 3));

    // And the row is where the filter says it should be, which is the other
    // half of a reconcile actually having happened.
    await expect(todos.rowByText(TOGGLED_TITLE)).toBeVisible();

    /*
      The drift outlives the toggle that caused it, so a passing counter here
      must not be a number that happens to be right for one frame. Going back
      to `Active` re-asks the server, and the two must agree.
    */
    await statusFilter(page, "active").click();

    await expect(todos.doneCounter).toHaveText(doneCount(1, 3));
    await expect(todos.rowByText(TOGGLED_TITLE)).toHaveCount(0);
  });

  test("the counter survives a token-driven reload interrupting a toggle", async ({
    signedIn: page,
    todos,
  }) => {
    /*
      The same interleaving reached through the *other* kind of reload — the
      one `requestReload()` drives, where a delete elsewhere on the screen
      bumps the reload token while a toggle is in flight. Worth its own case
      because the two are different mechanisms: a filter change re-runs the
      load effect through its `status` dependency and never touches the token,
      while a delete bumps the token and leaves `status` alone. A fix that
      watches only one of them passes only one of these tests.

      Here the reload's `GET` still asks for `Active`, so it brings the
      *pre-write* row back onto a screen the user had already seen it leave.
      The counter is the same question as above; the row's presence is the
      extra one, because `replaceTodo` splices in place and does not re-apply
      the status filter (`todoListState.ts` invariant 1), so a splice would
      leave a completed row sitting in a list that asked not to see one
      (`docs/PRD.md` US-07 ruling).
    */
    await seedTodos(page, [TOGGLED_TITLE, SECOND_TITLE, THIRD_TITLE]);

    await page.goto(ACTIVE_URL);
    await expect(todos.doneCounter).toHaveText(doneCount(0, 3));

    let releaseToggle = () => {};
    const toggleHeld = new Promise<void>((resolve) => {
      releaseToggle = resolve;
    });

    await page.route(TODO_STATUS_URL, async (route) => {
      await toggleHeld;
      await route.continue();
    });

    await todos.toggle(TOGGLED_TITLE, true);

    await expect(todos.rowByText(TOGGLED_TITLE)).toHaveCount(0);
    await expect(todos.doneCounter).toHaveText(doneCount(1, 3));

    // The interruption: an unrelated delete, which reloads on its own token.
    await todos.openDelete(THIRD_TITLE);
    await todos.confirmDelete();

    // The reload has landed and replaced local state: two todos in the
    // account, none of them complete as far as the server has been told, and
    // the row this test is toggling is back on screen because the server still
    // considers it active.
    await expect(todos.doneCounter).toHaveText(doneCount(0, 2));
    await expect(todos.rowByText(TOGGLED_TITLE)).toBeVisible();

    const patchResponse = page.waitForResponse(
      (response) =>
        TODO_STATUS_URL.test(response.url()) &&
        response.request().method() === "PATCH",
    );

    releaseToggle();

    expect((await patchResponse).status()).toBe(200);

    await expect(
      todos.toastTitles.filter({ hasText: markedCompleteToast(TOGGLED_TITLE) }),
    ).toBeVisible();

    await expect(todos.doneCounter).toHaveText(doneCount(1, 2));
    // US-10: a completed row may not remain in a list filtered to `Active`.
    await expect(todos.rowByText(TOGGLED_TITLE)).toHaveCount(0);
  });
});
