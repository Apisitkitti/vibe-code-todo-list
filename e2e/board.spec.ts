import type { Locator, Page } from "@playwright/test";

import {
  BOARD_EMPTY_COLUMN,
  BOARD_ORDER_NOTE,
  BOARD_VIEW_LABEL,
  COMPLETED_HEADING,
  LIST_VIEW_LABEL,
  NO_DATE_HEADING,
  OVERDUE_HEADING,
  TODAY_HEADING,
  TODAY_ITEM_LABEL,
  UPCOMING_HEADING,
  VIEW_TOGGLE_ARIA_LABEL,
  dueToast,
  sectionHeadingText,
  markCompleteLabel,
  markNotCompleteLabel,
  markedCompleteToast,
  rescheduleLabel,
} from "./support/copy";
import { countRequests, expectAbsentNow } from "./support/assertions";
import { expect, test } from "./support/fixtures";

/**
 * The board view, end to end (`docs/PRD.md` US-14, `docs/DESIGN.md` §8.8).
 *
 * Four claims are worth a browser, and they are the four this file makes:
 *
 *  1. **A drag between two columns writes the date that column names** — the
 *     one the card's own menu would write, and it survives a reload, so the
 *     assertion is about the database rather than about a re-render.
 *  2. **A drag into `Completed` completes the todo and does not touch its
 *     date.** Two separate routes, and the failure mode is a drop that silently
 *     rescheduled something the user meant to finish. Pinned by counting
 *     requests *and* by reopening the card and watching it come back to the
 *     column it left.
 *  3. **The keyboard does both**, through the reschedule menu and the checkbox
 *     the card already carries — which is the whole accessibility argument for
 *     a board with no keyboard drag mode, so it is asserted rather than
 *     asserted-in-a-comment.
 *  4. **Focus survives a move.** A card that changes column is unmounted and
 *     rebuilt, so both keyboard moves end with a check on where focus went.
 *
 * Due dates are seeded through `POST /api/todos` on the page's own request
 * context, exactly as `grouping.spec.ts` does: the same session cookie, the
 * real scoped endpoint, no database back door.
 */

const pad = (value: number) => String(value).padStart(2, "0");

/**
 * The wire day (`YYYY-MM-DD`), `offset` days from today in **local** time —
 * the same reasoning `grouping.spec.ts` sets out. The columns are cut by
 * comparing a UTC-midnight `dueAt` against the viewer's own calendar day, and
 * the browser shares this process's timezone. Building these from UTC would put
 * "today" in the wrong column for anyone running the suite west of UTC, and CI
 * runs it at UTC+14.
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
};

const openBoard = async (page: Page) => {
  await page.goto("/todos?view=board");
  await expect(page.getByText(BOARD_ORDER_NOTE)).toBeVisible();
};

/** The `<section>` a column heading names, so a card can be asserted inside it. */
const column = (page: Page, heading: string) =>
  page
    .locator("main section")
    .filter({ has: page.getByRole("heading", { name: heading, exact: true }) });

const cardIn = (page: Page, heading: string, title: string) =>
  column(page, heading).getByRole("listitem").filter({ hasText: title });

const card = (page: Page, title: string) =>
  page.locator("main").getByRole("listitem").filter({ hasText: title });

/**
 * Drags a card onto a column.
 *
 * `dragTo` drives real HTML5 drag events in Chromium, which is what the board
 * listens for — a synthetic `dispatchEvent` would call the app's own handlers
 * with events it fabricated, and would go on passing if `draggable` were
 * removed from the card entirely.
 */
const dragCardTo = async (page: Page, title: string, heading: string) => {
  await card(page, title).dragTo(column(page, heading));
};

/**
 * Establishes keyboard modality before landing on a control.
 *
 * The focus restorations are deliberately keyboard-only and react-aria decides
 * modality from real events, so this presses a real `Tab` rather than assuming
 * it. The `focus()` after it skips the tab-walk into the board, which is not
 * what is under test.
 */
const focusFromKeyboard = async (page: Page, control: Locator) => {
  await page.keyboard.press("Tab");
  await control.evaluate((element: HTMLElement) => {
    element.focus();
  });
};

/** URL shape for the due-date route, which no completion may ever call. */
const TODO_DUE_URL = /\/api\/todos\/[^/?]+\/due$/;

