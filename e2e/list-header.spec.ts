import type { Locator, Page } from "@playwright/test";

import {
  HEADER_LINE_PATTERN,
  STATUS_FILTER_ARIA_LABEL,
  STATUS_FILTER_LABELS,
  dueTodayClause,
  headerDate,
  headerLine,
  markedCompleteToast,
  overdueClause,
} from "./support/copy";
import { expect, test } from "./support/fixtures";

/**
 * The dated header line (`docs/PRD.md` US-12, `docs/DESIGN.md` §7.19).
 *
 * `Saturday, 16 August · 3 due today · 1 overdue`, clauses omitted when zero,
 * date alone while loading and when the list is empty.
 *
 * The counts are the sizes of the `Today` and `Overdue` sections the list is
 * drawing. Several tests below therefore assert the line **and** the sections
 * in the same breath: a header that agrees with a number the test hard-coded
 * is worth much less than one that agrees with the rows on screen, and the
 * risk US-12 is actually about is the two disagreeing.
 */

const pad = (value: number) => String(value).padStart(2, "0");

/** `YYYY-MM-DD`, `offset` days from today in **local** time — as `grouping.spec.ts`. */
const localDay = (offset: number): string => {
  const date = new Date();

  date.setDate(date.getDate() + offset);

  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
};

const seed = async (page: Page, seeds: { title: string; dueAt?: string }[]) => {
  for (const item of seeds) {
    const response = await page.request.post("/api/todos", {
      data: {
        title: item.title,
        note: "",
        priority: "medium",
        dueAt: item.dueAt ?? "",
      },
    });

    expect(response.status()).toBe(201);
  }
};

const line = (page: Page) =>
  page.locator("main").getByText(HEADER_LINE_PATTERN);

const rowsUnder = (page: Page, heading: string) =>
  page
    .locator("main section")
    .filter({ has: page.getByRole("heading", { name: heading, exact: true }) })
    .getByRole("listitem");

