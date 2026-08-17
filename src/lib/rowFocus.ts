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
 * Two moves fix it, and they have to happen in this order:
 *
 * 1. **Land focus back in the list**, on the row that took the removed row's
 *    place. This is what stops focus being lost at all, and it is also what
 *    gives the toast region something to hand focus *back* to: react-aria
 *    records the element focus arrived from (`lastFocused` in
 *    `useToastRegion`) and restores to it when the last toast goes away. Enter
 *    the region from `<body>` and there is nothing to restore, so the toast
 *    expiring drops focus a second time.
 * 2. **Then move to the toast's action**, which is now one deliberate hop
 *    rather than a race down the list.
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
const MAX_WAIT_FRAMES = 60;

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

const nextFrame = (): Promise<void> =>
  new Promise((resolve) => {
    requestAnimationFrame(() => resolve());
  });

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
 */
export const focusRowAfterRemoval = async (
  anchor: RowFocusAnchor,
): Promise<boolean> => {
  for (let frame = 0; frame < MAX_WAIT_FRAMES; frame += 1) {
    const checkboxes = rowCheckboxes();

    if (checkboxes.length < anchor.rowCount) {
      const index = nextFocusIndex(anchor.index, checkboxes.length);

      if (index === null) return false;

      checkboxes[index]?.focus();

      return document.activeElement === checkboxes[index];
    }

    await nextFrame();
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
