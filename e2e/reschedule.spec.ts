import type { Locator, Page } from "@playwright/test";

import {
  CLEAR_DUE_DATE_ITEM_LABEL,
  EDIT_MODAL_HEADING,
  NEXT_WEEK_ITEM_LABEL,
  PICK_A_DATE_ITEM_LABEL,
  TODAY_ITEM_LABEL,
  TOMORROW_ITEM_LABEL,
  dueClearedToast,
  dueToast,
  rescheduleLabel,
  undoActionLabel,
} from "./support/copy";
import { expect, test } from "./support/fixtures";

/**
 * Reschedule from the row (`docs/PM-PROPOSAL.md` §3 #5, `docs/PRD.md` US-13).
 *
 * Three things are being proved here that no unit test can reach:
 *
 *  - the dates the menu writes are the *viewer's* days, read back off the row
 *    by the same code that renders every other due date;
 *  - the whole journey works from the keyboard, including where focus ends up
 *    after the row has been rebuilt in another section;
 *  - three 44×44 targets and a title still fit in 320px without a scrollbar.
 */

/** `MMM D`, the row's own format for a date that is neither today nor tomorrow. */
const monthDayLabel = (date: Date) =>
  date.toLocaleDateString("en-US", { month: "short", day: "numeric" });

const daysFromToday = (days: number) => {
  const target = new Date();

  target.setDate(target.getDate() + days);

  return target;
};

/** The row's `<time>` element, or nothing when the todo has no due date. */
const rowDate = (row: Locator) => row.locator("time");

const boxOf = async (locator: Locator) => {
  const box = await locator.boundingBox();

  if (box === null) throw new Error("control is not rendered");

  return box;
};

test.describe("the quick days write the viewer's own day", () => {
  test("Today, Tomorrow and Next week each land on the day they name", async ({
    todos,
  }) => {
    await todos.quickAdd("water the plants");
    await expect(todos.row("water the plants")).toBeVisible();

    await todos.reschedule("water the plants", TODAY_ITEM_LABEL);
    await expect(rowDate(todos.row("water the plants"))).toHaveText("Today");

    await todos.reschedule("water the plants", TOMORROW_ITEM_LABEL);
    await expect(rowDate(todos.row("water the plants"))).toHaveText("Tomorrow");

    /*
      Seven days on, in the row's own words. Computed from the browser's clock
      rather than hard-coded, because that clock is the only authority on what
      "next week" means (`docs/PRD.md` §2, *user's today*) — and comparing the
      row against a second, independent reading of it is what makes this a test
      of the reconciliation rather than a restatement of the implementation.
    */
    await todos.reschedule("water the plants", NEXT_WEEK_ITEM_LABEL);
    await expect(rowDate(todos.row("water the plants"))).toHaveText(
      monthDayLabel(daysFromToday(7)),
    );
  });

  test("the menu shows the date each option resolves to before it is pressed", async ({
    todos,
  }) => {
    await todos.quickAdd("book the dentist");
    await todos.openReschedule("book the dentist");

    const menu = todos.rescheduleMenu("book the dentist");

    await expect(
      menu.getByRole("menuitem", { name: NEXT_WEEK_ITEM_LABEL }),
    ).toContainText(monthDayLabel(daysFromToday(7)));
    await expect(
      menu.getByRole("menuitem", { name: TOMORROW_ITEM_LABEL }),
    ).toContainText(monthDayLabel(daysFromToday(1)));

    /*
      And the *name* carries both halves, not just the date. HeroUI's
      `Typography` claims react-aria's label slot, so rendering the preview
      through it silently made `Aug 26` the item's entire accessible name —
      announcing a date to a screen-reader user with no word saying what
      pressing it would do. Asserted exactly, because a substring match is what
      hid it.
    */
    await expect(
      menu.getByRole("menuitem", {
        name: `${NEXT_WEEK_ITEM_LABEL} ${monthDayLabel(daysFromToday(7))}`,
        exact: true,
      }),
    ).toBeVisible();
  });

  test("a rescheduled todo keeps its date after a reload", async ({
    signedIn,
    todos,
  }) => {
    await todos.quickAdd("renew the passport");
    await todos.reschedule("renew the passport", TOMORROW_ITEM_LABEL);
    await expect(rowDate(todos.row("renew the passport"))).toHaveText("Tomorrow");

    await signedIn.reload();

    await expect(rowDate(todos.row("renew the passport"))).toHaveText("Tomorrow");
  });

  test("Clear due date removes it, and is unavailable when there is none", async ({
    todos,
  }) => {
    await todos.quickAdd("sort the recycling");
    await todos.openReschedule("sort the recycling");

    // Nothing to clear yet, so the item is present but unavailable rather than
    // missing — the menu keeps the same shape on every row.
    await expect(
      todos
        .rescheduleMenu("sort the recycling")
        .getByRole("menuitem", { name: CLEAR_DUE_DATE_ITEM_LABEL }),
    ).toBeDisabled();

    await todos.rescheduleMenu("sort the recycling").press("Escape");

    await todos.reschedule("sort the recycling", TOMORROW_ITEM_LABEL);
    await expect(rowDate(todos.row("sort the recycling"))).toHaveText("Tomorrow");

    await todos.reschedule("sort the recycling", CLEAR_DUE_DATE_ITEM_LABEL);
    await expect(rowDate(todos.row("sort the recycling"))).toHaveCount(0);
  });

  test("Pick a date… opens the existing edit modal rather than a second picker", async ({
    signedIn,
    todos,
  }) => {
    await todos.quickAdd("choose a holiday");
    await todos.reschedule("choose a holiday", PICK_A_DATE_ITEM_LABEL);

    await expect(
      signedIn.getByRole("heading", { name: EDIT_MODAL_HEADING }),
    ).toBeVisible();
  });
});

