import type { Page } from "@playwright/test";

import {
  COMPLETED_HEADING,
  NO_DATE_HEADING,
  OVERDUE_HEADING,
  UPCOMING_HEADING,
  doneCount,
  sectionHeadingText,
  markedCompleteToast,
  markedNotCompleteToast,
} from "./support/copy";
import { expect, test } from "./support/fixtures";

/**
 * Toggling under a status filter (`docs/PRD.md` US-07 ruling, US-10).
 *
 * The ruling in one sentence: **a filtered list must match what a reload of
 * the same URL would show, at every moment** — not only after a reload. A row
 * kept on screen because the viewer just pressed it makes one filter mean two
 * different things for two people looking at the same data, and under `Active`
 * it puts a `Completed` heading inside a view that asked not to see one.
 *
 * So the row leaves at the moment of the change, before the server answers.
 * What makes that affordable is where Undo lives: the toast is anchored to the
 * screen, not to the row, and survives the row's removal for the full 12s
 * window. These tests are the pin on both halves.
 */

const pad = (value: number) => String(value).padStart(2, "0");

/**
 * The wire format (`YYYY-MM-DD`), `offset` days from today in **local** time —
 * the same reasoning as `grouping.spec.ts`: the app compares a UTC-midnight
 * `dueAt` against the *viewer's* calendar day, and building these from UTC
 * would misfile "today" for anyone running the suite west of UTC.
 */
const localDay = (offset: number): string => {
  const date = new Date();

  date.setDate(date.getDate() + offset);

  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
};

interface SeedTodo {
  title: string;
  dueAt?: string;
}

/**
 * Seeded through `POST /api/todos` on the page's own request context — the
 * same session cookie the browser holds, so this is the real scoped endpoint
 * and not a database back door.
 */
const seedTodos = async (page: Page, seeds: SeedTodo[]) => {
  for (const seed of seeds) {
    const response = await page.request.post("/api/todos", {
      data: {
        title: seed.title,
        note: "",
        priority: "medium",
        dueAt: seed.dueAt ?? "",
      },
    });

    expect(response.status()).toBe(201);
  }
};

const groupHeadings = (page: Page) =>
  page.locator("main").getByRole("heading", { level: 2 });

const rowTitles = (page: Page) => page.locator("main").getByRole("listitem");

const ACTIVE_URL = "/todos?status=active";
const COMPLETED_URL = "/todos?status=completed";