test.describe("dragging a card between columns", () => {
  /*
    The board renders at `lg:` and above only, and the mobile project is a
    Pixel 7. Its own behaviour — the fallback to the list — is asserted at the
    bottom of this file rather than skipped silently.
  */
  test.skip(({ isMobile }) => isMobile === true, "the board needs a desktop viewport");

  test("writes the date the column names, and it sticks", async ({
    signedIn,
    todos,
  }) => {
    await seedTodos(signedIn, [{ title: "water the plants", dueAt: localDay(1) }]);
    await openBoard(signedIn);

    await expect(cardIn(signedIn, UPCOMING_HEADING, "water the plants")).toBeVisible();

    await dragCardTo(signedIn, "water the plants", TODAY_HEADING);

    /*
      The toast reads its day out of `formatDueDate`, the same function the
      card's own label uses — so this asserts the drop wrote *today* and not
      merely that something was written.
    */
    await expect(
      todos.toastTitles.filter({ hasText: dueToast("water the plants", "Today") }),
    ).toBeVisible();
    await expect(cardIn(signedIn, TODAY_HEADING, "water the plants")).toBeVisible();

    /*
      The reload is what makes this a claim about the database rather than about
      local state: an optimistic move that never reached the server would look
      identical up to this line.
    */
    await signedIn.reload();
    await expect(cardIn(signedIn, TODAY_HEADING, "water the plants")).toBeVisible();
  });

  /**
   * The second dated column, and it earns its place: with only `Today` and
   * `No date` covered, replacing the whole column-to-date mapping with a
   * constant `Today` left this file green — the unit test caught it and the
   * browser did not. A mapping is only pinned by more than one of its entries.
   *
   * `Upcoming` writes `Tomorrow` because tomorrow is the nearest day in that
   * column and the only one a gesture can name; the menu's `Pick a date…`
   * remains the way to say which future day.
   */
  test("a drop on Upcoming writes tomorrow, not today", async ({
    signedIn,
    todos,
  }) => {
    await seedTodos(signedIn, [{ title: "post the letters", dueAt: localDay(0) }]);
    await openBoard(signedIn);

    await expect(cardIn(signedIn, TODAY_HEADING, "post the letters")).toBeVisible();

    await dragCardTo(signedIn, "post the letters", UPCOMING_HEADING);

    await expect(
      todos.toastTitles.filter({
        hasText: dueToast("post the letters", "Tomorrow"),
      }),
    ).toBeVisible();
    await expect(cardIn(signedIn, UPCOMING_HEADING, "post the letters")).toBeVisible();

    await signedIn.reload();
    await expect(cardIn(signedIn, UPCOMING_HEADING, "post the letters")).toBeVisible();
  });

  test("a drop on No date clears the due date", async ({ signedIn }) => {
    await seedTodos(signedIn, [{ title: "someday thing", dueAt: localDay(1) }]);
    await openBoard(signedIn);

    await dragCardTo(signedIn, "someday thing", NO_DATE_HEADING);

    await expect(cardIn(signedIn, NO_DATE_HEADING, "someday thing")).toBeVisible();

    await signedIn.reload();
    await expect(cardIn(signedIn, NO_DATE_HEADING, "someday thing")).toBeVisible();
  });

  /**
   * The distinction the whole feature turns on. `Completed` is not a date, and
   * a drop there that reached `PATCH …/due` would be rescheduling a todo the
   * user meant to finish — a mistake nothing on screen would report, because
   * the card lands in `Completed` either way while it is still ticked.
   *
   * Two independent checks, because either alone can be satisfied by the wrong
   * implementation: the request counter says which route was called, and
   * reopening the card says the date is untouched.
   */
  test("a drop on Completed completes the todo and leaves its date alone", async ({
    signedIn,
    todos,
  }) => {
    await seedTodos(signedIn, [{ title: "file the taxes", dueAt: localDay(1) }]);
    await openBoard(signedIn);

    const dueWrites = countRequests(signedIn, TODO_DUE_URL, "PATCH");

    await dragCardTo(signedIn, "file the taxes", COMPLETED_HEADING);

    await expect(
      todos.toastTitles.filter({ hasText: markedCompleteToast("file the taxes") }),
    ).toBeVisible();
    await expect(cardIn(signedIn, COMPLETED_HEADING, "file the taxes")).toBeVisible();
    await expect(
      signedIn.getByRole("checkbox", { name: markNotCompleteLabel("file the taxes") }),
    ).toBeChecked();

    expect(
      dueWrites.count,
      "a drop on Completed reached the due-date route",
    ).toBe(0);

    /*
      The date survived. Reopening writes only completion, so the card can only
      come back to `Upcoming` if the drop never touched `dueAt` — which is the
      property, stated in the place the user would notice it.
    */
    /*
      The visible control, not the input. react-aria renders the real
      `<input type="checkbox">` visually hidden under a styled span, so a click
      aimed at the input is intercepted by it — the same trap `fixtures.ts`
      documents for the row.
    */
    await cardIn(signedIn, COMPLETED_HEADING, "file the taxes")
      .locator('[data-slot="checkbox-control"]')
      .click();

    await expect(cardIn(signedIn, UPCOMING_HEADING, "file the taxes")).toBeVisible();
  });

  /**
   * A completed card may be dropped only on the column it will actually return
   * to, which its untouched date decides. Reopening writes no date, so any
   * other target could only be honoured by landing the card somewhere other
   * than where it was released — the one thing direct manipulation must not do.
   *
   * Written from the user's side rather than as a rule restatement: drop it on
   * the wrong column and *nothing happens*; drop it on the right one and it
   * comes back where it belongs. Relaxing the rule in `boardMove` makes the
   * first half of this fail with the card sitting under `Upcoming` after being
   * released over `Today`.
   */
  test("a completed card can only be dropped where it will land", async ({
    signedIn,
    todos,
  }) => {
    await seedTodos(signedIn, [{ title: "already done", dueAt: localDay(1) }]);
    await openBoard(signedIn);

    await card(signedIn, "already done")
      .locator('[data-slot="checkbox-control"]')
      .click();
    await expect(cardIn(signedIn, COMPLETED_HEADING, "already done")).toBeVisible();

    // `Today` is not where an untouched tomorrow date would put it.
    await dragCardTo(signedIn, "already done", TODAY_HEADING);

    await expect(
      cardIn(signedIn, COMPLETED_HEADING, "already done"),
      "a refused drop moved the card anyway",
    ).toBeVisible();
    await expectAbsentNow(
      cardIn(signedIn, TODAY_HEADING, "already done"),
      "a completed card landed in a column its date does not name",
    );

    // `Upcoming` is where it belongs, so that drop is taken.
    await dragCardTo(signedIn, "already done", UPCOMING_HEADING);

    await expect(cardIn(signedIn, UPCOMING_HEADING, "already done")).toBeVisible();
    await expect(
      todos.toastTitles.filter({ hasText: "already done" }),
    ).toBeVisible();
  });

  /**
   * `Overdue` is not a drop target, because no menu item produces it: being
   * overdue is something time does to a date, not something a user chooses, and
   * honouring the drop would mean back-dating a todo nobody asked to back-date.
   *
   * The absence is read once rather than awaited — a retrying assertion would
   * watch a toast appear and expire and then report a pass.
   */
  test("Overdue refuses a drop", async ({ signedIn, todos }) => {
    await seedTodos(signedIn, [{ title: "undated thing" }]);
    await openBoard(signedIn);

    const dueWrites = countRequests(signedIn, TODO_DUE_URL, "PATCH");

    await dragCardTo(signedIn, "undated thing", OVERDUE_HEADING);

    await expect(cardIn(signedIn, NO_DATE_HEADING, "undated thing")).toBeVisible();
    expect(dueWrites.count, "a drop on Overdue wrote a due date").toBe(0);
    await expectAbsentNow(
      todos.toasts,
      "a refused drop reported something happening",
    );
  });
});

