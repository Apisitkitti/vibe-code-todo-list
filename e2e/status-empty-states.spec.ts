import type { Page } from "@playwright/test";

import {
  ALL_CAUGHT_UP_BODY,
  ALL_CAUGHT_UP_HEADING,
  NOTHING_COMPLETED_BODY,
  NOTHING_COMPLETED_HEADING,
  STATUS_FILTER_ARIA_LABEL,
  STATUS_FILTER_LABELS,
} from "./support/copy";
import { expect, test } from "./support/fixtures";

/**
 * The two empty states a **status** filter is answered with, and the one thing
 * they have in common: neither offers anything to press.
 *
 * `e2e/clear-filters.spec.ts` closed Cause C of `docs/MUTATION-AUDIT-E2E.md` by
 * pressing the button. This file closes the other half of the same gap — the
 * two branches of `resolveEmptyState` that render **no button**, which nothing
 * in the suite had ever looked at either. An absence is a product ruling
 * (`docs/DESIGN.md` §7.7 spells both rows with `—` in the action column) and an
 * unasserted ruling is one a mutant can reverse for free: swapping either
 * branch for `noMatchingFilters()` leaves an empty card on screen with a
 * heading, a body and a `Clear filters` button, and every spec in the suite
 * stays green.
 *
 * **Why the absence is right, and why this file asserts the reason as well as
 * the absence.** The brief this was built from called these states a corner
 * "with no way out". They are not: both branches are reached only when
 * `result.totalCount > 0` — the earlier `totalCount === 0` branch has already
 * returned otherwise — and `hasTodos` is that same account-wide count, so the
 * filter row is on screen, with the status the user chose showing as the
 * checked radio. The way out is the control they came in through, still
 * visible and still reporting its state. That is what the third test here
 * pins, and without it the first two are an inventory of two strings rather
 * than a claim about a screen.
 *
 * A `Clear filters` button in either branch would also be a wider action than
 * the card describes for a reason that is easy to get backwards: by the time
 * these branches run, `query === ""` and `priority === "all"` have both already
 * been checked and returned, so `clearFilters` would reset exactly one thing —
 * the status. It is not that the button would clear too much. It is that the
 * only filter it could clear is the one the user is looking at.
 */

const ROW = "the only todo";

const emptyState = (page: Page) => page.locator('[data-slot="empty-state"]');

/**
 * Seeds one todo over the API and, optionally, finishes it — then reloads, so
 * the screen starts from a server response rather than from optimistic state.
 *
 * The reload is load-bearing for the `Active` case. Completing a row through
 * the checkbox under `status=active` deliberately **leaves it on screen**
 * (`applyCompletion`, and `docs/REVIEW.md` §5(a), which notes that this is why
 * `All caught up` is unreachable by finishing your last active todo). So the
 * only way a user meets that state is by arriving at the filter with the work
 * already done, which is what this reproduces.
 */
const seedOne = async (page: Page, { completed }: { completed: boolean }) => {
  const created = await page.request.post("/api/todos", {
    data: { title: ROW, note: "", priority: "medium", dueAt: "" },
  });

  expect(created.status()).toBe(201);

  if (completed) {
    const { id } = (await created.json()) as { id: string };
    const finished = await page.request.patch(`/api/todos/${id}/status`, {
      data: { completed: true },
    });

    expect(finished.status()).toBe(200);
  }

  await page.reload();
};

const chooseStatus = async (page: Page, label: string) => {
  await page
    .getByRole("radiogroup", { name: STATUS_FILTER_ARIA_LABEL })
    .getByRole("radio", { name: label, exact: true })
    .click();
};

/**
 * The assertion with teeth, and the reason it is safe to ask for a count of
 * zero here.
 *
 * `testing.md`: *"a `toHaveCount(0)` that retries past the moment the thing
 * would have appeared cannot fail"*. The moment is pinned by the caller, which
 * asserts the heading **visible** first — the empty state is fully rendered by
 * the time this runs, so a button belonging to it is already in the DOM or is
 * never coming. The scope is the empty state's own box rather than the page,
 * because the page in this state legitimately holds several buttons: the
 * quick-add `Add`, `More options`, the account menu, and the filter row that
 * the third test below insists on.
 */
const offersNothingToPress = async (page: Page) => {
  await expect(emptyState(page).getByRole("button")).toHaveCount(0);
};

test.describe("Active, with the work already done, congratulates and stops there", () => {
  test("says there is nothing active and offers nothing to press", async ({
    signedIn: page,
  }) => {
    await seedOne(page, { completed: true });
    await chooseStatus(page, STATUS_FILTER_LABELS.active);

    await expect(
      page.getByRole("heading", { name: ALL_CAUGHT_UP_HEADING }),
    ).toBeVisible();
    await expect(emptyState(page).getByText(ALL_CAUGHT_UP_BODY)).toBeVisible();

    /*
      The body is the action. "You have no active todos. Nice." is a report of
      a success, not a failure to repair, and a button under it would reframe
      finishing your work as a state to get out of. The other four empty states
      describe something missing; this one describes something achieved.
    */
    await offersNothingToPress(page);
  });
});

test.describe("Completed, with nothing finished yet, explains what would fill it", () => {
  test("names what puts a todo here and offers nothing to press", async ({
    signedIn: page,
  }) => {
    await seedOne(page, { completed: false });
    await chooseStatus(page, STATUS_FILTER_LABELS.completed);

    await expect(
      page.getByRole("heading", { name: NOTHING_COMPLETED_HEADING }),
    ).toBeVisible();
    await expect(
      emptyState(page).getByText(NOTHING_COMPLETED_BODY),
    ).toBeVisible();

    /*
      "Todos you finish will appear here" is a *not yet*, and it names the one
      thing that changes it. A `Clear filters` button would answer a question
      the sentence has already answered, and would answer it by undoing the
      filter the user set two seconds ago rather than by telling them what the
      filter is for.
    */
    await offersNothingToPress(page);
  });
});

test.describe("the control that emptied the list is still on screen, which is why neither state needs a button", () => {
  /**
   * The case that stops the two above from passing vacuously — and the one
   * that would have caught the premise this file was written to check.
   *
   * If the filter row were gated on the *filtered* row count it would vanish
   * with the last row and these states really would be a dead end, at which
   * point "no action" would be the defect the brief described. It is gated on
   * `result.totalCount`, which is account-wide, so it survives. Asserting the
   * radio is **checked** rather than merely present is the half that matters:
   * a row of filters that had silently reset to `All` while the list stayed
   * empty would be the control lying about the state on screen, which is the
   * same defect `board.spec.ts` refuses for the view toggle.
   */
  test("the status filter is still there, still showing Completed as the chosen one", async ({
    signedIn: page,
  }) => {
    await seedOne(page, { completed: false });
    await chooseStatus(page, STATUS_FILTER_LABELS.completed);

    await expect(
      page.getByRole("heading", { name: NOTHING_COMPLETED_HEADING }),
    ).toBeVisible();

    const statusFilter = page.getByRole("radiogroup", {
      name: STATUS_FILTER_ARIA_LABEL,
    });

    await expect(statusFilter).toBeVisible();
    await expect(
      statusFilter.getByRole("radio", {
        name: STATUS_FILTER_LABELS.completed,
        exact: true,
      }),
    ).toBeChecked();
  });
});
