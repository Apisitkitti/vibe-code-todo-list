import {
  ADD_TODO_LABEL,
  CANCEL_LABEL,
  CHIP_GROUP_LABEL,
  CHIP_HINT,
  CREATE_FAILURE,
  CREATE_MODAL_HEADING,
  EMPTY_STATE_ACTION_LABEL,
  INTERNAL_ERROR_MESSAGE,
  MORE_OPTIONS_LABEL,
  NO_DATE_HEADING,
  QUICK_ADD_SUBMIT_LABEL,
  TITLE_FIELD_LABEL,
  addedToast,
  dueChipLabel,
  keepInTitleLabel,
  priorityChipLabel,
} from "./support/copy";
import {
  TODO_LIST_URL,
  expectAbsentNow,
  expectNoFalseSuccess,
  expectNoTransportLeak,
  fulfilApiError,
} from "./support/assertions";
import { expect, test } from "./support/fixtures";

/**
 * The quick-add bar (PM backlog #1).
 *
 * Two things are being proved here that no other layer can prove. The first is
 * that the **keyboard journey works end to end** — focus the bar, type, Enter,
 * and the todo is on screen — against the real API and the real database, with
 * focus still in the bar afterwards, because "focus stays put" is the feature
 * and not a detail. The second is the **failure path**: a 500 on create must
 * leave every character where the user typed it. Retyping a todo the app lost
 * is the thing that makes people stop trusting an app, and it is invisible to
 * a unit test.
 *
 * The parser itself is not re-tested here — `tests/unit/quickAdd.test.ts` owns
 * that, including every case where it must not fire. This file checks that the
 * reading reaches the database and that the user can refuse it.
 */

const TODO_TITLE = "Buy milk";
const SECOND_TITLE = "Call the vet";
const LITERAL_TITLE = "Call mum about tomorrow";

/** DEF-23's line, and the title the bar hands the modal after reading it. */
const DRAFT_LINE = "Draft the quarterly report and circulate it tomorrow high";
const DRAFT_TITLE = "Draft the quarterly report and circulate it";

