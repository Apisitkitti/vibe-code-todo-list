import type { Page } from "@playwright/test";

import {
  STATUS_FILTER_ARIA_LABEL,
  STATUS_FILTER_LABELS,
  doneCount,
  markedCompleteToast,
} from "./support/copy";
import { TODO_LIST_URL, TODO_STATUS_URL } from "./support/assertions";
import { expect, test } from "./support/fixtures";

/**
 * DEF-20's residual: a list load the server answered **before** the write
 * committed, whose response lands **after** the `PATCH` response.
 *
 * `e2e/mid-flight-reload.spec.ts` pins the interleaving where the load lands
 * *first*, and the landed-load counter closes that one: the toggle sees the
 * count move under it and refetches. This spec is the mirror image, and the
 * counter is blind to it by construction. At the moment the `PATCH` resolves
 * nothing has landed, so the counter agrees with itself and `replaceTodo` runs
 * — and then the stale answer arrives and overwrites the result with counts
 * computed from a database that had never seen the write. The header drifts
 * away from the rows on screen and stays drifted, because since m-7 no later
 * toggle refetches.
 *
 * **Both sides of both requests are controlled, which is the only way to build
 * this ordering.** The existing spec holds the `PATCH` on the way *out* and
 * lets the `GET` run free, because there the reload must be answered by a
 * database without the write. Here the `GET` must *also* be answered by that
 * database and then arrive late, so it is intercepted, forwarded immediately
 * with `route.fetch()` — the real handler, the real pre-write count — and its
 * **response** parked until the test releases it. That is the one arrangement
 * that separates "when the server answered" from "when the client heard", and
 * separating those two is the whole of the defect.
 *
 * Nothing here is faulted or mocked. Both requests succeed, both bodies are
 * the server's own; only their order is chosen. A test that faked the `GET`
 * body would prove nothing about a count the server owns.
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

/** See `mid-flight-reload.spec.ts` — a radiogroup, and the labels collide. */
const statusFilter = (page: Page, status: keyof typeof STATUS_FILTER_LABELS) =>
  page
    .getByRole("radiogroup", { name: STATUS_FILTER_ARIA_LABEL })
    .getByRole("radio", { name: STATUS_FILTER_LABELS[status], exact: true });

