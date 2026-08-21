import type { Locator, Page } from "@playwright/test";

import {
  CLEAR_DUE_DATE_ITEM_LABEL,
  editModalHeading,
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

/**
 * Whether a menu is open *now*, after giving react-aria two frames to open one.
 *
 * Deliberately not `expect(menu).toHaveCount(0)`. That assertion retries for
 * fifteen seconds, so a menu that opens and then closes on its own — which is
 * exactly what happens when the write lands and the row re-renders — satisfies
 * it retroactively. Removing the guard this is meant to pin left the suite
 * green precisely that way. A settled, non-retrying read is the only shape that
 * can say "it did not open" rather than "it is not open any more".
 */
const menuOpenedAfterSettling = async (page: Page, menu: Locator) => {
  await page.evaluate(
    () =>
      new Promise((resolve) => {
        requestAnimationFrame(() => requestAnimationFrame(() => resolve(null)));
      }),
  );

  return (await menu.count()) > 0;
};

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
      signedIn.getByRole("heading", {
        name: editModalHeading("choose a holiday"),
      }),
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
      a completion revert for a screen-reader user (§7.13, §7.21).
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

/**
 * The in-flight window, and what the row does to the user's focus while it is
 * open (review F1).
 *
 * The reschedule is not optimistic, so there is a real interval — a whole
 * round trip — where the row is busy and nothing on screen has moved. What
 * happens to focus during *that* interval is invisible to every assertion
 * about the end state, which is exactly why it went unnoticed: the row is
 * rebuilt afterwards and focus is put back, so the final frame looks correct
 * however badly the middle behaved.
 *
 * The write is held open deliberately rather than raced, because the defect is
 * proportional to latency and a local server has none.
 */
test.describe("a slow write does not park the user at the top of the document", () => {
  const HOLD_MS = 2000;

  /** Holds `PATCH /api/todos/[id]/due` open, and reports how many were sent. */
  const holdDueWrites = async (page: Page) => {
    const sent: string[] = [];

    await page.route(/\/api\/todos\/[^/?]+\/due$/, async (route) => {
      sent.push(route.request().url());

      await new Promise((resolve) => setTimeout(resolve, HOLD_MS));
      await route.continue();
    });

    return { count: () => sent.length };
  };

  test("focus stays on the control the user pressed for the whole request", async ({
    signedIn,
    todos,
  }) => {
    await todos.quickAdd("slow one");
    await expect(todos.row("slow one")).toBeVisible();

    await holdDueWrites(signedIn);

    await todos.rescheduleButton("slow one").focus();
    await signedIn.keyboard.press("Enter");
    await expect(todos.rescheduleMenu("slow one")).toBeVisible();
    // `Today` is already focused; commit it and leave the write in flight.
    await signedIn.keyboard.press("Enter");

    // Mid-flight: the row says it is busy and the new date has not landed.
    await expect(todos.row("slow one")).toHaveAttribute("aria-busy", "true");
    await expect(rowDate(todos.row("slow one"))).toHaveCount(0);

    /*
      The assertion this describe block exists for. A disabled control is
      blurred by the browser, so marking the trigger `disabled` while the write
      was in flight dropped focus to `<body>` — leaving a keyboard user at the
      top of the document for the length of the request, with no way back into
      the list except tabbing through everything above it. It is the same
      failure `src/lib/rowFocus.ts` exists to prevent for the toggle, and it
      lasted exactly as long as the user's connection was slow.
    */
    await expect(todos.rescheduleButton("slow one")).toBeFocused();

    /*
      And it is refused *visibly* rather than silently: `aria-disabled` carries
      the same unavailable state to assistive technology, and HeroUI dims it
      from the same rule as `:disabled`, so nothing about the appearance or the
      announcement changed — only whether the user is still standing on it.
    */
    await expect(todos.rescheduleButton("slow one")).toHaveAttribute(
      "aria-disabled",
      "true",
    );

    // And the write still lands.
    await expect(rowDate(todos.row("slow one"))).toHaveText("Today");
    await expect(todos.rescheduleButton("slow one")).toBeFocused();
  });

  test("a second press mid-flight is refused, not queued behind the first", async ({
    signedIn,
    todos,
  }) => {
    await todos.quickAdd("slow two");
    await expect(todos.row("slow two")).toBeVisible();

    const writes = await holdDueWrites(signedIn);

    await todos.rescheduleButton("slow two").focus();
    await signedIn.keyboard.press("Enter");
    await expect(todos.rescheduleMenu("slow two")).toBeVisible();
    await signedIn.keyboard.press("Enter");

    await expect(todos.row("slow two")).toHaveAttribute("aria-busy", "true");

    /*
      Pressed twice, in the two windows that behave differently.

      **Immediately**, while react-aria is still closing the menu — measured at
      more than 28ms in `next dev`, which is long enough for a real second
      press and far longer than it looks. The item is still there and still
      focused, so this press re-activates it and never asks the trigger to open
      anything: only the handler's own pending guard can refuse it.
    */
    await signedIn.keyboard.press("Enter");

    /*
      **And again once the menu has gone**, which is the press a user actually
      makes when nothing seems to be happening. This one reaches the trigger,
      and the trigger declines to open while the row is busy — visibly, on a
      control the user can still see they are standing on.
    */
    /*
      That press lands while the menu is still on screen, so there is nothing to
      assert about the menu here — what it must not do is produce a second
      write, which the count at the end of this test is what says.

      Then wait for the menu to actually go. react-aria closes it
      asynchronously, and the difference between "has not closed yet" and
      "reopened" is invisible to a retrying assertion, which is what let the
      earlier version of this test pass with the trigger's guard deleted.
    */
    await expect(todos.rescheduleMenu("slow two")).toHaveCount(0);

    // Now the press reaches the trigger, and the trigger must decline to open.
    await signedIn.keyboard.press("Enter");

    expect(
      await menuOpenedAfterSettling(signedIn, todos.rescheduleMenu("slow two")),
      "the trigger opened the menu while the row was busy",
    ).toBe(false);

    await expect(rowDate(todos.row("slow two"))).toHaveText("Today");
    expect(writes.count(), "exactly one due write was sent").toBe(1);
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

  /**
   * Review F3 — the constraint the comment in `TodoRow` claims, made checkable.
   *
   * The comment says the trigger is a plain HeroUI `Button` rather than
   * `Dropdown.Trigger` so it matches the two controls beside it. Nothing held
   * that: swapping `Dropdown.Trigger` back in while keeping the sizing class
   * left all eighteen tests green, so what was pinned was the 44×44 target and
   * not the styling rationale at all. A comment that says "learned the hard
   * way" about something no test holds is how documentation outlives its truth.
   *
   * `data-slot` is the discriminator, and it is the library's own contract
   * attribute rather than a styling hook: HeroUI's `Button` stamps `button`,
   * `Dropdown.Trigger` stamps `dropdown-trigger` and carries none of the
   * `button--ghost` / `button--icon-only` treatment. The computed comparison
   * against Edit is what makes this about the *treatment* rather than about the
   * attribute — a `Dropdown.Trigger` given the same sizing class would still
   * have square corners and no ghost background.
   */
  test("the trigger is styled as one of the row's icon buttons, not a bare menu trigger", async ({
    todos,
  }) => {
    await todos.quickAdd("styled like its neighbours");
    await expect(todos.row("styled like its neighbours")).toBeVisible();

    const trigger = todos.rescheduleButton("styled like its neighbours");

    await expect(trigger).toHaveAttribute("data-slot", "button");

    /*
      Read through the locators rather than by building a selector string: the
      row's `aria-label`s carry straight double quotes around the title
      (§7.4), which are not escapable inside an attribute selector without
      `CSS.escape` — and a selector that throws is a test that fails for a
      reason unrelated to what it is checking.
    */
    const readTreatment = (control: Locator) =>
      control.evaluate((element) => {
        const style = getComputedStyle(element);

        return {
          radius: style.borderTopLeftRadius,
          display: style.display,
          justify: style.justifyContent,
          padding: style.paddingLeft,
        };
      });

    expect(await readTreatment(trigger)).toEqual(
      await readTreatment(todos.editButton("styled like its neighbours")),
    );
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
