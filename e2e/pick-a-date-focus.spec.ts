import {
  BOARD_ORDER_NOTE,
  PICK_A_DATE_ITEM_LABEL,
  TITLE_FIELD_LABEL,
} from "./support/copy";
import { expect, test } from "./support/fixtures";

/**
 * `Pick a date…` lands the caret on `Due date` (`docs/DESIGN.md` §7.21).
 *
 * The ruling that the destination stays is argued in §7.21 and is not what
 * this file tests: a second date surface is its own popover, focus trap,
 * dismissal behaviour, small-screen story and contrast budget, built to set a
 * field that already has a screen. What was wrong is where the caret lands. A
 * menu item ending in `…` promises a surface for specifying *this* thing, and
 * the app answered with a text field holding words the user did not come to
 * change — which is exactly the "backwards from what I expected" a tester
 * reported.
 *
 * Opened from the row's `Edit` button it still focuses `Title`, unchanged.
 * Both halves are here, because a change that focused `Due date` from *every*
 * opener would pass a test that only checked the first.
 */

/**
 * Describes where focus actually is, in terms a failure message can be read
 * from: the field's accessible name, its role, and — for a date field — which
 * segment inside it took the caret.
 *
 * Asked of the document rather than asserted with `toBeFocused` on a guessed
 * locator, because the answer is the finding. A `DatePicker` is a group of
 * spin buttons, so "the Due date field is focused" is a statement about an
 * ancestor, and naming the ancestor is what makes the assertion mean what it
 * says.
 */
const focusedField = async (page: import("@playwright/test").Page) =>
  page.evaluate(() => {
    const active = document.activeElement;

    if (!active || active === document.body) return null;

    /*
      react-aria labels a field group through `aria-labelledby` pointing at its
      `<Label>`, so the field's name is read from the referenced element rather
      than from an attribute on the group itself.
    */
    const nameOf = (element: Element): string | null => {
      const labelledBy = element.getAttribute("aria-labelledby");

      if (labelledBy) {
        const label = labelledBy
          .split(/\s+/)
          .map((id) => document.getElementById(id)?.textContent?.trim() ?? "")
          .filter(Boolean)
          .join(" ");

        if (label) return label;
      }

      return element.getAttribute("aria-label");
    };

    const group = active.closest('[role="group"]');

    return {
      role: active.getAttribute("role") ?? active.tagName.toLowerCase(),
      name: nameOf(active),
      groupName: group ? nameOf(group) : null,
    };
  });

const TITLE = "Prepare the quarterly report";

/** The editor's own heading (`docs/DESIGN.md` §4.5) — and its dialog's name. */
const EDITOR_HEADING = "Edit todo";

