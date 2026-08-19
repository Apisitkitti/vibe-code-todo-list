/**
 * Where focus goes when a mutation destroys the control that had it.
 *
 * Toggling a row under a status filter removes it (`docs/PRD.md` US-07), and
 * the checkbox the user was standing on goes with it. Nothing caught that
 * focus, so it fell to `<body>` — and from `<body>` the Undo in the success
 * toast is at the far end of the document, three tab stops behind every
 * remaining row, against a 12s timeout. QA measured it unreachable at 19 todos
 * at any human pace (`docs/QA-REPORT.md` §A3), which makes the toast a
 * recovery path that exists only for short lists.
 *
 * Two moves fix it, in this order:
 *
 * 1. **Land focus back in the list**, on the row that took the removed row's
 *    place.
 * 2. **Then move to the toast's action**, which is one deliberate hop rather
 *    than a race down the list.
 *
 * **Why step 1 is first, and why it is not redundant.** Step 2 is what
 * satisfies the reachability criterion, and on the happy path it catches focus
 * whether or not step 1 ran — disabling step 1 leaves every reachability test
 * green. Step 1 earns its place on the paths where step 2 *cannot* run: a
 * refused write raises no Undo toast at all, and `focusIsUnclaimed` declines
 * when the user has already taken focus somewhere themselves. On those paths
 * step 1 is the whole of the fix, and `e2e/undo-focus.spec.ts` pins it with a
 * 500 on the status write. Doing it first is what makes it a fallback rather
 * than a cleanup: focus is somewhere useful from the first frame, whatever
 * step 2 goes on to do.
 *
 * An earlier version of this comment claimed step 1 also supplied the toast
 * region with a restore target (`lastFocused` in react-aria's
 * `useToastRegion`, which `react-aria-components` does delegate to). That hook
 * really does record and restore — but it is **not** what keeps focus alive
 * here, and the claim was never tested: skipping step 1 entirely leaves the
 * "focus is not lost when the toast goes away" assertion passing. The restore
 * path also cannot be reached by expiry, because the Undo timer pauses while
 * focus is inside the region. The reason above is the one that survives a
 * dependency upgrade.
 *
 * Step 2 waits for a frame at a time because HeroUI mounts every toast inside
 * `document.startViewTransition` (`docs/DESIGN.md` §4.10) — the toast is
 * queued before it is in the DOM, so reading for the button synchronously
 * finds nothing. This is the same "read before it rendered" trap that has
 * already produced two defects on this feature, so it is waited on rather than
 * assumed.
 *
 * **Step 2 names the toast it is waiting for, and waiting was never the
 * missing piece (QA DEF-25, DEF-26).** It used to ask for whichever toast was
 * frontmost, which is a *position* in a stack the caller does not control. In
 * the frames between `dismissUndo` and the success toast mounting, that
 * position holds the toast raised before this one — after a burst of
 * quick-adds, some other todo's `added` toast, whose Undo is a `DELETE`. The
 * poll matched it, focused it, and the user's next `Enter` destroyed a todo
 * they had never touched. Six of six on QA's repro, confirmed against the
 * database.
 *
 * **That `DELETE` no longer exists.** `added` toasts carry no action at all
 * now (`docs/DESIGN.md` §7.15), so the worst a mis-selected toast can do
 * today is revert somebody else's toggle or edit. **Nothing below is softened
 * for it.** Landing on the wrong toast is still the wrong mutation under the
 * user's next keypress, it is still the mechanism behind DEF-26's lost focus,
 * and "frontmost" still never meant "mine" — the consequence shrank, the
 * defect did not. `added` receipts are also still in the stack this poll
 * walks past; they simply have no button left to be matched by.
 *
 * The same wrong choice is what loses focus altogether. Both toasts in that
 * window are on their way out — `dismissUndo`'s `toast.close` is queued behind
 * the same serialized view transition as the add
 * (`@heroui/react/dist/components/toast/toast-queue.js`), so it lands *after*
 * step 2 has already focused its victim. react-aria's `useToastRegion` then
 * sees the focused toast removed and re-homes focus onto a neighbouring toast
 * *container* — an element with no action on it — or, when its own index
 * bookkeeping has not caught up, drops it on `<body>`. That is DEF-26 in full:
 * not a rescue that failed to run, but a rescue that ran onto a doomed toast
 * and had focus taken back off it a frame later.
 *
 * So the cure is identity, not patience. A longer wait would only shrink the
 * window in which the wrong toast is frontmost; it cannot close it, because
 * "frontmost" never meant "mine". Each Undo is minted with a token that goes
 * onto its own action button, and step 2 waits for *that* button. The toast it
 * lands on is the one this toggle raised, which is not being closed, so
 * nothing takes focus off it and `Enter` undoes the toggle the user just made.
 */

