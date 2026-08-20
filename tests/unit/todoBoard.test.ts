import { describe, expect, it } from "vitest";

import { rescheduleDay, TODAY_DAY_OFFSET, TOMORROW_DAY_OFFSET } from "@/lib/date";
import type { TodoItemData } from "@/lib/todo";
import { BOARD_COLUMN_IDS, boardColumns, boardMove } from "@/lib/todoBoard";
import { TODO_GROUP_IDS, todoGroupId } from "@/lib/todoGroups";

/**
 * The board's two claims, and both of them are properties rather than
 * restatements:
 *
 *  1. **The columns are the list's sections.** Not "look like" — the same ids,
 *     in the same order, cutting the same todos the same way. If these ever
 *     diverge, the board has become a second opinion about where a todo
 *     belongs, which is the thing `docs/DESIGN.md` §8.8 says it must never be.
 *  2. **A drop does what the card's own reschedule menu would do.** Asserted
 *     against `rescheduleDay` — the function the menu items call — rather than
 *     against a date literal, so a change to what `Today` means moves both
 *     sides of the test together and a change to only one of them fails it.
 *
 * `NOW` is a fixed instant so "today" is a value rather than the day the suite
 * happens to run, and it is read in the **local** calendar day for the reason
 * `src/lib/date.ts` gives at length: the board's columns are cut by
 * `dueDayOffset`, which compares a UTC-midnight `dueAt` against the viewer's
 * own day. CI runs at UTC+14, where a test that confused the two would fail.
 */

const NOW = new Date("2026-08-20T09:00:00.000Z");

const day = (offset: number) => rescheduleDay(offset, NOW).dueAt;

const todo = (overrides: Partial<TodoItemData> = {}): TodoItemData => ({
  id: "todo-1",
  title: "Buy milk",
  note: null,
  priority: "medium",
  completed: false,
  dueAt: null,
  createdAt: "2026-08-01T00:00:00.000Z",
  ...overrides,
});

const overdue = todo({ id: "a", dueAt: day(-3) });
const dueToday = todo({ id: "b", dueAt: day(TODAY_DAY_OFFSET) });
const upcoming = todo({ id: "c", dueAt: day(TOMORROW_DAY_OFFSET) });
const undated = todo({ id: "d", dueAt: null });
const done = todo({ id: "e", dueAt: day(TOMORROW_DAY_OFFSET), completed: true });

describe("boardColumns", () => {
  it("is the list's own sections, in the list's own order", () => {
    expect(BOARD_COLUMN_IDS).toEqual(TODO_GROUP_IDS);
    expect(boardColumns([], NOW).map((column) => column.id)).toEqual([
      ...TODO_GROUP_IDS,
    ]);
  });

  it("files every todo in the column the list would put it in", () => {
    const columns = boardColumns([overdue, dueToday, upcoming, undated, done], NOW);

    for (const column of columns) {
      for (const card of column.todos) {
        expect(todoGroupId(card, NOW)).toBe(column.id);
      }
    }
  });

  /*
    The one place the board differs from `groupTodos`, and the reason it is
    tested rather than assumed: an empty column is still a drop target, and a
    drop target that is not on screen cannot be aimed at.
  */
  it("keeps empty columns, which the list drops", () => {
    const columns = boardColumns([dueToday], NOW);

    expect(columns).toHaveLength(TODO_GROUP_IDS.length);
    expect(columns.find((column) => column.id === "overdue")?.todos).toEqual([]);
    expect(columns.find((column) => column.id === "today")?.todos).toEqual([
      dueToday,
    ]);
  });

  /*
    Invariant 1, restated where the board could break it. The server sequences
    the rows; the board only marks where the cuts fall. Two todos in one column
    must come out in the order they went in, whatever their dates say.
  */
  it("never reorders within a column", () => {
    const second = todo({ id: "b2", dueAt: day(TODAY_DAY_OFFSET) });
    const columns = boardColumns([dueToday, second], NOW);

    expect(columns.find((column) => column.id === "today")?.todos).toEqual([
      dueToday,
      second,
    ]);
  });
});

