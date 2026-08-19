import type { Page } from "@playwright/test";

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
