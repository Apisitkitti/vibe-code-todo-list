import type { Page } from "@playwright/test";

import {
  COMPLETED_HEADING,
  GROUP_HEADINGS_IN_ORDER,
  NO_DATE_HEADING,
  OVERDUE_HEADING,
  TODAY_HEADING,
  TOGGLE_FAILURE,
  UPCOMING_HEADING,
  markedCompleteToast,
  sectionHeadingText,
} from "./support/copy";
import {
  TODO_STATUS_URL,
  expectNoFalseSuccess,
  fulfilOpaqueError,
} from "./support/assertions";
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
      sectionHeadingText(OVERDUE_HEADING, 1),
      sectionHeadingText(TODAY_HEADING, 1),
      sectionHeadingText(UPCOMING_HEADING, 1),
      sectionHeadingText(NO_DATE_HEADING, 1),
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
   * §7.16 — the heading's count clause, and the one decision behind it.
   *
   * The count is rendered `aria-hidden`, so a heading's **accessible name** is
   * still the bare §7.16 string while its **text** carries `· N`. Both halves
   * are asserted here, because each one alone would pass on the wrong markup:
   * the text assertion alone would pass with the count in the name, and the
   * name assertion alone would pass with no count rendered at all.
   *
   * The reasoning: the `<ul>` under each heading already reports its own size
   * to assistive technology, natively and more precisely than a numeral behind
   * a middle dot. So the list count is asserted too — it is the thing the
   * aria-hidden decision leans on, and if it ever stopped matching the visible
   * number, the decision would be wrong rather than merely undocumented.
   */
  test("a section heading counts its rows without putting the count in its name", async ({
    signedIn: page,
    todos,
  }) => {
    await seedTodos(page, [
      { title: "First overdue", dueAt: localDay(-3) },
      { title: "Second overdue", dueAt: localDay(-2) },
      { title: "Third overdue", dueAt: localDay(-1) },
      { title: "Undated chore" },
    ]);

    await expect(todos.row("Third overdue")).toBeVisible();

    // Visible text: the name, the separator and the size of the section.
    await expect(groupHeadings(page)).toHaveText([
      sectionHeadingText(OVERDUE_HEADING, 3),
      sectionHeadingText(NO_DATE_HEADING, 1),
    ]);

    /*
      Accessible name: the bare string. `getByRole` computes the name, and an
      `aria-hidden` subtree is excluded from it — so this locator resolving at
      all is the assertion.
    */
    await expect(
      page.getByRole("heading", { name: OVERDUE_HEADING, exact: true }),
    ).toHaveCount(1);
    await expect(
      page.getByRole("heading", { name: sectionHeadingText(OVERDUE_HEADING, 3) }),
    ).toHaveCount(0);

    // What the count duplicates, and the reason it may stay out of the name.
    await expect(
      section(page, OVERDUE_HEADING).getByRole("listitem"),
    ).toHaveCount(3);
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
      sectionHeadingText(NO_DATE_HEADING, 1),
      sectionHeadingText(COMPLETED_HEADING, 1),
    ]);
    await expect(
      section(page, COMPLETED_HEADING).getByRole("listitem"),
    ).toHaveText([/Overdue chore/]);
    await expect(section(page, OVERDUE_HEADING)).toHaveCount(0);
  });

  /**
   * The half of the optimistic toggle a checkbox assertion cannot see.
   *
   * Sections are derived from `completed` on every render, so an optimistic
   * flip re-sections the list *before* the server agrees — the row leaves
   * `Overdue` the moment it is pressed. A revert that restored the boolean but
   * left the row filed under `Completed` would be a rollback the user is still
   * looking at. The fault injector is the one from `fault-injection.spec.ts`;
   * the assertions are this file's, which is why the test lives here.
   */
  test("a refused toggle puts the row back in the section it came from", async ({
    signedIn: page,
    todos,
  }) => {
    await seedTodos(page, [
      { title: "Overdue chore", dueAt: localDay(-3) },
      { title: "Undated chore" },
    ]);

    const headingsBefore = [
      sectionHeadingText(OVERDUE_HEADING, 1),
      sectionHeadingText(NO_DATE_HEADING, 1),
    ];

    await expect(groupHeadings(page)).toHaveText(headingsBefore);

    // Held so the in-flight re-sectioning is observable, then refused.
    let releaseToggle = () => {};
    const toggleHeld = new Promise<void>((resolve) => {
      releaseToggle = resolve;
    });

    await page.route(TODO_STATUS_URL, async (route) => {
      await toggleHeld;
      await fulfilOpaqueError(route, 500);
    });

    await todos.toggle("Overdue chore", true);

    // Optimistic: the row has already moved, on nothing but the press.
    await expect(
      section(page, COMPLETED_HEADING).getByRole("listitem"),
    ).toHaveText([/Overdue chore/]);
    await expect(section(page, OVERDUE_HEADING)).toHaveCount(0);

    releaseToggle();

    await expect(todos.toasts.filter({ hasText: TOGGLE_FAILURE })).toBeVisible();

    // And back, into the section it started in — not merely out of Completed.
    await expect(groupHeadings(page)).toHaveText(headingsBefore);
    await expect(
      section(page, OVERDUE_HEADING).getByRole("listitem"),
    ).toHaveText([/Overdue chore/]);
    await expect(section(page, COMPLETED_HEADING)).toHaveCount(0);
    await expectNoFalseSuccess(todos.toasts, markedCompleteToast("Overdue chore"));
  });

  /**
   * §8.5 and `src/lib/todoGroups.ts` — a completed row goes quiet.
   *
   * The grouping module already says a completed todo's date "has nothing left
   * to say", and the row used to render it anyway, so a finished task sat
   * under `Completed` still announcing a day. Its priority is history for the
   * same reason. Both go; the checkbox, the struck-through title, the `✎` note
   * marker and the actions all stay.
   *
   * An overdue row is the case worth using: its date was the loudest thing on
   * the row (`⚠` plus the warning tint) right up until it was finished.
   */
  test("a completed row drops its priority chip and its due date", async ({
    signedIn: page,
    todos,
  }) => {
    await seedTodos(page, [
      { title: "Overdue chore", dueAt: localDay(-3), priority: "high" },
      { title: "Undated chore" },
    ]);

    const row = todos.row("Overdue chore");

    // Active: chip and date both on the row, the date flagged overdue.
    await expect(row.locator('[data-slot="chip"]')).toHaveCount(1);
    await expect(row.locator("time")).toHaveCount(1);
    await expect(row).toContainText("High");

    await todos.toggle("Overdue chore", true);

    await expect(
      todos.toastTitles.filter({ hasText: markedCompleteToast("Overdue chore") }),
    ).toBeVisible();
    await expect(
      section(page, COMPLETED_HEADING).getByRole("listitem"),
    ).toHaveText([/Overdue chore/]);

    // Quiet: no chip, no `<time>`, and no `Overdue —` left anywhere on it.
    await expect(row.locator('[data-slot="chip"]')).toHaveCount(0);
    await expect(row.locator("time")).toHaveCount(0);
    await expect(row).not.toContainText("High");
    await expect(row).not.toContainText("Overdue —");

    /*
      What must NOT go with them. Completion is carried by `aria-checked` and
      `line-through` (§6.4), and the note marker and the actions are how the
      row is still usable — a quiet row is not a disabled one.
    */
    await expect(todos.checkbox("Overdue chore")).toBeChecked();
    await expect(row.getByText("Overdue chore")).toHaveCSS(
      "text-decoration-line",
      "line-through",
    );
    await expect(todos.editButton("Overdue chore")).toBeAttached();
    await expect(todos.deleteButton("Overdue chore")).toBeAttached();
  });

  /** The `✎` marker is the one piece of row metadata a completion keeps. */
  test("a completed row keeps its note marker", async ({
    signedIn: page,
    todos,
  }) => {
    const response = await page.request.post("/api/todos", {
      data: {
        title: "Noted chore",
        note: "the detail that outlives the due date",
        priority: "medium",
        dueAt: localDay(2),
      },
    });

    expect(response.status()).toBe(201);
    await page.reload();

    const row = todos.row("Noted chore");

    await expect(row.getByText("Has a note")).toBeAttached();

    await todos.toggle("Noted chore", true);

    await expect(
      todos.toastTitles.filter({ hasText: markedCompleteToast("Noted chore") }),
    ).toBeVisible();

    await expect(row.locator("time")).toHaveCount(0);
    await expect(row.locator('[data-slot="chip"]')).toHaveCount(0);
    await expect(row.getByText("Has a note")).toBeAttached();
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