test.describe("a list load answered before a write it lands after", () => {
  test("the stale answer does not overwrite the write that beat it home", async ({
    signedIn: page,
    todos,
  }) => {
    await seedTodos(page, [TOGGLED_TITLE, SECOND_TITLE, THIRD_TITLE]);

    await page.goto(ACTIVE_URL);
    await expect(todos.rowByText(TOGGLED_TITLE)).toBeVisible();
    await expect(todos.doneCounter).toHaveText(doneCount(0, 3));

    // Gate one: the `PATCH` waits here so the `GET` below is answered by a
    // server that has not seen the write. Released into `route.continue()`, so
    // the write is real.
    let releaseToggle = () => {};
    const toggleHeld = new Promise<void>((resolve) => {
      releaseToggle = resolve;
    });

    await page.route(TODO_STATUS_URL, async (route) => {
      await toggleHeld;
      await route.continue();
    });

    await todos.toggle(TOGGLED_TITLE, true);

    // The optimistic half: the row leaves the filtered list and the
    // account-wide counter moves with it, before the server is consulted.
    await expect(todos.rowByText(TOGGLED_TITLE)).toHaveCount(0);
    await expect(todos.doneCounter).toHaveText(doneCount(1, 3));

    /*
      Gate two, and the piece `mid-flight-reload.spec.ts` does not have. The
      first `GET` after this point is forwarded to the real handler at once —
      answered pre-commit, exactly as in that spec — and then its *response*
      is parked. Only the first: the re-ask a correct implementation makes
      must reach the server unimpeded, and holding that one too would prove
      nothing except that a held request stays held.
    */
    let releaseStaleList = () => {};
    const staleListHeld = new Promise<void>((resolve) => {
      releaseStaleList = resolve;
    });

    let markListAnswered = () => {};
    const listAnswered = new Promise<void>((resolve) => {
      markListAnswered = resolve;
    });

    let hasParkedOne = false;

    await page.route(TODO_LIST_URL, async (route) => {
      if (hasParkedOne || route.request().method() !== "GET") {
        return route.fallback();
      }

      hasParkedOne = true;

      const answer = await route.fetch();

      markListAnswered();

      await staleListHeld;
      await route.fulfill({ response: answer });
    });

    // The load. A filter change is the likeliest way a user lands one inside
    // a toggle's flight window, and it is the trigger DEF-20 was reported
    // against.
    await statusFilter(page, "completed").click();

    // The server has now answered that load — with `0 of 3`, from a database
    // where the write has not landed — and the client has not heard it yet.
    await listAnswered;

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

    /*
      The write has landed and its arithmetic is on screen. Asserted before the
      release so a failure below can only be the stale answer arriving — if the
      counter were already wrong here, this would be a different defect.
    */
    await expect(todos.doneCounter).toHaveText(doneCount(1, 3));

    // The stale answer, finally delivered. Waited for explicitly: asserting
    // straight after the release would race the very event under test and pass
    // on a frame that predates it.
    const staleList = page.waitForResponse(
      (response) =>
        TODO_LIST_URL.test(response.url()) &&
        response.request().method() === "GET",
    );

    releaseStaleList();

    expect((await staleList).status()).toBe(200);

    /*
      The assertion this spec exists for. One todo of three is complete in the
      database and the toast has already said so; a load that was asked before
      that became true may not be allowed to say otherwise afterwards.

      Unfixed, the counter reads `0 of 3` from here on — permanently, because
      nothing on the toggle path refetches.
    */
    await expect(todos.doneCounter).toHaveText(doneCount(1, 3));

    /*
      And the other half: refusing a stale answer must not freeze the list on
      the filter the user just left. Under `Completed` the row has to appear,
      which it can only do if the refusal re-asked the question. Unfixed, the
      stale answer *is* what renders here — a `Completed` list computed before
      the write, so empty — and the row is missing for the opposite reason.
    */
    await expect(todos.rowByText(TOGGLED_TITLE)).toBeVisible();

    /*
      The drift outlives the toggle that caused it, so a counter that is right
      for one frame is not enough. Going back to `Active` re-asks the server,
      and the two must agree.
    */
    await statusFilter(page, "active").click();

    await expect(todos.doneCounter).toHaveText(doneCount(1, 3));
    await expect(todos.rowByText(TOGGLED_TITLE)).toHaveCount(0);
  });

  /**
   * The refusal window, which the test above passes straight through.
   *
   * A refused load re-asks, and until that re-ask lands there is nothing newer
   * to render — so what the user is shown in between is whatever the *previous*
   * question returned. Under a filter change that is the old filter's rows
   * sitting under the new filter's heading, which is precisely the state the
   * skeleton exists to prevent: `useTodoList` already raises `isLoading` during
   * render when the filter key moves, for the documented reason that a frame of
   * stale rows reads as the app ignoring you (review m-8).
   *
   * Dropping the skeleton when the refused answer arrives spends that guarantee
   * on a load that was then thrown away. The window is a full round trip — a
   * few tens of milliseconds locally and a real pause on a real connection —
   * and the re-ask is deliberately silent, so nothing raises it again.
   *
   * **Both the mechanism and the harm are asserted, and the harm comes first.**
   * A skeleton assertion alone could pass on the frame before the refusal has
   * been processed; a stale row rendered under `Completed` cannot appear for a
   * frame and then be right, and it persists for as long as the re-ask is
   * parked. So the absent stale row is what makes this test fail honestly, and
   * the skeleton is what says why.
   */
  test("the skeleton spans the refusal, not just the load that was refused", async ({
    signedIn: page,
    todos,
  }) => {
    await seedTodos(page, [TOGGLED_TITLE, SECOND_TITLE, THIRD_TITLE]);

    await page.goto(ACTIVE_URL);
    await expect(todos.rowByText(TOGGLED_TITLE)).toBeVisible();
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

    /*
      Two gates this time. The first `GET` is the one that will be refused, held
      exactly as above. The second — the re-ask the refusal makes — is held too,
      which is what turns an instant into a window the test can stand inside and
      look around.
    */
    let releaseStaleList = () => {};
    const staleListHeld = new Promise<void>((resolve) => {
      releaseStaleList = resolve;
    });

    let markListAnswered = () => {};
    const listAnswered = new Promise<void>((resolve) => {
      markListAnswered = resolve;
    });

    let releaseReask = () => {};
    const reaskHeld = new Promise<void>((resolve) => {
      releaseReask = resolve;
    });

    let markReaskRequested = () => {};
    const reaskRequested = new Promise<void>((resolve) => {
      markReaskRequested = resolve;
    });

    let listCallCount = 0;

    await page.route(TODO_LIST_URL, async (route) => {
      if (route.request().method() !== "GET") {
        return route.fallback();
      }

      listCallCount += 1;

      if (listCallCount === 1) {
        const answer = await route.fetch();

        markListAnswered();

        await staleListHeld;
        await route.fulfill({ response: answer });

        return;
      }

      if (listCallCount === 2) {
        // The re-ask. Signalled on arrival, so the assertions below run after
        // the refusal has been fully processed rather than racing it.
        markReaskRequested();

        await reaskHeld;
        await route.continue();

        return;
      }

      await route.fallback();
    });

    await statusFilter(page, "completed").click();

    // The filter change raised the skeleton on its own, before any of this.
    await expect(todos.listSkeleton).toBeVisible();

    await listAnswered;

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

    // The refusal happens here: the stale answer lands, is refused, and the
    // re-ask goes out. Awaiting the re-ask's arrival is what makes everything
    // below a statement about the window rather than about a frame.
    releaseStaleList();

    await reaskRequested;

    /*
      The harm, and the assertion that fails honestly. `Book the venue` is
      active; it belongs to the list the user has already left. Rendering it
      under `Completed` — with no skeleton and no pending anything — tells the
      user the server answered when it has not, and it stays on screen for the
      whole round trip.
    */
    await expect(todos.rowByText(SECOND_TITLE)).toHaveCount(0);
    await expect(todos.rowByText(THIRD_TITLE)).toHaveCount(0);

    // And the mechanism: the skeleton the filter change raised is still up,
    // because the question it was raised for still has no answer.
    await expect(todos.listSkeleton).toBeVisible();

    // Released, and the window closes the way it should: the re-ask lands, the
    // skeleton comes down, and the list is the one the filter asked for.
    releaseReask();

    await expect(todos.listSkeleton).toHaveCount(0);
    await expect(todos.rowByText(TOGGLED_TITLE)).toBeVisible();
    await expect(todos.doneCounter).toHaveText(doneCount(1, 3));
  });
});
