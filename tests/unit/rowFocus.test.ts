import { describe, expect, it } from "vitest";

import {
  focusRowAfterRemoval,
  MAX_WAIT_FRAMES,
  nextFocusIndex,
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