/**
 * The reversal. A due date is trivially reversible, so it fires immediately and
 * offers Undo rather than asking first (`docs/CONVENTIONS.md` → Mutation UX).
 */
test.describe("the toast reverses exactly what the press changed", () => {
  test("Undo restores the date the row held before, not the absence of one", async ({
    todos,
  }) => {
    await todos.quickAdd("call the plumber");

    // Two writes, so a wrong Undo has two wrong answers to choose between —
    // `null`, and a date recomputed from today rather than read from the row.
    await todos.reschedule("call the plumber", TOMORROW_ITEM_LABEL);
    await expect(rowDate(todos.row("call the plumber"))).toHaveText("Tomorrow");

    await todos.reschedule("call the plumber", NEXT_WEEK_ITEM_LABEL);
    await expect(rowDate(todos.row("call the plumber"))).toHaveText(
      monthDayLabel(daysFromToday(7)),
    );

    await todos.pressUndo();

    await expect(rowDate(todos.row("call the plumber"))).toHaveText("Tomorrow");
  });

  test("Undo of a first reschedule puts the todo back to having no date", async ({
    todos,
  }) => {
    await todos.quickAdd("tidy the loft");

    await todos.reschedule("tidy the loft", TODAY_ITEM_LABEL);
    await expect(rowDate(todos.row("tidy the loft"))).toHaveText("Today");

    await todos.pressUndo();

    await expect(rowDate(todos.row("tidy the loft"))).toHaveCount(0);
  });

  test("Undo of a clear puts the date back", async ({ todos }) => {
    await todos.quickAdd("service the bike");

    await todos.reschedule("service the bike", TOMORROW_ITEM_LABEL);
    await todos.reschedule("service the bike", CLEAR_DUE_DATE_ITEM_LABEL);
    await expect(rowDate(todos.row("service the bike"))).toHaveCount(0);

    await todos.pressUndo();

    await expect(rowDate(todos.row("service the bike"))).toHaveText("Tomorrow");
  });

  test("the toast names the todo and the day, and its Undo names the toast", async ({
    todos,
  }) => {
    await todos.quickAdd("pay the invoice");
    await todos.reschedule("pay the invoice", TOMORROW_ITEM_LABEL);

    const message = dueToast("pay the invoice", "Tomorrow");

    await expect(todos.toastTitles.filter({ hasText: message })).toBeVisible();
    /*
      Every Undo in the stack reads `Undo`, and the stack is the ordinary case
      at a 12s window — the name is the only thing separating a date revert from
      a completion revert for a screen-reader user (§7.13, §7.19).
    */
    await expect(
      todos.undoButton.and(
        todos.undoButton.page().getByLabel(undoActionLabel(message)),
      ),
    ).toBeVisible();
  });

  test("clearing reports it in its own words rather than as a date", async ({
    todos,
  }) => {
    await todos.quickAdd("cancel the subscription");

    await todos.reschedule("cancel the subscription", TOMORROW_ITEM_LABEL);
    await todos.reschedule("cancel the subscription", CLEAR_DUE_DATE_ITEM_LABEL);

    await expect(
      todos.toastTitles.filter({
        hasText: dueClearedToast("cancel the subscription"),
      }),
    ).toBeVisible();
  });
});