test.describe("quick-add bar", () => {
  test("focus, type, Enter — and focus stays in the bar for the next one", async ({
    todos,
    signedIn: page,
  }) => {
    // The empty state's call to action does not open a modal any more; it
    // points at the one capture path (§7.18).
    await page
      .getByRole("button", { name: EMPTY_STATE_ACTION_LABEL, exact: true })
      .click();
    await expect(todos.quickAddInput).toBeFocused();

    await todos.quickAddInput.pressSequentially(TODO_TITLE);
    await todos.quickAddInput.press("Enter");

    await expect(todos.row(TODO_TITLE)).toBeVisible();
    await expect(
      todos.toastTitles.filter({ hasText: addedToast(TODO_TITLE) }),
    ).toBeVisible();
    // A create destroys nothing, so it does not confirm — it offers Undo.
    await expect(todos.undoButton).toBeVisible();

    // The whole point of the bar: cleared, still focused, ready for the next.
    await expect(todos.quickAddInput).toHaveValue("");
    await expect(todos.quickAddInput).toBeFocused();

    // Burst capture — a second todo without touching the pointer once.
    await todos.quickAddInput.pressSequentially(SECOND_TITLE);
    await todos.quickAddInput.press("Enter");

    await expect(todos.row(SECOND_TITLE)).toBeVisible();
    await expect(todos.row(TODO_TITLE)).toBeVisible();
    await expect(todos.quickAddInput).toBeFocused();
  });

  test("reads a trailing day and priority, and stores both", async ({
    todos,
  }) => {
    await todos.quickAdd("Buy milk tomorrow high");

    await expect(todos.row(TODO_TITLE)).toBeVisible();

    // The chips said what would happen; the row is where it is checked.
    const row = todos.row(TODO_TITLE);

    await expect(row).toContainText("Tomorrow");
    await expect(row).toContainText("High");
    // The words the parser took are out of the title, not merely hidden.
    await expect(todos.rowByText("Buy milk tomorrow")).toHaveCount(0);
  });

  test("the chips show the reading before anything is saved, and Esc refuses it", async ({
    todos,
    signedIn: page,
  }) => {
    const dueChip = page.getByRole("button", {
      name: keepInTitleLabel(dueChipLabel("Tomorrow"), "tomorrow"),
    });

    await todos.quickAddInput.fill(LITERAL_TITLE);

    // Trailing, so rule 2 cannot save it — this is exactly the case the chips
    // exist for, and it is visible before Enter is ever pressed.
    await expect(dueChip).toBeVisible();
    // `exact`, so this is the visible hint and not the live region, which
    // carries the same sentence inside a longer announcement.
    await expect(page.getByText(CHIP_HINT, { exact: true })).toBeVisible();

    await todos.quickAddInput.press("Escape");

    // Refused from the keyboard, without leaving the input.
    await expect(dueChip).toHaveCount(0);
    await expect(todos.quickAddInput).toBeFocused();

    await todos.quickAddInput.press("Enter");

    await expect(todos.row(LITERAL_TITLE)).toBeVisible();
    await expect(
      todos.toastTitles.filter({ hasText: addedToast(LITERAL_TITLE) }),
    ).toBeVisible();
  });

  /**
   * Review B-1. Releasing a kind used to stop the scan at the unconsumed word,
   * so everything to its left became unreachable and the priority silently
   * reverted to medium with its chip gone.
   *
   * **Both word orders, deliberately.** The first version of this test passed
   * only because its fixture happened to put the priority last, which is the
   * one arrangement the bug could not reach.
   */
  for (const typed of [
    "Call mum about tomorrow high",
    "Call mum about high tomorrow",
  ]) {
    test(`pressing a chip keeps the other reading — "${typed}"`, async ({
      todos,
      signedIn: page,
    }) => {
      const dueChip = page.getByRole("button", {
        name: keepInTitleLabel(dueChipLabel("Tomorrow"), "tomorrow"),
      });
      const priorityChip = page.getByRole("button", {
        name: keepInTitleLabel(priorityChipLabel("High"), "high"),
      });

      await todos.quickAddInput.fill(typed);

      await expect(dueChip).toBeVisible();
      await expect(priorityChip).toBeVisible();

      await dueChip.click();

      // The date chip is gone; the priority chip is untouched.
      await expect(dueChip).toHaveCount(0);
      await expect(priorityChip).toBeVisible();

      await todos.quickAddInput.press("Enter");

      await expect(todos.row(LITERAL_TITLE)).toBeVisible();
      // The priority survived the release — this is the whole of B-1.
      await expect(todos.row(LITERAL_TITLE)).toContainText("High");
    });
  }

  /**
   * Review B-2. The release used to be a bare set of kinds that nothing ever
   * cleared, so one `Esc` left the parser dead for everything typed
   * afterwards — no chips, no date, no priority, and no signal that anything
   * had been switched off.
   */
  test("a refusal does not outlive the text it was made against", async ({
    todos,
    signedIn: page,
  }) => {
    const dueChip = page.getByRole("button", {
      name: keepInTitleLabel(dueChipLabel("Tomorrow"), "tomorrow"),
    });

    await todos.quickAddInput.fill(LITERAL_TITLE);
    await todos.quickAddInput.press("Escape");
    await expect(dueChip).toHaveCount(0);

    // Retyping is a fresh reading, not a dead parser.
    await todos.quickAddInput.fill("Buy milk tomorrow");
    await expect(dueChip).toBeVisible();

    await todos.quickAddInput.press("Enter");
    await expect(todos.row(TODO_TITLE)).toBeVisible();
    await expect(todos.row(TODO_TITLE)).toContainText("Tomorrow");

    // …and it did not leak into the todo after that one either.
    await todos.quickAddInput.fill("Call the vet high");
    await expect(
      page.getByRole("button", {
        name: keepInTitleLabel(priorityChipLabel("High"), "high"),
      }),
    ).toBeVisible();
  });

  /**
   * DEF-22. The refusal used to be keyed to the raw field value, so *any*
   * difference revoked it — including a keystroke that changes no word the
   * parser can see. The todo then saved short by a word, with a due date the
   * user had explicitly refused, announced by a success toast.
   *
   * The trailing space is the sharper of the two: `parseQuickAdd` trims and
   * splits on `/\s+/`, so this edit is invisible to the parser and cannot have
   * changed its reading. It is also invisible to the user, which is why the
   * feature's own doctrine ranks it worse than an unwanted chip.
   */
  test("a refusal survives a trailing space, which is not a word", async ({
    todos,
    signedIn: page,
  }) => {
    const dueChip = page.getByRole("button", {
      name: keepInTitleLabel(dueChipLabel("Tomorrow"), "tomorrow"),
    });

    await todos.quickAddInput.fill(LITERAL_TITLE);
    await dueChip.click();
    await expect(dueChip).toHaveCount(0);

    // One space at the end. No word added, none changed, none removed.
    await todos.quickAddInput.press("End");
    await todos.quickAddInput.press(" ");

    await expect(dueChip).toHaveCount(0);

    await todos.quickAddInput.press("Enter");

    await expect(todos.row(LITERAL_TITLE)).toBeVisible();
    // The refusal held: the word is in the title and the row carries no date
    // at all — `TodoDueDate` renders a `<time>` or nothing.
    await expect(todos.row(LITERAL_TITLE).locator("time")).toHaveCount(0);
  });

  /**
   * DEF-22, reproduction A. A correction three words from the tail cannot
   * change what rule 1 reads, so it cannot withdraw a refusal of that reading.
   */
  test("a refusal survives a typo fixed at the far end of the line", async ({
    todos,
    signedIn: page,
  }) => {
    const dueChip = page.getByRole("button", {
      name: keepInTitleLabel(dueChipLabel("Tomorrow"), "tomorrow"),
    });

    await todos.quickAddInput.fill("Cal mum about tomorrow");
    await dueChip.click();
    await expect(dueChip).toHaveCount(0);

    // Caret after `Cal`, then the missing `l` — the far end of the line.
    await todos.quickAddInput.press("Home");
    await todos.quickAddInput.press("ArrowRight");
    await todos.quickAddInput.press("ArrowRight");
    await todos.quickAddInput.press("ArrowRight");
    await todos.quickAddInput.press("l");

    await expect(todos.quickAddInput).toHaveValue(LITERAL_TITLE);
    await expect(dueChip).toHaveCount(0);

    await todos.quickAddInput.press("Enter");

    await expect(todos.row(LITERAL_TITLE)).toBeVisible();
    await expect(todos.row(LITERAL_TITLE).locator("time")).toHaveCount(0);
  });

  /**
   * The other half of DEF-22, and the reason the fix is a *tail* comparison
   * rather than a dead parser: changing the tail is still a fresh reading.
   */
  test("a refusal lapses when the tail itself changes", async ({
    todos,
    signedIn: page,
  }) => {
    const dueChip = page.getByRole("button", {
      name: keepInTitleLabel(dueChipLabel("Tomorrow"), "tomorrow"),
    });
    const todayChip = page.getByRole("button", {
      name: keepInTitleLabel(dueChipLabel("Today"), "today"),
    });

    await todos.quickAddInput.fill(LITERAL_TITLE);
    await dueChip.click();
    await expect(dueChip).toHaveCount(0);

    // A different tail word is a different reading, offered and refusable.
    await todos.quickAddInput.fill("Call mum about today");

    await expect(todayChip).toBeVisible();
  });

  /**
   * Review MA-1. A capital is how the user says the word is part of a name,
   * and it is a stronger guarantee than the chips: nothing fires, so there is
   * nothing to notice and nothing to undo.
   */
  test("a capitalised weekday is part of a name, not a due date", async ({
    todos,
    signedIn: page,
  }) => {
    await todos.quickAdd("Casual Friday");

    await expect(todos.row("Casual Friday")).toBeVisible();
    await expect(page.locator("main")).not.toContainText(NO_DATE_HEADING);
    await expect(todos.rowByText("Casual")).toContainText("Casual Friday");
  });

  test("More options carries the typed text into the modal", async ({
    todos,
    signedIn: page,
  }) => {
    await todos.quickAddInput.fill("Buy milk tomorrow high");
    await page.getByRole("button", { name: MORE_OPTIONS_LABEL, exact: true }).click();

    await expect(
      page.getByRole("heading", { name: CREATE_MODAL_HEADING }),
    ).toBeVisible();
    // Nothing has to be typed twice.
    await expect(
      page.getByRole("textbox", { name: TITLE_FIELD_LABEL }),
    ).toHaveValue(TODO_TITLE);
  });

  /**
   * DEF-23. `More options` used to empty the bar on the *press*, so a modal
   * the user backed out of took every character with it — no todo, no Undo,
   * nothing to recover. The bar keeps its text through a 500, a 502 and a
   * field error; a user-initiated, reversible dismissal cannot be the one path
   * that loses it (`docs/PRD.md` US-05).
   *
   * All three dismissals, because they are three different code paths in
   * `TodoFormModal`: `Cancel` goes through `closeForm`, while `Escape` and the
   * close `×` go through the overlay state directly.
   */
  for (const dismissal of ["Cancel", "Escape", "the close ×"] as const) {
    test(`More options keeps the typed text when the modal is dismissed with ${dismissal}`, async ({
      todos,
      signedIn: page,
    }) => {
      const dialog = page.getByRole("dialog");

      await todos.quickAddInput.fill(DRAFT_LINE);
      await page
        .getByRole("button", { name: MORE_OPTIONS_LABEL, exact: true })
        .click();

      await expect(
        page.getByRole("heading", { name: CREATE_MODAL_HEADING }),
      ).toBeVisible();
      // The handoff itself still works: nothing has to be typed twice.
      await expect(
        page.getByRole("textbox", { name: TITLE_FIELD_LABEL }),
      ).toHaveValue(DRAFT_TITLE);

      if (dismissal === "Cancel") {
        await dialog.getByRole("button", { name: CANCEL_LABEL, exact: true }).click();
      } else if (dismissal === "Escape") {
        await page.keyboard.press("Escape");
      } else {
        await dialog.getByRole("button", { name: "Close", exact: true }).click();
      }

      await expect(dialog).toHaveCount(0);

      // Nothing was committed, so nothing should have been lost.
      await expect(todos.quickAddInput).toHaveValue(DRAFT_LINE);
      await expect(todos.row(DRAFT_TITLE)).toHaveCount(0);
      await expectNoFalseSuccess(todos.toasts, addedToast(DRAFT_TITLE));

      // And the bar is still the bar: the text is submittable as it stands.
      await todos.quickAddInput.press("Enter");
      await expect(todos.row(DRAFT_TITLE)).toBeVisible();
    });
  }

  /** The other half of DEF-23: the bar clears on the save, not on the press. */
  test("More options clears the bar once the modal actually saves", async ({
    todos,
    signedIn: page,
  }) => {
    await todos.quickAddInput.fill(DRAFT_LINE);
    await page
      .getByRole("button", { name: MORE_OPTIONS_LABEL, exact: true })
      .click();

    await expect(
      page.getByRole("heading", { name: CREATE_MODAL_HEADING }),
    ).toBeVisible();

    await page.getByRole("button", { name: ADD_TODO_LABEL, exact: true }).click();

    await expect(todos.row(DRAFT_TITLE)).toBeVisible();
    // Saved once, and the bar is empty and ready for the next todo.
    await expect(todos.quickAddInput).toHaveValue("");
  });

  test("a 500 on create leaves the typed text in the input", async ({
    todos,
    signedIn: page,
  }) => {
    await page.route(TODO_LIST_URL, async (route) => {
      if (route.request().method() !== "POST") {
        await route.continue();

        return;
      }

      await fulfilApiError(route, 500, "INTERNAL", INTERNAL_ERROR_MESSAGE);
    });

    await todos.quickAdd("Buy milk tomorrow high");

    // The failure is reported…
    await expect(
      todos.toastTitles.filter({ hasText: INTERNAL_ERROR_MESSAGE }),
    ).toBeVisible();

    // …and nothing the user typed was taken from them.
    await expect(todos.quickAddInput).toHaveValue("Buy milk tomorrow high");
    await expect(todos.quickAddInput).toBeFocused();
    await expect(todos.row(TODO_TITLE)).toHaveCount(0);

    /*
      Read once, not retried: a retrying "count is zero" would sit and watch a
      false success toast expire and then report a pass (see
      `expectNoFalseSuccess`).
    */
    await expectNoFalseSuccess(todos.toasts, addedToast(TODO_TITLE));
    await expectNoTransportLeak(todos.toasts);
    await expect(todos.undoButton).toHaveCount(0);

    // And it is still submittable — the failure cost a keystroke, not a todo.
    await page.unroute(TODO_LIST_URL);
    await todos.quickAddInput.press("Enter");

    await expect(todos.row(TODO_TITLE)).toBeVisible();
  });

  test("an opaque 502 falls back to the copy deck rather than leaking axios", async ({
    todos,
    signedIn: page,
  }) => {
    await page.route(TODO_LIST_URL, async (route) => {
      if (route.request().method() !== "POST") {
        await route.continue();

        return;
      }

      await route.fulfill({
        status: 502,
        contentType: "text/html",
        body: "<html><body>502 Bad Gateway</body></html>",
      });
    });

    await todos.quickAdd(TODO_TITLE);

    await expect(
      todos.toastTitles.filter({ hasText: CREATE_FAILURE }),
    ).toBeVisible();
    await expect(todos.quickAddInput).toHaveValue(TODO_TITLE);
    await expectNoTransportLeak(todos.toasts);
  });

  test("an empty bar reports a field error and sends nothing", async ({
    todos,
    signedIn: page,
  }) => {
    let postCount = 0;

    page.on("request", (request) => {
      if (request.method() === "POST" && TODO_LIST_URL.test(request.url())) {
        postCount += 1;
      }
    });

    await todos.quickAddInput.focus();
    await page
      .getByRole("button", { name: QUICK_ADD_SUBMIT_LABEL, exact: true })
      .click();

    await expect(page.getByText("Enter a title.")).toBeVisible();
    expect(postCount, "an empty bar must not reach the API").toBe(0);
  });

  test("a create outside the active filter says so instead of vanishing", async ({
    todos,
    signedIn: page,
  }) => {
    await todos.quickAdd(TODO_TITLE);
    await expect(todos.row(TODO_TITLE)).toBeVisible();

    // Under "Completed", a brand-new todo cannot match — it is active.
    await page.goto("/todos?status=completed");
    await expect(todos.quickAddInput).toBeVisible();

    await todos.quickAdd(SECOND_TITLE);

    await expect(
      todos.toastTitles.filter({ hasText: "hidden by your filters" }),
    ).toBeVisible();
    // Not inserted: the filtered list still matches what a reload would show.
    await expect(todos.row(SECOND_TITLE)).toHaveCount(0);
    // The Undo is still offered — the todo exists, it is simply not in view.
    await expect(todos.undoButton).toBeVisible();

    // And it really was saved.
    await page.goto("/todos");
    await expect(todos.row(SECOND_TITLE)).toBeVisible();
  });

  /**
   * Review MA-3. A create through the bar no longer blanks the list: nothing
   * closed over it, the toast already said what happened, and under a filter
   * that hides the new row the flash returns an identical list. During burst
   * capture it would fire on every Enter.
   */
  test("a create through the bar never blanks the list to a skeleton", async ({
    todos,
  }) => {
    await todos.quickAdd(TODO_TITLE);
    await expect(todos.row(TODO_TITLE)).toBeVisible();

    await todos.quickAdd(SECOND_TITLE);
    /*
      Read once, not retried: the skeleton is transient by nature, so a
      retrying "is hidden" would simply wait for it to go and report a pass.
      The first row staying put across the second create is the observable
      that the skeleton would have destroyed.
    */
    await expectAbsentNow(
      todos.listSkeleton,
      "a quick-add create blanked the list to a skeleton",
    );
    await expect(todos.row(TODO_TITLE)).toBeVisible();
    await expect(todos.row(SECOND_TITLE)).toBeVisible();
  });

  /**
   * Review MA-5. The chips are buttons a screen reader only meets by tabbing
   * to them, so without a live region the one thing §7.17 calls
   * non-negotiable — that the reading is visible before it is committed — was
   * available to sighted users only.
   */
  test("the reading is announced, not only drawn", async ({
    todos,
    signedIn: page,
  }) => {
    const liveRegion = page.locator("main [role=status][aria-live=polite]");

    // Nothing to say before anything is read.
    await expect(liveRegion).toHaveText("");

    await todos.quickAddInput.fill("Buy milk tomorrow high");

    await expect(liveRegion).toContainText(CHIP_GROUP_LABEL);
    await expect(liveRegion).toContainText(dueChipLabel("Tomorrow"));
    await expect(liveRegion).toContainText(priorityChipLabel("High"));
    // The way out is announced with it, or the mitigation is inaudible.
    await expect(liveRegion).toContainText(CHIP_HINT);

    await todos.quickAddInput.press("Escape");
    await expect(liveRegion).toHaveText("");
  });

  test("the bar is present with no todos, and under a filter matching none", async ({
    todos,
    signedIn: page,
  }) => {
    // Brand-new account, empty list. A capture bar that appears only once you
    // have something to capture is not a capture bar.
    await expect(todos.quickAddInput).toBeVisible();

    await todos.quickAdd(TODO_TITLE);
    await expect(todos.row(TODO_TITLE)).toBeVisible();

    // Medium by default, so this filter matches nothing at all.
    await page.goto("/todos?priority=high");

    await expect(page.getByText("No todos match these filters")).toBeVisible();
    await expect(todos.quickAddInput).toBeVisible();
  });
});
