import type { Locator, Page } from "@playwright/test";

import {
  formatRgb,
  measureContrast,
  measurePropertyAgainstBackdrop,
  setTheme,
  THEMES,
  type ContrastReading,
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

/**
 * §8.4.2 — only `High` is loud.
 *
 * `low` and `medium` moved from `variant="soft"` to `variant="tertiary"`, and
 * `medium` lost `color="warning"` with it: `chip--tertiary` sets only
 * `--chip-bg: transparent`, so the colour class still drives `--chip-fg` and a
 * tertiary+warning chip would have been orange text with the fill removed.
 *
 * The chip is where §6.4's priority wording lives, so the label is body text
 * and 4.5:1 binds. A tertiary chip has no fill of its own, which means its
 * label is measured against whatever the row paints — that is the reason to
 * measure rather than to assume the surface is the one the designer's
 * reference reading came from.
 */
test.describe("§8.4.2 — the priority chip label stays readable at every level", () => {
  const seedPriority = async (page: Page, title: string, priority: string) => {
    const response = await page.request.post("/api/todos", {
      data: { title, note: "", priority, dueAt: "" },
    });

    expect(response.status()).toBe(201);
  };

  test("all three levels clear 4.5:1 in both themes", async ({
    signedIn,
    todos,
  }) => {
    await seedPriority(signedIn, "high chip row", "high");
    await seedPriority(signedIn, "medium chip row", "medium");
    await seedPriority(signedIn, "low chip row", "low");
    await signedIn.reload();

    await expect(todos.row("low chip row")).toBeVisible();

    const chipLabel = (title: string) =>
      todos.row(title).locator('[data-slot="chip-label"]');

    for (const theme of THEMES) {
      await setTheme(signedIn, theme);

      for (const title of ["high chip row", "medium chip row", "low chip row"]) {
        await expectReadable(chipLabel(title), `${title} chip label`, theme);
      }
    }
  });

  /*
    The variant itself, pinned. Contrast alone would pass just as happily on
    the column of identical `soft` chips this change exists to break up, so the
    ratio is not the whole claim — the claim is that two of the three no longer
    carry a fill.
  */
  test("low and medium carry no fill, high still does", async ({
    signedIn,
    todos,
  }) => {
    await seedPriority(signedIn, "high chip row", "high");
    await seedPriority(signedIn, "medium chip row", "medium");
    await seedPriority(signedIn, "low chip row", "low");
    await signedIn.reload();

    await expect(todos.row("low chip row")).toBeVisible();

    const chip = (title: string) =>
      todos.row(title).locator('[data-slot="chip"]');

    // `--chip-bg: transparent`, resolved by the browser to `rgba(0, 0, 0, 0)`.
    await expect(chip("low chip row")).toHaveCSS(
      "background-color",
      "rgba(0, 0, 0, 0)",
    );
    await expect(chip("medium chip row")).toHaveCSS(
      "background-color",
      "rgba(0, 0, 0, 0)",
    );
    await expect(chip("high chip row")).not.toHaveCSS(
      "background-color",
      "rgba(0, 0, 0, 0)",
    );
  });
});

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

/**
 * DEF-15 — the muted token.
 *
 * QA measured it at **4.43:1** on the page background in light
 * (`docs/QA-REPORT.md` §A2): 0.07 short of AA, and it fails only *outside* the
 * Card, where the same token reads 4.83:1. Dark passes at 7.72:1.
 *
 * QA re-ranked this above DEF-14 for one reason, recorded in §A6: that token
 * now carries `Press Esc to keep your text exactly as typed.` — the only
 * **visible** statement of the quick-add parser's escape hatch. §7.17 makes
 * "a parse the user cannot see and cannot refuse" the one thing the feature may
 * never ship, and the sentence telling a sighted user how to refuse was the
 * thing below the floor.
 *
 * Every surface the token lands on is measured here, not just the one QA
 * named, because the fix is to the token and a token fix has to hold
 * everywhere. That includes `--surface-hover`, which nobody had measured: a
 * completed row under the pointer is the *tightest* surface of the three, and
 * it was failing at 4.02:1.
 */
test.describe("DEF-15 — the muted token clears 4.5:1 on every surface", () => {
  test("the quick-add chip hint, on the page background", async ({
    signedIn,
    todos,
  }) => {
    // A reading with chips is what puts the hint on screen (§7.17).
    await todos.quickAddInput.fill("pay rent friday high");

    const hint = signedIn.locator(
      '[role="group"][aria-label="Read from your text"] > [aria-hidden="true"]',
    );

    await expect(hint).toBeVisible();

    for (const theme of THEMES) {
      await setTheme(signedIn, theme);
      await expectReadable(hint, "quick-add chip hint (the Esc escape hatch)", theme);
    }
  });

  test("the done counter and the account menu, on the page background", async ({
    signedIn,
    todos,
  }) => {
    await todos.quickAdd("counter contrast row");
    await expect(todos.doneCounter).toBeVisible();

    const accountMenu = signedIn.getByRole("button", { name: "Account menu" });

    for (const theme of THEMES) {
      await setTheme(signedIn, theme);
      await expectReadable(todos.doneCounter, "done counter", theme);
      // Same token, same surface — QA noted it travels with the count.
      await expectReadable(accountMenu, "account menu label", theme);
    }
  });

  test("a completed row's title, on a hovered row", async ({
    signedIn,
    todos,
  }) => {
    await todos.quickAdd("hovered completed row");
    await expect(rowTitle(signedIn, "hovered completed row")).toBeVisible();

    await todos.toggle("hovered completed row", true);
    await expect(
      todos.toastTitles.filter({ hasText: "marked complete" }),
    ).toBeVisible();

    const row = signedIn
      .locator("main")
      .getByRole("listitem")
      .filter({ hasText: "hovered completed row" });

    /*
      `--surface-hover` is the tightest of the three surfaces this token lands
      on, and it is the one a mouse user is looking at while they read a
      completed row. It was never in QA's audit; it measured 4.02:1.
    */
    for (const theme of THEMES) {
      await setTheme(signedIn, theme);
      await row.hover();
      await expectReadable(
        rowTitle(signedIn, "hovered completed row"),
        "completed row title on a hovered row",
        theme,
      );
    }
  });
});

/**
 * DEF-14 — the primary button.
 *
 * `--accent` is rgb(4,133,247) with an `--accent-foreground` of rgb(252,252,252)
 * at 14px/500, which QA measured at **3.59:1 in both themes** across three
 * different buttons on three different routes (`docs/QA-REPORT.md` §A2). 14px
 * at weight 500 is not large text, so 4.5:1 is the right bar.
 *
 * One token, so one fix — and one risk, which is what the rest of this block
 * is for. `--accent` is not only the button fill: `--focus` is aliased to it
 * (§2.1, "do not restyle"), and `--accent-soft-foreground` is mixed from it for
 * the selected filter chip. Darkening it to clear 4.5:1 on white text moves all
 * three, and in **dark** the other two move the wrong way — a darker ring on a
 * near-black page, and a darker chip label. Both are measured here so the fix
 * cannot buy the button at their expense.
 */
test.describe("DEF-14 — the primary button label clears 4.5:1", () => {
  test("the quick-add Add button, in both themes", async ({ signedIn }) => {
    const addButton = signedIn.getByRole("button", { name: "Add", exact: true });

    await expect(addButton).toBeVisible();

    for (const theme of THEMES) {
      await setTheme(signedIn, theme);
      await expectReadable(addButton, "quick-add Add button label", theme);
    }
  });

  test("the same token on an auth route, in both themes", async ({ page }) => {
    // `Create account` is a different route and a different component, and QA
    // confirmed the defect travels with the token rather than with the button.
    await page.goto("/sign-up");

    const submit = page.getByRole("button", { name: "Create account", exact: true });

    await expect(submit).toBeVisible();

    for (const theme of THEMES) {
      await setTheme(page, theme);
      await expectReadable(submit, "Create account button label", theme);
    }
  });

  test("the focus ring and the selected filter chip survive the change", async ({
    signedIn,
    todos,
  }) => {
    await todos.quickAdd("accent regression row");
    await expect(todos.doneCounter).toBeVisible();

    const selectedChip = signedIn.locator('[role="radio"][aria-checked="true"]');
    const addButton = signedIn.getByRole("button", { name: "Add", exact: true });

    await expect(selectedChip).toBeVisible();

    const expectAtLeast = (
      reading: ContrastReading,
      minimum: number,
      label: string,
      theme: Theme,
    ) => {
      expect
        .soft(
          reading.ratio,
          `${label} [${theme}] — ${formatRgb(reading.foreground)} on ${formatRgb(reading.background)}`,
        )
        .toBeGreaterThanOrEqual(minimum);
    };

    for (const theme of THEMES) {
      await setTheme(signedIn, theme);

      // SC 1.4.11, 3:1 — the ring is painted outside the control, so it is
      // judged against what the control sits on.
      expectAtLeast(
        await measurePropertyAgainstBackdrop(addButton, "--focus"),
        3,
        "focus ring against its backdrop",
        theme,
      );

      // SC 1.4.11, 3:1 — the filled button has to be findable as a control.
      expectAtLeast(
        await measurePropertyAgainstBackdrop(addButton, "--accent"),
        3,
        "primary button fill against the page",
        theme,
      );

      // SC 1.4.3, 4.5:1 — `--accent-soft-foreground` is mixed from the accent.
      await expectReadable(selectedChip, "selected status filter label", theme);
    }
  });
});
