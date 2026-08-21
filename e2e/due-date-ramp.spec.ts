import type { Locator, Page } from "@playwright/test";

import {
  formatRgb,
  measureContrast,
  setTheme,
  THEMES,
} from "./support/contrast";
import { HEADER_LINE_PATTERN } from "./support/copy";
import { expect, test } from "./support/fixtures";

/**
 * The due-date column has three ordered steps of urgency, and `Today` is the
 * middle one (`docs/DESIGN.md` §7.4, and §8.4.5 in part).
 *
 * §8.4.5 asked for `Today` at `--accent-soft-foreground`. That half is **not**
 * what this file pins and was not taken: a row reading `Today` sits under a
 * section headed `Today`, and on the board inside a column headed `Today`, so
 * an accent would be spent saying what the structure has already said — and §3
 * allows one saturated element at rest, which `/todos` is already over (§8.4).
 *
 * The half that survives is the case where the structure says nothing at all.
 * `TodoGroupedList` renders headings only when `groups.length > 1`, so a
 * brand-new account with one todo due today has **no** `Today` heading: the
 * row's own word is the entire signal, and at `--muted` it was the same ink as
 * `Aug 28`. So `Today` moves to `--foreground`, which is a contrast *gain* and
 * spends nothing from the §3 budget — the identical argument on the identical
 * tokens that `TodoGroupedList`'s own heading comment carries, and that
 * `e2e/a11y-contrast.spec.ts` measured for the section heading.
 *
 * The ramp, in order, none of it colour-only (§6.4 — every step keeps its word,
 * and the overdue step keeps its `⚠` and its visually-hidden `Overdue —`):
 *
 * | Step | Ink |
 * |---|---|
 * | Future / undated | `--muted` |
 * | `Today` | `--foreground` |
 * | Overdue | `--warning-soft-foreground`, plus `⚠` |
 *
 * **`Tomorrow` is deliberately not in it.** `Today` is a word this app has
 * already made structural — the section, the board column, the reschedule
 * menu's first item — and `Tomorrow` is not. Widening the treatment to it would
 * turn one signal into a second tier of muted, so the last test here exists to
 * make that widening go red rather than merely look odd.
 *
 * **Ink is compared as a resolved colour, not as a contrast ratio**, wherever
 * the claim is "these are/are not the same token". Two elements on different
 * surfaces — the Card and the page — produce different ratios from the same
 * token, so a ratio comparison across surfaces would be measuring the backdrop.
 * Ratios are used only where the comparison is on one surface, and as a floor.
 */

const pad = (value: number) => String(value).padStart(2, "0");

/**
 * The wire day (`YYYY-MM-DD`) `offset` days from today in **local** time, for
 * the reason `e2e/grouping.spec.ts` gives: the sections and the row's own label
 * both compare a UTC-midnight `dueAt` against the viewer's calendar day, and CI
 * runs at UTC+14.
 */
const localDay = (offset: number): string => {
  const date = new Date();

  date.setDate(date.getDate() + offset);

  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
};

interface SeedTodo {
  title: string;
  dueAt?: string;
}

const seedTodos = async (page: Page, seeds: SeedTodo[]) => {
  for (const seed of seeds) {
    const response = await page.request.post("/api/todos", {
      data: {
        title: seed.title,
        note: "",
        priority: "medium",
        dueAt: seed.dueAt ?? "",
      },
    });

    expect(response.status()).toBe(201);
  }

  await page.reload();
};

/**
 * The `Typography` **inside** the row's `<time>`, which is where the colour
 * lives. The `<time>` itself carries none and inherits `--foreground`, so
 * measuring the wrapper reports every row's date as foreground and the whole
 * of this file would pass on the unfixed code — the same false reading
 * `a11y-contrast.spec.ts` records having produced once.
 */
const dueDateInk = (row: Locator): Locator => row.locator("time > *");

/** The resolved `color`, e.g. `rgb(9, 9, 11)`. Identity, not a ratio. */
const inkOf = (target: Locator): Promise<string> =>
  target.evaluate((element) => getComputedStyle(element).color);

/** `Your todos` — the page's `--foreground` reference. */
const foregroundReference = (page: Page): Locator =>
  page.getByRole("heading", { level: 1 });

/**
 * The dated header line (§7.19) — the page's `--muted` reference. It is on the
 * page rather than on the Card, which is exactly why this file compares it by
 * resolved colour and never by ratio.
 */
const mutedReference = (page: Page): Locator =>
  page.locator("main").getByText(HEADER_LINE_PATTERN);