/**
 * The row checkboxes, in visual order. Scoped to `<main>` because the toast
 * region is a portal in `<body>` and renders list items of its own.
 */
const ROW_CHECKBOX_SELECTOR = 'main input[type="checkbox"]';

/**
 * Names *which* Undo an action button is, rather than where it happens to sit.
 *
 * HeroUI stamps `data-frontmost` on whichever toast is at the top of the
 * stack, and there is no attribute anywhere that says "the toast this call
 * raised" — the queue key `toast.success` returns never reaches the DOM. So
 * the app supplies its own: `showUndoableSuccess` mints a token per Undo and
 * hands it to the action button through `actionProps`, which HeroUI spreads
 * onto the button and react-aria's `filterDOMProps` passes through because it
 * is a `data-*` attribute.
 *
 * This is the whole of the DEF-25 fix. A positional selector cannot express
 * "the one I just raised" and must not be asked to.
 */
export const UNDO_TOKEN_ATTRIBUTE = "data-undo-token";

/**
 * The token as `actionProps` wants it.
 *
 * A `Record<string, string>` rather than a literal because HeroUI's
 * `ButtonProps` has no index signature, so a `data-*` key written inline is an
 * excess property. Spreading is what gets it past the check without loosening
 * the button's own types.
 */
export const undoTokenProps = (token: string): Record<string, string> => ({
  [UNDO_TOKEN_ATTRIBUTE]: token,
});

/**
 * Monotonic, so no two Undos on screen at once can share a token — including
 * the two that belong to the **same todo**, which is the case a todo-id would
 * get wrong: a toggle dismisses that row's outstanding Undo — its edit's,
 * since an `added` receipt no longer registers one — and raises its own, so
 * for a few frames both are in the DOM under the same id. The one being closed
 * is precisely the one that must not take focus.
 */
let undoTokenSeq = 0;

export const nextUndoToken = (): string => {
  undoTokenSeq += 1;

  return `undo-${undoTokenSeq}`;
};

const undoActionSelector = (token: string) =>
  `[data-slot="toast-action-button"][${UNDO_TOKEN_ATTRIBUTE}="${token}"]`;

/**
 * How long step 2 will wait for the view transition to commit the toast.
 * ~1s at 60fps — comfortably longer than the 350–400ms slide plus the doubled
 * window a close-then-add chain costs, and far short of the 12s Undo timeout,
 * so a toast that never arrives leaves focus parked on the row from step 1
 * rather than hanging.
 *
 * **This budget is only now actually spent.** While step 2 selected by stack
 * position it matched an already-mounted toast on the first frame every time,
 * so the loop never ran and the number was never tested by anything. Waiting
 * for *this* toggle's own toast, it is: measured worst case is 37 frames —
 * a toggle fired the instant after a quick-add, so the `dismissUndo` close is
 * queued behind the add's still-running transition and the success toast
 * behind that. Counting frames rather than milliseconds is what keeps the
 * margin on a slow machine, where the transitions cost the same wall time but
 * the budget stretches with the frame rate.
 */
export const MAX_WAIT_FRAMES = 60;

/**
 * Where the user was standing when the mutation started: which row held focus,
 * and how many rows there were. Both halves are needed, and both have to be
 * read before the flip — the index says where to land, and the count is how
 * the wait below knows the removal has actually happened.
 */
export interface RowFocusAnchor {
  index: number;
  rowCount: number;
}

/**
 * The index to focus after the row at `removedIndex` is gone.
 *
 * The row that slid up into the vacated position, which keeps the user where
 * they were looking. Removing the last row falls back to the new last row, and
 * an emptied list has nowhere to go.
 */
