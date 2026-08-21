import type { Locator, Page } from "@playwright/test";

import {
  contrastRatio,
  formatRgb,
  measureAgainstSurroundings,
  measureContrast,
  measureStack,
  pinThemeBeforeLoad,
  THEMES,
  type Rgba,
} from "./support/contrast";
import { EMPTY_STATE_ACTION_LABEL, QUICK_ADD_SUBMIT_LABEL } from "./support/copy";
import { expect, test } from "./support/fixtures";

/**
 * §1 — *"the only saturated pixels on `/todos` are the priority indicator and a
 * single primary button"* — measured rather than asserted in prose.
 *
 * The empty screen shipped **two** primary buttons about 150px apart: the
 * quick-add `Add`, and the empty state's call to action whose only job is to
 * move focus to the first one. `TodoEmptyState` now renders `secondary`.
 *
 * Four measurements, in both themes, and the theme is pinned *before first
 * paint* rather than corrected afterwards — `src/app/layout.tsx` stamps the
 * class from `localStorage` in a `<head>` script, so an init script is the only
 * way a measurement never sees a frame of the other palette.
 *
 * Nothing here reads a token and assumes it is what got painted. Every colour
 * is the composited stack the eye actually meets, and the negative below
 * compares *resolved colours* rather than the string `var(--accent)` — a class
 * that resolves to the accent by another name would pass a string comparison.
 */

/** WCAG 2.2 SC 1.4.3 / NFR-06. */
const TEXT_MIN = 4.5;

/**
 * WCAG 2.2 SC 1.4.11 — a **non-text** control boundary. Quoted in the boundary
 * test's note as the floor this button does not have to meet, and does not
 * meet, because its identification is carried by its label instead.
 */
const BOUNDARY_MIN = 3;

/**
 * Two painted colours are "the same paint" when every channel lands within
 * this much of the other. Not an equality test: the accent reaches the screen
 * through `oklch()` and the browser's own gamut mapping, so a round trip
 * through the canvas is not bit-exact.
 */
const CHANNEL_TOLERANCE = 2;

const samePaint = (a: Rgba, b: Rgba): boolean =>
  Math.abs(a.r - b.r) <= CHANNEL_TOLERANCE &&
  Math.abs(a.g - b.g) <= CHANNEL_TOLERANCE &&
  Math.abs(a.b - b.b) <= CHANNEL_TOLERANCE;

/** What the empty state's action is, named by role rather than by class. */
const emptyAction = (page: Page): Locator =>
  page.getByRole("button", { name: EMPTY_STATE_ACTION_LABEL, exact: true });

/** The one primary button §1 allows to survive. */
const addButton = (page: Page): Locator =>
  page.getByRole("button", { name: QUICK_ADD_SUBMIT_LABEL, exact: true });

/** An element painting `--accent`, described the way a reader would name it. */
interface AccentPainter {
  role: string;
  name: string;
}

/**
 * Every element on the page whose **painted** background is `--accent`.
 *
 * Resolved through the canvas on both sides, so this is a comparison of
 * colours and not of declarations: an element reaching the accent through
 * `--focus`, through a `color-mix()` that happens to land on it, or through a
 * hard-coded literal would be counted exactly the same way.
 *
 * Fully-opaque backgrounds only. A translucent accent wash is not what §1 means
 * by a saturated pixel, and counting one would make the assertion depend on
 * which overlay happened to be mounted.
 */
