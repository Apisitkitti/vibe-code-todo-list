import {
  CANCEL_LABEL,
  DELETE_CONFIRM_ACTION,
  DELETE_TOOLTIP,
  EDIT_TOOLTIP,
  deleteLabel,
  editLabel,
} from "./support/copy";
import { expect, test } from "./support/fixtures";

/**
 * Pointer interaction — the part of the product a manual QA pass with a
 * keyboard, or an integration test with no layout engine, cannot reach.
 *
 * Two behaviours only exist for a real mouse at a real viewport:
 *
 *   - the row's action buttons are `lg:opacity-0` and only become visible on
 *     hover or focus-within, so they are invisible-but-present at ≥1024px;
 *   - `TodoRow`'s tooltips are gated on `showTooltips`, which
 *     `TodoListScreen` derives from `useMediaQuery("(min-width: 640px)")`.
 *     A tooltip needs a hover to appear at all.
 *
 * The project runs at 1280×800 (see `playwright.config.ts`), which is above
 * both breakpoints.
 */

const TODO_TITLE = "Water the plants";

test.describe("pointer interaction", () => {
  test("row actions are hidden until hover, then reveal their tooltips", async ({
    signedIn: page,
    todos,
  }) => {
    await todos.createTodo(TODO_TITLE);

    const row = todos.rowByText(TODO_TITLE);
    const edit = todos.editButton(TODO_TITLE);
    const actions = row.locator("div").filter({ has: edit }).last();

    /*
      Present and in the accessibility tree, but painted at zero opacity. This
      is the state a keyboard-only or integration test sees as "visible" —
      Playwright's `toBeVisible` passes here too, because opacity does not
      affect visibility. Only the computed style tells the truth.
    */
    await expect(edit).toBeAttached();
    await expect(actions).toHaveCSS("opacity", "0");

    await row.hover();

    await expect(actions).toHaveCSS("opacity", "1");

    // The tooltip is a pointer-only affordance; the `aria-label` is the real
    // name (`TodoRow`), so both must be right and they use different quotes.
    await edit.hover();
    await expect(page.getByRole("tooltip", { name: EDIT_TOOLTIP })).toBeVisible();
    await expect(edit).toHaveAttribute("aria-label", editLabel(TODO_TITLE));

    const remove = todos.deleteButton(TODO_TITLE);

    await remove.hover();
    await expect(page.getByRole("tooltip", { name: DELETE_TOOLTIP })).toBeVisible();
    await expect(remove).toHaveAttribute("aria-label", deleteLabel(TODO_TITLE));
  });

  test("the destructive confirm focuses Cancel when opened with the mouse", async ({
    signedIn: page,
    todos,
  }) => {
    await todos.createTodo(TODO_TITLE);

    await todos.openDelete(TODO_TITLE);

    /*
      `ConfirmDialog` sets `autoFocus={isDestructive}` on Cancel, so the safe
      choice takes focus and a stray Enter or Space cannot delete anything.
      Opening the dialog by mouse is the case worth checking: a click moves
      focus to the trigger, and react-aria has to move it into the dialog and
      onto the right control without the keyboard ever being involved.
    */
    const cancel = todos.confirmDialog.getByRole("button", {
      name: CANCEL_LABEL,
      exact: true,
    });
    const confirm = todos.confirmDialog.getByRole("button", {
      name: DELETE_CONFIRM_ACTION,
      exact: true,
    });

    await expect(cancel).toBeFocused();
    await expect(confirm).not.toBeFocused();

    // Escape closes without mutating (CONVENTIONS → Mutation UX).
    await page.keyboard.press("Escape");

    await expect(todos.confirmDialog).toHaveCount(0);
    await expect(todos.rowByText(TODO_TITLE)).toBeVisible();
  });
});
