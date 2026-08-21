import type { Locator, Page } from "@playwright/test";

import { expect, test } from "./support/fixtures";

/**
 * The reserved metadata column (`docs/DESIGN.md` §1, §4.4).
 *
 * §1 promises *"Nothing reflows between rows; a row with no due date leaves the
 * slot empty rather than shifting"*, and until the title took `sm:flex-1
 * sm:min-w-0` the code did not deliver it: the title was sized by its own
 * content, so the chip/date/note cluster hugged the end of each title and
 * landed at a different place on every row.
 *
 * Both widths are driven from inside the test with `setViewportSize` rather
 * than left to the project's own viewport. The claim is about a breakpoint, so
 * a test that only ever sees one side of it can only ever check half of it —
 * and the mobile half is the half that must *not* change.
 */

const DESKTOP = { width: 1280, height: 800 };
const MOBILE = { width: 375, height: 812 };

/** A geometry read is only meaningful once layout has settled. */
const boxOf = async (locator: Locator) => {
  const box = await locator.boundingBox();

  expect(box, "element has no box").not.toBeNull();

  return box!;
};

const seed = async (
  page: Page,
  seeds: { title: string; dueAt?: string; priority?: string; note?: string }[],
) => {
  for (const item of seeds) {
    const response = await page.request.post("/api/todos", {
      data: {
        title: item.title,
        note: item.note ?? "",
        priority: item.priority ?? "high",
        dueAt: item.dueAt ?? "",
      },
    });

    expect(response.status()).toBe(201);
  }

  await page.reload();
};

const pad = (value: number) => String(value).padStart(2, "0");

const localDay = (offset: number): string => {
  const date = new Date();

  date.setDate(date.getDate() + offset);

  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
};

const SHORT_TITLE = "Milk";
const LONG_TITLE =
  "Renew the parking permit before the council office closes on Friday afternoon";
const UNDATED_TITLE = "Sweep";