test.describe("keyboard operation, end to end", () => {
  test("the menu opens, moves and commits from the keyboard alone", async ({
    signedIn,
    todos,
  }) => {
    await todos.quickAdd("post the letters");
    await expect(todos.row("post the letters")).toBeVisible();

    await todos.rescheduleButton("post the letters").focus();
    await signedIn.keyboard.press("Enter");

    const menu = todos.rescheduleMenu("post the letters");

    await expect(menu).toBeVisible();

    // `Enter` on the trigger opens the menu with the first item — `Today` —
    // already focused, so one press down is `Tomorrow`.
    await signedIn.keyboard.press("ArrowDown");
    await signedIn.keyboard.press("Enter");

    await expect(rowDate(todos.row("post the letters"))).toHaveText("Tomorrow");
  });

  test("Escape closes the menu without changing anything", async ({
    signedIn,
    todos,
  }) => {
    await todos.quickAdd("water the fern");

    await todos.rescheduleButton("water the fern").focus();
    await signedIn.keyboard.press("Enter");
    await expect(todos.rescheduleMenu("water the fern")).toBeVisible();

    await signedIn.keyboard.press("Escape");

    await expect(todos.rescheduleMenu("water the fern")).toHaveCount(0);
    await expect(rowDate(todos.row("water the fern"))).toHaveCount(0);
    await expect(todos.rescheduleButton("water the fern")).toBeFocused();
  });

  /**
   * The focus decision, and the one this feature could most easily have got
   * wrong (`src/lib/rowFocus.ts` → `restoreRescheduleFocus`).
   *
   * Rescheduling the second of two todos moves it into a different section, so
   * the list re-sections and React rebuilds the row — destroying the trigger
   * the user is standing on. Focus is put back on the rebuilt trigger rather
   * than redirected into the toast: the row is still on screen and still
   * theirs, so there is nothing to rescue them from.
   */
  test("focus returns to the row's own trigger after the row moves section", async ({
    signedIn,
    todos,
  }) => {
    await todos.quickAdd("first thing");
    // The bar clears itself on the refetch that follows a capture, so the next
    // `fill` has to wait for that to land or it is wiped before `Enter`.
    await expect(todos.row("first thing")).toBeVisible();
    await todos.quickAdd("second thing");
    await expect(todos.row("second thing")).toBeVisible();
    // One todo dated, so the list has two sections and rescheduling the other
    // genuinely moves it between them.
    await todos.reschedule("first thing", NEXT_WEEK_ITEM_LABEL);

    await todos.rescheduleButton("second thing").focus();
    await signedIn.keyboard.press("Enter");
    await expect(todos.rescheduleMenu("second thing")).toBeVisible();
    // `Today` is already focused; commit it.
    await signedIn.keyboard.press("Enter");

    await expect(rowDate(todos.row("second thing"))).toHaveText("Today");
    // The row moved out of `No date` and into `Today`; focus came with it.
    await expect(todos.rescheduleButton("second thing")).toBeFocused();
  });

  test("the trigger and its menu both name the todo they belong to", async ({
    signedIn,
    todos,
  }) => {
    await todos.quickAdd("alpha task");
    await expect(todos.row("alpha task")).toBeVisible();
    await todos.quickAdd("beta task");
    await expect(todos.row("beta task")).toBeVisible();

    await expect(
      signedIn.getByRole("button", {
        name: rescheduleLabel("alpha task"),
        exact: true,
      }),
    ).toBeVisible();
    await expect(
      signedIn.getByRole("button", {
        name: rescheduleLabel("beta task"),
        exact: true,
      }),
    ).toBeVisible();

    await todos.openReschedule("beta task");

    await expect(todos.rescheduleMenu("beta task")).toBeVisible();
    await expect(todos.rescheduleMenu("alpha task")).toHaveCount(0);
  });
});