test.describe("§8.4.5, in part — `Today` is not the same ink as a date two years out", () => {
  /**
   * The first-todo moment, which is the case the original proposal was pointing
   * at and the only one where nothing else on screen says `Today`.
   *
   * The headings assertion is not scene-setting: with a second section on
   * screen the row's word is a repetition of a heading, and this test would be
   * making a much weaker claim than it says it is.
   */
  test("a lone todo due today carries the whole signal, and is not muted", async ({
    signedIn: page,
    todos,
  }) => {
    await seedTodos(page, [{ title: "the only thing today", dueAt: localDay(0) }]);

    const date = dueDateInk(todos.row("the only thing today"));

    await expect(date).toHaveText("Today");
    await expect(
      page.locator("main").getByRole("heading", { level: 2 }),
      "one section renders no headings, so the row's own word is the only signal",
    ).toHaveCount(0);

    for (const theme of THEMES) {
      await setTheme(page, theme);

      const [dateInk, foreground, muted] = await Promise.all([
        inkOf(date),
        inkOf(foregroundReference(page)),
        inkOf(mutedReference(page)),
      ]);

      expect
        .soft(dateInk, `“Today” [${theme}] is still the muted token ${muted}`)
        .not.toBe(muted);
      expect
        .soft(
          dateInk,
          `“Today” [${theme}] is ${dateInk}, and the page heading is ${foreground}`,
        )
        .toBe(foreground);

      const reading = await measureContrast(date);

      /*
        NFR-06 / SC 1.4.3. Stated as a floor rather than as a comparison
        because on this screen there is no second date to compare against —
        that is the point of the screen. The claim the change rests on, that
        this is a contrast *gain*, is the next test's.
      */
      expect
        .soft(
          reading.ratio,
          `“Today” [${theme}] ${reading.ratio.toFixed(2)}:1 — ${formatRgb(reading.foreground)} on ${formatRgb(reading.background)}`,
        )
        .toBeGreaterThanOrEqual(4.5);
    }
  });

  /**
   * The ramp itself, all three steps on one surface, so the ratios are
   * comparable and the ordering claim is a measurement rather than a reading of
   * the stylesheet.
   */
  test("overdue, today and future are three inks, and today outreads future", async ({
    signedIn: page,
    todos,
  }) => {
    await seedTodos(page, [
      { title: "the overdue one", dueAt: localDay(-3) },
      { title: "the today one", dueAt: localDay(0) },
      { title: "the future one", dueAt: localDay(12) },
    ]);

    const overdue = dueDateInk(todos.row("the overdue one"));
    const today = dueDateInk(todos.row("the today one"));
    const future = dueDateInk(todos.row("the future one"));

    await expect(today).toHaveText("Today");

    for (const theme of THEMES) {
      await setTheme(page, theme);

      const [overdueInk, todayInk, futureInk] = await Promise.all([
        inkOf(overdue),
        inkOf(today),
        inkOf(future),
      ]);

      expect
        .soft(
          new Set([overdueInk, todayInk, futureInk]).size,
          `[${theme}] overdue ${overdueInk}, today ${todayInk}, future ${futureInk}`,
        )
        .toBe(3);

      const [todayReading, futureReading] = await Promise.all([
        measureContrast(today),
        measureContrast(future),
      ]);

      /*
        The same shape as §7.16's heading-against-due-date assertion, and for
        the same reason: a floor alone would pass just as happily on the column
        of identical muted dates this change exists to break up. A whole point
        of ratio, so a token that merely drifted would not satisfy it.
      */
      expect
        .soft(
          todayReading.ratio,
          `[${theme}] “Today” ${todayReading.ratio.toFixed(2)}:1 vs a future date ${futureReading.ratio.toFixed(2)}:1 — ${formatRgb(todayReading.foreground)} on ${formatRgb(todayReading.background)}`,
        )
        .toBeGreaterThan(futureReading.ratio + 1);

      /* The gain claim, stated so it can be false: nothing went down. */
      expect
        .soft(futureReading.ratio, `[${theme}] a future date fell below 4.5:1`)
        .toBeGreaterThanOrEqual(4.5);
    }
  });

  /**
   * The boundary. Both rows are `Upcoming`, so there is one section and no
   * heading, and the two words sit in the same column with nothing between
   * them — which is precisely where widening the treatment to `Tomorrow` would
   * look like a second tier rather than a signal.
   */
  test("`Tomorrow` stays muted, beside a plain date", async ({
    signedIn: page,
    todos,
  }) => {
    await seedTodos(page, [
      { title: "the tomorrow one", dueAt: localDay(1) },
      { title: "the far one", dueAt: localDay(20) },
    ]);

    const tomorrow = dueDateInk(todos.row("the tomorrow one"));
    const far = dueDateInk(todos.row("the far one"));

    await expect(tomorrow).toHaveText("Tomorrow");

    for (const theme of THEMES) {
      await setTheme(page, theme);

      const [tomorrowInk, farInk, muted] = await Promise.all([
        inkOf(tomorrow),
        inkOf(far),
        inkOf(mutedReference(page)),
      ]);

      expect
        .soft(tomorrowInk, `[${theme}] “Tomorrow” is ${tomorrowInk}, a plain date ${farInk}`)
        .toBe(farInk);
      expect
        .soft(tomorrowInk, `[${theme}] “Tomorrow” left the muted token ${muted}`)
        .toBe(muted);
    }
  });
});