export const nextFocusIndex = (
  removedIndex: number,
  remainingCount: number,
): number | null => {
  if (remainingCount <= 0 || removedIndex < 0) return null;

  return Math.min(removedIndex, remainingCount - 1);
};

/** The row checkboxes on screen right now, in document order. */
export const rowCheckboxes = (): HTMLElement[] =>
  Array.from(document.querySelectorAll<HTMLElement>(ROW_CHECKBOX_SELECTOR));

/**
 * Where focus is sitting in the list, or `null` if it is not in the list at
 * all. Read *before* the mutation, because the mutation is what destroys the
 * answer.
 */
export const readFocusedRow = (): RowFocusAnchor | null => {
  const checkboxes = rowCheckboxes();
  const index = checkboxes.indexOf(document.activeElement as HTMLElement);

  if (index < 0) return null;

  return { index, rowCount: checkboxes.length };
};

/** The little of a row checkbox the wait loop actually needs. */
export interface FocusTarget {
  focus: () => void;
}

/**
 * What `focusIsUnclaimed` reads the world through.
 *
 * Injectable for the same reason the two loops below are: the property under
 * test is which *element* the guard accepts, and a `node` test environment has
 * no `document` to arrange one in.
 */
export interface UnclaimedFocusDeps {
  getActiveElement: () => unknown;
  getBody: () => unknown;
}

const browserUnclaimedDeps: UnclaimedFocusDeps = {
  getActiveElement: () => document.activeElement,
  getBody: () => document.body,
};

/**
 * Whether the toast step is still allowed to take focus.
 *
 * Two states qualify, and the second is the one that is easy to leave out:
 *
 * - Focus is **exactly where step 1 put it** — `rescued` is the element
 *   `focusRowAfterRemoval` focused, and it is still the active one.
 * - Focus is on `<body>`, i.e. **nowhere**. That is what an emptied list
 *   leaves: toggling the only row in an active list gives step 1 no row to
 *   land on, so it returns `null` with focus still on the floor. Requiring an
 *   element here would make the rescue decline in the one state where nothing
 *   else can catch focus at all — the user who has just finished their last
 *   todo, and for whom US-07 makes the toast the only route back.
 *
 * Anything else means the user has taken focus somewhere themselves, and it is
 * not ours to move.
 *
 * **`rescued` is an identity, not a shape (QA DEF-28).** This used to ask
 * whether the active element was *any* row checkbox, which is a description
 * satisfied by every row on screen — so a user who tabbed from the rescued row
 * to a neighbouring one, during a write slow enough to leave time for it, was
 * indistinguishable from a user who had not moved at all, and had focus taken
 * off the row they had deliberately chosen. QA reproduced it 3 of 3 on a
 * 2500ms status write: the next `Space` went to the toast's `Undo` and reverted
 * a completion instead of making the one they were standing on.
 *
 * The guard was already correct for focus that leaves the list altogether —
 * `undo-focus.spec.ts` pins the quick-add case — which is exactly why the suite
 * stayed green through it. Comparing against the one element step 1 focused is
 * the same shape as the DEF-25 fix one level up: identity, not position, and
 * not a category that happens to contain the right answer.
 */
export const focusIsUnclaimed = (
  /*
    Typed rather than `unknown`, which is what `getActiveElement` needs on the
    other side of the comparison. DEF-28 *was* this guard comparing against the
    wrong thing, and `unknown` accepts every wrong thing: passing the undo token
    here would typecheck, lint, build, and then silently decline forever. The
    review's own mutation passing `null` cleared all three gates and only fell
    over five tests deep in the e2e suite (review F3).
  */
  rescued: FocusTarget | null,
  deps: UnclaimedFocusDeps = browserUnclaimedDeps,
): boolean => {
  const active = deps.getActiveElement();

  if (active === null || active === deps.getBody()) return true;

  return active === rescued;
};

const nextFrame = (): Promise<void> =>
  new Promise((resolve) => {
    requestAnimationFrame(() => resolve());
  });