/**
 * The board ships no keyboard drag mode, and does not owe one: every move a
 * drop makes is a move the card's own controls make, so the keyboard path is
 * the one that already existed (`docs/DESIGN.md` §6.8, §8.1, §8.8).
 *
 * These are the assertions that keep that true. If a drop ever gains a
 * capability the menu lacks, one of them stops describing the same journey.
 */
test.describe("the keyboard does everything the drag does", () => {
  /*
    The board renders at `lg:` and above only, and the mobile project is a
    Pixel 7. Its own behaviour — the fallback to the list — is asserted at the
    bottom of this file rather than skipped silently.
  */
  test.skip(({ isMobile }) => isMobile === true, "the board needs a desktop viewport");

  test("the reschedule menu moves a card between columns", async ({
    signedIn,
    todos,
  }) => {
    await seedTodos(signedIn, [{ title: "call the plumber", dueAt: localDay(1) }]);
    await openBoard(signedIn);

    const trigger = signedIn.getByRole("button", {
      name: rescheduleLabel("call the plumber"),
      exact: true,
    });

    await focusFromKeyboard(signedIn, trigger);
    await signedIn.keyboard.press("Enter");
    await expect(
      signedIn.getByRole("menu", { name: rescheduleLabel("call the plumber") }),
    ).toBeVisible();
    // `Today` is the first item and is already focused; commit it.
    await signedIn.keyboard.press("Enter");

    await expect(
      todos.toastTitles.filter({ hasText: dueToast("call the plumber", "Today") }),
    ).toBeVisible();
    await expect(cardIn(signedIn, TODAY_HEADING, "call the plumber")).toBeVisible();

    /*
      The card moved to another column, so React unmounted it and built a new
      one — taking the trigger the user was standing on. Focus is restored to
      the rebuilt trigger rather than redirected into the toast: the card is
      still on screen and still theirs (`restoreRescheduleFocus`).
    */
    await expect(trigger).toBeFocused();

    await signedIn.reload();
    await expect(cardIn(signedIn, TODAY_HEADING, "call the plumber")).toBeVisible();
  });

  test("the checkbox moves a card into Completed", async ({ signedIn, todos }) => {
    await seedTodos(signedIn, [{ title: "book the flights", dueAt: localDay(1) }]);
    await openBoard(signedIn);

    const checkbox = signedIn.getByRole("checkbox", {
      name: markCompleteLabel("book the flights"),
    });

    await focusFromKeyboard(signedIn, checkbox);
    await signedIn.keyboard.press("Space");

    await expect(
      todos.toastTitles.filter({ hasText: markedCompleteToast("book the flights") }),
    ).toBeVisible();
    await expect(cardIn(signedIn, COMPLETED_HEADING, "book the flights")).toBeVisible();

    /*
      The other half of the focus decision, and the one that differs from the
      list's. A toggle on the list under the default filter leaves the row's DOM
      node alone; on the board the card changes column, so the checkbox is
      rebuilt and focus would otherwise be on `<body>`. It goes back to the
      checkbox — where the next `Space` un-completes what was just completed —
      rather than to the toast's Undo (`restoreToggleFocus`).
    */
    await expect(
      signedIn.getByRole("checkbox", {
        name: markNotCompleteLabel("book the flights"),
      }),
    ).toBeFocused();
  });
});

