import { describe, expect, it } from "vitest";

import {
  focusRowAfterRemoval,
  focusUndoAction,
  MAX_WAIT_FRAMES,
  nextFocusIndex,
  nextUndoToken,
  UNDO_TOKEN_ATTRIBUTE,
  undoTokenProps,
} from "@/lib/rowFocus";

/**
 * The arithmetic behind NFR-04's focus rescue: given the row that was removed
 * and what is left, where does focus land.
 *
 * The DOM half is proved end to end in `e2e/undo-focus.spec.ts`, against a real
 * toast and a real view transition — the part worth pinning here is the choice
 * itself, and in particular the two edges that decide whether focus survives at
 * all: removing the last row, and emptying the list.
 */
describe("nextFocusIndex", () => {
  it("keeps the user in place — the row that slid up into the gap", () => {
    expect(nextFocusIndex(0, 7)).toBe(0);
    expect(nextFocusIndex(3, 7)).toBe(3);
  });

  it("falls back to the new last row when the last row was the one removed", () => {
    // Eight rows, the last one toggled away: index 7 no longer exists.
    expect(nextFocusIndex(7, 7)).toBe(6);
  });

  it("reports nowhere to go when the list is now empty", () => {
    // The caller leaves focus alone rather than moving it to `<body>` itself.
    expect(nextFocusIndex(0, 0)).toBeNull();
  });

  it("reports nowhere to go when focus was not on a row", () => {
    expect(nextFocusIndex(-1, 5)).toBeNull();
  });
});

/**
 * The wait loop itself.
 *
 * `focusRowAfterRemoval` waits for the row count to drop rather than for a
 * fixed number of frames. In a real browser that distinction is invisible:
 * React commits a discrete-input update synchronously, so the row is already
 * gone on the first check — measured at `frame=1` for 4 rows unthrottled and
 * 40 rows at 20x CPU throttling alike. A fixed one-frame version therefore
 * passes every end-to-end test, for reasons that have nothing to do with being
 * correct.
 *
 * So the loop is driven directly here, with a removal that deliberately lands
 * several frames late. That is the only way to tell the two implementations
 * apart, and it is what makes the condition-wait a pinned decision rather than
 * a preference.
 */
describe("focusRowAfterRemoval", () => {
  /** A stand-in for a row checkbox: it records that it was focused. */
  const makeRows = (names: string[]) => {
    let active: unknown = null;

    const rows = names.map((name) => {
      const row = {
        name,
        focus: () => {
          active = row;
        },
      };

      return row;
    });

    return { rows, getActiveElement: () => active };
  };

  it("waits for the removal to land instead of moving on the next frame", async () => {
    // Four rows, the first one toggled away — so `doomed` is what a
    // one-frame implementation would focus, and `next` is the right answer.
    const before = makeRows(["doomed", "next", "third", "fourth"]);
    const [doomed, ...survivors] = before.rows;

    let frames = 0;
    const REMOVAL_LANDS_ON_FRAME = 3;

    const focused = await focusRowAfterRemoval(
      { index: 0, rowCount: 4 },
      {
        readRows: () => (frames < REMOVAL_LANDS_ON_FRAME ? before.rows : survivors),
        getActiveElement: before.getActiveElement,
        waitFrame: async () => {
          frames += 1;
        },
      },
    );

    expect(focused).toBe(true);
    expect(frames).toBe(REMOVAL_LANDS_ON_FRAME);
    // The row that slid up, not the one that was about to be unmounted.
    expect(before.getActiveElement()).toBe(survivors[0]);
    expect(before.getActiveElement()).not.toBe(doomed);
  });

  it("gives up after MAX_WAIT_FRAMES when the row never leaves", async () => {
    // A removal that never happens must not spin forever, and must not focus
    // the doomed row as a consolation prize.
    const stuck = makeRows(["one", "two"]);
    let frames = 0;

    const focused = await focusRowAfterRemoval(
      { index: 0, rowCount: 2 },
      {
        readRows: () => stuck.rows,
        getActiveElement: stuck.getActiveElement,
        waitFrame: async () => {
          frames += 1;
        },
      },
    );

    expect(focused).toBe(false);
    expect(frames).toBe(MAX_WAIT_FRAMES);
    expect(stuck.getActiveElement()).toBeNull();
  });

  it("reports failure, and focuses nothing, when the list empties", async () => {
    const before = makeRows(["only"]);

    const focused = await focusRowAfterRemoval(
      { index: 0, rowCount: 1 },
      {
        readRows: () => [],
        getActiveElement: before.getActiveElement,
        waitFrame: async () => {},
      },
    );

    // Step 2's `focusIsUnclaimed` is what catches this case instead.
    expect(focused).toBe(false);
    expect(before.getActiveElement()).toBeNull();
  });
});

