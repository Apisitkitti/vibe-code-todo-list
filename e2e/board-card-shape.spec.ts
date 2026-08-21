import type { Locator, Page } from "@playwright/test";

import { BOARD_ORDER_NOTE } from "./support/copy";
import { expect, test } from "./support/fixtures";

/**
 * A board card's height follows **what it carries**, not which chip it draws
 * (`docs/decisions/2026-08-21-board-card-metadata-line.md`, `docs/DESIGN.md`
 * §4.11).
 *
 * The card used to put its metadata and its actions in one `flex flex-wrap`
 * line, so the metadata got whatever was left after `TodoActions`. Measured at
 * 1280×800 with five columns: the line is 183.20px, `TodoActions` is a fixed
 * 124.00 and §2.2's `gap-2` is 8, leaving **51.20px**. `Low` is 48.45 and fits;
 * `High` is **52.16 — over by 0.95px** — and the whole action cluster wrapped
 * to a third line, 28px taller. So on a board of otherwise identical cards,
 * whether a card was two lines or three depended on nothing the user can see
 * except whether it said `High`.
 *
 * The fix is to stop letting `flex-wrap` decide: an explicit metadata line,
 * rendered only when it has visible content, and an action line, always. These
 * tests assert the consequences of that rather than the class list — a card's
 * height is a function of its content shape, and the metadata is never squeezed
 * into a remainder.
 *
 * **Desktop only, and not by preference.** `TodoListScreen` renders the board
 * at `lg:` and above; below that there are no cards to measure.
 */

/** Sub-pixel. These are the same computed height, not two heights that are close. */
const HEIGHT_TOLERANCE = 1;

/*
  Four short titles, deliberately of one line each in a ~183px column. A card's
  height is a function of its title's line count as well as its metadata, and
  the claim under test is about the metadata alone — so a pair whose titles wrap
  differently would report 24px of title as 24px of chip. The line counts are
  asserted below rather than trusted to stay short.
*/
const LOW_BARE = "Rinse";
const MEDIUM_BARE = "Sweep";
const HIGH_BARE = "Fold";
const LOW_DATED = "Water";
const HIGH_DATED = "Iron";
const FULLY_LOADED = "Boiler";

const pad = (value: number) => String(value).padStart(2, "0");

const localDay = (offset: number): string => {
  const date = new Date();

  date.setDate(date.getDate() + offset);

  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
};

const seed = async (
  page: Page,
  items: { title: string; priority: string; dueAt?: string; note?: string }[],
) => {
  for (const item of items) {
    const response = await page.request.post("/api/todos", {
      data: {
        title: item.title,
        note: item.note ?? "",
        priority: item.priority,
        dueAt: item.dueAt ?? "",
      },
    });

    expect(response.status()).toBe(201);
  }
};

const openBoard = async (page: Page) => {
  await page.goto("/todos?view=board");

  await expect(page.getByText(BOARD_ORDER_NOTE)).toBeVisible();
};

const card = (page: Page, title: string): Locator =>
  page.locator("main").getByRole("listitem").filter({ hasText: title });

const heightOf = async (item: Locator): Promise<number> =>
  item.evaluate((element) => element.getBoundingClientRect().height);

/** How many lines this card's title renders on, after `line-clamp-3`. */
const titleLinesIn = async (item: Locator, title: string): Promise<number> =>
  item.getByText(title, { exact: true }).evaluate((element) => {
    const lineHeight = parseFloat(getComputedStyle(element).lineHeight);

    return Math.round(element.getBoundingClientRect().height / lineHeight);
  });

