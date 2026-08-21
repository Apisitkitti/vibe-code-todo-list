import type { Page } from "@playwright/test";

import { STATUS_FILTER_ARIA_LABEL } from "./support/copy";
import { expect, test } from "./support/fixtures";

/**
 * The horizontal half of `page-rhythm.spec.ts`.
 *
 * That file pins the `/todos` shell's *vertical* rhythm — every top-level child
 * of `main` 24px from the next. Nothing pinned the other axis, and on
 * 2026-08-21 the view toggle moved into the filter row
 * (`docs/decisions/2026-08-21-view-toggle-after-the-query-controls.md`) and the
 * row stopped fitting inside the shell it shares with the heading block, the
 * quick-add bar and the Card. It shipped.
 *
 * ## Why the pixel audit did not catch it, and why this file makes two claims
 *
 * The measurement that was run was element boxes at 320, 390, 768 and 1280.
 * Both halves of that missed it:
 *
 * - **The toggle only renders at `lg` and above** (`isWideEnoughForBoard`, i.e.
 *   `(min-width: 1024px) and (pointer: fine)`), so three of those four widths
 *   were measuring a row that does not contain the control that broke it.
 * - **At 1280, every box still agreed.** `main` is `max-w-2xl` and the filter
 *   row is a stretched flex item in a column, so its border box is exactly the
 *   shell's content width at every desktop width — `getBoundingClientRect` on
 *   the row and on its siblings returns the same left and right to the pixel,
 *   with 80px of the row's contents painted outside that box. A box-edge audit
 *   is *structurally incapable* of seeing this fault.
 *
 * So the two claims below are different faults with different fixes and neither
 * subsumes the other:
 *
 * 1. **The children agree on their edges** — the fault where a band escapes the
 *    shell's width, which reads as one section being wider than the page.
 * 2. **No child overflows its own box, and the page does not scroll
 *    sideways** — the fault that actually shipped, where the box is right and
 *    the contents are not.
 *
 * Only the second was red on the unfixed code. The first is here anyway,
 * because it is the fault the screenshot *looked* like and the one a reader
 * measuring this page will reach for first; a file that pinned only what
 * happened to break this time would let the other one through.
 *
 * ## The widths
 *
 * Swept rather than sampled at one point, for the reason above: the filter
 * row's population changes at `lg`, so a single desktop width can only ever be
 * evidence about one side of that boundary. 1023 and 1024 are the pair that
 * brackets it, and the rest span the range where the toggle exists and the
 * shell has stopped growing.
 *
 * `main`'s content width is *constant* across all of these — `max-w-2xl` caps
 * it at 672px including gutters — so a row that overflows at one of them
 * overflows at all of them. That is worth knowing rather than assuming: it
 * means this suite would have caught the defect at any single width ≥ 1024, and
 * the sweep is here to keep that true if the shell ever becomes fluid.
 */

/** Sub-pixel layout, and the fractional widths HeroUI's controls resolve to. */
const EDGE_TOLERANCE = 1;

/**
 * Below `lg` the view toggle does not exist; above it, `main` has stopped
 * growing. Both sides are measured so this file says something about the
 * boundary rather than only about one side of it.
 */
const WIDTHS = [1023, 1024, 1100, 1152, 1200, 1280, 1440] as const;

const VIEWPORT_HEIGHT = 900;

interface ShellChild {
  label: string;
  left: number;
  right: number;
  scrollWidth: number;
  clientWidth: number;
}

/**
 * The shell's top-level children, with the ones that occupy no space dropped —
 * the same rule, and for the same reason, as `page-rhythm.spec.ts`: a zero-box
 * child has no edges to agree about, and a positioned one is not in the
 * column's flow at all.
 */
const shellChildren = async (page: Page): Promise<ShellChild[]> =>
  page.locator("main > *").evaluateAll((elements) =>
    elements
      .map((element) => {
        const rect = element.getBoundingClientRect();
        const { position } = getComputedStyle(element);
        const text = (element.textContent ?? "").replace(/\s+/g, " ").trim();

        return {
          label: `<${element.tagName.toLowerCase()}> ${text.slice(0, 40) || "(no text)"}`,
          left: rect.left,
          right: rect.right,
          width: rect.width,
          height: rect.height,
          scrollWidth: element.scrollWidth,
          clientWidth: element.clientWidth,
          inFlow:
            rect.height > 0 &&
            rect.width > 0 &&
            position !== "fixed" &&
            position !== "absolute",
        };
      })
      .filter((entry) => entry.inFlow)
      .map(({ label, left, right, scrollWidth, clientWidth }) => ({
        label,
        left,
        right,
        scrollWidth,
        clientWidth,
      })),
  );

const pageScroll = async (page: Page) =>
  page.evaluate(() => ({
    bodyScrollWidth: document.body.scrollWidth,
    bodyClientWidth: document.body.clientWidth,
    docScrollWidth: document.documentElement.scrollWidth,
    docClientWidth: document.documentElement.clientWidth,
  }));

