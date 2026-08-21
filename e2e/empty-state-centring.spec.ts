import type { Page } from "@playwright/test";

import { EMPTY_STATE_SYNTAX_HINT } from "./support/copy";
import { expect, test } from "./support/fixtures";

/**
 * The empty state is centred — measured on the **text**, not on the boxes
 * around it (`docs/DESIGN.md` §4.7, §7.7).
 *
 * `TodoEmptyState` carried `text-center` on its container and the container's
 * value never reached the copy: `Typography` defaults to `align="start"` and
 * emits `typography--align-start`, which is `text-align: start` **on the `<h4>`
 * and on each `<p>` itself** (`@heroui/styles/dist/components/typography.css`).
 * An inherited value cannot beat a declared one, so this was not a specificity
 * fight and no `!important` would have helped — the child was simply setting
 * its own.
 *
 * It was invisible while every line of copy was one line long. The container is
 * `flex flex-col items-center`, so each child's cross size is shrink-to-fit: a
 * single-line `<p>` is exactly as wide as its own text, and centring *that box*
 * puts the text on the centre line whatever `text-align` says. QA measured the
 * heading at 384.00 against a container centre of 384.00 and correctly called
 * it centred.
 *
 * The teaching line (§7.18) is the first copy in this component that wraps. A
 * wrapped `<p>` is as wide as the space it was given, its lines are laid out
 * from the start edge, and the short second line lands 122.62px left of centre
 * — under an icon, a heading and a button that are all genuinely centred, on
 * the first screen a new account sees.
 *
 * So this measures **line boxes**, one per rendered line, through a `Range`.
 * The element box is the thing that was already right; the line box is the
 * thing that was wrong. A test that read `text-align` instead would assert the
 * declaration rather than the pixels, and a test at a width where the hint fits
 * on one line passes against the broken code.
 */

/**
 * 390px — an iPhone 14/15's CSS width, and the narrowest width the suite
 * measures at. Wide enough that the hint takes two lines rather than four, and
 * narrow enough that it takes more than one. The wrap is the whole point: the
 * assertion below cannot fail on a single line, so the viewport is what makes
 * it discriminate.
 */
const WRAPPING_VIEWPORT = { width: 390, height: 844 };

/**
 * Sub-pixel only. These are meant to be the same centre line, not two centres
 * that happen to land near each other — a real failure here is over a hundred
 * pixels wide, so a loose tolerance would buy nothing and hide the next one.
 */
const CENTRE_TOLERANCE = 1;

interface LineMeasurement {
  /** How a reader would name the thing this line belongs to. */
  owner: string;
  /** Which line of that element, 0-based. */
  index: number;
  centre: number;
  width: number;
  text: string;
}

interface EmptyStateGeometry {
  /** The centre of the container's **content** box, borders and padding removed. */
  centre: number;
  lines: LineMeasurement[];
  /** The icon and the action, which are boxes rather than text. */
  boxes: { owner: string; centre: number }[];
}

/**
 * Every rendered line inside the empty state, with the centre it is measured
 * against.
 *
 * Text nodes are measured with `Range.getClientRects()`, which returns one rect
 * per line box — the only way to see the second line of a wrapped paragraph at
 * all. `element.getBoundingClientRect()` returns the union of those rects and
 * is exactly the measurement that agreed with the broken code.
 */
const measureEmptyState = async (page: Page): Promise<EmptyStateGeometry> =>
  page.evaluate(() => {
    const container = document.querySelector<HTMLElement>(
      '[data-slot="empty-state"]',
    );

    if (container === null) throw new Error("no empty state on the page");

    const style = getComputedStyle(container);
    const box = container.getBoundingClientRect();
    const left =
      box.left +
      parseFloat(style.borderLeftWidth) +
      parseFloat(style.paddingLeft);
    const right =
      box.right -
      parseFloat(style.borderRightWidth) -
      parseFloat(style.paddingRight);

    const nameOf = (element: Element): string => {
      const tag = element.tagName.toLowerCase();
      const type = element.getAttribute("data-type");

      return type === null ? tag : `${tag}[${type}]`;
    };

    const lines: LineMeasurement[] = [];
    const walker = document.createTreeWalker(container, NodeFilter.SHOW_TEXT);

    for (
      let node = walker.nextNode();
      node !== null;
      node = walker.nextNode()
    ) {
      const text = node.textContent ?? "";

      if (text.trim() === "") continue;

      const parent = node.parentElement;

      if (parent === null) continue;

      // Screen-reader-only text is a 1px clip and has no visual centre.
      if (parent.closest(".sr-only") !== null) continue;

      const range = document.createRange();

      range.selectNodeContents(node);

      const rects = Array.from(range.getClientRects()).filter(
        (rect) => rect.width > 0,
      );

      rects.forEach((rect, index) => {
        lines.push({
          owner: nameOf(parent),
          index,
          centre: rect.left + rect.width / 2,
          width: rect.width,
          text: text.trim(),
        });
      });
    }

    const boxes: { owner: string; centre: number }[] = [];

    for (const element of Array.from(
      container.querySelectorAll<HTMLElement>("svg, button"),
    )) {
      const rect = element.getBoundingClientRect();

      boxes.push({
        owner: nameOf(element),
        centre: rect.left + rect.width / 2,
      });
    }

    return { centre: (left + right) / 2, lines, boxes };
  });