test.describe("the dated header line", () => {
  test("shows the date alone on an empty account", async ({ signedIn: page }) => {
    await expect(line(page)).toHaveText(headerDate());
  });

  test("counts due today and overdue, in that order, matching the sections", async ({
    signedIn: page,
    todos,
  }) => {
    await seed(page, [
      { title: "Due today one", dueAt: localDay(0) },
      { title: "Due today two", dueAt: localDay(0) },
      { title: "Due today three", dueAt: localDay(0) },
      { title: "Was due last week", dueAt: localDay(-7) },
      { title: "Due next week", dueAt: localDay(7) },
      { title: "No date at all" },
    ]);
    await page.reload();

    await expect(todos.row("Due today three")).toBeVisible();

    await expect(line(page)).toHaveText(
      headerLine(dueTodayClause(3), overdueClause(1)),
    );

    // The same two numbers, read off the list rather than off the line.
    await expect(rowsUnder(page, "Today")).toHaveCount(3);
    await expect(rowsUnder(page, "Overdue")).toHaveCount(1);
  });

  test("omits a clause that would be zero rather than showing 0", async ({
    signedIn: page,
    todos,
  }) => {
    await seed(page, [{ title: "Was due last week", dueAt: localDay(-7) }]);
    await page.reload();

    await expect(todos.row("Was due last week")).toBeVisible();

    await expect(line(page)).toHaveText(headerLine(overdueClause(1)));
    await expect(line(page)).not.toContainText("0 due today");
  });

  test("is the date alone when nothing is due or overdue", async ({
    signedIn: page,
    todos,
  }) => {
    await seed(page, [
      { title: "Due next week", dueAt: localDay(7) },
      { title: "No date at all" },
    ]);
    await page.reload();

    await expect(todos.row("No date at all")).toBeVisible();
    await expect(line(page)).toHaveText(headerDate());
  });

  /**
   * The requirement this exists to satisfy is "the counts never appear as zero
   * and then change", so the assertion has to be made *while* the list is
   * genuinely still loading — held, not raced.
   */
  test("shows the date alone while the list is still loading", async ({
    signedIn: page,
    todos,
  }) => {
    await seed(page, [
      { title: "Due today one", dueAt: localDay(0) },
      { title: "Was due last week", dueAt: localDay(-7) },
    ]);

    let releaseList = () => {};
    const listHeld = new Promise<void>((resolve) => {
      releaseList = resolve;
    });

    await page.route("**/api/todos?*", async (route, request) => {
      if (request.method() !== "GET") {
        await route.continue();

        return;
      }

      await listHeld;
      await route.continue();
    });

    await page.goto("/todos");

    // Genuinely mid-load: the skeleton is up and no row exists yet.
    await expect(todos.listSkeleton).toBeVisible();
    await expect(line(page)).toHaveText(headerDate());
    await expect(line(page)).not.toContainText("due today");

    releaseList();

    // And the clauses arrive once — they are not corrected from zero.
    await expect(line(page)).toHaveText(
      headerLine(dueTodayClause(1), overdueClause(1)),
    );
  });

  /**
   * The half the test above cannot reach, and the only one that catches the
   * loading guard at all.
   *
   * On a **first** load the client's list is empty anyway, so the date renders
   * alone whether or not anything gates the counts on `isLoading` — a mutation
   * removing that gate passes the test above. A **filter change** is the case
   * with teeth: `useTodoList` keeps the previous filter's rows in `result`
   * until the new ones land, so an ungated line spends a full round trip
   * reporting the old filter's numbers under the new filter's list, and then
   * silently corrects itself. That is precisely the "counts appear and then
   * change under the user" US-12 forbids.
   */
  test("does not report the previous filter's counts while the next list loads", async ({
    signedIn: page,
    todos,
  }) => {
    await seed(page, [
      { title: "Due today one", dueAt: localDay(0) },
      { title: "Due today two", dueAt: localDay(0) },
      { title: "Was due last week", dueAt: localDay(-7) },
    ]);

    await page.goto("/todos");
    await expect(line(page)).toHaveText(
      headerLine(dueTodayClause(2), overdueClause(1)),
    );

    let releaseNext = () => {};
    const nextHeld = new Promise<void>((resolve) => {
      releaseNext = resolve;
    });

    await page.route("**/api/todos?*", async (route, request) => {
      if (request.method() !== "GET") {
        await route.continue();

        return;
      }

      await nextHeld;
      await route.continue();
    });

    /*
      Driven through the filter control rather than `page.goto`, which is the
      whole point: a fresh navigation would start with an empty client list and
      could not reproduce stale rows sitting under a new filter.
    */
    await page
      .getByRole("radiogroup", { name: STATUS_FILTER_ARIA_LABEL })
      .getByRole("radio", { name: STATUS_FILTER_LABELS.completed, exact: true })
      .click();

    await expect(todos.listSkeleton).toBeVisible();
    await expect(line(page)).toHaveText(headerDate());

    releaseNext();

    await expect(todos.listSkeleton).toHaveCount(0);
    await expect(line(page)).toHaveText(headerDate());
  });

  /**
   * US-12: "the counts describe the todos currently shown, so the line and the
   * list can never disagree". A status filter is the cheapest way to make the
   * shown list differ from the account.
   */
  test("the counts follow the filtered list, not the account", async ({
    signedIn: page,
    todos,
  }) => {
    await seed(page, [
      { title: "Due today one", dueAt: localDay(0) },
      { title: "Was due last week", dueAt: localDay(-7) },
    ]);

    await page.goto("/todos");
    await expect(todos.row("Due today one")).toBeVisible();
    await expect(line(page)).toHaveText(
      headerLine(dueTodayClause(1), overdueClause(1)),
    );

    // `completed` shows neither of them, so neither clause may survive.
    await page.goto("/todos?status=completed");

    await expect(todos.rowByText("Due today one")).toHaveCount(0);
    await expect(line(page)).toHaveText(headerDate());
  });

  /**
   * US-12: "a completed todo is in `Completed`, not in `Today` or `Overdue`,
   * however its due date reads" — driven through the real toggle, so the
   * optimistic re-section and the line move together.
   */
  test("a completed todo stops being counted", async ({
    signedIn: page,
    todos,
  }) => {
    await seed(page, [
      { title: "Due today one", dueAt: localDay(0) },
      { title: "Due today two", dueAt: localDay(0) },
    ]);
    await page.reload();

    await expect(line(page)).toHaveText(headerLine(dueTodayClause(2)));

    await todos.toggle("Due today one", true);

    await expect(
      todos.toastTitles.filter({ hasText: markedCompleteToast("Due today one") }),
    ).toBeVisible();

    await expect(line(page)).toHaveText(headerLine(dueTodayClause(1)));
    await expect(rowsUnder(page, "Today")).toHaveCount(1);
  });

  /**
   * US-12's last criterion: plain text, not a heading and not a control. The
   * sections remain the place overdue work is conveyed, so the line must not
   * add a second structure to navigate by.
   */
  test("is plain text — not a heading, not a control", async ({
    signedIn: page,
  }) => {
    await seed(page, [{ title: "Was due last week", dueAt: localDay(-7) }]);
    await page.reload();

    const text = headerLine(overdueClause(1));

    await expect(line(page)).toHaveText(text);

    await expect(page.getByRole("heading", { name: text })).toHaveCount(0);
    await expect(page.getByRole("button", { name: text })).toHaveCount(0);
    await expect(page.getByRole("link", { name: text })).toHaveCount(0);

    // Nor is it inside one — a heading wrapping it would satisfy the three
    // assertions above and still put it in the heading tree.
    const headingAncestors = await line(page).evaluate(
      (element) => element.closest("h1, h2, h3, h4, h5, h6, a, button") !== null,
    );

    expect(headingAncestors, "the line sits inside a heading or a control").toBe(
      false,
    );
  });
});

