import type { Page } from "@playwright/test";

import {
  HEADER_LINE_PATTERN,
  STATUS_FILTER_ARIA_LABEL,
  VIEW_TOGGLE_ARIA_LABEL,
} from "./support/copy";
import { expect, test } from "./support/fixtures";

/**
 * The `/todos` shell has exactly two vertical steps, and no third
 * (`docs/DESIGN.md` §2.2, §7.19).
 *
 * > 24px between sections, and 4px between the two lines of a titled block.
 * > Nothing in between, and no third step.
 *
 * `TODOS_PAGE_SHELL` is a `gap-6` column and every top-level child is a sibling
 * under it, so the 24 is structural and this file exists to keep it that way:
 * the failure it guards against is not a wrong number typed somewhere but a
 * *fourth step* arriving — a band with its own margin, a wrapper with its own
 * gap, or the §7.19 titled block being un-wrapped in one entry file and not the
 * other, which is the §4.8 swap shift `PAGE_HEADING_BLOCK` was named to
 * prevent.
 *
 * **Measured, and against no written-down count of sections.** QA counted six
 * `gap-6` peers where the shell renders four; a test that pinned a count would
 * have been wrong on the day it was written and would break on every legitimate
 * band added or removed. Every adjacent pair actually on screen is checked, and
 * the only count assertion is a floor — enough sections that the loop is not
 * vacuously empty.
 *
 * The rendered gap is read from the boxes rather than from the class string.
 * A `gap-6` on a flex column that some child has escaped with a margin still
 * reads `gap-6` in the DOM and 32px on screen.
 *
 * ## The header above this shell measures 67px, and it is not a defect
 *
 * Written down here because it is the first surprise anyone measuring the top
 * of this page meets, QA flagged it as unexplained, and it costs a re-measure
 * every time. `TodosHeader`'s inner bar names `h-14` — 56px — and the `<header>`
 * around it measures 67. The 11 is fully accounted for:
 *
 * | Source | px |
 * |---|---|
 * | The inner bar's own `h-14` | 56 |
 * | HeroUI's `.header` base class: `pt-1.5 pb-1` (`node_modules/@heroui/styles/dist/components/header.css`) | 10 |
 * | `TodosHeader`'s `border-b` | 1 |
 * | **Total** | **67** |
 *
 * So the inner bar is exactly the height it says it is, and the element around
 * it is carrying padding from a library class nobody wrote. Nothing here
 * asserts it: `TodosHeader.tsx` is outside `<main>` and outside this file's
 * subject, and pinning another component's height from a rhythm spec would be
 * claiming ownership of a number this file has no argument about.
 *
 * Worth knowing for whoever does own it: the same `.header` class also applies
 * `px-2 text-xs font-medium text-muted`, all four of which `TodosHeader`'s
 * inner bar happens to override or not inherit. The padding is the one that
 * got through.
 */

/** §2.2's section step, in px, and the tolerance sub-pixel layout needs. */
const SECTION_GAP = 24;
const GAP_TOLERANCE = 1;

/**
 * The titled block's inner step is asserted as a *fraction* of the section
 * step rather than as `4 ± 1`. The rule is that the two lines read as one
 * statement, and what makes them read that way is being an order of magnitude
 * inside the distance between sections — not the specific 4. A quarter is the
 * loosest reading that still excludes every §2.2 step above `gap-1`.
 */
const TITLED_BLOCK_MAX_GAP = SECTION_GAP / 4;

interface ShellSection {
  label: string;
  top: number;
  bottom: number;
}

/**
 * The shell's top-level children, in painted order, with the ones that occupy
 * no space in the column dropped.
 *
 * Dropped deliberately, and both kinds: a zero-box child contributes no gap of
 * its own, and a positioned child (a portalled overlay that happens to land
 * here) is not in the column's flow at all, so measuring either would invent a
 * gap the reader never sees.
 */
const shellSections = async (page: Page): Promise<ShellSection[]> =>
  page.locator("main > *").evaluateAll((elements) =>
    elements
      .map((element) => {
        const rect = element.getBoundingClientRect();
        const { position } = getComputedStyle(element);
        const text = (element.textContent ?? "").replace(/\s+/g, " ").trim();

        return {
          label: `<${element.tagName.toLowerCase()}> ${text.slice(0, 40) || "(no text)"}`,
          top: rect.top,
          bottom: rect.bottom,
          inFlow:
            rect.height > 0 &&
            rect.width > 0 &&
            position !== "fixed" &&
            position !== "absolute",
        };
      })
      .filter((entry) => entry.inFlow)
      .map(({ label, top, bottom }) => ({ label, top, bottom })),
  );

