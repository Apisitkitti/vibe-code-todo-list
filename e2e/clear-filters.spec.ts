import type { Page } from "@playwright/test";

import {
  BOARD_VIEW_LABEL,
  CLEAR_FILTERS_LABEL,
  CLEAR_SEARCH_LABEL,
  NO_MATCHES_HEADING,
  NO_MATCHING_FILTERS_HEADING,
  PRIORITY_FILTER_ARIA_LABEL,
  PRIORITY_FILTER_LABELS,
  SEARCH_BOX_LABEL,
  VIEW_TOGGLE_ARIA_LABEL,
} from "./support/copy";
import { expect, test } from "./support/fixtures";

/**
 * The empty state's `Clear filters`, pressed.
 *
 * Cause C of `docs/MUTATION-AUDIT-E2E.md`, and the shortest entry in it:
 * `grep -rn "Clear filters" e2e/` returned nothing. The button is rendered,
 * labelled, reachable, and backed by a product ruling that `src/lib/todosUrl.ts`
 * argues for at length — and no test in the suite pressed it. `U4`, which adds
 * `view: DEFAULT_VIEW` to `CLEARED_FILTERS` so that clearing the filters also
 * throws the user out of the board, survived 41 tests across four files.
 *
 * The only "clear" the suite did exercise is the search field's own clear
 * button in `a11y-targets.spec.ts`, which is a different control on a
 * different code path.
 *
 * **Both labels are here because they are one handler.** `resolveEmptyState`
 * shows `Clear filters` when a status or priority filter matched nothing and
 * `Clear search` when a query did, and both call `clearFilters`. Pressing only
 * one would leave half the ruling covered and the other label free to drift.
 */

const ROW = "the only todo";

const seedOne = async (page: Page) => {
  const response = await page.request.post("/api/todos", {
    data: { title: ROW, note: "", priority: "medium", dueAt: "" },
  });

  expect(response.status()).toBe(201);

  await page.reload();
};

/**
 * Narrows by **priority** until nothing matches, which is the only filter that
 * reaches the branch this file is about.
 *
 * A first draft used the status filter, because it is a radiogroup and the
 * priority one is a HeroUI `Select` behind a popover. It was wrong:
 * `resolveEmptyState` answers `status=completed` with its own `Nothing
 * completed yet` state, which carries **no action button at all**, so there was
 * nothing to press and the test timed out looking for a heading the app had no
 * reason to render. `priority !== "all"` is the branch that returns
 * `noMatchingFilters()`, and it is the branch `Clear filters` belongs to.
 *
 * Driven through the real control rather than through `page.goto` — the ruling
 * under test is about what the button *pushes* over the state the user is
 * actually in, and a `goto` would set that state by a route no user takes.
 */
const narrowToNothing = async (page: Page) => {
  await page.getByRole("button", { name: PRIORITY_FILTER_ARIA_LABEL }).click();
  await page
    .getByRole("option", { name: PRIORITY_FILTER_LABELS.high, exact: true })
    .click();

  await expect(
    page.getByRole("heading", { name: NO_MATCHING_FILTERS_HEADING }),
  ).toBeVisible();
};

const clearFiltersButton = (page: Page) =>
  page.getByRole("button", { name: CLEAR_FILTERS_LABEL, exact: true });

test.describe("Clear filters", () => {
  test("puts every filter back to its default and brings the rows back", async ({
    signedIn: page,
    todos,
  }) => {
    await seedOne(page);
    await narrowToNothing(page);

    await expect(page).toHaveURL(/priority=high/);
    await expect(todos.rowByText(ROW)).toHaveCount(0);

    await clearFiltersButton(page).click();

    await expect(todos.rowByText(ROW)).toBeVisible();
    /*
      The defaults are *omitted* from the URL rather than written out as
      `status=all` — `todosUrl` drops every value that equals its default, and
      `search-clear-race.spec.ts` pins that separately. So the assertion is that
      the clause is gone, not that it reads `all`.
    */
    await expect(page).not.toHaveURL(/priority=/);
    await expect(
      page.getByRole("button", { name: PRIORITY_FILTER_ARIA_LABEL }),
    ).toHaveText(PRIORITY_FILTER_LABELS.all);
  });

  /**
   * `U4`, and the ruling it breaks, quoted from `src/lib/todosUrl.ts`:
   *
   * > The user asked to stop narrowing the list; they did not ask to leave the
   * > board they are looking at.
   *
   * Under the mutant a user on the board whose filters match nothing presses
   * `Clear filters` and lands back in the list — the app losing its place, in
   * the one press whose whole purpose is to restore it.
   *
   * The view is asserted through the URL **and** through the toggle's own
   * checked state. The URL alone would pass against a screen that kept
   * `view=board` while rendering the list, which is the shape of the
   * `filterSync` races `search-clear-race.spec.ts` exists for.
   */
  test("leaves the user on the board they were looking at", async ({
    signedIn: page,
    todos,
    isMobile,
  }) => {
    test.skip(isMobile === true, "the board needs a desktop viewport");

    await seedOne(page);

    await page
      .getByRole("radiogroup", { name: VIEW_TOGGLE_ARIA_LABEL })
      .getByRole("radio", { name: BOARD_VIEW_LABEL, exact: true })
      .click();
    await expect(page).toHaveURL(/view=board/);

    await narrowToNothing(page);
    // Still the board, narrowed — the precondition, so a mutant that never
    // reached the board cannot pass the assertion below by accident.
    await expect(page).toHaveURL(/view=board/);

    await clearFiltersButton(page).click();

    await expect(todos.rowByText(ROW)).toBeVisible();
    await expect(page).toHaveURL(/view=board/);
    await expect(
      page.getByRole("radio", { name: BOARD_VIEW_LABEL, exact: true }),
    ).toBeChecked();
  });
});

test.describe("Clear search", () => {
  /**
   * The same handler under its other label. `clearFilters` empties the search
   * box as well as the filters — `setSearchQuery(current, "")` before the push
   * — so the field is asserted, not just the URL: the two have come apart
   * before, which is the whole subject of `search-clear-race.spec.ts`.
   */
  test("empties the box the user typed in, not only the query in the URL", async ({
    signedIn: page,
    todos,
  }) => {
    await seedOne(page);

    const search = page.getByRole("searchbox", { name: SEARCH_BOX_LABEL });

    await search.fill("nothing matches this");

    await expect(
      page.getByRole("heading", { name: NO_MATCHES_HEADING }),
    ).toBeVisible();
    await expect(page).toHaveURL(/q=/);

    /*
      Scoped to the empty state, and it has to be: the search field's **own**
      clear `×` carries `aria-label="Clear search"` too, so while this empty
      state is up the page holds two different controls under one accessible
      name. An unscoped `getByRole` resolves to both and Playwright refuses it
      in strict mode — which is how this was found.

      They are not the same control. The field's `×` is the one
      `a11y-targets.spec.ts` measures, it is `tabindex="-1"`, and it clears only
      the text; this one is a real tab stop and calls `clearFilters`, which
      resets the priority filter as well. Worth someone's attention as a copy
      question — a screen-reader user hears the same name twice and cannot tell
      which does more — but it is not this file's to change.
    */
    await page
      .locator('[data-slot="empty-state"]')
      .getByRole("button", { name: CLEAR_SEARCH_LABEL, exact: true })
      .click();

    await expect(search).toHaveValue("");
    await expect(todos.rowByText(ROW)).toBeVisible();
    await expect(page).not.toHaveURL(/q=/);
  });
});