test.describe("§4.7 — the empty state is centred, line by line", () => {
  test("every line of copy is centred on the container, with the hint wrapped", async ({
    signedIn: page,
  }) => {
    await page.setViewportSize(WRAPPING_VIEWPORT);
    await page.goto("/todos");

    await expect(page.getByText(EMPTY_STATE_SYNTAX_HINT)).toBeVisible();

    const geometry = await measureEmptyState(page);

    /*
      The precondition, asserted rather than assumed. If the hint stops wrapping
      — a shorter line, a wider viewport, a smaller type step — this file goes
      on passing while measuring nothing, which is the failure mode the whole
      test is built to avoid. So the wrap is a claim of its own.
    */
    const hintLines = geometry.lines.filter((line) =>
      line.text.startsWith(EMPTY_STATE_SYNTAX_HINT.slice(0, 20)),
    );

    expect(
      hintLines.length,
      `the teaching line must wrap at ${WRAPPING_VIEWPORT.width}px for this test to discriminate; it rendered on ${hintLines.length} line(s)`,
    ).toBeGreaterThan(1);

    for (const line of geometry.lines) {
      expect
        .soft(
          Math.abs(line.centre - geometry.centre),
          `${line.owner} “${line.text.slice(0, 28)}…” line ${line.index} (${line.width.toFixed(2)}px wide) sits at ${line.centre.toFixed(2)}, container centre is ${geometry.centre.toFixed(2)}`,
        )
        .toBeLessThanOrEqual(CENTRE_TOLERANCE);
    }
  });

  /**
   * The icon and the action were never the defect — `items-center` centres a
   * flex child's box and always did. They are here because they are what made
   * the misaligned line visible: a second line that is *only* off relative to
   * things that are right. If a fix to the copy centred the text by
   * un-centring these, this is what would catch it.
   */
  test("the icon and the action stay centred with it", async ({
    signedIn: page,
  }) => {
    await page.setViewportSize(WRAPPING_VIEWPORT);
    await page.goto("/todos");

    await expect(page.getByText(EMPTY_STATE_SYNTAX_HINT)).toBeVisible();

    const geometry = await measureEmptyState(page);

    expect(geometry.boxes.length, "an icon and an action are both rendered").toBe(
      2,
    );

    for (const box of geometry.boxes) {
      expect
        .soft(
          Math.abs(box.centre - geometry.centre),
          `${box.owner} sits at ${box.centre.toFixed(2)}, container centre is ${geometry.centre.toFixed(2)}`,
        )
        .toBeLessThanOrEqual(CENTRE_TOLERANCE);
    }
  });

  /**
   * §2.2's spacing hierarchy, stated as a **relationship** rather than as a
   * gap value.
   *
   * The screen shipped with one `gap-3` across five children — icon, heading,
   * body, teaching line, button — which spaces the thing to press exactly as
   * far from the copy as the copy's own lines are from each other. That was
   * survivable while the button carried the accent and separated itself by
   * colour; it stopped being survivable when §1 took the fill away, and the
   * button began reading as a fifth line of copy.
   *
   * Asserting `gap-2` and `gap-4` by name would restate the class list. What
   * this asserts is the thing the classes are for: the copy is evenly spaced,
   * and the action is further out than any of it. Both halves survive a change
   * of step; neither survives a flat stack.
   */
  test("the action is spaced further from the copy than the copy is from itself", async ({
    signedIn: page,
  }) => {
    await page.setViewportSize(WRAPPING_VIEWPORT);
    await page.goto("/todos");

    await expect(page.getByText(EMPTY_STATE_SYNTAX_HINT)).toBeVisible();

    const gaps = await page.evaluate(() => {
      const container = document.querySelector<HTMLElement>(
        '[data-slot="empty-state"]',
      );

      if (container === null) throw new Error("no empty state on the page");

      const action = container.querySelector("button");

      if (action === null) throw new Error("no action in the empty state");

      const blocks = Array.from(container.children).filter(
        (child) => !child.contains(action),
      );

      // Whatever the copy is wrapped in, its own children are the lines the
      // reader sees as a block. Reading the wrapper's children rather than the
      // container's is what makes this independent of how the block is built.
      const copy = blocks.flatMap((block) => Array.from(block.children));
      const between = (a: Element, b: Element) =>
        b.getBoundingClientRect().top - a.getBoundingClientRect().bottom;

      const copyGaps = copy
        .slice(0, -1)
        .map((element, index) => between(element, copy[index + 1]));

      return {
        copyCount: copy.length,
        copyGaps,
        actionGap: between(copy[copy.length - 1], action),
      };
    });

    expect(
      gaps.copyCount,
      "icon, heading, body and teaching line are the copy block",
    ).toBe(4);

    /*
      Evenly spaced inside the block. A hierarchy built by widening one gap
      inside the copy would satisfy the assertion below while making the copy
      itself read as two things.
    */
    for (const [index, gap] of gaps.copyGaps.entries()) {
      expect
        .soft(
          Math.abs(gap - gaps.copyGaps[0]),
          `copy gap ${index} is ${gap.toFixed(2)}px, the first is ${gaps.copyGaps[0].toFixed(2)}px`,
        )
        .toBeLessThanOrEqual(CENTRE_TOLERANCE);
    }

    expect(
      gaps.actionGap,
      `the action sits ${gaps.actionGap.toFixed(2)}px below the copy, which is spaced at ${gaps.copyGaps[0].toFixed(2)}px`,
    ).toBeGreaterThan(Math.max(...gaps.copyGaps));
  });
});
