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
describe("truncateForAnnouncement — the bound itself", () => {
  /**
   * The anchor, and the only assertion in this file that is not derived from
   * the constant it is about.
   *
   * Every other case here builds its expectation *from*
   * `DIALOG_TITLE_MAX_LENGTH`, which is the right style and should stay — but
   * it left the number compared only against itself. Mutation audit T3:
   * **45 → 40 left all six cases green.** The band the file did pin was
   * `0 < DIALOG_TITLE_MAX_LENGTH < TITLE_MAX_LENGTH`, because "bounds the
   * longest title the schema will accept" stops truncating above that; 5000
   * went red, 40 and 199 did not.
   *
   * 45 is not a preference, which is why an unpinned 45 is worse than an
   * unpinned round number would be. It is a measurement: the row's title box
   * is 342px in this project's own Chromium at 1280×800, and 45 characters of
   * mixed-case English is what fits before the row's own ellipsis. A measured
   * number that nothing pins drifts back to a guess, and the next person has
   * no way to tell that it was ever measured.
   *
   * So this case fails on purpose when the number moves. If you are here
   * because it went red: `docs/DESIGN.md` §7.5 and the constant's own comment
   * hold the argument, including the open question of whether the bound
   * should be the row's layout (45) or §7.5's four seconds of speech (60).
   * Change the number and this line together, deliberately.
   */
  it("cuts at forty-five characters, the width the row's own title box measured", () => {
    expect(DIALOG_TITLE_MAX_LENGTH).toBe(45);
  });

  /** And it is genuinely below the schema's limit, or truncation never fires. */
  it("sits below the longest title the schema accepts, so it can bind at all", () => {
    expect(DIALOG_TITLE_MAX_LENGTH).toBeLessThan(TITLE_MAX_LENGTH);
  });
});

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