test.describe("§4.11 — a board card's height follows its content shape", () => {
  test("two cards carrying the same things are the same height, whichever chip they draw", async ({
    signedIn: page,
    isMobile,
  }) => {
    test.skip(isMobile === true, "the board needs a desktop viewport");

    await seed(page, [
      { title: LOW_BARE, priority: "low" },
      { title: MEDIUM_BARE, priority: "medium" },
      { title: HIGH_BARE, priority: "high" },
      { title: LOW_DATED, priority: "low", dueAt: localDay(0) },
      { title: HIGH_DATED, priority: "high", dueAt: localDay(0) },
    ]);

    await openBoard(page);
    await expect(card(page, HIGH_DATED)).toBeVisible();

    const [lowBare, highBare, lowDated, highDated] = await Promise.all([
      heightOf(card(page, LOW_BARE)),
      heightOf(card(page, HIGH_BARE)),
      heightOf(card(page, LOW_DATED)),
      heightOf(card(page, HIGH_DATED)),
    ]);

    /*
      The precondition, asserted. A title that wrapped would put 24px of its own
      into these heights and the comparison would stop being about the chip.
    */
    for (const [title, seeded] of [
      [LOW_BARE, LOW_BARE],
      [HIGH_BARE, HIGH_BARE],
      [LOW_DATED, LOW_DATED],
      [HIGH_DATED, HIGH_DATED],
    ] as const) {
      expect(
        await titleLinesIn(card(page, title), seeded),
        `“${title}” must be a one-line title for this comparison to be about the metadata`,
      ).toBe(1);
    }

    /*
      The defect, stated as the thing it costs. `Low` fitted the 51.20px
      remainder and `High` missed it by 0.95px, so these two differed by 28px
      while carrying exactly the same information.
    */
    expect
      .soft(
        Math.abs(lowBare - highBare),
        `undated: Low card is ${lowBare.toFixed(2)}px, High card is ${highBare.toFixed(2)}px`,
      )
      .toBeLessThanOrEqual(HEIGHT_TOLERANCE);

    expect
      .soft(
        Math.abs(lowDated - highDated),
        `dated: Low card is ${lowDated.toFixed(2)}px, High card is ${highDated.toFixed(2)}px`,
      )
      .toBeLessThanOrEqual(HEIGHT_TOLERANCE);

    /*
      The other half of "height follows content". A card carrying a date is
      allowed to be taller than one that does not — that is the card saying
      something more — but it must be taller for that reason and not for the
      chip's.
    */
    expect(
      lowDated,
      `a dated card (${lowDated.toFixed(2)}px) carries a line an undated one (${lowBare.toFixed(2)}px) does not`,
    ).toBeGreaterThanOrEqual(lowBare);
  });

  test("the actions have a line of their own, so the metadata is never a remainder", async ({
    signedIn: page,
    isMobile,
  }) => {
    test.skip(isMobile === true, "the board needs a desktop viewport");

    await seed(page, [
      { title: LOW_BARE, priority: "low" },
      {
        title: FULLY_LOADED,
        priority: "high",
        dueAt: localDay(3),
        note: "ask about the flue",
      },
    ]);

    await openBoard(page);
    await expect(card(page, FULLY_LOADED)).toBeVisible();

    /*
      Located through the chip's own `data-slot` — HeroUI's contract attribute,
      which the rest of this suite already navigates by — rather than through a
      `data-*` hook invented for the test. The chip's parent *is* the metadata
      line; if it still contains the actions, the restructure did not land.
    */
    const geometry = async (title: string) =>
      card(page, title).evaluate((element, cardTitle) => {
        const chip = element.querySelector('[data-slot="chip"]');
        const metadata = chip?.parentElement ?? null;

        if (metadata === null) throw new Error("no chip in the card");

        /*
          The actions are found by the **Edit** control's accessible name, which
          names the record rather than the position (§7.13) — the same handle
          the rest of this suite reaches these buttons by.
        */
        const action = element.querySelector<HTMLElement>(
          `button[aria-label='Edit "${cardTitle}"']`,
        );

        if (action === null) throw new Error(`no Edit action in “${cardTitle}”`);

        const style = getComputedStyle(element);
        const box = element.getBoundingClientRect();

        return {
          metadataContainsActions: metadata.contains(action),
          metadataBottom: metadata.getBoundingClientRect().bottom,
          metadataHeight: metadata.getBoundingClientRect().height,
          metadataWidth: metadata.getBoundingClientRect().width,
          actionTop: action.getBoundingClientRect().top,
          /*
            The tallest thing on the line, not the chip: `TodoDueDate` renders
            `body-sm` at `leading-6`, so a line carrying a date is 24px where a
            chip alone is 20. Comparing the line against its own tallest child
            is what makes "one line" mean one line rather than "as tall as a
            chip", which would fail on correct markup the moment a date joins.
          */
          tallestChild: Math.max(
            ...Array.from(metadata.children).map(
              (child) => child.getBoundingClientRect().height,
            ),
          ),
          contentWidth:
            box.width -
            parseFloat(style.paddingLeft) -
            parseFloat(style.paddingRight) -
            parseFloat(style.borderLeftWidth) -
            parseFloat(style.borderRightWidth),
        };
      }, title);

    for (const title of [LOW_BARE, FULLY_LOADED]) {
      const measured = await geometry(title);

      expect
        .soft(
          measured.metadataContainsActions,
          `“${title}”: the metadata line still holds the actions, so its width is a remainder`,
        )
        .toBe(false);

      expect
        .soft(
          measured.actionTop,
          `“${title}”: the actions start at ${measured.actionTop.toFixed(2)}, the metadata ends at ${measured.metadataBottom.toFixed(2)}`,
        )
        .toBeGreaterThanOrEqual(measured.metadataBottom);

      /*
        The metadata gets the card's full content width rather than the 51.20px
        left over after `TodoActions`. Stated as the relationship, not as 183.20
        — the number moves with the column width and the claim does not.
      */
      expect
        .soft(
          measured.metadataWidth,
          `“${title}”: the metadata line is ${measured.metadataWidth.toFixed(2)}px of the card's ${measured.contentWidth.toFixed(2)}px`,
        )
        .toBeGreaterThanOrEqual(measured.contentWidth - HEIGHT_TOLERANCE);
    }

    /*
      The action line is `justify-end`, so the actions still end where the card
      ends — the thing `ml-auto` used to do inside the shared line, now done by
      the line that owns them.
    */
    for (const title of [LOW_BARE, FULLY_LOADED]) {
      const edges = await card(page, title).evaluate((element, cardTitle) => {
        const action = element.querySelector<HTMLElement>(
          `button[aria-label='Delete "${cardTitle}"']`,
        );

        if (action === null) throw new Error(`no Delete action in “${cardTitle}”`);

        const style = getComputedStyle(element);
        const box = element.getBoundingClientRect();

        return {
          actionRight: action.getBoundingClientRect().right,
          contentRight:
            box.right -
            parseFloat(style.paddingRight) -
            parseFloat(style.borderRightWidth),
        };
      }, title);

      expect
        .soft(
          Math.abs(edges.actionRight - edges.contentRight),
          `“${title}”: the last action ends at ${edges.actionRight.toFixed(2)}, the card's content ends at ${edges.contentRight.toFixed(2)}`,
        )
        .toBeLessThanOrEqual(HEIGHT_TOLERANCE);
    }

    /*
      And the point of that width: a chip, a date and a note marker together are
      one line, where 51.20px forced them into two.
    */
    const loaded = await geometry(FULLY_LOADED);

    expect(
      loaded.metadataHeight,
      `chip + date + note is ${loaded.metadataHeight.toFixed(2)}px tall against a tallest child of ${loaded.tallestChild.toFixed(2)}px — it wrapped`,
    ).toBeLessThanOrEqual(loaded.tallestChild + HEIGHT_TOLERANCE);
  });

  /**
   * A card with nothing to show draws **no metadata line at all**, not an empty
   * one.
   *
   * This is the half the height comparison above cannot see: an always-rendered
   * empty line costs every bare card the same 8px, so `Low` and `High` would
   * still agree with each other while both sat a step too low. It is also the
   * exact fault this change removes from the row, where the empty box was worth
   * 2.00px of misalignment — so it is measured here rather than assumed to have
   * come along for the ride.
   *
   * Measured as a distance rather than as an element count: the gap between the
   * title line and the action line must be the card's own `row-gap` and nothing
   * more. An empty line between them would read as two gaps.
   */
  test("a card with nothing to show draws no metadata line", async ({
    signedIn: page,
    isMobile,
  }) => {
    test.skip(isMobile === true, "the board needs a desktop viewport");

    await seed(page, [{ title: MEDIUM_BARE, priority: "medium" }]);

    await openBoard(page);
    await expect(card(page, MEDIUM_BARE)).toBeVisible();

    const measured = await card(page, MEDIUM_BARE).evaluate(
      (element, cardTitle) => {
        const title = element.querySelector<HTMLElement>(
          '[data-slot="typography"]',
        );
        const action = element.querySelector<HTMLElement>(
          `button[aria-label='Edit "${cardTitle}"']`,
        );

        if (title === null || action === null) {
          throw new Error(`no title or Edit action in “${cardTitle}”`);
        }

        /*
          The lines are the card's own flex children, reached from the elements
          they contain rather than by index — the card's shape is what is under
          test, so indexing into it would assume the answer.
        */
        const lineOf = (node: HTMLElement) => {
          let current: HTMLElement = node;

          while (current.parentElement !== element) {
            current = current.parentElement as HTMLElement;
          }

          return current.getBoundingClientRect();
        };

        return {
          rowGap: parseFloat(getComputedStyle(element).rowGap),
          distance: lineOf(action).top - lineOf(title).bottom,
        };
      },
      MEDIUM_BARE,
    );

    expect(
      measured.distance,
      `the action line starts ${measured.distance.toFixed(2)}px below the title line, against a ${measured.rowGap.toFixed(2)}px row-gap — an empty metadata line would double it`,
    ).toBeCloseTo(measured.rowGap, 1);
  });

  /**
   * The half a screen-reader user pays for.
   *
   * Dropping the metadata line when it has nothing to *draw* must not drop the
   * `sr-only` `Priority: Medium` that lives inside it — the untriaged default
   * draws no chip, so the announcement is the only thing carrying the level,
   * and the person who cannot see that the chip is absent is exactly the person
   * this would silently cost. `e2e/a11y-contrast.spec.ts` makes this claim for
   * the **row**; the card had no equivalent, and the card is the shape whose
   * metadata line disappears.
   */
  test("a card with no chip, no date and no note still announces its level", async ({
    signedIn: page,
    isMobile,
  }) => {
    test.skip(isMobile === true, "the board needs a desktop viewport");

    await seed(page, [
      { title: MEDIUM_BARE, priority: "medium" },
      { title: HIGH_BARE, priority: "high" },
    ]);

    await openBoard(page);
    await expect(card(page, MEDIUM_BARE)).toBeVisible();

    await expect(
      card(page, MEDIUM_BARE).locator('[data-slot="chip"]'),
      "the untriaged default draws no chip",
    ).toHaveCount(0);

    await expect(card(page, MEDIUM_BARE)).toContainText("Priority: Medium");
    await expect(card(page, HIGH_BARE)).toContainText("Priority: High");
  });
});