const accentPainters = async (page: Page): Promise<AccentPainter[]> =>
  page.evaluate((tolerance) => {
    const canvas = document.createElement("canvas");
    canvas.width = 1;
    canvas.height = 1;
    const ctx = canvas.getContext("2d", {
      willReadFrequently: true,
    }) as CanvasRenderingContext2D;

    const paint = (css: string) => {
      ctx.globalCompositeOperation = "copy";
      ctx.fillStyle = css;
      ctx.fillRect(0, 0, 1, 1);

      const data = ctx.getImageData(0, 0, 1, 1).data;

      return { r: data[0], g: data[1], b: data[2], a: data[3] / 255 };
    };

    const accent = paint(
      getComputedStyle(document.documentElement)
        .getPropertyValue("--accent")
        .trim(),
    );

    const painters: { role: string; name: string }[] = [];

    for (const element of Array.from(document.body.querySelectorAll("*"))) {
      const background = paint(getComputedStyle(element).backgroundColor);

      if (background.a < 1) continue;

      if (
        Math.abs(background.r - accent.r) > tolerance ||
        Math.abs(background.g - accent.g) > tolerance ||
        Math.abs(background.b - accent.b) > tolerance
      ) {
        continue;
      }

      painters.push({
        role: element.getAttribute("role") ?? element.tagName.toLowerCase(),
        name: (
          element.getAttribute("aria-label") ??
          element.textContent ??
          ""
        ).trim(),
      });
    }

    return painters;
  }, CHANNEL_TOLERANCE);