describe("boardMove", () => {
  it("writes the menu's own Today for a drop on Today", () => {
    expect(boardMove(upcoming, "today", NOW)).toEqual({
      kind: "due",
      dueAt: rescheduleDay(TODAY_DAY_OFFSET, NOW).dueAt,
    });
  });

  it("writes the menu's own Tomorrow for a drop on Upcoming", () => {
    expect(boardMove(dueToday, "upcoming", NOW)).toEqual({
      kind: "due",
      dueAt: rescheduleDay(TOMORROW_DAY_OFFSET, NOW).dueAt,
    });
  });

  it("clears the date for a drop on No date", () => {
    expect(boardMove(dueToday, "no-date", NOW)).toEqual({
      kind: "due",
      dueAt: null,
    });
  });

  /*
    The distinction the whole feature turns on: `Completed` is a completion,
    not a date. A drop there that came back as a `due` move would silently
    reschedule a todo the user meant to finish.
  */
  it("completes rather than reschedules for a drop on Completed", () => {
    expect(boardMove(upcoming, "completed", NOW)).toEqual({
      kind: "status",
      completed: true,
    });
  });

  it("refuses Overdue, which no menu item can produce", () => {
    expect(boardMove(upcoming, "overdue", NOW)).toBeNull();
    expect(boardMove(undated, "overdue", NOW)).toBeNull();
    expect(boardMove(dueToday, "overdue", NOW)).toBeNull();
  });

  it("refuses the column the card is already in", () => {
    for (const card of [overdue, dueToday, upcoming, undated, done]) {
      expect(boardMove(card, todoGroupId(card, NOW), NOW)).toBeNull();
    }
  });

  /*
    Reopening writes no date, so a completed card returns to whichever column
    its untouched date puts it in. Allowing any other target would either land
    the card somewhere other than where it was released — the one thing direct
    manipulation must not do — or issue a second write nobody asked for.
  */
  it("lets a completed card be dropped only where it will actually land", () => {
    expect(boardMove(done, "upcoming", NOW)).toEqual({
      kind: "status",
      completed: false,
    });
    expect(boardMove(done, "today", NOW)).toBeNull();
    expect(boardMove(done, "no-date", NOW)).toBeNull();
    expect(boardMove(done, "overdue", NOW)).toBeNull();
  });

  it("returns an overdue completed card to Overdue and nowhere else", () => {
    const staleDone = todo({ id: "f", dueAt: day(-2), completed: true });

    expect(boardMove(staleDone, "overdue", NOW)).toEqual({
      kind: "status",
      completed: false,
    });
    expect(boardMove(staleDone, "today", NOW)).toBeNull();
  });

  /*
    The parity claim, checked as a property rather than as five separate
    assertions: **every move a drop can make is a move the card's menu can
    make.** The menu writes `Today`, `Tomorrow`, `Next week`, a picked date,
    `null`, and completion through the checkbox. A drop that produced anything
    outside that set would be a mouse-only capability, which is the
    accessibility gap this design exists to close.
  */
  it("can only produce moves the card's own menu can produce", () => {
    const menuDueValues = new Set<string | null>([
      rescheduleDay(TODAY_DAY_OFFSET, NOW).dueAt,
      rescheduleDay(TOMORROW_DAY_OFFSET, NOW).dueAt,
      null,
    ]);

    for (const card of [overdue, dueToday, upcoming, undated, done]) {
      for (const column of BOARD_COLUMN_IDS) {
        const move = boardMove(card, column, NOW);

        if (move === null) continue;

        if (move.kind === "due") {
          expect(menuDueValues.has(move.dueAt)).toBe(true);
        } else {
          expect(typeof move.completed).toBe("boolean");
        }
      }
    }
  });

  /*
    And the other half of parity, which is the one a mutation would break
    quietly: a drop must land the card in the column it was dropped on. Applying
    the move and re-asking `todoGroupId` is the check, because that is exactly
    what the screen does — nothing here restates the mapping it is testing.
  */
  it("lands the card in the column it was dropped on", () => {
    for (const card of [overdue, dueToday, upcoming, undated, done]) {
      for (const column of BOARD_COLUMN_IDS) {
        const move = boardMove(card, column, NOW);

        if (move === null) continue;

        const moved =
          move.kind === "due"
            ? { ...card, dueAt: move.dueAt }
            : { ...card, completed: move.completed };

        expect(todoGroupId(moved, NOW)).toBe(column);
      }
    }
  });
});