test.describe("§2.2 — the page shell has two steps and no third", () => {
  /**
   * Seeded so the shell is at its fullest: `hasTodos` gates the filter row, and
   * the row is where the third and fourth bands would be if they existed.
   */
  const seed = async (page: Page) => {
    const response = await page.request.post("/api/todos", {
      data: { title: "something to fill the shell", note: "", priority: "medium", dueAt: "" },
    });

    expect(response.status()).toBe(201);

    await page.reload();
  };

  test("every gap between adjacent sections is 24px", async ({
    signedIn: page,
    todos,
  }) => {
    await seed(page);
    await expect(todos.row("something to fill the shell")).toBeVisible();

    const sections = await shellSections(page);

    expect(
      sections.length,
      `the shell rendered ${sections.length} sections: ${sections.map((section) => section.label).join(" | ")}`,
    ).toBeGreaterThanOrEqual(4);

    for (let index = 1; index < sections.length; index += 1) {
      const previous = sections[index - 1];
      const current = sections[index];
      const gap = current.top - previous.bottom;

      expect
        .soft(
          Math.abs(gap - SECTION_GAP),
          `${previous.label} → ${current.label} is ${gap.toFixed(2)}px, not ${SECTION_GAP}`,
        )
        .toBeLessThanOrEqual(GAP_TOLERANCE);
    }
  });

  /**
   * The other step, and the one that is easy to lose. `Your todos` and
   * `Wednesday, 20 August · 3 due today` were two direct children of the shell
   * once, which put §2.2's 24 between them and made the page read as four peers
   * instead of a titled block followed by three sections (§7.19).
   *
   * **Both halves are named, and both are load-bearing.** The first draft of
   * this test walked from the `<h1>` up to its shell section and measured that
   * section's first two children — and un-wrapping `PAGE_HEADING_BLOCK`
   * survived it, because the section then became the heading *row*, whose two
   * children are the heading and the `N of M done` counter sitting *beside* it
   * on a baseline. Their vertical gap is negative, which is comfortably under
   * any ceiling. The test was passing on the geometry of the wrong pair.
   *
   * So the two elements are located by what they are — the page's `<h1>` and
   * §7.19's dated line — and the claim is that they are one block: the same
   * shell section, 4px apart. Neither assertion alone survives the un-wrap.
   */
  test("the heading and its dated line are one block, an order of magnitude closer than a section step", async ({
    signedIn: page,
    todos,
  }) => {
    await seed(page);
    await expect(todos.row("something to fill the shell")).toBeVisible();

    const heading = page.locator("main").getByRole("heading", { level: 1 });
    const datedLine = page.locator("main").getByText(HEADER_LINE_PATTERN);

    await expect(heading).toBeVisible();
    await expect(datedLine).toBeVisible();

    const sameSection = await page.evaluate(() => {
      const main = document.querySelector("main");

      if (main === null) throw new Error("no <main> on the page");

      const sectionOf = (element: Element | null) => {
        if (element === null) return null;

        let node: Element | null = element;

        while (node !== null && node.parentElement !== main) {
          node = node.parentElement;
        }

        return node;
      };

      const h1 = main.querySelector("h1");
      const line = Array.from(main.querySelectorAll("p, span, div")).find(
        (element) =>
          element.children.length === 0 &&
          /^\w+day, \d{1,2} [A-Z][a-z]+/.test((element.textContent ?? "").trim()),
      );

      if (h1 === null || line === undefined) return null;

      return sectionOf(h1) === sectionOf(line);
    });

    expect(
      sameSection,
      "the heading and the dated line are not in one shell section — §7.19's wrapper is gone, so §2.2's 24px is between them",
    ).toBe(true);

    const [headingBox, lineBox] = await Promise.all([
      heading.boundingBox(),
      datedLine.boundingBox(),
    ]);

    if (headingBox === null || lineBox === null) {
      throw new Error("an element that is visible has no box");
    }

    const gap = lineBox.y - (headingBox.y + headingBox.height);

    expect(
      gap,
      `the heading's baseline block ends at ${(headingBox.y + headingBox.height).toFixed(2)} and the dated line starts at ${lineBox.y.toFixed(2)} — ${gap.toFixed(2)}px`,
    ).toBeLessThan(TITLED_BLOCK_MAX_GAP);
  });
});

