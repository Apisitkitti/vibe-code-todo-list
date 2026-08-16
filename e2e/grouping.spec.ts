import type { Page } from "@playwright/test";

import {
  COMPLETED_HEADING,
  GROUP_HEADINGS_IN_ORDER,
  NO_DATE_HEADING,
  OVERDUE_HEADING,
  TODAY_HEADING,
  UPCOMING_HEADING,
  markedCompleteToast,
} from "./support/copy";
import { expect, test } from "./support/fixtures";

/**
 * The list's urgency sections, end to end (`docs/DESIGN.md` §7.16).
 *
 * Due dates are seeded through `POST /api/todos` on the page's own request
 * context — the same session cookie the browser holds, so this is the real
 * scoped endpoint and not a database back door. The alternative, driving the
 * segmented `DatePicker` four times per test, would be a test of the date
 * widget wearing a grouping test's name.
 */

const pad = (value: number) => String(value).padStart(2, "0");

/**
 * The wire format (`YYYY-MM-DD`), `offset` days from today in **local** time.
 *
 * Local, not UTC: the app decides which section a todo lands in by comparing
 * the stored UTC-midnight date against the viewer's own calendar day, and the
 * browser here shares this process's timezone. Building these from UTC would
 * put "today" in the wrong section for anyone running the suite west of UTC —
 * which is precisely the bug the grouping exists to avoid.
 */
const localDay = (offset: number): string => {
  const date = new Date();

  date.setDate(date.getDate() + offset);

  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
};

interface SeedTodo {
  title: string;
  dueAt?: string;
  priority?: "low" | "medium" | "high";
}

const seedTodos = async (page: Page, seeds: SeedTodo[]) => {
  for (const seed of seeds) {
    const response = await page.request.post("/api/todos", {
      data: {
        title: seed.title,
        note: "",
        priority: seed.priority ?? "medium",
        dueAt: seed.dueAt ?? "",
      },
    });

    expect(response.status()).toBe(201);
  }

  await page.reload();
};

/** The `<section>` a heading names, so a row can be asserted *inside* it. */
const section = (page: Page, heading: string) =>
  page
    .locator("main section")
    .filter({ has: page.getByRole("heading", { name: heading, exact: true }) });

const groupHeadings = (page: Page) =>
  page.locator("main").getByRole("heading", { level: 2 });

test.describe("due-date sections", () => {
  test("headed sections appear in urgency order, with each row under its own", async ({
    signedIn: page,
    todos,
  }) => {
    await seedTodos(page, [
      { title: "No date at all" },
      { title: "Due next week", dueAt: localDay(7) },
      { title: "Was due last week", dueAt: localDay(-7) },
      { title: "Due today", dueAt: localDay(0) },
    ]);

    await expect(todos.row("Due today")).toBeVisible();

    // Real `<h2>`s, not styled text — the navigable structure §8.4.3 asked for.
    await expect(groupHeadings(page)).toHaveText([
      OVERDUE_HEADING,
      TODAY_HEADING,
      UPCOMING_HEADING,
      NO_DATE_HEADING,
    ]);

    await expect(
      section(page, OVERDUE_HEADING).getByRole("listitem"),
    ).toHaveText([/Was due last week/]);
    await expect(section(page, TODAY_HEADING).getByRole("listitem")).toHaveText([
      /Due today/,
    ]);
    await expect(
      section(page, UPCOMING_HEADING).getByRole("listitem"),
    ).toHaveText([/Due next week/]);
    await expect(
      section(page, NO_DATE_HEADING).getByRole("listitem"),
    ).toHaveText([/No date at all/]);
  });

  /**
   * PM wrote this one as a requirement rather than a nicety: a user who has
   * never set a due date must see exactly the list they saw before this
   * change, with no heading standing over the whole of it.
   */
  test("a list with no due dates anywhere shows no headings at all", async ({
    signedIn: page,
    todos,
  }) => {
    await seedTodos(page, [
      { title: "Buy milk" },
      { title: "Call the plumber" },
      { title: "Renew the parking permit" },
    ]);

    await expect(todos.row("Buy milk")).toBeVisible();
    await expect(groupHeadings(page)).toHaveCount(0);

    for (const heading of GROUP_HEADINGS_IN_ORDER) {
      await expect(section(page, heading)).toHaveCount(0);
    }

    // One flat list, which is the markup that shipped before this change.
    // Asserted on the `<ul>` rather than on the absent headings alone: the
    // status filter's own `Completed` button lives in `<main>` too, so a text
    // search for the headings would match it and pass for the wrong reason.
    await expect(page.locator("main ul")).toHaveCount(1);
    await expect(page.locator("main ul").getByRole("listitem")).toHaveCount(3);
  });

  test("completing a todo moves it out of Overdue and into Completed", async ({
    signedIn: page,
    todos,
  }) => {
    await seedTodos(page, [
      { title: "Overdue chore", dueAt: localDay(-3) },
      { title: "Undated chore" },
    ]);

    await expect(
      section(page, OVERDUE_HEADING).getByRole("listitem"),
    ).toHaveText([/Overdue chore/]);

    await todos.toggle("Overdue chore", true);

    await expect(
      todos.toastTitles.filter({ hasText: markedCompleteToast("Overdue chore") }),
    ).toBeVisible();

    // Done work leaves the urgency sections entirely — an overdue todo that is
    // finished has nothing left to be urgent about.
    await expect(groupHeadings(page)).toHaveText([
      NO_DATE_HEADING,
      COMPLETED_HEADING,
    ]);
    await expect(
      section(page, COMPLETED_HEADING).getByRole("listitem"),
    ).toHaveText([/Overdue chore/]);
    await expect(section(page, OVERDUE_HEADING)).toHaveCount(0);
  });

  test("priority breaks the tie inside a section, high first", async ({
    signedIn: page,
    todos,
  }) => {
    const today = localDay(0);

    await seedTodos(page, [
      { title: "Low today", dueAt: today, priority: "low" },
      { title: "High today", dueAt: today, priority: "high" },
      { title: "Medium today", dueAt: today, priority: "medium" },
      // A second section, so the headings render at all: three todos sharing
      // a due date are one section, and one section shows no heading.
      { title: "Someday", priority: "high" },
    ]);

    await expect(todos.row("High today")).toBeVisible();
    await expect(section(page, TODAY_HEADING).getByRole("listitem")).toHaveText([
      /High today/,
      /Medium today/,
      /Low today/,
    ]);
  });
});
