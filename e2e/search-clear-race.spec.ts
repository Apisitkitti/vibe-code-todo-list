import type { Page, Request } from "@playwright/test";

import {
  STATUS_FILTER_ARIA_LABEL,
  STATUS_FILTER_LABELS,
} from "./support/copy";
import { expect, test } from "./support/fixtures";

/**
 * The search box must not be refilled by its own push landing late.
 *
 * Filter state lives in the URL (`docs/PRD.md` US-10), so the search field's
 * value makes a round trip: type, debounce, `router.replace("/todos?q=…")`,
 * and the value comes back as a prop. Anything the user does inside that
 * window — clearing the field, typing more — is newer than the value in
 * flight, and must survive it.
 *
 * It did not. The component compared the incoming `q` against the last one it
 * had seen and adopted anything that differed, which is right for a link or a
 * Back press and wrong for its own echo: the box refilled itself with the text
 * the user had just deleted, and the debounce then found the field and the URL
 * in agreement and never pushed a correction. The field stayed wrong until the
 * user edited it again — a silent, permanent revert of a deliberate action.
 *
 * ── Why the navigation is held rather than raced ────────────────────────────
 *
 * The window is a 300ms debounce plus one `replace`, and on a warm dev server
 * that whole round trip can finish before a `click()` resolves. Holding the
 * navigation open makes the interleaving the test's to choose: the clear
 * happens while the push is provably still in the air, every run, on any
 * machine.
 *
 * **This is the only place the race is caught, and that is not a stylistic
 * preference.** It was believed for a while to be the cause of an intermittent
 * failure in `e2e/a11y-targets.spec.ts`, which would have made a held
 * navigation merely a tidier way to reach the same bug. It was not: that spec
 * has no sensitivity to this defect whatsoever. Disabling the guard entirely,
 * so a real press is followed by a genuine permanent refill, leaves its
 * `toHaveValue("")` passing 20/20 — the assertion resolves on the transient
 * empty value before the ~300ms refill, which is also why `develop` passed it
 * 40/40 while the race was live there.
 *
 * A race whose whole character is that it resolves *after* a settling delay
 * cannot be caught by an assertion that is satisfied before the delay elapses.
 * Holding the navigation is what converts it from an unobservable one to a
 * deterministic one; nothing else here does.
 */

/** The RSC fetch `router.replace` makes for a search push. */
const isSearchNavigation = (url: URL) =>
  url.pathname === "/todos" && url.searchParams.get("q") !== null;

/**
 * The list reload the landing navigation causes, whichever way the field then
 * resolves.
 *
 * Releasing the held response is not the same event as React having applied
 * it, and the two assertions that matter here are about what the field does
 * *after* it is applied. `router.replace` does not even move the address bar
 * until the payload lands, so waiting on the URL would let both assertions
 * pass in the gap before anything had happened — which is how the first draft
 * of this spec passed against the unfixed component.
 *
 * `useTodoList` refetches off the new `query` prop, so this request going out
 * is the prop change reaching the tree. It is not undone by either outcome,
 * which is what makes it a usable anchor rather than another race.
 */
const listReloadFor = (query: string) => (request: Request) =>
  // `query` is the last parameter `getTodoList` builds, so this is exact.
  request.url().includes("/api/todos") &&
  request.url().endsWith(`query=${encodeURIComponent(query)}`);

/**
 * The status filter's own control, scoped to its group.
 *
 * `ToggleButtonGroup` in single-selection mode renders a radiogroup, so these
 * are radios and `getByRole("button")` matches nothing.
 */
const statusFilter = (page: Page, status: keyof typeof STATUS_FILTER_LABELS) =>
  page
    .getByRole("radiogroup", { name: STATUS_FILTER_ARIA_LABEL })
    .getByRole("radio", { name: STATUS_FILTER_LABELS[status], exact: true });

