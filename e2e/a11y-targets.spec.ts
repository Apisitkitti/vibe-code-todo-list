import type { Locator, Page } from "@playwright/test";

import { expect, test } from "./support/fixtures";

/**
 * DEF-16 — the search field's clear button.
 *
 * QA measured it at 20×20 at every width (`docs/QA-REPORT.md` §A2): the only
 * control in the app below WCAG 2.2 SC 2.5.8's 24×24 floor, and far below
 * NFR-05's 44×44. Missing it puts text back in the search box and silently
 * changes which list the user is looking at.
 *
 * Its accessible name was HeroUI's default `Close` — which describes
 * dismissing something, not clearing a field.
 */

/** The app's own floors: NFR-05 on phones, the `sm:` step-down above 640px. */
const MOBILE_MIN = 44;
const POINTER_MIN = 36;
/** WCAG 2.2 SC 2.5.8 (AA) — the floor nothing in the app may drop below. */
const WCAG_MIN = 24;

const targetFloor = (page: Page): number => {
  const width = page.viewportSize()?.width ?? 0;

  return width < 640 ? MOBILE_MIN : POINTER_MIN;
};

const boxOf = async (locator: Locator) => {
  const box = await locator.boundingBox();

  if (box === null) throw new Error("control is not rendered");

  return box;
};

test.describe("DEF-16 — the search clear button is a real target", () => {
  test("clears at the app's own tap-target floor, and never below WCAG's", async ({
    signedIn,
    todos,
  }) => {
    await todos.quickAdd("something to search for");
    await expect(
      signedIn.locator("main").getByText("something to search for"),
    ).toBeVisible();

    const search = signedIn.getByRole("searchbox", { name: "Search todos" });
    const clear = signedIn.locator('[data-slot="search-field-clear-button"]');

    // The button only exists once the field has something to clear.
    await search.fill("something");
    await expect(clear).toBeVisible();

    const box = await boxOf(clear);
    const floor = targetFloor(signedIn);

    expect.soft(box.width, "clear button width").toBeGreaterThanOrEqual(floor);
    expect.soft(box.height, "clear button height").toBeGreaterThanOrEqual(floor);

    // Restated independently: whatever the app's own bar is, SC 2.5.8 binds.
    expect(Math.min(box.width, box.height)).toBeGreaterThanOrEqual(WCAG_MIN);
  });

  test("is named for what it does, not for HeroUI's default", async ({
    signedIn,
    todos,
  }) => {
    await todos.quickAdd("something to search for");
    await expect(
      signedIn.locator("main").getByText("something to search for"),
    ).toBeVisible();

    const search = signedIn.getByRole("searchbox", { name: "Search todos" });

    await search.fill("something");

    await expect(
      signedIn.getByRole("button", { name: "Clear search", exact: true }),
    ).toBeVisible();
    await expect(
      signedIn.getByRole("button", { name: "Close", exact: true }),
    ).toHaveCount(0);
  });

  test("a full 24×24 region of it actually takes the press", async ({
    signedIn,
    todos,
  }) => {
    await todos.quickAdd("something to search for");
    await expect(
      signedIn.locator("main").getByText("something to search for"),
    ).toBeVisible();

    const search = signedIn.getByRole("searchbox", { name: "Search todos" });
    const clear = signedIn.locator('[data-slot="search-field-clear-button"]');

    await search.fill("something");
    await expect(clear).toBeVisible();

    /*
      A box that measures 36 but does not hit-test is not a target, so this
      probes the shape rather than trusting the rectangle — the same
      `elementFromPoint` method QA used to close DEF-01.

      The probes trace the corners of a **centred 24×24 square**, not the
      bounding box's own corners: this control is a circle, and the corners of
      a circle's bounding box are outside the circle by construction. SC 2.5.8
      asks for a 24×24 region that accepts the pointer, and a 36px circle
      contains one (24×√2 = 33.9 < 36). A 20px circle contains no such region
      at all, which is what makes this fail on the unfixed control.
    */
    /*
      Measured and probed inside **one** evaluation, deliberately.

      An earlier version read the box over one round trip and then hit-tested
      over five more. The search field is debounced and writes the query to the
      URL, so a re-render can land inside that window — and when it does, the
      probe is aimed at coordinates that described the control a moment ago and
      reports a miss that says nothing about the control's shape. That is a
      false red, which is the one kind of failure worse than none here. Reading
      `getBoundingClientRect` beside `elementFromPoint` closes the window
      without weakening anything: the probes are still the corners of a centred
      24×24 square of the real, rendered control.
    */
    const results = await signedIn.evaluate((minSize) => {
      const target = document.querySelector(
        '[data-slot="search-field-clear-button"]',
      );

      if (target === null) return null;

      const rect = target.getBoundingClientRect();
      const centreX = rect.x + rect.width / 2;
      const centreY = rect.y + rect.height / 2;
      const half = minSize / 2;

      const probes: [string, number, number][] = [
        ["centre", centreX, centreY],
        ["top-left", centreX - half, centreY - half],
        ["top-right", centreX + half, centreY - half],
        ["bottom-left", centreX - half, centreY + half],
        ["bottom-right", centreX + half, centreY + half],
      ];

      return probes.map(([name, x, y]) => {
        const hit = document.elementFromPoint(x, y);

        return {
          name,
          hits:
            hit !== null &&
            hit.closest('[data-slot="search-field-clear-button"]') !== null,
        };
      });
    }, WCAG_MIN);

    expect(results, "the clear button is not rendered").not.toBeNull();

    for (const probe of results ?? []) {
      expect.soft(probe.hits, `probe ${probe.name} lands on the clear button`).toBe(
        true,
      );
    }

    // And it really clears — the probes prove reach, this proves effect.
    await clear.click();
    await expect(search).toHaveValue("");
  });
});
