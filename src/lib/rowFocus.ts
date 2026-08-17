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
 */

/**
 * The row checkboxes, in visual order. Scoped to `<main>` because the toast
 * region is a portal in `<body>` and renders list items of its own.
 */
const ROW_CHECKBOX_SELECTOR = 'main input[type="checkbox"]';

/**
 * The action on the toast currently in front. HeroUI stamps `data-frontmost`
 * on it, which is what distinguishes the toast just raised from the stack of
 * older ones still sliding out behind it.
 */
const FRONTMOST_TOAST_ACTION_SELECTOR =
  '[data-slot="toast"][data-frontmost="true"] [data-slot="toast-action-button"]';

/**
 * How long step 2 will wait for the view transition to commit the toast.
 * ~1s at 60fps — comfortably longer than the 350–400ms slide plus the doubled
 * window a close-then-add chain costs, and far short of the 12s Undo timeout,
 * so a toast that never arrives leaves focus parked on the row from step 1
 * rather than hanging.
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

/**
 * Whether the toast step is still allowed to take focus.
 *
 * Two states qualify, and the second is the one that is easy to leave out:
 *
 * - Focus is on a row — where step 1 put it, and the user has not moved since.
 * - Focus is on `<body>`, i.e. **nowhere**. That is what an emptied list
 *   leaves: toggling the only row in an active list gives step 1 no row to
 *   land on, so it returns `false` with focus still on the floor. Requiring a
 *   row here would make the rescue decline in the one state where nothing else
 *   can catch focus at all — the user who has just finished their last todo,
 *   and for whom US-07 makes the toast the only route back.
 *
 * Anything else means the user has taken focus somewhere themselves, and it is
 * not ours to move.
 */
export const focusIsUnclaimed = (): boolean => {
  const active = document.activeElement;

  if (active === null || active === document.body) return true;

  return rowCheckboxes().includes(active as HTMLElement);
};

const nextFrame = (): Promise<void> =>
  new Promise((resolve) => {
    requestAnimationFrame(() => resolve());
  });

/** The little of a row checkbox the wait loop actually needs. */
interface FocusTarget {
  focus: () => void;
}

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
 */
export const focusRowAfterRemoval = async (
  anchor: RowFocusAnchor,
  deps: RowFocusDeps = browserDeps,
): Promise<boolean> => {
  for (let frame = 0; frame < MAX_WAIT_FRAMES; frame += 1) {
    const rows = deps.readRows();

    if (rows.length < anchor.rowCount) {
      const index = nextFocusIndex(anchor.index, rows.length);

      if (index === null) return false;

      const target = rows[index];

      target?.focus();

      return deps.getActiveElement() === target;
    }

    await deps.waitFrame();
  }

  return false;
};

/**
 * Moves focus onto the frontmost toast's action once it exists.
 *
 * Bounded rather than open-ended, and it never moves focus that the user has
 * since taken somewhere themselves — `shouldStillMove` is re-read on the frame
 * the button appears, not on the frame the wait started.
 */
export const focusFrontmostToastAction = async (
  shouldStillMove: () => boolean,
): Promise<boolean> => {
  for (let frame = 0; frame < MAX_WAIT_FRAMES; frame += 1) {
    const action = document.querySelector<HTMLElement>(
      FRONTMOST_TOAST_ACTION_SELECTOR,
    );

    if (action !== null) {
      if (!shouldStillMove()) return false;

      action.focus();

      return document.activeElement === action;
    }

    await nextFrame();
  }

  return false;
};