/**
 * What `focusRowAfterRemoval` reads the world through.
 *
 * Injectable for one reason: the loop below cannot be driven off its first
 * iteration in a real browser. React commits a discrete-input update
 * synchronously, so the row is gone by the first `requestAnimationFrame` every
 * time — measured at `frame=1` for 4 rows unthrottled and 40 rows at 20× CPU
 * throttling alike. That leaves the wait itself unexercised, and a fixed
 * one-frame version passing for reasons that have nothing to do with being
 * correct.
 *
 * The alternative was to put the optimistic `setResult` behind
 * `startTransition` so React yields mid-commit. That would pin the loop, but
 * by slowing the very thing §8.3.2 asks to be immediate — the box ticking
 * under the finger — which is paying in product behaviour for a test. Driving
 * the loop directly costs nothing at runtime: production passes no `deps` and
 * gets the browser exactly as before.
 */
export interface RowFocusDeps {
  readRows: () => readonly FocusTarget[];
  getActiveElement: () => unknown;
  waitFrame: () => Promise<void>;
}

const browserDeps: RowFocusDeps = {
  readRows: rowCheckboxes,
  getActiveElement: () => document.activeElement,
  waitFrame: nextFrame,
};

/**
 * Puts focus back in the list once the row has actually gone.
 *
 * **Waits for the row count to drop rather than for a fixed number of
 * frames.** The removal is a React state update, and a frame is not a commit:
 * moving on the next `requestAnimationFrame` lands focus on the row that is
 * still there and about to be unmounted, and React then destroys it — which
 * puts focus back on `<body>` and looks exactly like no fix at all. This is
 * the same class of mistake as reading a count before the button had rendered
 * (`docs/DESIGN.md` §4.10); the cure is to wait on the condition, not the
 * clock.
 *
 * In today's React the condition happens to be true on the first check, so
 * this is insurance rather than a bug being worked around. It is kept, and
 * pinned in `tests/unit/rowFocus.test.ts`, because the thing it insures
 * against — a commit that lands a frame later than the caller assumed — is a
 * scheduling detail no caller should have to re-verify after every upgrade.
 *
 * **Returns the element it focused**, or `null` for every way of not having
 * focused one — the list emptied, the removal never landed, or the row refused
 * the focus. That element is the anchor `focusIsUnclaimed` compares against, so
 * step 2 can tell "still where I left it" from "some other row" (QA DEF-28). A
 * boolean could only say that focus went *somewhere*, which is the ambiguity
 * the defect lived in.
 */
export const focusRowAfterRemoval = async (
  anchor: RowFocusAnchor,
  deps: RowFocusDeps = browserDeps,
): Promise<FocusTarget | null> => {
  for (let frame = 0; frame < MAX_WAIT_FRAMES; frame += 1) {
    const rows = deps.readRows();

    if (rows.length < anchor.rowCount) {
      const index = nextFocusIndex(anchor.index, rows.length);

      if (index === null) return null;

      const target = rows[index];

      target?.focus();

      return deps.getActiveElement() === target ? (target ?? null) : null;
    }

    await deps.waitFrame();
  }

  return null;
};

/**
 * Names a row's reschedule trigger by the todo it belongs to (backlog #5).
 *
 * The same shape of answer as `UNDO_TOKEN_ATTRIBUTE` above, for a different
 * question: not "which toast did I raise" but "which row did I act on". A
 * positional selector would be wrong for the same reason it was wrong there —
 * the row's position is exactly what a reschedule changes.
 */
export const RESCHEDULE_TRIGGER_ATTRIBUTE = "data-reschedule-for";

/** The attribute as a spreadable prop; see `undoTokenProps` for why. */
export const rescheduleTriggerProps = (
  todoId: string,
): Record<string, string> => ({
  [RESCHEDULE_TRIGGER_ATTRIBUTE]: todoId,
});

const rescheduleTriggerSelector = (todoId: string) =>
  `main [${RESCHEDULE_TRIGGER_ATTRIBUTE}="${CSS.escape(todoId)}"]`;

/** What `restoreRescheduleFocus` reads the world through. */
export interface RestoreFocusDeps {
  findTrigger: (todoId: string) => FocusTarget | null;
  getActiveElement: () => unknown;
  getBody: () => unknown;
  waitFrame: () => Promise<void>;
}

const browserRestoreDeps: RestoreFocusDeps = {
  findTrigger: (todoId) =>
    document.querySelector<HTMLElement>(rescheduleTriggerSelector(todoId)),
  getActiveElement: () => document.activeElement,
  getBody: () => document.body,
  waitFrame: nextFrame,
};