test.describe("§2.2 — the shell's children share one pair of edges", () => {
  /**
   * Two todos, because the filter row is gated on `hasTodos` and the row is the
   * subject. One dated and one not is the screenshot's own shape and costs
   * nothing extra; it also means the Card carries two group headings, so a
   * heading escaping the Card's width would be visible to the same measurement.
   */
  const seed = async (page: Page) => {
    const tomorrow = new Date(Date.now() + 86_400_000).toISOString().slice(0, 10);

    for (const data of [
      { title: "a dated todo", note: "", priority: "medium", dueAt: tomorrow },
      { title: "an undated todo", note: "", priority: "high", dueAt: "" },
    ]) {
      const response = await page.request.post("/api/todos", { data });

      expect(response.status()).toBe(201);
    }

    await page.reload();
  };

  test("every top-level child starts and ends where its siblings do, at every desktop width", async ({
    signedIn: page,
    todos,
    isMobile,
  }) => {
    test.skip(isMobile === true, "the sweep is about widths this project does not render");

    await seed(page);
    await expect(todos.row("an undated todo")).toBeVisible();

    for (const width of WIDTHS) {
      await page.setViewportSize({ width, height: VIEWPORT_HEIGHT });
      await expect(
        page.getByRole("radiogroup", { name: STATUS_FILTER_ARIA_LABEL }),
      ).toBeVisible();

      const children = await shellChildren(page);

      expect(
        children.length,
        `at ${width}px the shell rendered ${children.length} children`,
      ).toBeGreaterThanOrEqual(4);

      const [first, ...rest] = children;

      for (const child of rest) {
        expect
          .soft(
            Math.abs(child.left - first.left),
            `at ${width}px, ${child.label} starts at ${child.left.toFixed(2)} and ${first.label} at ${first.left.toFixed(2)}`,
          )
          .toBeLessThanOrEqual(EDGE_TOLERANCE);

        expect
          .soft(
            Math.abs(child.right - first.right),
            `at ${width}px, ${child.label} ends at ${child.right.toFixed(2)} and ${first.label} at ${first.right.toFixed(2)}`,
          )
          .toBeLessThanOrEqual(EDGE_TOLERANCE);
      }
    }
  });

  /**
   * The one that was red.
   *
   * A box whose contents do not fit paints them outside itself, which is what a
   * reader sees as "that row is wider than the page" even though every rect
   * still agrees. `scrollWidth` against `clientWidth` is the only thing that
   * separates the two, and it is what the audit that cleared 1280 was missing.
   *
   * Measured on the unfixed code, at every width from 1024 up: the filter row
   * reported `scrollWidth` 688 against a `clientWidth` of 608 — 80px, which is
   * the view toggle's 111px plus the row's 12px gap, less the 43px the priority
   * select and the search field had left to give.
   */
  test("no child paints outside its own box, and the page never scrolls sideways", async ({
    signedIn: page,
    todos,
    isMobile,
  }) => {
    test.skip(isMobile === true, "the sweep is about widths this project does not render");

    await seed(page);
    await expect(todos.row("an undated todo")).toBeVisible();

    for (const width of WIDTHS) {
      await page.setViewportSize({ width, height: VIEWPORT_HEIGHT });
      await expect(
        page.getByRole("radiogroup", { name: STATUS_FILTER_ARIA_LABEL }),
      ).toBeVisible();

      for (const child of await shellChildren(page)) {
        expect
          .soft(
            child.scrollWidth - child.clientWidth,
            `at ${width}px, ${child.label} holds ${child.scrollWidth}px of contents in a ${child.clientWidth}px box`,
          )
          .toBeLessThanOrEqual(EDGE_TOLERANCE);
      }

      /*
        A separate claim, and deliberately not folded into the loop above. An
        overflowing child and a horizontally scrolling page are different
        faults: this defect produced the first and not the second, because the
        shell is centred with hundreds of pixels of margin either side, so 80px
        of overflow had somewhere to go. Narrow the shell's surroundings and the
        same overflow becomes a page that scrolls — and a fix that only stopped
        the page scrolling would leave the row still spilling.
      */
      const scroll = await pageScroll(page);

      expect
        .soft(
          scroll.bodyScrollWidth - scroll.bodyClientWidth,
          `at ${width}px, <body> scrolls to ${scroll.bodyScrollWidth} in ${scroll.bodyClientWidth}`,
        )
        .toBeLessThanOrEqual(EDGE_TOLERANCE);

      expect
        .soft(
          scroll.docScrollWidth - scroll.docClientWidth,
          `at ${width}px, <html> scrolls to ${scroll.docScrollWidth} in ${scroll.docClientWidth}`,
        )
        .toBeLessThanOrEqual(EDGE_TOLERANCE);
    }
  });
});
