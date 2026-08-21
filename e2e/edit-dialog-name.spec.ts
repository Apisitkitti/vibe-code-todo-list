import { CREATE_MODAL_HEADING, editModalHeading } from "./support/copy";
import { expect, test } from "./support/fixtures";

/**
 * `docs/DESIGN.md` §7.5 — the edit dialog names its record, within a bound.
 *
 * `Edit todo` named the surface and nothing else. Which record was spoken on
 * open only by accident: focus landed on `Title` and a screen reader read the
 * focused field's value. §7.21's `Pick a date…` ruling moves that focus to
 * `Due date` and takes the accident away, so the name has to carry the title
 * deliberately.
 *
 * **The expected strings below are literals, not built with the app's own
 * `truncateForAnnouncement`.** Importing the helper would make these agree with
 * the code by construction and they could not catch a wrong bound — which is
 * the whole thing under test, since §7.5's number was a judgement call this
 * branch replaced with a measurement.
 */

/** §7.5's bound, measured: see `DIALOG_TITLE_MAX_LENGTH` for the method. */
const BOUND = 45;

/* Exactly 45 characters, counted rather than trusted — asserted below. */
const EXACTLY_AT_BOUND = "Prepare the quarterly report for the leaders.";

const OVER_BOUND =
  "Prepare the quarterly report for the leadership review and circulate it";

/**
 * What the announcement must be for `OVER_BOUND`: the first 45 characters,
 * written out, with one ellipsis. Spelled rather than sliced.
 */
const OVER_BOUND_ANNOUNCED =
  "Edit “Prepare the quarterly report for the leadersh…”";

test.describe("the edit dialog names its record", () => {
  test("a short title is carried whole", async ({ signedIn: page, todos }) => {
    const title = "Buy milk";

    await todos.quickAdd(title);
    await expect(todos.rowByText(title)).toBeVisible();

    await todos.openEdit(title);

    await expect(
      page.getByRole("dialog", { name: editModalHeading(title), exact: true }),
    ).toBeVisible();
  });

  test("a title exactly at the bound keeps its last character and gains no ellipsis", async ({
    signedIn: page,
    todos,
  }) => {
    /*
      The off-by-one that a `<` for a `<=` would produce, and the reason this
      test exists separately from the one below: truncating at exactly the
      bound would drop a character and add an ellipsis to a title that fits.
    */
    expect(EXACTLY_AT_BOUND).toHaveLength(BOUND);

    await todos.quickAdd(EXACTLY_AT_BOUND);
    await expect(todos.rowByText(EXACTLY_AT_BOUND)).toBeVisible();

    await todos.openEdit(EXACTLY_AT_BOUND);

    await expect(
      page.getByRole("dialog", {
        name: editModalHeading(EXACTLY_AT_BOUND),
        exact: true,
      }),
    ).toBeVisible();
  });

  test("a long title is cut in the accessible name, not only in CSS", async ({
    signedIn: page,
    todos,
  }) => {
    expect(OVER_BOUND.length).toBeGreaterThan(BOUND);

    await todos.quickAdd(OVER_BOUND);
    await expect(todos.rowByText(OVER_BOUND)).toBeVisible();

    await todos.openEdit(OVER_BOUND);

    /*
      The heart of it. `text-overflow` clips pixels and leaves the accessibility
      tree carrying all 200 characters, so a CSS-only truncation would pass any
      screenshot and still read the whole title on open, before the user has
      been told it is a dialog and with no way to skip it. Asking for the dialog
      *by* its truncated name is what proves the cut reached the name.
    */
    await expect(
      page.getByRole("dialog", { name: OVER_BOUND_ANNOUNCED, exact: true }),
    ).toBeVisible();

    // And the untruncated title is not the name.
    await expect(
      page.getByRole("dialog", { name: editModalHeading(OVER_BOUND), exact: true }),
    ).toHaveCount(0);

    /*
      Nothing is lost: the full title is in the `Title` field two lines below,
      which is the relationship §4.4's truncated row has with its own title.
    */
    await expect(page.getByRole("textbox", { name: "Title" })).toHaveValue(
      OVER_BOUND,
    );
  });

  test("a create still names the surface, because there is no record yet", async ({
    signedIn: page,
    todos,
  }) => {
    await todos.openCreate();

    await expect(
      page.getByRole("dialog", { name: CREATE_MODAL_HEADING, exact: true }),
    ).toBeVisible();
  });
});
