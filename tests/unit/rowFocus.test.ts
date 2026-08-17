import { describe, expect, it } from "vitest";

import { nextFocusIndex } from "@/lib/rowFocus";

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