/**
 * §7.19 — the line is a **subtitle of the heading**, not a peer of the
 * quick-add bar.
 *
 * `Your todos` and `Wednesday, 20 August · 3 due today · 1 overdue` are one
 * statement, and they were two direct children of `main`, so §2.2's `gap-6`
 * put the same 24px between them as between the bar and the Card. Nothing in
 * the DOM said which of the four things on the page belonged with which.
 *
 * Measured rather than eyeballed, and measured as **two** numbers rather than
 * one: a wrapper that tightened the heading to its line while also tightening
 * the block to the bar would look "closer" in a screenshot and would have
 * destroyed §2.2's section rhythm to do it. The claim is that one gap shrank
 * and the other did not.
 */
test.describe("§7.19 — the dated line belongs to the heading", () => {
  /** §2.2: `gap-1` inside the block, `gap-6` between `main`'s sections. */
  const SUBTITLE_GAP = 4;
  const SECTION_GAP = 24;

  /**
   * Sub-pixel only. These are computed flex gaps, not two edges that happen to
   * land near each other, so anything at or above 1px is a different layout.
   */
  const TOLERANCE = 1;

  const gapBetween = async (above: Locator, below: Locator) => {
    const [top, bottom] = await Promise.all([above.boundingBox(), below.boundingBox()]);

    expect(top, "the element above has no box").not.toBeNull();
    expect(bottom, "the element below has no box").not.toBeNull();

    return bottom!.y - (top!.y + top!.height);
  };

  test("sits 4px under the heading row while the block stays 24px off the bar", async ({
    signedIn: page,
    todos,
  }) => {
    await seed(page, [
      { title: "Due today one", dueAt: localDay(0) },
      { title: "Was due last week", dueAt: localDay(-7) },
    ]);
    await page.reload();

    await expect(todos.row("Due today one")).toBeVisible();

    /*
      The heading **row**, not the `h1`: the row is the flex child `gap-1`
      actually applies to, and it is taller than the `h1` whenever the
      `{done} of {total} done` counter beside it is on screen. Measuring the
      heading itself would report the row's own baseline alignment as part of
      the gap.
    */
    const headingRow = page
      .getByRole("heading", { level: 1 })
      .locator("xpath=..");
    /*
      The quick-add bar is the next of `main`'s sections. Located as the form
      rather than by a class, because the class is the thing under test.
    */
    const quickAddBar = page.locator("main form");

    const subtitleGap = await gapBetween(headingRow, line(page));
    const sectionGap = await gapBetween(line(page), quickAddBar);

    expect(
      Math.abs(subtitleGap - SUBTITLE_GAP),
      `heading row to dated line: ${subtitleGap.toFixed(2)}px, expected ${SUBTITLE_GAP}px — the line is the heading's subtitle`,
    ).toBeLessThan(TOLERANCE);

    expect(
      Math.abs(sectionGap - SECTION_GAP),
      `dated line to quick-add bar: ${sectionGap.toFixed(2)}px, expected ${SECTION_GAP}px — §2.2's gap between page sections is unchanged`,
    ).toBeLessThan(TOLERANCE);

    /*
      And the two are genuinely different distances now, which is the whole
      point and is worth asserting on its own: the failure this replaces was
      not "the gap is wrong", it was "every gap is the same, so the page has no
      structure".
    */
    expect(
      sectionGap,
      "the block is further from the bar than the line is from the heading",
    ).toBeGreaterThan(subtitleGap);
  });
});