test.describe("Pick a date… opens the editor on the date", () => {
  test("the caret lands in Due date, not in Title", async ({
    signedIn: page,
    todos,
  }) => {
    await todos.quickAdd(TITLE);
    await expect(todos.rowByText(TITLE)).toBeVisible();

    await todos.reschedule(TITLE, PICK_A_DATE_ITEM_LABEL);

    /*
      Named, not bare. The reschedule menu's own popover carries `role="dialog"`
      and lingers in the DOM with `data-exiting` while it animates out, so an
      unnamed `getByRole("dialog")` matches two elements and trips strict mode.
      Waiting on the editor by name also waits for the right thing.
    */
    await expect(page.getByRole("dialog", { name: EDITOR_HEADING })).toBeVisible();

    const focused = await focusedField(page);

    /*
      The date field is a group of spin buttons — month, day, year — so the
      thing that actually holds the caret is a segment, and what makes it the
      *Due date* segment is the group it sits in. Asserting the group's name is
      the assertion; asserting the segment's own name would pin the locale's
      segment order, which is not the contract.
    */
    expect(
      focused?.groupName,
      "focus must be inside the field the menu item promised",
    ).toBe("Due date");

    // And explicitly not the field it used to land on.
    await expect(
      page.getByRole("textbox", { name: TITLE_FIELD_LABEL }),
    ).not.toBeFocused();
  });

  test("the row's Edit button still lands the caret in Title", async ({
    signedIn: page,
    todos,
  }) => {
    await todos.quickAdd(TITLE);
    await expect(todos.rowByText(TITLE)).toBeVisible();

    await todos.openEdit(TITLE);

    await expect(
      page.getByRole("textbox", { name: TITLE_FIELD_LABEL }),
      "Edit is unchanged — it opens on the record, so it opens on its name",
    ).toBeFocused();
  });

  /**
   * The modal is never unmounted between openings, so the focus intent is
   * state that has to be reset rather than defaulted. Without the reset in
   * `openCreate`, a `Pick a date…` followed by `More options` opens a brand
   * new todo with the caret sitting in an empty date field.
   */
  test("a create after a Pick a date… still opens on Title", async ({
    signedIn: page,
    todos,
  }) => {
    await todos.quickAdd(TITLE);
    await expect(todos.rowByText(TITLE)).toBeVisible();

    await todos.reschedule(TITLE, PICK_A_DATE_ITEM_LABEL);

    const editor = page.getByRole("dialog", { name: EDITOR_HEADING });

    await expect(editor).toBeVisible();
    await page.keyboard.press("Escape");
    await expect(editor).toBeHidden();

    await todos.openCreate();

    await expect(
      page.getByRole("textbox", { name: TITLE_FIELD_LABEL }),
    ).toBeFocused();
  });

  /**
   * What this costs a screen-reader user, measured rather than assumed.
   *
   * Autofocusing a field that is not first in the form means the fields above
   * it are not passed over on the way in — the virtual cursor starts where
   * focus is. The question is whether the user can still tell what surface
   * they are on, and the answer has to come from the accessible name of the
   * dialog, not from the field.
   *
   * If this ever fails, the honest fix is not to move the focus back; it is to
   * make the dialog say what it is.
   */
  test("the dialog still names itself, so the surface is announced", async ({
    signedIn: page,
    todos,
  }) => {
    await todos.quickAdd(TITLE);
    await expect(todos.rowByText(TITLE)).toBeVisible();

    await todos.reschedule(TITLE, PICK_A_DATE_ITEM_LABEL);

    /*
      The dialog's own accessible name is what a screen reader announces on
      open, before the focused control. `Edit todo` says the surface is the
      record editor, which is the caveat §7.21 argues a menu item cannot carry
      — so it is carried here instead, where it costs nothing to read.
    */
    await expect(page.getByRole("dialog", { name: EDITOR_HEADING })).toBeVisible();
  });

  /**
   * The board's cards carry the same `TodoActions`, and the intent has to
   * survive that chain too.
   *
   * **This is the half most likely to break silently.** `TodoRow`, `TodoCard`,
   * `TodoBoard` and `TodoGroupedList` all declare `onEdit` as
   * `(todo: TodoItemData) => void` and pass the reference straight through, so
   * the second argument reaches `openEdit` at runtime while none of those four
   * prop types mention it — TypeScript allows a function of fewer parameters
   * where one of more is expected, so nothing complains. Rewriting any of those
   * pass-throughs as `onEdit={(todo) => onEdit(todo)}`, which reads like a
   * tidy-up, drops the intent on the floor with no type error and no failure
   * anywhere else.
   *
   * The list test above would not catch that if only the card were rewritten.
   * This one would.
   */
  test("the board's cards carry the intent too", async ({
    signedIn: page,
    todos,
    isMobile,
  }) => {
    // The board does not render below `lg` or without a fine pointer, and the
    // list it falls back to is the case the first test in this file covers.
    test.skip(isMobile === true, "the board needs a desktop viewport");

    await todos.quickAdd(TITLE);
    await expect(todos.rowByText(TITLE)).toBeVisible();

    await page.goto("/todos?view=board");
    await expect(page.getByText(BOARD_ORDER_NOTE)).toBeVisible();

    await todos.reschedule(TITLE, PICK_A_DATE_ITEM_LABEL);
    await expect(page.getByRole("dialog", { name: EDITOR_HEADING })).toBeVisible();

    expect(
      (await focusedField(page))?.groupName,
      "a card's Pick a date… must open on Due date, exactly as a row's does",
    ).toBe("Due date");
  });
});