test.describe("the board's structure", () => {
  /*
    The board renders at `lg:` and above only, and the mobile project is a
    Pixel 7. Its own behaviour — the fallback to the list — is asserted at the
    bottom of this file rather than skipped silently.
  */
  test.skip(({ isMobile }) => isMobile === true, "the board needs a desktop viewport");

  /**
   * Every column, always — unlike the list, which omits an empty section. An
   * empty column is a drop target, and a drop target that is not on screen
   * cannot be aimed at.
   */
  test("shows all five columns, including the empty ones", async ({ signedIn }) => {
    await seedTodos(signedIn, [{ title: "the only todo", dueAt: localDay(1) }]);
    await openBoard(signedIn);

    const headings = signedIn.locator("main").getByRole("heading", { level: 2 });

    await expect(headings).toHaveText([
      sectionHeadingText(OVERDUE_HEADING, 0),
      sectionHeadingText(TODAY_HEADING, 0),
      sectionHeadingText(UPCOMING_HEADING, 1),
      sectionHeadingText(NO_DATE_HEADING, 0),
      sectionHeadingText(COMPLETED_HEADING, 0),
    ]);
    await expect(signedIn.getByText(BOARD_EMPTY_COLUMN.overdue)).toBeVisible();
    await expect(signedIn.getByText(BOARD_EMPTY_COLUMN.completed)).toBeVisible();
  });

  /**
   * The view is URL state, for the reasons the filters are (US-10): it survives
   * a reload, it can be shared, and Back undoes it. The half that is easy to
   * get wrong is the interaction — a filter change rebuilding the query string
   * without the view would silently drop the user back to the list.
   */
  test("the chosen view is in the URL and survives a filter change", async ({
    signedIn,
    todos,
  }) => {
    await seedTodos(signedIn, [{ title: "a todo to look at", dueAt: localDay(1) }]);
    await signedIn.goto("/todos");

    await expect(todos.row("a todo to look at")).toBeVisible();

    await signedIn
      .getByRole("radiogroup", { name: VIEW_TOGGLE_ARIA_LABEL })
      .getByRole("radio", { name: BOARD_VIEW_LABEL })
      .click();

    await expect(signedIn).toHaveURL(/view=board/);
    await expect(signedIn.getByText(BOARD_ORDER_NOTE)).toBeVisible();

    await signedIn
      .getByRole("radiogroup", { name: "Filter todos by status" })
      .getByRole("radio", { name: "Active" })
      .click();

    await expect(signedIn).toHaveURL(/status=active/);
    await expect(signedIn, "a filter change dropped the view").toHaveURL(
      /view=board/,
    );
    await expect(signedIn.getByText(BOARD_ORDER_NOTE)).toBeVisible();

    await signedIn.reload();
    await expect(signedIn.getByText(BOARD_ORDER_NOTE)).toBeVisible();
  });

  test("the toggle goes back to the list again", async ({ signedIn, todos }) => {
    await seedTodos(signedIn, [{ title: "there and back", dueAt: localDay(1) }]);
    await signedIn.goto("/todos");
    await expect(todos.row("there and back")).toBeVisible();

    await signedIn
      .getByRole("radiogroup", { name: VIEW_TOGGLE_ARIA_LABEL })
      .getByRole("radio", { name: BOARD_VIEW_LABEL })
      .click();
    await expect(signedIn.getByText(BOARD_ORDER_NOTE)).toBeVisible();

    await signedIn
      .getByRole("radiogroup", { name: VIEW_TOGGLE_ARIA_LABEL })
      .getByRole("radio", { name: LIST_VIEW_LABEL })
      .click();
    await expect(signedIn.getByText(BOARD_ORDER_NOTE)).toHaveCount(0);
  });
});

