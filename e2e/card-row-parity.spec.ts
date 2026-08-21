import type { Locator, Page } from "@playwright/test";

import { BOARD_ORDER_NOTE } from "./support/copy";
import { expect, test } from "./support/fixtures";

/**
 * A card's checkbox sits on its title's first line, exactly as a row's does
 * (`docs/DESIGN.md` §4.4, §4.11).
 *
 * A card and a row are the same object in two shapes — the same checkbox, the
 * same chip, the same date, the same three actions, literally the same
 * `TodoActions` component. The checkbox was the clearest place they did not
 * read as the same object: a desktop row's control and title share a centre
 * line and measure 0.00 apart, and every card in every column sat 6.00px low.
 *
 * **Not fixed by making the row `items-start`.** The row's centring is right,
 * and the reason is a rule rather than a preference: baseline-align text to
 * text, centre-align a box to text. A checkbox is a box.
 *
 * **The card is the case that rule has to be stated carefully for.** A row's
 * title truncates and is always one line, so "centred on the title" and
 * "centred on the title's first line" are the same sentence there. A card's
 * title wraps to three, and they stop being the same sentence: plain
 * `items-center` on a card would centre the control against the whole wrapped
 * block and put it *lower* than the 6px it was fixing. So this measures a
 * wrapping title as well as a short one, and the wrap is asserted rather than
 * hoped for — a file that only ever measured short titles would pass against
 * exactly the wrong fix.
 *
 * **Line boxes, not ink.** The centre of a title is `top + line-height / 2`,
 * read off the element and its computed `line-height`. `Range.getClientRects`
 * returns the *ink* box, which sits half a pixel off the line box because a
 * font's ascent and descent are not symmetrical, and reports the pre-clamp line
 * count rather than the rendered one. Neither is what the layout is doing.
 */

/** Sub-pixel. The desktop row measures 0.00; the card has to reach the same. */
const CENTRE_TOLERANCE = 1;

const SHORT_TITLE = "Milk";
/**
 * Long enough to fill all three lines `line-clamp-3` allows in a board column,
 * which is roughly 147px of text. Asserted below rather than assumed.
 */
const WRAPPING_TITLE =
  "Renew the parking permit before the council office closes on Friday afternoon";

const seed = async (page: Page, titles: string[]) => {
  for (const title of titles) {
    const response = await page.request.post("/api/todos", {
      data: { title, note: "", priority: "medium", dueAt: "" },
    });

    expect(response.status()).toBe(201);
  }
};

interface Alignment {
  /** Vertical centre of the painted checkbox square. */
  control: number;
  /** Vertical centre of the title's **first line box**. */
  firstLine: number;
  /** How many lines the title renders on, after `line-clamp`. */
  lines: number;
}

const alignmentIn = async (item: Locator, title: string): Promise<Alignment> => {
  const control = await item
    .locator('[data-slot="checkbox-control"]')
    .first()
    .evaluate((element) => {
      const rect = element.getBoundingClientRect();

      return rect.top + rect.height / 2;
    });

  const line = await item
    .getByText(title, { exact: true })
    .evaluate((element) => {
      const rect = element.getBoundingClientRect();
      const lineHeight = parseFloat(getComputedStyle(element).lineHeight);

      return {
        centre: rect.top + lineHeight / 2,
        lines: Math.round(rect.height / lineHeight),
      };
    });

  return { control, firstLine: line.centre, lines: line.lines };
};

test.describe("a card's checkbox and its title", () => {
  test("share a centre line, whether the title wraps or not", async ({
    signedIn: page,
    isMobile,
  }) => {
    test.skip(isMobile === true, "the board needs a desktop viewport");

    await seed(page, [SHORT_TITLE, WRAPPING_TITLE]);
    await page.goto("/todos?view=board");

    await expect(page.getByText(BOARD_ORDER_NOTE)).toBeVisible();

    const card = (title: string) =>
      page.locator("main").getByRole("listitem").filter({ hasText: title });

    const [short, wrapped] = await Promise.all([
      alignmentIn(card(SHORT_TITLE), SHORT_TITLE),
      alignmentIn(card(WRAPPING_TITLE), WRAPPING_TITLE),
    ]);

    /*
      The preconditions, asserted. One line and several lines pull a fix in
      opposite directions, so a run where the long title happened not to wrap
      would be measuring the same case twice and would bless the wrong one.
    */
    expect(short.lines, "the short title is one line").toBe(1);
    expect(
      wrapped.lines,
      `the long title must wrap for this test to discriminate; it rendered on ${wrapped.lines} line(s)`,
    ).toBeGreaterThan(1);

    expect
      .soft(
        Math.abs(short.control - short.firstLine),
        `one-line card — control centre ${short.control.toFixed(2)}, title line centre ${short.firstLine.toFixed(2)}`,
      )
      .toBeLessThanOrEqual(CENTRE_TOLERANCE);

    expect
      .soft(
        Math.abs(wrapped.control - wrapped.firstLine),
        `${wrapped.lines}-line card — control centre ${wrapped.control.toFixed(2)}, first line centre ${wrapped.firstLine.toFixed(2)}`,
      )
      .toBeLessThanOrEqual(CENTRE_TOLERANCE);
  });

  /**
   * The reference measurement, and the reason the row is not what changes. It
   * is asserted rather than taken on trust so that a "fix" reached by loosening
   * the row instead would fail in the same file that proposed it.
   *
   * **Desktop only, and that is a finding rather than a convenience.** Below
   * `sm:` the row stacks its title and its metadata cluster in a `flex-col`,
   * and the cluster is rendered even when it is empty — an untriaged, undated,
   * noteless todo draws a zero-height `div` that still takes the `gap-1` before
   * it. The checkbox is then centred against a block 4px taller than the title,
   * so a mobile row measures 2.00px rather than 0.00. That is the same defect
   * class as the card's and it is older than this change; it is recorded in
   * `docs/decisions/2026-08-21-board-card-metadata-line.md`, whose proposal —
   * render a metadata line only when it has content — is the fix for both.
   */
  test("the row it is meant to match already does", async ({
    signedIn: page,
    todos,
    isMobile,
  }) => {
    test.skip(
      isMobile === true,
      "below sm: the row centres against an empty metadata slot — see this test's note",
    );

    await seed(page, [SHORT_TITLE]);
    await page.reload();

    await expect(todos.row(SHORT_TITLE)).toBeVisible();

    const row = await alignmentIn(todos.row(SHORT_TITLE), SHORT_TITLE);

    expect(row.lines, "a row's title never wraps").toBe(1);
    expect(
      Math.abs(row.control - row.firstLine),
      `row — control centre ${row.control.toFixed(2)}, title line centre ${row.firstLine.toFixed(2)}`,
    ).toBeLessThanOrEqual(CENTRE_TOLERANCE);
  });
});