/**
 * The PM's flagged risk: three icon buttons at 44×44 on a 320px viewport, next
 * to a truncated title (`docs/PM-PROPOSAL.md` §3 #5, `docs/DESIGN.md` §4.4).
 *
 * 320px is `docs/PRD.md` NFR-05's floor and the width the layout is designed
 * from. The answer this branch took is that the actions cluster is allowed to
 * take a line of its own when the row cannot hold everything on one — so the
 * targets stay 44×44, the gaps stay ≥8px, and nothing scrolls sideways.
 */
test.describe("320px — three targets, a title, and no horizontal scroll", () => {
  test.use({ viewport: { width: 320, height: 800 } });

  /** NFR-05, and `docs/DESIGN.md` §6.3: not negotiable below 640px. */
  const MOBILE_TARGET_MIN = 44;
  /** §6.3 — adjacent targets keep at least this much between them. */
  const ADJACENT_GAP_MIN = 8;

  const controls = (page: Page, title: string) => [
    ["reschedule", page.getByRole("button", { name: rescheduleLabel(title), exact: true })],
    ["edit", page.getByRole("button", { name: `Edit "${title}"`, exact: true })],
    ["delete", page.getByRole("button", { name: `Delete "${title}"`, exact: true })],
  ] as const;

  test("every row action is a full 44×44 target", async ({ signedIn, todos }) => {
    await todos.quickAdd("a title long enough to be truncated at this width");
    await expect(
      todos.row("a title long enough to be truncated at this width"),
    ).toBeVisible();

    for (const [name, control] of controls(
      signedIn,
      "a title long enough to be truncated at this width",
    )) {
      const box = await boxOf(control);

      expect.soft(box.width, `${name} width`).toBeGreaterThanOrEqual(
        MOBILE_TARGET_MIN,
      );
      expect.soft(box.height, `${name} height`).toBeGreaterThanOrEqual(
        MOBILE_TARGET_MIN,
      );
    }
  });

  test("adjacent actions keep at least 8px between them", async ({
    signedIn,
    todos,
  }) => {
    await todos.quickAdd("spacing check");
    await expect(todos.row("spacing check")).toBeVisible();

    const boxes = [];

    for (const [, control] of controls(signedIn, "spacing check")) {
      boxes.push(await boxOf(control));
    }

    for (let index = 1; index < boxes.length; index += 1) {
      const previous = boxes[index - 1];
      const current = boxes[index];

      expect
        .soft(current.x - (previous.x + previous.width), `gap ${index}`)
        .toBeGreaterThanOrEqual(ADJACENT_GAP_MIN);
    }
  });

  test("the page does not scroll sideways, and the title is still readable", async ({
    signedIn,
    todos,
  }) => {
    await todos.quickAdd("a title long enough to be truncated at this width");
    await expect(
      todos.row("a title long enough to be truncated at this width"),
    ).toBeVisible();

    const overflows = await signedIn.evaluate(
      () => document.documentElement.scrollWidth > document.documentElement.clientWidth,
    );

    expect(overflows, "the document scrolls horizontally at 320px").toBe(false);

    /*
      A layout that fits by crushing the title to nothing is not a layout that
      fits. `min-w-32` is the floor the row is built on, and this is the
      assertion that keeps it honest — without it, the three targets above would
      pass just as happily on a row whose title had been squeezed to a single
      ellipsis.
    */
    const title = todos
      .row("a title long enough to be truncated at this width")
      .getByText("a title long enough to be truncated at this width");

    expect((await boxOf(title)).width).toBeGreaterThanOrEqual(128);
  });

  test("all three actions still work at 320px", async ({ todos }) => {
    await todos.quickAdd("still usable");

    await todos.reschedule("still usable", TOMORROW_ITEM_LABEL);

    await expect(rowDate(todos.row("still usable"))).toHaveText("Tomorrow");
  });
});
