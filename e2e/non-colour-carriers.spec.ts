import type { Locator, Page } from "@playwright/test";

import { expectWording } from "./support/assertions";
import {
  MEDIUM_PRIORITY_ANNOUNCEMENT,
  OVERDUE_ANNOUNCEMENT,
  OVERDUE_GLYPH,
  PRIORITY_GLYPH_WORDS,
  PRIORITY_PREFIX,
  PRIORITY_WORDS,
  headerDate,
  HEADER_LINE_PATTERN,
} from "./support/copy";
import { expect, test } from "./support/fixtures";

/**
 * §6.4, asserted as a claim about **words** rather than about ink.
 *
 * `due-date-ramp.spec.ts` and `a11y-contrast.spec.ts` between them measure
 * every colour on these elements, and the e2e mutation audit still walked four
 * mutations straight through them:
 *
 * | | mutation | survived |
 * |---|---|---|
 * | `P1` | the chip's visible word moved into `sr-only` | 104 tests |
 * | `B3` | `aria-hidden` on the `Priority: Medium` announcement | 51 tests |
 * | `D1` | the visually-hidden `Overdue — ` gutted | 57 tests |
 * | `D3` | the `⚠` deleted | 50 tests |
 *
 * One cause, so one file. Every one of those mutations leaves `textContent`
 * byte-identical and leaves every resolved colour identical, so `toContainText`,
 * `getByText`, `toHaveText` and every contrast reading in the suite are blind to
 * all four by construction. What they change is *who the word is for* — and
 * that is three properties, not one: in the DOM, occupying layout, reaching the
 * accessibility tree. `expectWording` in `support/assertions.ts` is where they
 * are pulled apart, and the docblock there records the two measurements that
 * decide how (a `Range` cannot see `sr-only`; an aria snapshot can see
 * `aria-hidden`).
 *
 * **This file asserts no colour at all, deliberately.** The ink is already
 * pinned, twice over, in the two files named above. Restating it here would
 * make this file pass for a reason that has nothing to do with what it claims,
 * which is the failure mode the whole audit is about.
 */

const pad = (value: number) => String(value).padStart(2, "0");

/**
 * The wire day (`YYYY-MM-DD`) `offset` days from today in **local** time.
 * Copied from `due-date-ramp.spec.ts` for its reason: the row's own label
 * compares a UTC-midnight `dueAt` against the viewer's calendar day, and CI
 * runs at UTC+14, where the two calendars differ.
 */
const localDay = (offset: number): string => {
  const date = new Date();

  date.setDate(date.getDate() + offset);

  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
};

interface SeedTodo {
  title: string;
  priority?: string;
  dueAt?: string;
}

const seedTodos = async (page: Page, seeds: SeedTodo[]) => {
  for (const seed of seeds) {
    const response = await page.request.post("/api/todos", {
      data: {
        title: seed.title,
        note: "",
        priority: seed.priority ?? "medium",
        dueAt: seed.dueAt ?? "",
      },
    });

    expect(response.status()).toBe(201);
  }

  await page.reload();
};

/**
 * The chip's label, which is the smallest element holding the whole
 * announcement — the glyph, the `sr-only` prefix and the level word.
 *
 * Scoped this tightly on purpose. `expectWording` reads the accessibility tree
 * through an aria snapshot of the element it is given, and a row's snapshot
 * carries the accessible names of its four buttons; a level word left in one of
 * those could answer for a level word deleted from the chip.
 */
const chipLabel = (row: Locator): Locator =>
  row.locator('[data-slot="chip-label"]');

/** The row's `<time>`, which holds the whole of the overdue treatment. */
const dueDate = (row: Locator): Locator => row.locator("time");