/**
 * Step 2's choice of toast — the whole of DEF-25.
 *
 * The end-to-end spec can show the right Undo taking focus. What it cannot
 * show, because a browser only ever offers one arrangement of the stack at a
 * time, is the property that matters: a toast which is *not* this one is
 * refused **every frame it is offered**, no matter how frontmost it looks or
 * how long it sits there. That is a negative about the lookup itself, so the
 * lookup is driven directly here.
 *
 * The old implementation asked for `[data-frontmost="true"]`. Every case below
 * is one it would have passed by focusing the wrong button on frame 0.
 */
describe("focusUndoAction", () => {
  /**
   * A stack where an older Undo is present from the first frame and this
   * toggle's own arrives late — the shape DEF-25 lives in, with the frames
   * before the success toast mounts held open.
   */
  const stack = (mineArrivesOnFrame: number) => {
    let frames = 0;
    let active: unknown = null;

    const makeAction = (name: string) => {
      const action = {
        name,
        focus: () => {
          active = action;
        },
      };

      return action;
    };

    /** `Todo “keepme” added` — an Undo that is a DELETE of another todo. */
    const staleAction = makeAction("stale");
    const myAction = makeAction("mine");

    return {
      staleAction,
      myAction,
      get frames() {
        return frames;
      },
      getActiveElement: () => active,
      /** Only ever answers with the button carrying the token asked for. */
      findAction: (token: string) => {
        if (token === "mine") return frames >= mineArrivesOnFrame ? myAction : null;
        if (token === "stale") return staleAction;

        return null;
      },
      waitFrame: async () => {
        frames += 1;
      },
    };
  };

  it("waits for this toggle's own Undo rather than taking the one already there", async () => {
    const MINE_MOUNTS_ON_FRAME = 12;
    const world = stack(MINE_MOUNTS_ON_FRAME);

    const focused = await focusUndoAction("mine", () => true, {
      findAction: world.findAction,
      getActiveElement: world.getActiveElement,
      waitFrame: world.waitFrame,
    });

    expect(focused).toBe(true);
    expect(world.frames).toBe(MINE_MOUNTS_ON_FRAME);
    // The stale Undo — a `DELETE` of a todo the user never touched — was on
    // offer for all twelve of those frames and was never taken.
    expect(world.getActiveElement()).toBe(world.myAction);
    expect(world.getActiveElement()).not.toBe(world.staleAction);
  });

  it("moves nothing when this toggle's Undo never arrives", async () => {
    // A toast that never mounts leaves focus parked on the row step 1 chose.
    // The previous behaviour was to settle for whatever else was on screen.
    const world = stack(Number.POSITIVE_INFINITY);

    const focused = await focusUndoAction("mine", () => true, {
      findAction: world.findAction,
      getActiveElement: world.getActiveElement,
      waitFrame: world.waitFrame,
    });

    expect(focused).toBe(false);
    expect(world.frames).toBe(MAX_WAIT_FRAMES);
    expect(world.getActiveElement()).toBeNull();
  });

  it("declines on the frame the button appears, not the frame the wait began", async () => {
    // The user tabbed away mid-flight. `shouldStillMove` is re-read late, so a
    // guard that was true when the toggle started must not carry the move.
    const world = stack(3);
    let moved = true;

    const focused = await focusUndoAction(
      "mine",
      () => {
        moved = false;

        return false;
      },
      {
        findAction: world.findAction,
        getActiveElement: world.getActiveElement,
        waitFrame: world.waitFrame,
      },
    );

    expect(focused).toBe(false);
    expect(moved).toBe(false);
    expect(world.getActiveElement()).toBeNull();
  });
});

/**
 * The token itself.
 *
 * Two Undos for the **same todo** can be in the DOM at once — a toggle
 * dismisses that row's outstanding `added` toast and raises its own, and
 * HeroUI defers the close through a view transition. So the identity cannot be
 * the todo id, and this is what says so.
 */
describe("nextUndoToken", () => {
  it("never repeats, so the toast being closed cannot answer for the one being raised", () => {
    const tokens = [nextUndoToken(), nextUndoToken(), nextUndoToken()];

    expect(new Set(tokens).size).toBe(tokens.length);
  });

  it("travels as the data attribute the action button is found by", () => {
    expect(undoTokenProps("undo-7")).toEqual({ [UNDO_TOKEN_ATTRIBUTE]: "undo-7" });
    expect(UNDO_TOKEN_ATTRIBUTE.startsWith("data-")).toBe(true);
  });
});
