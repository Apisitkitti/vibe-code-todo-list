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
});
