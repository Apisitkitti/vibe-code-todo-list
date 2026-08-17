import type { Locator, Page } from "@playwright/test";

import {
  formatRgb,
  measureContrast,
  setTheme,
  THEMES,
  type Theme,
} from "./support/contrast";
import { expect, test } from "./support/fixtures";

/**
 * Contrast, measured through the browser's own parser rather than estimated.
 *
 * Every threshold here comes from `docs/PRD.md` by way of QA's audit
 * (`docs/QA-REPORT.md` §A1), not from this file:
 *
 * - **4.5:1** for body text — NFR-06 / WCAG 2.2 SC 1.4.3. Nothing measured
 *   here qualifies as large text (that needs ≥24px, or ≥18.66px bold).
 * - **3:1** for a non-text control boundary — SC 1.4.11.
 *
 * `e2e/support/contrast.ts` explains the compositing model. The short version
 * is that it resolves `oklch()` / `lab()` / `color-mix()` by painting them,
 * composites alpha per layer from the root down, and treats `opacity` as a
 * group multiplier — which is the only way the pending row's number comes out
 * right, because the row's dimming is what was reaching the text.
 *
 * Both themes are measured on every target. HeroUI scopes its light palette to
 * `:root, .light, [data-theme="light"]` and its dark palette to
 * `.dark, [data-theme="dark"]`, and `src/app/layout.tsx` stamps an explicit
 * `data-theme` before first paint — so a token corrected in one block is not
 * corrected in the other.
 */

/** WCAG 2.2 SC 1.4.3 / NFR-06. */
const TEXT_MIN = 4.5;

/** Where a held request is released from, so a test never leaves one hanging. */
interface HeldRequest {
  release: () => void;
}

/**
 * Holds a mutation open so the row's in-flight treatment can be measured while
 * it is genuinely on screen, rather than raced against a round trip.
 */
const holdRoute = async (page: Page, url: string, method: string): Promise<HeldRequest> => {
  let release = () => {};
  const held = new Promise<void>((resolve) => {
    release = resolve;
  });

  await page.route(url, async (route, request) => {
    if (request.method() !== method) {
      await route.continue();

      return;
    }

    await held;
    await route.continue();
  });

  return { release };
};

const rowTitle = (page: Page, title: string): Locator =>
  page
    .locator("main")
    .getByRole("listitem")
    .filter({ hasText: title })
    .getByText(title, { exact: true });

const expectReadable = async (target: Locator, label: string, theme: Theme) => {
  const reading = await measureContrast(target);

  expect
    .soft(
      reading.ratio,
      `${label} [${theme}] — ${formatRgb(reading.foreground)} on ${formatRgb(reading.background)}`,
    )
    .toBeGreaterThanOrEqual(TEXT_MIN);
};

test.describe("the row a mutation is working on stays readable", () => {
  /**
   * QA §A4: completing a row applied `text-muted line-through` optimistically
   * *and* dimmed the row to `opacity-60` at the same moment. The two stack —
   * muted rgb(113,113,122) at 60% over white is rgb(170,170,175) — and the
   * title measured **2.32:1**, below even the 3:1 large-text floor, on the
   * single most frequent interaction in the product. The thing the user is
   * waiting on was the least readable thing on screen.
   *
   * `docs/DESIGN.md` §8.3.2 is the half of the MI-6 contradiction that
   * survives: an optimistic toggle already shows its outcome, so dimming it is
   * latency theatre that costs legibility.
   */
  test("a toggle in flight does not dim the title away", async ({
    signedIn,
    todos,
  }) => {
    await todos.quickAdd("toggle contrast row");
    await expect(rowTitle(signedIn, "toggle contrast row")).toBeVisible();

    const held = await holdRoute(signedIn, "**/api/todos/*/status", "PATCH");

    await todos.toggle("toggle contrast row", true);

    /*
      Off the row before measuring. `toggle()` clicks it, which leaves the
      pointer parked and `hover:bg-surface-hover` painted — a different surface
      from the one this test is about, and one that is measured on its own
      terms with the rest of the muted token in "the muted token clears 4.5:1
      on every surface it lands on" below.
    */
    await signedIn.mouse.move(0, 0);

    // The row is mid-write: completed styling applied, request unresolved.
    await expect(rowTitle(signedIn, "toggle contrast row")).toBeVisible();

    for (const theme of THEMES) {
      await setTheme(signedIn, theme);
      await expectReadable(
        rowTitle(signedIn, "toggle contrast row"),
        "row title while completing",
        theme,
      );
    }

    held.release();
  });

  /**
   * The same measurement on the path §8.3.2 *keeps* the dimming for. A
   * completed row is the case that matters: its title is already `text-muted
   * line-through`, so a row-level `opacity-60` lands on the muted token and
   * reproduces the 2.32:1 exactly, even once the toggle no longer dims.
   */
  test("a delete in flight does not dim a completed title away", async ({
    signedIn,
    todos,
  }) => {
    await todos.quickAdd("delete contrast row");
    await expect(rowTitle(signedIn, "delete contrast row")).toBeVisible();

    await todos.toggle("delete contrast row", true);
    await expect(
      todos.toastTitles.filter({ hasText: "marked complete" }),
    ).toBeVisible();

    const held = await holdRoute(signedIn, "**/api/todos/*", "DELETE");

    await todos.openDelete("delete contrast row");
    await todos.confirmDelete();

    await expect(rowTitle(signedIn, "delete contrast row")).toBeVisible();

    for (const theme of THEMES) {
      await setTheme(signedIn, theme);
      await expectReadable(
        rowTitle(signedIn, "delete contrast row"),
        "completed row title while deleting",
        theme,
      );
    }

    held.release();
  });
});
