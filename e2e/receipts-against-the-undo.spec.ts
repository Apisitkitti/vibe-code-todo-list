import type { Page } from "@playwright/test";

import {
  STATUS_FILTER_ARIA_LABEL,
  STATUS_FILTER_LABELS,
  addedHiddenToast,
  addedToast,
  markedCompleteToast,
} from "./support/copy";
import { expectAbsentNow } from "./support/assertions";
import { expect, test } from "./support/fixtures";

/**
 * `docs/DESIGN.md` §7.13.1 — the receipt exemption, narrowed.
 *
 * The two `added` receipts are not the same object, and the exemption used to
 * cover both by inheritance rather than by argument:
 *
 * | receipt | life | against a standing Undo |
 * |---|---|---|
 * | `added` | 4s | **yields** — not raised at all |
 * | `added — hidden by your filters` | 12s | **takes the slot**, closing it |
 *
 * **Why "not raised" rather than "raised behind".** §4.10.1: HeroUI's region is
 * a deck, not a list. Every toast is absolutely positioned, offset `n × 12px`
 * and scaled `1 − n × 0.05`, and anything not frontmost is clipped to the
 * height of the card in front of it, has its close button disabled, and carries
 * `tabIndex = -1` on its wrapper. The newest toast always takes the only
 * operable slot — so a receipt raised over a standing Undo does not sit beside
 * it, it holds it inert to pointer for the receipt's whole life.
 *
 * The action button keeps its own tab stop, which is why the reachability
 * assertions here are about pointers and the keyboard is unaffected.
 */

const ROW = "toggle me";
const CAPTURED = "captured after";

/** The pattern `e2e/list-freshness.spec.ts` established for this control. */
const statusFilter = (page: Page, status: keyof typeof STATUS_FILTER_LABELS) =>
  page
    .getByRole("radiogroup", { name: STATUS_FILTER_ARIA_LABEL })
    .getByRole("radio", { name: STATUS_FILTER_LABELS[status], exact: true });

const showCompletedOnly = async (page: Page) => {
  await statusFilter(page, "completed").click();
  await expect(statusFilter(page, "completed")).toBeChecked();
};

/**
 * What `document.elementFromPoint` returns at the Undo button's own centre.
 *
 * Asked directly rather than by clicking, because this is the property
 * §4.10.1 is about. A passing click would prove it too, but a failing one
 * times out for twenty seconds and reports "intercepts pointer events" without
 * naming what is on top — which is the difference between a diagnosis and a
 * symptom.
 */
const whatIsOverTheUndo = (page: Page) =>
  page.evaluate(() => {
    const button = document.querySelector<HTMLElement>(
      '[data-slot="toast-action-button"]',
    );

    if (!button) return { found: false, reaches: false, description: "no Undo" };

    const rect = button.getBoundingClientRect();
    const onTop = document.elementFromPoint(
      rect.left + rect.width / 2,
      rect.top + rect.height / 2,
    );

    return {
      found: true,
      reaches: onTop !== null && (onTop === button || button.contains(onTop)),
      description:
        onTop === null
          ? "nothing"
          : `${onTop.tagName.toLowerCase()}[${onTop.getAttribute("data-slot") ?? "-"}]`,
    };
  });

test.describe("receipts against the standing Undo", () => {
  test("a visible-row receipt yields — it is not raised at all", async ({
    signedIn: page,
    todos,
  }) => {
    await todos.quickAdd(ROW);
    await expect(todos.rowByText(ROW)).toBeVisible();

    await todos.toggle(ROW, true);
    await expect(
      todos.toastTitles.filter({ hasText: markedCompleteToast(ROW) }),
    ).toBeVisible();
    await expect(todos.undoButton).toHaveCount(1);

    // A capture inside the Undo's window. No filter is on, so the row lands in
    // the list and this is the receipt that yields.
    await todos.quickAdd(CAPTURED);
    await expect(todos.rowByText(CAPTURED)).toBeVisible();

    /*
      Read at a point in time, not retried. Toasts expire on their own, so a
      retrying "no receipt" would be satisfied by an expiry and would pass
      against an app that raised it and buried the Undo for four seconds first.
    */
    await expectAbsentNow(
      todos.toastTitles.filter({ hasText: addedToast(CAPTURED) }),
      "the visible-row receipt was raised over a standing Undo",
    );

    // The point of yielding: the Undo is still the frontmost toast.
    const onTop = await whatIsOverTheUndo(page);

    expect(onTop.reaches, `“${onTop.description}” is over the Undo`).toBe(true);
    expect(await todos.undoButton.count()).toBe(1);
  });

  test("a hidden-by-filters receipt takes the slot and closes the Undo", async ({
    signedIn: page,
    todos,
  }) => {
    await todos.quickAdd(ROW);
    await expect(todos.rowByText(ROW)).toBeVisible();

    await todos.toggle(ROW, true);
    await expect(todos.undoButton).toHaveCount(1);

    /*
      Narrow to completed todos. The row stays — it was just completed — so its
      Undo is still standing and still describes something on screen. Changing
      the filter touches no toast.
    */
    await showCompletedOnly(page);
    await expect(todos.rowByText(ROW)).toBeVisible();
    await expect(todos.undoButton).toHaveCount(1);

    /*
      A capture that cannot land in this list: a brand-new todo is active and
      the filter is showing completed ones. This receipt carries the only
      account of the write, so it takes the slot.
    */
    await todos.quickAdd(CAPTURED);

    await expect(
      todos.toastTitles.filter({ hasText: addedHiddenToast(CAPTURED) }),
      "the hidden-by-filters sentence is the only account of this write",
    ).toBeVisible();
    await expect(todos.rowByText(CAPTURED)).toHaveCount(0);

    expect(
      await todos.undoButton.count(),
      "the hidden-by-filters receipt must close the standing Undo",
    ).toBe(0);
  });

  /**
   * The discriminating case, and the reason this is one file rather than two
   * assertions in separate ones: a change that got the branch backwards —
   * yielding when hidden, taking the slot when visible — passes each of the two
   * tests above only if they are read alone.
   */
  test("the two receipts behave differently under the same standing Undo", async ({
    signedIn: page,
    todos,
  }) => {
    await todos.quickAdd(ROW);
    await expect(todos.rowByText(ROW)).toBeVisible();

    await todos.toggle(ROW, true);
    await expect(todos.undoButton).toHaveCount(1);

    // Visible: yields, and the Undo survives.
    await todos.quickAdd(`${CAPTURED} one`);
    await expect(todos.rowByText(`${CAPTURED} one`)).toBeVisible();

    expect(
      await todos.undoButton.count(),
      "a visible-row receipt must leave the Undo standing",
    ).toBe(1);

    // Hidden: takes the slot, from the same Undo, inside the same window.
    await showCompletedOnly(page);
    await expect(todos.undoButton).toHaveCount(1);

    await todos.quickAdd(`${CAPTURED} two`);
    await expect(
      todos.toastTitles.filter({ hasText: addedHiddenToast(`${CAPTURED} two`) }),
    ).toBeVisible();

    expect(
      await todos.undoButton.count(),
      "a hidden-by-filters receipt must take the slot from the same Undo",
    ).toBe(0);
  });
});