test.describe("the search field owns its own value", () => {
  test("a clear that lands while the push is in flight is not undone", async ({
    signedIn,
    todos,
  }) => {
    await todos.quickAdd("something to search for");
    await expect(
      signedIn.locator("main").getByText("something to search for"),
    ).toBeVisible();

    const search = signedIn.getByRole("searchbox", { name: "Search todos" });
    const clear = signedIn.locator('[data-slot="search-field-clear-button"]');

    let releaseNavigation = () => {};
    const held = new Promise<void>((resolve) => {
      releaseNavigation = resolve;
    });
    let heldCount = 0;

    /*
      Only the push that carries `q` is held. The correcting push the fix makes
      afterwards drops the parameter entirely, so it is not matched and is free
      to land — which is what lets the last assertion below wait on a URL
      rather than on a duration.
    */
    await signedIn.route(
      (url) => isSearchNavigation(url),
      async (route) => {
        heldCount += 1;

        await held;
        await route.continue();
      },
    );

    await search.fill("something");

    // The push is now provably in the air and cannot land until released.
    await expect.poll(() => heldCount).toBeGreaterThan(0);

    await clear.click();
    await expect(search).toHaveValue("");

    const stalePushApplied = signedIn.waitForRequest(listReloadFor("something"));

    releaseNavigation();
    await stalePushApplied;

    /*
      The assertion the unfixed code fails: `?q=something` lands, is read as an
      outside navigation, and puts `something` back in the box.
    */
    await expect(search).toHaveValue("");
    // …and the field, not the stale URL, is what the app converges on.
    await expect(signedIn).toHaveURL(/\/todos$/);
    await expect(search).toHaveValue("");
  });

  /*
    The mirror case — the user keeps typing instead of clearing, and an older
    push lands after a newer one was issued — is covered in
    `tests/unit/searchQuerySync.test.ts` rather than here. Forcing two
    navigations to be in flight at once and to land in the older-first order
    means holding both and releasing them out of order, which tests the App
    Router's supersession rules as much as this component's: Next discards a
    superseded payload on its own, so the interleaving the guard is written for
    never reaches the component. The unit test drives it directly.
  */

  test("a status press does not discard typing that has not landed yet", async ({
    signedIn,
    todos,
  }) => {
    /*
      The same lost update by a different and worse route, and it needs its own
      fix rather than being a second symptom of the one above.

      The guard in `searchQuerySync` governs the *sync* path — what the field
      does when a navigation lands. This one goes wrong at the *push* site.
      `pushFilters({ ...filters, status })` spreads `filters`, which is the
      **URL's** query, not the local `query` state. Press a status toggle
      inside the 300ms debounce and the value spread is the query the URL still
      holds — the stale one — so the push overwrites `?q=` with text the user
      has already replaced. No amount of care on the sync path can see this: by
      the time the navigation lands, the typing is already gone from the URL.

      Asserted on the push rather than on the screen, deliberately. The guard
      makes the component self-heal ~300ms later — the debounce notices the
      field and the URL disagree and pushes a correction — so a test that
      waited for the dust to settle would pass against the broken push site and
      prove nothing. The claim that has to hold is that the status press itself
      carries the user's current text, and that is a property of the one
      request it makes.
    */
    await todos.quickAdd("something to search for");
    await expect(
      signedIn.locator("main").getByText("something to search for"),
    ).toBeVisible();

    const search = signedIn.getByRole("searchbox", { name: "Search todos" });

    let releaseNavigation = () => {};
    const held = new Promise<void>((resolve) => {
      releaseNavigation = resolve;
    });
    let heldCount = 0;

    /*
      Only the plain search push is held — `q` present, `status` absent. The
      status press's own navigation carries `status`, so it is never held
      whichever way it resolves: with `q` when the push site is right, without
      when it is not. Holding it on the correct behaviour alone would deadlock
      the fixed code and pass the broken one.
    */
    await signedIn.route(
      (url) =>
        url.pathname === "/todos" &&
        url.searchParams.get("q") !== null &&
        url.searchParams.get("status") === null,
      async (route) => {
        heldCount += 1;

        await held;
        await route.continue();
      },
    );

    const statusNavigation = signedIn.waitForRequest((request) => {
      const url = new URL(request.url());

      return (
        url.pathname === "/todos" && url.searchParams.get("status") === "active"
      );
    });

    await search.fill("something");

    // The search push is in the air; the URL's `q` is provably still empty.
    await expect.poll(() => heldCount).toBeGreaterThan(0);

    await statusFilter(signedIn, "active").click();

    const pushed = new URL((await statusNavigation).url());

    // The assertion the unfixed push site fails: `q` is absent entirely.
    expect(pushed.searchParams.get("q")).toBe("something");

    releaseNavigation();
    await expect(search).toHaveValue("something");
  });

  test("typing does not discard a filter press that has not landed yet", async ({
    signedIn,
    todos,
  }) => {
    /*
      The mirror of the test above, and the half that was missed the first
      time. `query` was threaded into the status and priority pushes so a
      filter press stops discarding in-flight typing; nothing was done about
      the other direction, and it is the worse one.

      `pushFilters({ ...filters, query })` on the debounce path spreads the
      URL's `status` and `priority`. Press Active and type inside the window
      and the debounced push carries the *old* status, so the press is
      discarded at the push site exactly as the typing was.

      Worse, because there is no recovery. The search text has local state, so
      a lost `q` is noticed and re-pushed; `status` has none — the group renders
      `filters.status` straight from the prop — so once the press is dropped
      from the URL there is nothing left that remembers it happened. The toggle
      simply springs back to All and stays there.
    */
    await todos.quickAdd("something to search for");
    await expect(
      signedIn.locator("main").getByText("something to search for"),
    ).toBeVisible();

    const search = signedIn.getByRole("searchbox", { name: "Search todos" });

    let releaseNavigation = () => {};
    const held = new Promise<void>((resolve) => {
      releaseNavigation = resolve;
    });
    let heldCount = 0;

    /*
      Holds the status press alone — `status` set, `q` absent. The search push
      that follows carries `q`, so it is never held whichever way it resolves:
      with `status` when the push site is right, without when it is not.
    */
    await signedIn.route(
      (url) =>
        url.pathname === "/todos" &&
        url.searchParams.get("status") === "active" &&
        url.searchParams.get("q") === null,
      async (route) => {
        heldCount += 1;

        await held;
        await route.continue();
      },
    );

    const searchNavigation = signedIn.waitForRequest((request) => {
      const url = new URL(request.url());

      return (
        url.pathname === "/todos" && url.searchParams.get("q") === "something"
      );
    });

    await statusFilter(signedIn, "active").click();

    // The press is in the air; the URL's `status` is provably still `all`.
    await expect.poll(() => heldCount).toBeGreaterThan(0);

    await search.fill("something");

    const pushed = new URL((await searchNavigation).url());

    // The assertion the unfixed push site fails: `status` is absent entirely.
    expect(pushed.searchParams.get("status")).toBe("active");

    releaseNavigation();
  });

  test("a load carrying ?q populates the field", async ({
    signedIn,
    todos,
  }) => {
    /*
      The guard must not turn into "ignore the URL". A load carrying `q` still
      has to populate the box, or the fix has traded one wrong value for
      another.

      Named for what it actually exercises. `goto` is a document navigation, so
      the component remounts and this runs `createSearchQuerySync` — the
      constructor — and never reaches `syncSearchQueryToUrl`'s
      outside-navigation branch. It was previously called "still follows a
      navigation that came from outside the field", which is the branch it is
      the one test here that does *not* touch.

      That branch is covered in `tests/unit/searchQuerySync.test.ts`, and it has
      to be, because an in-app navigation to `/todos` carrying a different `q`
      is not something this app can currently produce: nothing links to
      `/todos`, `clearFilters` pushes no `q`, and every filter change is a
      `replace`, so typing lays down no history entry to go Back to. Should any
      of those three change, the branch becomes reachable and wants a real
      journey here.
    */
    await todos.quickAdd("something to search for");
    await signedIn.goto("/todos?q=something");

    await expect(
      signedIn.getByRole("searchbox", { name: "Search todos" }),
    ).toHaveValue("something");
  });
});