/*
  Titles within a test are deliberately not substrings of one another, in
  either case: `filter({ hasText })` matches case-insensitively on substring,
  so a title containing another title's words silently resolves to two rows —
  and an assertion that one of them is gone then never passes.
*/
test.describe("toggling under a status filter", () => {
  test("completing a todo under Active removes it, with no Completed heading", async ({
    signedIn: page,
    todos,
  }) => {
    await seedTodos(page, [
      { title: "Was due last week", dueAt: localDay(-7) },
      { title: "Due next week", dueAt: localDay(7) },
      { title: "No date at all" },
    ]);

    await page.goto(ACTIVE_URL);

    await expect(groupHeadings(page)).toHaveText([
      sectionHeadingText(OVERDUE_HEADING, 1),
      sectionHeadingText(UPCOMING_HEADING, 1),
      sectionHeadingText(NO_DATE_HEADING, 1),
    ]);
    await expect(todos.doneCounter).toHaveText(doneCount(0, 3));

    await todos.toggle("Was due last week", true);

    /*
      Immediately — the assertion below is web-first, but the removal is
      applied before the request is sent, so it is not waiting on the server.
      The counter moving in the same breath is the proof the count still
      describes the account rather than the page it just left.
    */
    await expect(todos.rowByText("Was due last week")).toHaveCount(0);
    await expect(todos.doneCounter).toHaveText(doneCount(1, 3));

    await expect(
      todos.toastTitles.filter({ hasText: markedCompleteToast("Was due last week") }),
    ).toBeVisible();

    // US-10: under Active the `Completed` heading never appears at any point.
    await expect(groupHeadings(page)).toHaveText([
      sectionHeadingText(UPCOMING_HEADING, 1),
      sectionHeadingText(NO_DATE_HEADING, 1),
    ]);
    await expect(page.getByRole("heading", { name: COMPLETED_HEADING })).toHaveCount(0);

    // And the list now equals what a reload of the same URL shows.
    await page.reload();

    await expect(rowTitles(page)).toHaveText([/Due next week/, /No date at all/]);
    await expect(todos.doneCounter).toHaveText(doneCount(1, 3));
  });

  test("un-completing under Completed removes it, with no due-date heading", async ({
    signedIn: page,
    todos,
  }) => {
    await seedTodos(page, [
      { title: "Sweep the yard", dueAt: localDay(-7) },
      { title: "Water the plants" },
    ]);

    await page.goto(ACTIVE_URL);
    await todos.toggle("Sweep the yard", true);
    await todos.toggle("Water the plants", true);

    await page.goto(COMPLETED_URL);
    await expect(rowTitles(page)).toHaveCount(2);
    // Both rows are completed, so there is one section and therefore no
    // heading at all (US-06).
    await expect(groupHeadings(page)).toHaveCount(0);

    await todos.toggle("Sweep the yard", false);

    await expect(todos.rowByText("Sweep the yard")).toHaveCount(0);
    await expect(todos.doneCounter).toHaveText(doneCount(1, 2));
    /*
      The row was overdue, so a list that kept it would have had to grow an
      `Overdue` heading inside a view that asked only for completed work.
    */
    await expect(page.getByRole("heading", { name: OVERDUE_HEADING })).toHaveCount(0);
    await expect(groupHeadings(page)).toHaveCount(0);
  });

  test("Undo brings the row back in its default-order place", async ({
    signedIn: page,
    todos,
  }) => {
    /*
      §2 order is `dueAt` ascending, so the row must return *between* the other
      two rather than at either end. Restoring it wherever it used to sit in
      the array would pass a "the row is back" assertion and fail this one,
      which is why the assertion is on the whole sequence.
    */
    await seedTodos(page, [
      { title: "Due in one day", dueAt: localDay(1) },
      { title: "Due in two days", dueAt: localDay(2) },
      { title: "Due in three days", dueAt: localDay(3) },
    ]);

    await page.goto(ACTIVE_URL);
    await expect(rowTitles(page)).toHaveText([
      /Due in one day/,
      /Due in two days/,
      /Due in three days/,
    ]);

    await todos.toggle("Due in two days", true);

    await expect(rowTitles(page)).toHaveText([
      /Due in one day/,
      /Due in three days/,
    ]);
    await expect(todos.doneCounter).toHaveText(doneCount(1, 3));

    // The toast is anchored to the screen, not the row, so it outlives it.
    await expect(todos.undoButton).toBeVisible();
    await todos.pressUndo();

    await expect(
      todos.toastTitles.filter({ hasText: markedNotCompleteToast("Due in two days") }),
    ).toBeVisible();

    await expect(rowTitles(page)).toHaveText([
      /Due in one day/,
      /Due in two days/,
      /Due in three days/,
    ]);
    await expect(todos.doneCounter).toHaveText(doneCount(0, 3));

    // No further Undo is offered on a toast that has already been used.
    expect(await todos.undoButton.count()).toBe(0);
  });

  test("emptying the list under Active shows All caught up, not a zeroed account", async ({
    signedIn: page,
    todos,
  }) => {
    await seedTodos(page, [{ title: "The last one" }]);

    await page.goto(ACTIVE_URL);
    await expect(todos.rowByText("The last one")).toBeVisible();

    await todos.toggle("The last one", true);

    /*
      US-07 / US-11: the account still has a todo, so this must be the
      "you're done" empty state and not the brand-new-account one, which would
      read as the app having lost the row it just accepted.
    */
    await expect(page.getByRole("heading", { name: "All caught up" })).toBeVisible();
    await expect(page.getByRole("heading", { name: "Nothing here yet" })).toHaveCount(0);
    await expect(todos.doneCounter).toHaveText(doneCount(1, 1));

    // The Undo is still operable over the empty state.
    await todos.pressUndo();

    await expect(todos.rowByText("The last one")).toBeVisible();
    await expect(todos.doneCounter).toHaveText(doneCount(0, 1));
  });
});