test.describe("§6.4 — a priority level is a word, and the word is on screen", () => {
  /**
   * `P1`, which is the survivor that would have cost the most: it moved the
   * chip's visible label into `sr-only`, so every `High` and `Low` row rendered
   * a coloured pill with a shape glyph and no readable word — colour and shape
   * as the only carriers, which is precisely what §6.4 and WCAG SC 1.4.1
   * forbid. It survived 104 tests across six files.
   *
   * The word has to *paint*. That is the assertion nothing in the suite made:
   * `a11y-contrast.spec.ts` measures the chip label's box, but only to prove the
   * `sr-only` announcement takes **no** room. Nothing asserted that the word
   * takes **some**.
   */
  for (const level of ["high", "low"] as const) {
    test(`${PRIORITY_WORDS[level]} draws its word, not only its colour and its glyph`, async ({
      signedIn,
      todos,
    }) => {
      const title = `${level} level row`;

      await seedTodos(signedIn, [{ title, priority: level }]);
      await expect(todos.row(title)).toBeVisible();

      const label = chipLabel(todos.row(title));

      await expectWording(
        label,
        PRIORITY_WORDS[level],
        "visible",
        `the ${level} chip's level word`,
      );
    });
  }

  /**
   * The other half of the same chip, and the half that must NOT paint — so that
   * the test above cannot be satisfied by making everything visible. The
   * prefix exists to turn a bare `High` into `Priority: High` for a screen
   * reader without adding a word to the row's ink or a `gap-2` step to the
   * metadata cluster, which is the §1 reflow promise `row-layout.spec.ts`
   * measures.
   */
  test("the announcement's prefix is announced without being drawn", async ({
    signedIn,
    todos,
  }) => {
    const title = "high level row";

    await seedTodos(signedIn, [{ title, priority: "high" }]);
    await expect(todos.row(title)).toBeVisible();

    await expectWording(
      chipLabel(todos.row(title)),
      PRIORITY_PREFIX,
      "screen-reader-only",
      "the chip's `Priority: ` prefix",
    );
  });

  /**
   * The glyph is the third state, and it is the one the brief did not ask for.
   * §6.4 wants the shape *beside* the word, in ink — and it is `aria-hidden`
   * because a screen reader that read it would announce the level twice. So it
   * must paint and must not be announced, which is neither "visible to
   * everyone" nor "for screen readers only".
   *
   * Worth pinning in both directions: dropping the `aria-hidden` is a real
   * regression that no box measurement and no contrast reading can see.
   */
  for (const level of ["high", "low"] as const) {
    test(`the ${level} shape glyph is drawn beside the word and never read out twice`, async ({
      signedIn,
      todos,
    }) => {
      const title = `${level} level row`;

      await seedTodos(signedIn, [{ title, priority: level }]);
      await expect(todos.row(title)).toBeVisible();

      await expectWording(
        chipLabel(todos.row(title)),
        PRIORITY_GLYPH_WORDS[level],
        "decorative",
        `the ${level} chip's shape glyph`,
      );
    });
  }

  /**
   * `B3`. `medium` is the schema default, so this is *most rows*: the level
   * draws no chip at all, and the announcement is the entire signal. Adding
   * `aria-hidden="true"` to it leaves the class, leaves the 1px box, leaves the
   * DOM text — and a screen-reader user hears nothing, which the chip's own
   * docblock identifies as indistinguishable from a render failure. It survived
   * 51 tests.
   *
   * `a11y-contrast.spec.ts` came closest and says why it could not close it: it
   * asserts the wording with `toContainText` **and** measures that the element
   * carrying it has no box. Both halves pass under `aria-hidden`. The pair
   * covers "is it in the DOM" and "does it take room"; neither is "does it
   * reach the accessibility tree".
   */
  test("the untriaged level is still announced, though nothing is drawn for it", async ({
    signedIn,
    todos,
  }) => {
    const title = "untriaged row";

    await seedTodos(signedIn, [{ title, priority: "medium" }]);
    await expect(todos.row(title)).toBeVisible();

    await expectWording(
      todos.row(title),
      MEDIUM_PRIORITY_ANNOUNCEMENT,
      "screen-reader-only",
      "the untriaged row's priority announcement",
    );
  });
});

test.describe("§6.4 — the overdue step keeps its word and its glyph", () => {
  /**
   * `D1` and `D3`, which are one cause: together they are the entire non-colour
   * half of the overdue step, and the suite asserted neither.
   *
   * `due-date-ramp.spec.ts`'s own header claims the ramp is *"none of it
   * colour-only (§6.4 — every step keeps its word, and the overdue step keeps
   * its `⚠` and its visually-hidden `Overdue —`)"*. That sentence was asserted
   * nowhere: the file measures resolved colour and contrast ratios exclusively,
   * so it is a test of the ink and the ink is untouched by either mutation.
   *
   * The only mention of the prefix anywhere in the suite was
   * `grouping.spec.ts:330`, and it is **negative** — `not.toContainText`
   * on a *completed* row, which deletion satisfies. These are its missing
   * positive counterpart.
   */
  const OVERDUE_ROW = "overdue chore";

  test("an overdue row says so for a screen reader, in words", async ({
    signedIn,
    todos,
  }) => {
    await seedTodos(signedIn, [{ title: OVERDUE_ROW, dueAt: localDay(-3) }]);
    await expect(todos.row(OVERDUE_ROW)).toBeVisible();

    await expectWording(
      dueDate(todos.row(OVERDUE_ROW)),
      OVERDUE_ANNOUNCEMENT,
      "screen-reader-only",
      "the overdue row's announcement",
    );
  });

  test("an overdue row shows the warning glyph, and does not announce it twice", async ({
    signedIn,
    todos,
  }) => {
    await seedTodos(signedIn, [{ title: OVERDUE_ROW, dueAt: localDay(-3) }]);
    await expect(todos.row(OVERDUE_ROW)).toBeVisible();

    await expectWording(
      dueDate(todos.row(OVERDUE_ROW)),
      OVERDUE_GLYPH,
      "decorative",
      "the overdue row's `⚠`",
    );
  });
});

/**
 * `H4` is not a survivor — it was killed. It is here because of *what* killed
 * it: making the dated header line `sr-only`, text unchanged, went red in
 * exactly one test, `list-header.spec.ts:348`, which is the §7.19 **geometry**
 * test that measures the gap between the line and the heading below it. All
 * **eleven** tests in that file's `the dated header line` block passed, because
 * every one of them reads the line through
 * `page.locator("main").getByText(HEADER_LINE_PATTERN)` and `toHaveText`.
 *
 * So the suite's only tripwire on this line being on screen was written to
 * measure something else, and it will stop being a tripwire the moment the
 * spacing rule it actually tests changes. `board.spec.ts:613` records the same
 * accidental-tripwire pattern having already been lost once.
 *
 * One assertion, in the file about words rather than in the file about spacing.
 */
test.describe("§7.19 — the dated header line is on screen, not merely in the DOM", () => {
  test("the date is drawn for everyone, on an account with nothing in it", async ({
    signedIn: page,
  }) => {
    const line = page.locator("main").getByText(HEADER_LINE_PATTERN);

    await expect(line).toHaveText(headerDate());

    await expectWording(line, headerDate(), "visible", "the dated header line");
  });
});