/**
 * §4.11 — the view toggle is a control in the filter row, not a band.
 *
 * The spec says "a `ToggleButtonGroup` above the list, matching the status
 * filter beside it", and its accent note says "a second `ToggleButtonGroup`
 * beside the status filter". It shipped above the filter row and alone,
 * right-aligned on a band of its own — which cost 60px of chrome above the fold
 * and left two right-aligned controls stacked with nothing to their left.
 *
 * It also doubled a jump. On the first todo `hasTodos` flips and the filter row
 * appears; on desktop the toggle appeared too, so the Card dropped ~120px in one
 * frame rather than ~60. The jump itself is **accepted, not fixed** — a
 * threshold is not available, because `result.totalCount` is account-wide rather
 * than filtered, so any threshold above 1 produces a state where the URL is
 * filtering and the control that says so is off screen. One band instead of two
 * is the half of it that is free.
 *
 * **Both are gated on `hasTodos` and both take `LABELLED_CONTROL_SIZING`**, so
 * this move is composition only: nothing changes about when either appears or
 * how tall it is.
 */
test.describe("§4.11 — the view toggle sits in the filter row", () => {
  const seed = async (page: Page) => {
    const response = await page.request.post("/api/todos", {
      data: { title: "a todo worth two views", note: "", priority: "medium", dueAt: "" },
    });

    expect(response.status()).toBe(201);

    await page.reload();
  };

  test("the toggle and the status filter are one band, not two", async ({
    signedIn: page,
    todos,
    isMobile,
  }) => {
    test.skip(isMobile === true, "the toggle is not offered below the board's breakpoint");

    await seed(page);
    await expect(todos.row("a todo worth two views")).toBeVisible();

    const statusFilter = page.getByRole("radiogroup", {
      name: STATUS_FILTER_ARIA_LABEL,
    });
    const viewToggle = page.getByRole("radiogroup", {
      name: VIEW_TOGGLE_ARIA_LABEL,
    });

    await expect(statusFilter).toBeVisible();
    await expect(viewToggle).toBeVisible();

    /*
      The claim is structural — the same shell section — not merely "they look
      level". Two bands can be made to look level by accident; only one of them
      is one band. The section is found by walking up to the shell's own child,
      which is what §2.2's `gap-6` is applied to.
    */
    const bands = await page.evaluate(
      ([statusLabel, viewLabel]) => {
        const main = document.querySelector("main");

        if (main === null) throw new Error("no <main> on the page");

        const bandOf = (label: string) => {
          const control = main.querySelector(`[role="radiogroup"][aria-label="${label}"]`);

          if (control === null) throw new Error(`no radiogroup labelled ${label}`);

          let node: Element | null = control;

          while (node !== null && node.parentElement !== main) {
            node = node.parentElement;
          }

          if (node === null) throw new Error(`${label} is not inside the shell`);

          return node;
        };

        return { sameBand: bandOf(statusLabel) === bandOf(viewLabel) };
      },
      [STATUS_FILTER_ARIA_LABEL, VIEW_TOGGLE_ARIA_LABEL] as const,
    );

    expect(
      bands.sameBand,
      "the view toggle is on a shell band of its own, above the filter row",
    ).toBe(true);

    const [statusBox, viewBox] = await Promise.all([
      statusFilter.boundingBox(),
      viewToggle.boundingBox(),
    ]);

    if (statusBox === null || viewBox === null) {
      throw new Error("a control that is visible has no box");
    }

    /*
      "Matching the status filter beside it" (§4.11) — the same **height**, from
      the same `LABELLED_CONTROL_SIZING` step on both.

      Height, not centre. The first draft compared centres and a mutation walked
      straight through it: the row is `sm:items-center`, so two controls of
      wildly different heights are centred on each other anyway and their
      centres agree to the pixel. Alignment is what the row does for free;
      matching size is the thing the two constants are actually promising, and
      it is what makes the pair read as one control rather than as a control and
      a smaller thing beside it.
    */
    expect(
      viewBox.height,
      `the status filter is ${statusBox.height.toFixed(2)}px tall, the view toggle ${viewBox.height.toFixed(2)}px`,
    ).toBeCloseTo(statusBox.height, 0);

    const statusCentre = statusBox.y + statusBox.height / 2;
    const viewCentre = viewBox.y + viewBox.height / 2;

    expect(
      Math.abs(statusCentre - viewCentre),
      `the status filter's centre is at ${statusCentre.toFixed(2)}, the view toggle's at ${viewCentre.toFixed(2)}`,
    ).toBeLessThanOrEqual(1);

    /* At the end of the row: nothing in the row starts to its right. */
    expect(
      viewBox.x,
      `the view toggle starts at ${viewBox.x.toFixed(2)}, the status filter at ${statusBox.x.toFixed(2)}`,
    ).toBeGreaterThan(statusBox.x);
  });
});
