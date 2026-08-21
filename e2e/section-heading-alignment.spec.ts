import type { Locator, Page } from "@playwright/test";

import { BOARD_ORDER_NOTE } from "./support/copy";
import { expect, test } from "./support/fixtures";

/**
 * A section heading shares a left edge with the rows it labels (§7.16, §4.11).
 *
 * Found twice and independently — computed off the CSS by the ui-designer, and
 * measured by QA. In the list a row's content began 25px from the Card's inner
 * edge and the heading began at 16px; on the board, 21 and 12. Nine pixels in
 * both, and the two views were reaching that nine through *different* insets
 * (`px-2` on the list heading, `px-1` on the board's) for what is one
 * relationship.
 *
 * Nine pixels is the worst available answer. It is too small to read as a
 * deliberate hanging indent and too large to read as an edge, so a heading
 * looks like it missed rather than like it meant it — and this is the only
 * place in the app where two things that should share an edge do not.
 *
 * **The heading is measured on its text, the row on its checkbox.** The
 * heading's element box is the full width of the section and says nothing
 * about where the words start; the checkbox is the row's first painted thing
 * and is what the eye actually runs down. `[data-slot="checkbox-control"]` is
 * HeroUI's own contract attribute for the painted square, not a styling hook
 * invented here.
 *
 * Headings only render when there is more than one group, so both halves seed
 * two sections' worth of todos deliberately. On a first todo none of this is
 * on screen.
 */

/**
 * How far apart the two edges may be, and it is **read from the row** rather
 * than written down here.
 *
 * A row and a card each draw a 1px border, and their padding is inset from
 * inside it, so content sits one pixel further in than a heading with the
 * matching padding. §2.2 has no 17px step and inventing one to swallow a
 * border would be an arbitrary pixel value dressed as alignment — so the
 * residual is exactly the border width, stated as such. Nine pixels is not,
 * which is the difference this discriminates.
 */
const toleranceFor = async (item: Locator): Promise<number> =>
  item.evaluate((element) =>
    parseFloat(getComputedStyle(element).borderLeftWidth),
  );

const pad = (value: number) => String(value).padStart(2, "0");

/**
 * The wire day (`YYYY-MM-DD`) `offset` days from today in **local** time. The
 * sections are cut by comparing a UTC-midnight `dueAt` against the viewer's own
 * calendar day, and CI runs at UTC+14 — building these from UTC would put
 * "today" in a different section there.
 */
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

/**
 * Two sections, so the headings render at all, and each with a row under it.
 * `Today` and `Upcoming` in the list; `Today` and `Upcoming` on the board too,
 * which is the same cut by the same function.
 */
const SEEDS = [
  { title: "Call the plumber", dueAt: localDay(0) },
  { title: "Book the ferry", dueAt: localDay(3) },
];

/**
 * Where the heading's **text** starts — the first line box, through a `Range`.
 *
 * `boundingBox()` would return the `<h2>`'s own box, which spans the whole
 * section whatever its padding is, and would report the same number for a
 * heading at any indent.
 */
const textLeftOf = async (heading: Locator): Promise<number> =>
  heading.evaluate((element) => {
    const range = document.createRange();

    range.selectNodeContents(element);

    const rects = Array.from(range.getClientRects()).filter(
      (rect) => rect.width > 0,
    );

    if (rects.length === 0) throw new Error("the heading rendered no text");

    return Math.min(...rects.map((rect) => rect.left));
  });

/** The left edge of a row or card's painted checkbox square. */
const checkboxLeftOf = async (item: Locator): Promise<number> =>
  item
    .locator('[data-slot="checkbox-control"]')
    .first()
    .evaluate((element) => element.getBoundingClientRect().left);

test.describe("§7.16 — a section heading starts where its rows start", () => {
  test("in the list", async ({ signedIn: page, todos }) => {
    await seed(page, SEEDS);
    await page.reload();

    await expect(todos.row(SEEDS[0].title)).toBeVisible();

    const sections = page.locator("main section").filter({
      has: page.getByRole("heading", { level: 2 }),
    });

    const count = await sections.count();

    expect(count, "two seeded sections, so the headings render").toBe(2);

    for (let index = 0; index < count; index += 1) {
      const section = sections.nth(index);
      const heading = section.getByRole("heading", { level: 2 });
      const name = await heading.textContent();

      const row = section.getByRole("listitem").first();
      const [headingLeft, rowLeft, tolerance] = await Promise.all([
        textLeftOf(heading),
        checkboxLeftOf(row),
        toleranceFor(row),
      ]);

      expect
        .soft(
          Math.abs(headingLeft - rowLeft),
          `list heading “${name}” starts at ${headingLeft.toFixed(2)}, its first row's checkbox at ${rowLeft.toFixed(2)}; the row's own border is ${tolerance}px`,
        )
        .toBeLessThanOrEqual(tolerance);
    }
  });

  test("on the board", async ({ signedIn: page, isMobile }) => {
    test.skip(isMobile === true, "the board needs a desktop viewport");

    await seed(page, SEEDS);
    await page.goto("/todos?view=board");

    await expect(page.getByText(BOARD_ORDER_NOTE)).toBeVisible();

    const columns = page.locator("main section").filter({
      has: page.getByRole("listitem"),
    });

    const count = await columns.count();

    expect(count, "the two seeded cards land in two columns").toBe(2);

    for (let index = 0; index < count; index += 1) {
      const column = columns.nth(index);
      const heading = column.getByRole("heading", { level: 2 });
      const name = await heading.textContent();

      const card = column.getByRole("listitem").first();
      const [headingLeft, cardLeft, tolerance] = await Promise.all([
        textLeftOf(heading),
        checkboxLeftOf(card),
        toleranceFor(card),
      ]);

      expect
        .soft(
          Math.abs(headingLeft - cardLeft),
          `board heading “${name}” starts at ${headingLeft.toFixed(2)}, its first card's checkbox at ${cardLeft.toFixed(2)}; the card's own border is ${tolerance}px`,
        )
        .toBeLessThanOrEqual(tolerance);
    }
  });

  /**
   * The fourth instance of the same nine pixels, and the reason it is here: an
   * empty column renders a line of copy where its cards would be, and that line
   * shared the heading's old inset. Moving the heading alone would have left
   * the two of them disagreeing in the one column where they are the only two
   * things on screen.
   *
   * Asserted against the heading rather than against a number, because what an
   * empty column owes the reader is a single left edge, whatever it is.
   */
  test("an empty board column's line starts where its heading does", async ({
    signedIn: page,
    isMobile,
  }) => {
    test.skip(isMobile === true, "the board needs a desktop viewport");

    await seed(page, SEEDS);
    await page.goto("/todos?view=board");

    await expect(page.getByText(BOARD_ORDER_NOTE)).toBeVisible();

    const empty = page.locator("main section").filter({
      hasNot: page.getByRole("listitem"),
    });

    const count = await empty.count();

    expect(count, "two seeded cards leave three columns empty").toBe(3);

    for (let index = 0; index < count; index += 1) {
      const column = empty.nth(index);
      const heading = column.getByRole("heading", { level: 2 });
      const name = await heading.textContent();

      const [headingLeft, lineLeft] = await Promise.all([
        textLeftOf(heading),
        textLeftOf(column.locator("p").first()),
      ]);

      expect
        .soft(
          Math.abs(headingLeft - lineLeft),
          `empty column “${name}” — heading at ${headingLeft.toFixed(2)}, its line at ${lineLeft.toFixed(2)}`,
        )
        .toBeLessThanOrEqual(1);
    }
  });
});
