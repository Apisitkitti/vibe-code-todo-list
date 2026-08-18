import {
  ADD_TODO_LABEL,
  CREATE_MODAL_HEADING,
  MORE_OPTIONS_LABEL,
  TITLE_FIELD_LABEL,
} from "./support/copy";
import { readCreatedVia } from "./support/database";
import { expect, test } from "./support/fixtures";

/**
 * Which capture surface a todo was created through (PM backlog #5).
 *
 * `tests/api/createdVia.test.ts` pins what the route does with the value. This
 * pins the half that lives above it: that each of the two call sites actually
 * sends the surface it is. Nothing else can — the column has no UI and is
 * deliberately absent from the response body, so a call site that sent the
 * wrong value, or stopped sending one, would look identical from the browser
 * and identical to every other spec in this suite.
 *
 * The distinction is only worth recording if it is recorded correctly, and the
 * failure mode of an analytics column is not a broken screen. It is a year of
 * numbers that were wrong the whole time.
 */

const QUICK_ADD_TITLE = "Rinse the cafetiere";
const FORM_TITLE = "Book the annual review";

/**
 * `More options` is on the quick-add bar, so it is the case most likely to be
 * attributed wrongly — and it must be `form`, because the measurement is of
 * the surface the user filled in, not of the button they arrived by.
 */
const HANDOFF_LINE = "Send the contract tomorrow high";
const HANDOFF_TITLE = "Send the contract";

test.describe("a todo records the surface it was captured on", () => {
  test("the quick-add bar records quickAdd", async ({ todos, account }) => {
    await todos.quickAdd(QUICK_ADD_TITLE);
    await expect(todos.row(QUICK_ADD_TITLE)).toBeVisible();

    expect(await readCreatedVia(account.email, QUICK_ADD_TITLE)).toBe("quickAdd");
  });

  test("the full form records form", async ({ todos, account }) => {
    await todos.createTodo(FORM_TITLE);

    expect(await readCreatedVia(account.email, FORM_TITLE)).toBe("form");
  });

  test("the More options handoff records form, not the bar it came from", async ({
    todos,
    account,
    signedIn: page,
  }) => {
    await todos.quickAddInput.fill(HANDOFF_LINE);
    await page
      .getByRole("button", { name: MORE_OPTIONS_LABEL, exact: true })
      .click();
    await expect(
      page.getByRole("heading", { name: CREATE_MODAL_HEADING }),
    ).toBeVisible();
    // The handoff carried the reading, so the title is the parsed one.
    await expect(
      page.getByRole("textbox", { name: TITLE_FIELD_LABEL }),
    ).toHaveValue(HANDOFF_TITLE);

    await page.getByRole("button", { name: ADD_TODO_LABEL, exact: true }).click();
    await expect(todos.row(HANDOFF_TITLE)).toBeVisible();

    expect(await readCreatedVia(account.email, HANDOFF_TITLE)).toBe("form");
  });
});
