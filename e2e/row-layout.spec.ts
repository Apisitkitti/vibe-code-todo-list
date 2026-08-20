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
  seeds: { title: string; dueAt?: string }[],
) => {
  for (const item of seeds) {
    const response = await page.request.post("/api/todos", {
      data: {
        title: item.title,
        note: "",
        priority: "high",
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
