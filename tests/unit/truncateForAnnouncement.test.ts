import { describe, expect, it } from "vitest";

import {
  DIALOG_TITLE_MAX_LENGTH,
  TITLE_MAX_LENGTH,
  truncateForAnnouncement,
} from "@/lib/todo";

/**
 * The bound on the edit dialog's accessible name (`docs/DESIGN.md` §7.5).
 *
 * A dialog name is read in full, on open, before the user has been told it is
 * a dialog and with no way to skip it — and a title here can be
 * `TITLE_MAX_LENGTH` characters. This is the function that stops that.
 */
describe("truncateForAnnouncement", () => {
  it("leaves a title shorter than the bound alone", () => {
    expect(truncateForAnnouncement("Buy milk")).toBe("Buy milk");
  });

  it("leaves a title exactly at the bound alone", () => {
    const exact = "a".repeat(DIALOG_TITLE_MAX_LENGTH);

    /*
      The off-by-one worth its own case: a `<` where the code has `<=` would
      cut a title that fits, dropping its last character and adding an ellipsis
      for nothing. Nothing else in the suite distinguishes those two.
    */
    expect(truncateForAnnouncement(exact)).toBe(exact);
    expect(truncateForAnnouncement(exact)).not.toContain("…");
  });

  it("cuts one character over the bound, and adds exactly one ellipsis", () => {
    const over = "a".repeat(DIALOG_TITLE_MAX_LENGTH + 1);
    const result = truncateForAnnouncement(over);

    expect(result).toBe(`${"a".repeat(DIALOG_TITLE_MAX_LENGTH)}…`);
    expect([...result].filter((char) => char === "…")).toHaveLength(1);
  });

  it("drops the space a cut would otherwise leave before the ellipsis", () => {
    // The cut lands immediately after a space; "word …" reads as a gap.
    const title = `${"a".repeat(DIALOG_TITLE_MAX_LENGTH - 1)} tail`;

    expect(truncateForAnnouncement(title)).toBe(
      `${"a".repeat(DIALOG_TITLE_MAX_LENGTH - 1)}…`,
    );
  });

  it("bounds the longest title the schema will accept", () => {
    /*
      Built from `TITLE_MAX_LENGTH` rather than a literal 200, so this stays
      true when the schema's limit moves — which is the rule the copy in this
      codebase follows everywhere else.
    */
    const longest = "a".repeat(TITLE_MAX_LENGTH);

    expect(truncateForAnnouncement(longest)).toHaveLength(
      DIALOG_TITLE_MAX_LENGTH + 1,
    );
  });

  it("takes an explicit bound, so the default is not the only tested path", () => {
    expect(truncateForAnnouncement("abcdef", 3)).toBe("abc…");
    expect(truncateForAnnouncement("abc", 3)).toBe("abc");
  });
});