/**
 * Puts focus back on the control the user pressed, after the row it lives on
 * has been rebuilt somewhere else in the list.
 *
 * **This is a restoration, not the redirection the toggle needs, and the
 * difference is the whole reason it is a separate function.** A toggle under a
 * status filter destroys the row: there is nothing to go back to, so focus is
 * moved to the toast's Undo and the user pays the surprise §6.8 describes. A
 * reschedule destroys nothing — the row is still on screen, still the user's,
 * just under a different heading — so the right place for focus is the button
 * they pressed, and moving them to a toast instead would arm an Undo under
 * their next `Space` for no reason at all.
 *
 * The focus is lost in the first place because the list is cut into sections
 * (`TodoGroupedList`): a todo moving from `Upcoming` to `Today` is rendered
 * under a different `<section>`, so React unmounts the row and builds a new
 * one rather than moving the DOM node, and the trigger goes with it. Nothing
 * about that is visible on screen — the row appears to slide — which is
 * exactly the kind of focus loss that only shows up in keyboard use.
 *
 * **It only ever acts on focus that is already on the floor.** `<body>` (or
 * `null`) is what an unmounted focused element leaves behind; a row that did
 * *not* change section leaves focus on the trigger, and this declines and
 * expires quietly. So it cannot take focus the user has moved themselves, and
 * it cannot fire on the common case where nothing was lost — which also means
 * there is no version of this that fights react-aria's own restore-focus-to-
 * trigger on menu close.
 *
 * Bounded by `MAX_WAIT_FRAMES` for the same reason step 2 is: the list refetch
 * has to land first, and waiting on the condition rather than the clock is what
 * makes that safe on a slow machine.
 */
export const restoreRescheduleFocus = async (
  todoId: string,
  deps: RestoreFocusDeps = browserRestoreDeps,
): Promise<boolean> => {
  for (let frame = 0; frame < MAX_WAIT_FRAMES; frame += 1) {
    const active = deps.getActiveElement();

    if (active === null || active === deps.getBody()) {
      const trigger = deps.findTrigger(todoId);

      if (trigger !== null) {
        trigger.focus();

        return deps.getActiveElement() === trigger;
      }
    }

    await deps.waitFrame();
  }

  return false;
};

/**
 * What `focusUndoAction` reads the world through.
 *
 * Injectable for the same reason `RowFocusDeps` is, and for one more: the
 * property under test is a *negative* — that a toast which is not this one is
 * never focused, however long it sits there and however frontmost it looks. A
 * browser test can show the right toast taking focus; only driving the lookup
 * directly can show the wrong one being refused every frame it is offered.
 */
export interface UndoActionDeps {
  findAction: (token: string) => FocusTarget | null;
  getActiveElement: () => unknown;
  waitFrame: () => Promise<void>;
}

const browserUndoDeps: UndoActionDeps = {
  findAction: (token) =>
    document.querySelector<HTMLElement>(undoActionSelector(token)),
  getActiveElement: () => document.activeElement,
  waitFrame: nextFrame,
};

/**
 * Moves focus onto **this** toggle's Undo once it exists.
 *
 * `token` is the identity minted for that one toast, so the wait cannot be
 * satisfied by an older toast, by a toast for another todo, or by the Undo for
 * this same todo that the toggle has just asked to close. Every one of those
 * is what the previous frontmost-selection version settled for, and each of
 * them is a different mutation under the user's next keypress.
 *
 * Bounded rather than open-ended, and it never moves focus that the user has
 * since taken somewhere themselves — `shouldStillMove` is re-read on the frame
 * the button appears, not on the frame the wait started.
 */
export const focusUndoAction = async (
  token: string,
  shouldStillMove: () => boolean,
  deps: UndoActionDeps = browserUndoDeps,
): Promise<boolean> => {
  for (let frame = 0; frame < MAX_WAIT_FRAMES; frame += 1) {
    const action = deps.findAction(token);

    if (action !== null) {
      if (!shouldStillMove()) return false;

      action.focus();

      return deps.getActiveElement() === action;
    }

    await deps.waitFrame();
  }

  return false;
};