test.describe("the row's metadata column", () => {
  /**
   * The cluster's **right** edge, not its left. With the title taking the
   * slack the cluster is pushed to the end of the row, so its right edge is
   * the fixed thing; a row carrying fewer pieces of metadata is narrower and
   * its left edge legitimately differs. Asserting the left edge would fail on
   * correct markup for the third row below, which has no date.
   */
  test("lands at one right edge whatever the title's length, at sm: and up", async ({
    signedIn: page,
    todos,
  }) => {
    await page.setViewportSize(DESKTOP);
    await seed(page, [
      { title: SHORT_TITLE, dueAt: localDay(7) },
      { title: LONG_TITLE, dueAt: localDay(7) },
      { title: UNDATED_TITLE },
    ]);

    await expect(todos.row(UNDATED_TITLE)).toBeVisible();

    /*
      The cluster is the chip's parent. There is no `data-*` hook on it, and
      inventing one for a test would be a styling hook wearing a contract's
      clothes — the chip's own `data-slot` is HeroUI's contract attribute and
      is what the rest of this suite already navigates by.
    */
    const cluster = (title: string) =>
      todos.row(title).locator('[data-slot="chip"]').locator("xpath=..");

    const [short, long, undated] = await Promise.all([
      boxOf(cluster(SHORT_TITLE)),
      boxOf(cluster(LONG_TITLE)),
      boxOf(cluster(UNDATED_TITLE)),
    ]);

    const rightEdge = (box: { x: number; width: number }) => box.x + box.width;

    // Sub-pixel tolerance only: these are the same computed edge, not two
    // edges that happen to be close.
    expect(
      Math.abs(rightEdge(short) - rightEdge(long)),
      "a four-letter title and a seventy-six-letter one end their metadata at the same edge",
    ).toBeLessThan(1);
    expect(
      Math.abs(rightEdge(undated) - rightEdge(long)),
      "a row with no due date leaves the slot empty rather than shifting (§1)",
    ).toBeLessThan(1);

    // The trade §1 already made: the long title truncates rather than pushing.
    const isTruncated = await todos
      .row(LONG_TITLE)
      .getByText(LONG_TITLE)
      .evaluate((element) => element.scrollWidth > element.clientWidth);

    expect(isTruncated, "the long title truncates inside its column").toBe(true);
  });

  /**
   * The same right edge once the default level stopped drawing a chip
   * (§4.4, §8.4.2).
   *
   * A row whose priority is `medium` now renders a `sr-only` `Priority: Medium`
   * where the chip used to be. `sr-only` is `position: absolute`, so it is not
   * a flex item and contributes neither width nor a `gap-2` step — but that is
   * a claim about what the browser does with a utility class, and §1's promise
   * that *"nothing reflows between rows"* is exactly the promise this project
   * has previously asserted in prose and not delivered. So it is measured.
   *
   * Four rows, covering both axes of the cluster's contents:
   *
   * | Row | chip | date |
   * |---|---|---|
   * | `Milk` | yes | yes |
   * | `Sweep` | yes | no |
   * | `Rinse` | no | yes |
   * | `Fold` | no | no (note marker only) |
   *
   * The last row is why the note is there at all: with neither a chip nor a
   * date, the cluster has no child to locate it by, and a zero-width empty div
   * is precisely the case where a stray gap would go unnoticed. The `✎` marker
   * gives the cluster something to be found by without changing what is being
   * measured.
   */
  test("lands at one right edge whether or not the row draws a chip", async ({
    signedIn: page,
    todos,
  }) => {
    await page.setViewportSize(DESKTOP);
    await seed(page, [
      { title: "Milk", dueAt: localDay(7), priority: "high" },
      { title: "Sweep", priority: "high" },
      { title: "Rinse", dueAt: localDay(7), priority: "medium" },
      { title: "Fold", priority: "medium", note: "a note to find it by" },
    ]);

    await expect(todos.row("Fold")).toBeVisible();

    /*
      Each cluster located through whichever child that row actually has. The
      cluster carries no `data-*` hook of its own and inventing one for a test
      would be a styling hook wearing a contract's clothes — `data-slot` on the
      chip, `<time>` and the note's own visually-hidden text are all things the
      row publishes for its own reasons.
    */
    const clusters = {
      "chip + date": todos
        .row("Milk")
        .locator('[data-slot="chip"]')
        .locator("xpath=.."),
      "chip, no date": todos
        .row("Sweep")
        .locator('[data-slot="chip"]')
        .locator("xpath=.."),
      "no chip, date": todos.row("Rinse").locator("time").locator("xpath=.."),
      "no chip, no date": todos
        .row("Fold")
        .getByText("Has a note")
        .locator("xpath=.."),
    };

    const rightEdges = new Map<string, number>();

    for (const [label, locator] of Object.entries(clusters)) {
      const box = await boxOf(locator);

      rightEdges.set(label, box.x + box.width);
    }

    const reference = rightEdges.get("chip + date")!;

    for (const [label, edge] of rightEdges) {
      expect(
        Math.abs(edge - reference),
        `${label}: right edge ${edge.toFixed(2)} vs ${reference.toFixed(2)} — a row that draws no chip must not shift the column (§1)`,
      ).toBeLessThan(1);
    }
  });

  /**
   * Mobile is `flex-col` and must be untouched. `flex-1` there would stretch
   * the title down the row instead of across it, and there is no column to
   * reserve in the first place — which is the whole reason the utilities are
   * `sm:`-prefixed.
   */
  test("is still stacked under the title below sm:", async ({
    signedIn: page,
    todos,
  }) => {
    await page.setViewportSize(MOBILE);
    await seed(page, [{ title: SHORT_TITLE, dueAt: localDay(7) }]);

    await expect(todos.row(SHORT_TITLE)).toBeVisible();

    const title = await boxOf(todos.row(SHORT_TITLE).getByText(SHORT_TITLE));
    const chip = await boxOf(
      todos.row(SHORT_TITLE).locator('[data-slot="chip"]'),
    );

    expect(
      chip.y,
      "the metadata sits below the title, not beside it",
    ).toBeGreaterThanOrEqual(title.y + title.height);
  });

  /**
   * A row with nothing to draw gets **no metadata box**, not an empty one —
   * measured in the file named after the row's metadata column, which is the
   * point.
   *
   * `M2` (the line always boxed) was killed by exactly one test,
   * `card-row-parity.spec.ts:158`, and only in `chromium-mobile`. This file
   * passed. That is a fragile kill: `card-row-parity` exists to compare a row
   * against a *card*, so the row's own conditional render was pinned only as a
   * side effect of a parity measurement, and it would stop being pinned the
   * moment that comparison changed shape.
   *
   * The mechanism, from `TodoRow`'s own comment: below `sm:` this column is a
   * `flex-col gap-1`, and a cluster rendered with nothing in it is still a flex
   * item — zero-height, but it takes the 4px gap before it. So the column ends
   * up 4px taller than its only visible child, the `<li>`'s `items-center`
   * centres the checkbox against that, and the control sits 2.00px below the
   * title. At `sm:` and up the same empty box costs nothing visible, which is
   * why this measures at `MOBILE`.
   *
   * Measured as *the column is exactly as tall as its title*, against the
   * column's own box rather than against a constant — a hard-coded height would
   * be a restatement of the type scale and would go red on any font change.
   * The chip row below is what stops it being vacuous: the same measurement has
   * to be able to come out the other way.
   */
  test("a row with nothing to show reserves no space for the metadata it does not have", async ({
    signedIn: page,
    todos,
  }) => {
    await page.setViewportSize(MOBILE);
    await seed(page, [
      // Untriaged and undated: `priorityDrawsChip` is false and there is no
      // date, so the metadata fragment's only content is the `sr-only`
      // announcement, which is `position: absolute` and not a flex item.
      { title: UNDATED_TITLE, priority: "medium" },
      // The control: this one genuinely has something to draw.
      { title: SHORT_TITLE, priority: "high" },
    ]);

    await expect(todos.row(UNDATED_TITLE)).toBeVisible();

    /**
     * The title's own flex column, reached through the title rather than by its
     * classes — the utilities on it are a layout decision that may be rewritten,
     * and "the box the title lives in" is the thing being measured either way.
     */
    const columnOverTitle = (title: string) =>
      todos
        .row(title)
        .getByText(title, { exact: true })
        .evaluate((element) => {
          const column = element.parentElement;

          if (column === null) return null;

          return {
            column: column.getBoundingClientRect().height,
            title: element.getBoundingClientRect().height,
          };
        });

    const bare = await columnOverTitle(UNDATED_TITLE);
    const withChip = await columnOverTitle(SHORT_TITLE);

    expect(bare, "the bare row's title has no column around it").not.toBeNull();
    expect(withChip, "the chip row's title has no column around it").not.toBeNull();

    expect(
      bare!.column,
      `the bare row reserves ${(bare!.column - bare!.title).toFixed(2)}px for metadata it does not draw — an empty flex item still takes the column's gap`,
    ).toBeCloseTo(bare!.title, 1);

    /*
      And the measurement can come out the other way, so the assertion above is
      a claim about this row rather than about every row.
    */
    expect(
      withChip!.column,
      "a row that does draw metadata should be taller than its title alone — if this fails the measurement above proves nothing",
    ).toBeGreaterThan(withChip!.title);
  });
});
