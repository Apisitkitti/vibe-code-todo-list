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
 * **Both labels are here because they used to be one handler.**
 * `resolveEmptyState` shows `Clear filters` when a status or priority filter
 * matched nothing and `Clear search` when a query did, and until this branch
 * both called `clearFilters` — so `Clear search` reset the priority filter and
 * the status filter as well as the search. They are two handlers now, one per
 * label, and both are pressed here so neither label is free to drift back into
 * describing less than it does.
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
   * The field is asserted, not just the URL: the two have come apart before,
   * which is the whole subject of `search-clear-race.spec.ts`. Emptying the
   * box is `setSearchQuery(current, "")` before the push, and it is the half a
   * URL assertion cannot see.
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

      They are still two controls — the field's `×` is `tabindex="-1"` and is
      the one `a11y-targets.spec.ts` measures; this one is a real tab stop —
      but they no longer do different amounts, which is what made the shared
      name a false claim. Both clear the search term and nothing else. The next
      test is the one that holds that.
    */
    await page
      .locator('[data-slot="empty-state"]')
      .getByRole("button", { name: CLEAR_SEARCH_LABEL, exact: true })
      .click();

    await expect(search).toHaveValue("");
    await expect(todos.rowByText(ROW)).toBeVisible();
    await expect(page).not.toHaveURL(/q=/);
  });

  /**
   * The repro. `Clear search` used to call `clearFilters`, so it reset the
   * priority filter and the status filter as well as the search — the label
   * naming one filter and the handler dropping three.
   *
   * That is not a pedantic reading of a word. Two controls on this screen
   * answer to `Clear search` while `No matches` is up: the search field's own
   * `×`, which clears the text, and this one, which cleared everything. A
   * screen-reader user heard the same name twice for two different amounts of
   * work, and the name is all they had to tell them apart. Making the empty
   * state's action mean what the field's `×` already means is the smaller of
   * the two available fixes — the alternative, renaming this one `Clear
   * filters`, keeps a control that silently discards work the user did not ask
   * it to touch and merely stops advertising it under the wrong word.
   *
   * The end state is the assertion that carries it: with the search dropped
   * and `priority=high` kept, the screen moves from `No matches` to
   * `No todos match these filters` — a *different* empty state, which is only
   * reachable if exactly one of the two narrowings went away. Asserting the
   * row came back would be the assertion for the old behaviour.
   */
  test("drops the search term and leaves the priority filter where the user set it", async ({
    signedIn: page,
  }) => {
    await seedOne(page);
    await narrowToNothing(page);

    const search = page.getByRole("searchbox", { name: SEARCH_BOX_LABEL });

    await search.fill("nothing matches this");

    // `query !== ""` is checked before `priority !== "all"`, so the search is
    // the branch on screen even though both are narrowing.
    await expect(
      page.getByRole("heading", { name: NO_MATCHES_HEADING }),
    ).toBeVisible();
    await expect(page).toHaveURL(/priority=high/);

    await page
      .locator('[data-slot="empty-state"]')
      .getByRole("button", { name: CLEAR_SEARCH_LABEL, exact: true })
      .click();

    await expect(search).toHaveValue("");
    await expect(page).not.toHaveURL(/q=/);

    await expect(page).toHaveURL(/priority=high/);
    await expect(
      page.getByRole("button", { name: PRIORITY_FILTER_ARIA_LABEL }),
    ).toHaveText(PRIORITY_FILTER_LABELS.high);
    await expect(
      page.getByRole("heading", { name: NO_MATCHING_FILTERS_HEADING }),
    ).toBeVisible();
  });

  /**
   * The case that makes the one above mean something, and the reason the name
   * is now allowed to be shared.
   *
   * While `No matches` is up, two controls answer to `Clear search`: the
   * field's `×` and the empty state's action. A duplicate accessible name is
   * only a defect when the two do different things — WCAG asks a name to
   * describe its control, not to be unique on the page — so the fix was to
   * make them equivalent rather than to invent a second word for one of them.
   * This asserts the equivalence directly: **the same starting state, the
   * other control, the same three outcomes.** Without it, "they are equivalent
   * now" is a claim in a comment.
   *
   * The count is asserted first and deliberately. It is the thing that would
   * tell a future reader the collision is intentional rather than an
   * oversight, and it is what turns a rename of either control into a
   * failure here instead of a silent divergence.
   */
  test("the field's own × reaches the same place, which is what makes one name for two controls honest", async ({
    signedIn: page,
  }) => {
    await seedOne(page);
    await narrowToNothing(page);

    const search = page.getByRole("searchbox", { name: SEARCH_BOX_LABEL });

    await search.fill("nothing matches this");

    await expect(
      page.getByRole("heading", { name: NO_MATCHES_HEADING }),
    ).toBeVisible();
    await expect(
      page.getByRole("button", { name: CLEAR_SEARCH_LABEL, exact: true }),
    ).toHaveCount(2);

    /*
      Named by its slot rather than by `.first()`: the two share an accessible
      name, so position is the only thing left to tell them apart in a
      role query, and position is exactly what this project's defect families
      come from. `search-field-clear-button` is HeroUI's own
      (`node_modules/@heroui/react/dist/components/search-field/search-field.js`).
    */
    await page.locator('[data-slot="search-field-clear-button"]').click();

    await expect(search).toHaveValue("");
    await expect(page).not.toHaveURL(/q=/);
    await expect(page).toHaveURL(/priority=high/);
    await expect(
      page.getByRole("heading", { name: NO_MATCHING_FILTERS_HEADING }),
    ).toBeVisible();
  });
});