/**
 * The phone answer (`docs/DESIGN.md` §4.11, §8.8).
 *
 * Five columns do not fit at 412px, and a drag does not work on touch at all —
 * so `?view=board` renders the list, which is the same five groups stacked, and
 * the URL is kept so widening the window puts the board back. The view toggle
 * is not offered, because a control that changed nothing would be reporting a
 * state the screen does not show.
 */
test.describe("on a phone", () => {
  test("the board falls back to the list, and the toggle is not offered", async ({
    signedIn,
    isMobile,
  }) => {
    test.skip(!isMobile, "the fallback only exists below the board's breakpoint");

    await seedTodos(signedIn, [
      { title: "phone thing", dueAt: localDay(1) },
      { title: "undated pocket item" },
    ]);
    await signedIn.goto("/todos?view=board");

    await expect(card(signedIn, "phone thing")).toBeVisible();
    // The list's own sections, not the board's five columns.
    await expect(
      signedIn.locator("main").getByRole("heading", { level: 2 }),
    ).toHaveText([`${UPCOMING_HEADING} · 1`, `${NO_DATE_HEADING} · 1`]);
    await expect(signedIn.getByText(BOARD_ORDER_NOTE)).toHaveCount(0);
    await expect(
      signedIn.getByRole("radiogroup", { name: VIEW_TOGGLE_ARIA_LABEL }),
    ).toHaveCount(0);
    // The URL is kept: the user did not change their mind, their window is narrow.
    await expect(signedIn).toHaveURL(/view=board/);
  });

  test("the reschedule menu still moves a todo, which is the whole write vocabulary", async ({
    signedIn,
    todos,
    isMobile,
  }) => {
    test.skip(!isMobile, "the desktop path is covered above");

    await seedTodos(signedIn, [{ title: "pocket todo", dueAt: localDay(1) }]);
    await signedIn.goto("/todos?view=board");
    await expect(card(signedIn, "pocket todo")).toBeVisible();

    await todos.reschedule("pocket todo", TODAY_ITEM_LABEL);

    await expect(
      todos.toastTitles.filter({ hasText: dueToast("pocket todo", "Today") }),
    ).toBeVisible();
  });
});