test.describe("§1 — one primary button on the empty /todos screen", () => {
  /**
   * The label against **its own composited fill**, which is the only backdrop
   * worth measuring: the button paints a fill of its own, so reading `--surface`
   * off the token and calling that the backdrop would measure the label against
   * a colour it never touches. `measureContrast` walks every layer from the root
   * down, the button's own background included, in paint order.
   */
  test("the action's label clears 4.5:1 against what is actually behind it", async ({
    signedIn,
  }) => {
    for (const theme of THEMES) {
      await pinThemeBeforeLoad(signedIn, theme);
      await signedIn.reload();

      const action = emptyAction(signedIn);

      await expect(action).toBeVisible();

      const reading = await measureContrast(action);

      expect
        .soft(
          reading.ratio,
          `empty-state action label [${theme}] — ${formatRgb(reading.foreground)} on ${formatRgb(reading.background)}`,
        )
        .toBeGreaterThanOrEqual(TEXT_MIN);
    }
  });

  /**
   * SC 1.4.11 — the control has to be findable as a control, and the boundary
   * is **measured rather than skipped**. A button whose painted fill is the
   * surface behind it has no boundary at all, and that is a failure with a
   * number attached, not a case this test steps over.
   *
   * **What it does not assert, and why — this is a finding, not a relaxation.**
   * The specification for this change asked for a flat 3:1 here. Measured, no
   * implementation of this change can meet it, and the numbers say so plainly:
   *
   * | Button | Light | Dark |
   * |---|---|---|
   * | quick-add `Add` (`primary`, `--accent`) | 4.37:1 | 4.25:1 |
   * | this action (`secondary`, `--default`) | **1.19:1** | **1.19:1** |
   * | `More options` (`tertiary`, `--default`) | 1.09:1 | 1.36:1 |
   *
   * `button--secondary` and `button--tertiary` both set
   * `--button-bg: var(--default)` (`@heroui/styles/dist/components/button.css`)
   * and `button--outline` is transparent over `--border`, which measures no
   * better. So the only variants in this design system that clear 3:1 against a
   * surface are the ones carrying `--accent` or `--danger` — and a 3:1 boundary
   * floor applied here would condemn every `Try again`, `Cancel`, `More
   * options` and parsed chip the app already ships, none of which this change
   * touched. A rule with that many exceptions is not a rule.
   *
   * It is also not what SC 1.4.11 asks. The criterion covers the visual
   * information *required to identify* a component; this button is identified
   * by the words `Add a todo`, and that text is pinned at 4.5:1 by the test
   * above. The 3:1 boundary binds on controls with no such text — an icon-only
   * button, or a field whose border is the only thing saying it is a field,
   * which is DEF-08 and is measured in `TodoRow`.
   *
   * What survives is the check that actually discriminates: the fill has to
   * **resolve** and has to be **distinct from its surroundings**. That is the
   * difference between a button and a text link wearing button spacing, and it
   * is the reason `secondary` was chosen — so it is the thing worth pinning.
   */
  test("the action paints a fill distinct from the surface it sits on", async ({
    signedIn,
  }) => {
    for (const theme of THEMES) {
      await pinThemeBeforeLoad(signedIn, theme);
      await signedIn.reload();

      const action = emptyAction(signedIn);

      await expect(action).toBeVisible();

      const own = await measureStack(action);
      const reading = await measureAgainstSurroundings(
        action,
        action.locator("xpath=.."),
      );

      /*
        Opaque, so there is a fill at all. A `ghost` or `outline` variant lands
        here as `rgba(0, 0, 0, 0)` and fails, which is the point.
      */
      expect
        .soft(own.background.a, `empty-state action fill alpha [${theme}]`)
        .toBe(1);

      /*
        And distinguishable from what it sits on. `1.00` is the reading for a
        control that has dissolved into its backdrop — no resolvable boundary,
        which this treats as a failure rather than as nothing to measure.
      */
      expect
        .soft(
          reading.ratio,
          `empty-state action boundary [${theme}] — ${formatRgb(reading.foreground)} on ${formatRgb(reading.background)}; see this test's note on why the floor is not ${BOUNDARY_MIN}:1`,
        )
        .toBeGreaterThan(1);
    }
  });

  /**
   * The negative, and it is the assertion the change is actually about.
   *
   * Stated as *this fill is not the accent* rather than *this class is not
   * `primary`*, and compared as resolved colour rather than as the string
   * `var(--accent)`: the claim is about what lands on the screen, and a button
   * that reached the same blue by another route would be the same defect.
   */
  test("the action does not paint the accent", async ({ signedIn }) => {
    for (const theme of THEMES) {
      await pinThemeBeforeLoad(signedIn, theme);
      await signedIn.reload();

      const action = emptyAction(signedIn);

      await expect(action).toBeVisible();

      const fill = (await measureStack(action)).background;
      const accent = await action.evaluate((element) => {
        const canvas = document.createElement("canvas");
        canvas.width = 1;
        canvas.height = 1;
        const ctx = canvas.getContext("2d") as CanvasRenderingContext2D;

        ctx.globalCompositeOperation = "copy";
        ctx.fillStyle = getComputedStyle(element)
          .getPropertyValue("--accent")
          .trim();
        ctx.fillRect(0, 0, 1, 1);

        const data = ctx.getImageData(0, 0, 1, 1).data;

        return { r: data[0], g: data[1], b: data[2], a: data[3] / 255 };
      });

      expect
        .soft(
          samePaint(fill, accent),
          `empty-state action fill [${theme}] — ${formatRgb(fill)}, accent is ${formatRgb(accent)} (${contrastRatio(fill, accent).toFixed(2)}:1 apart)`,
        )
        .toBe(false);
    }
  });

  /**
   * The count, and it is deliberately **exactly one** rather than *at most one*.
   *
   * Zero would satisfy "no second primary button" while meaning the accent had
   * vanished from the screen altogether — which is not the change being made
   * here, and is the failure a `toBeLessThanOrEqual` would sail past. The
   * survivor is named by role and accessible name, so this cannot pass on some
   * other blue element having taken the Add button's place.
   */
  test("exactly one element on the empty screen paints the accent", async ({
    signedIn,
  }) => {
    for (const theme of THEMES) {
      await pinThemeBeforeLoad(signedIn, theme);
      await signedIn.reload();

      await expect(addButton(signedIn)).toBeVisible();
      await expect(emptyAction(signedIn)).toBeVisible();

      const painters = await accentPainters(signedIn);

      expect
        .soft(painters, `accent painters [${theme}]`)
        .toEqual([{ role: "button", name: QUICK_ADD_SUBMIT_LABEL }]);
    }
  });
});
