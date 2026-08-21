import { ToastQueue, type ToastContentValue } from "@heroui/react";

/**
 * The app's toast queue, and the one rule about toasts that carry an action.
 *
 * Two things live here rather than in a screen, and they are one change:
 *
 * 1. **The queue is built with `wrapUpdate: fn => fn()`**, which is the escape
 *    hatch `docs/DESIGN.md` §4.10 names. HeroUI's default runs every add and
 *    every close inside `document.startViewTransition`, and while a transition
 *    is running the `::view-transition` snapshot layer takes hit-testing — so a
 *    toast's action button is visible, mounted, focusable and completely inert.
 * 2. **At most one action-bearing toast stands at a time.** Raising one closes
 *    whichever one was standing, whatever record it belonged to.
 *
 * Neither can ship without the other. Under the cap every action toast becomes
 * a close-then-add, and a close-then-add is where the dead window is worst:
 * the close animates first and the add is queued behind it, so the button does
 * not exist until the close finishes and is then inert for its own transition.
 * Measured on this branch, in this project's own Chromium, with a real pointer
 * press delivered through the browser's input pipeline:
 *
 * | from the user's press | first press that lands |
 * |---|---|
 * | lone add, default `wrapUpdate` | between 357ms and 417ms |
 * | close-then-add, default `wrapUpdate` | between 729ms and 760ms |
 *
 * That is §4.10's 350–400ms and 700–800ms, reproduced rather than inherited.
 * `e2e/toast-dead-window.spec.ts` is the harness; while the press is swallowed
 * `document.elementFromPoint` at the button's own centre returns `<main>`,
 * which is the snapshot layer answering for it.
 *
 * **What it costs.** The slide is defined entirely on `::view-transition-old`
 * and `::view-transition-new` (`@heroui/styles/dist/components/toast.css`), so
 * removing the transition removes the animation: toasts now cut in and out
 * instead of sliding. §4.10 states that trade and calls it worth making "the
 * moment an action matters more than the animation". Under a single slot every
 * repeat write is a replacement, so it is that moment.
 */

type ActionProps = NonNullable<ToastContentValue["actionProps"]>;

/**
 * The escape hatch itself. Named rather than inlined because the whole of
 * §4.10 is the difference between this and HeroUI's default.
 */
const applyImmediately = (update: () => void) => {
  update();
};

export const appToastQueue = new ToastQueue({ wrapUpdate: applyImmediately });

/**
 * The action toast currently standing, or `null`.
 *
 * **Identity, three ways, because three different questions are asked of it.**
 * `todoId` answers "is the outstanding Undo about the row I am writing to";
 * `token` answers "is the button that was just pressed the one this slot
 * holds"; `key` is what the queue needs to close it. Deriving any of them from
 * another is the mistake this codebase keeps paying for.
 *
 * Module state rather than a ref, because the queue it guards is module state
 * too: one toast region exists for the whole app, so the slot that describes
 * it cannot be scoped to a component that happens to be mounted.
 */
interface ActionSlot {
  todoId: string;
  token: string;
  key: string;
}

let outstandingAction: ActionSlot | null = null;

const closeOutstanding = () => {
  if (outstandingAction === null) return;

  appToastQueue.close(outstandingAction.key);
  outstandingAction = null;
};

const raise = (
  message: string,
  variant: ToastContentValue["variant"],
  options?: { timeout?: number; actionProps?: ActionProps },
): string =>
  appToastQueue.add(
    { title: message, variant, actionProps: options?.actionProps },
    { timeout: options?.timeout },
  );

/**
 * The subset of HeroUI's `toast` this app uses, over the app's own queue.
 *
 * A facade rather than the exported `toast`, because that one is bound at
 * module load to a queue built with the default `wrapUpdate` and there is no
 * way to re-point it: `createToastFunction` is not exported, and `toastQueue`
 * is a `const` (`node_modules/@heroui/react/dist/components/toast/toast-queue.js`).
 * Taking the option means owning the queue, and owning the queue means owning
 * this much of the surface.
 *
 * Timeouts match HeroUI's exactly — `add` applies `DEFAULT_TOAST_TIMEOUT` when
 * none is given — so a caller that passes no `timeout` gets the same 4s it got
 * before.
 */
export const toast = {
  success: (message: string, options?: { timeout?: number }): string =>
    raise(message, "success", options),
  danger: (message: string, options?: { timeout?: number }): string =>
    raise(message, "danger", options),
  close: (key: string): void => appToastQueue.close(key),
};

export interface ActionToastRequest {
  /** The record this toast's action would act on. */
  todoId: string;
  /** This toast's own identity, from `nextUndoToken`. */
  token: string;
  message: string;
  timeout: number;
  actionProps: ActionProps;
}

/**
 * Raises an action-bearing toast, closing whichever one was standing.
 *
 * **The cap is enforced here and nowhere else**, which is what makes it a
 * property of the code rather than of every call site remembering. It is
 * deliberately not `maxVisibleToasts`: that option is documented "visual only"
 * and HeroUI hands the underlying react-stately queue
 * `DEFAULT_RAC_MAX_VISIBLE_TOAST` regardless, so it hides toasts rather than
 * closing them — and hiding is exactly wrong here, because a hidden toast's
 * Undo is still mounted, still focusable and still pressable.
 *
 * **Receipts are outside the cap and do not come through this function.** A
 * receipt has no action, so neither thing the cap protects applies to it: there
 * is nothing to press and nothing describing a state the row has since left.
 * `Todo “x” added — hidden by your filters` (§7.17) is the only account a user
 * ever gets of a row a filter swallowed on write, and a cap that closed it
 * would be spending the one message that cannot be re-derived from the screen.
 */
export const showActionToast = ({
  todoId,
  token,
  message,
  timeout,
  actionProps,
}: ActionToastRequest): string => {
  closeOutstanding();

  const key = raise(message, "success", { timeout, actionProps });

  outstandingAction = { todoId, token, key };

  return key;
};

/**
 * Disarms the outstanding action toast when it belongs to `todoId`.
 *
 * Scoped to the record on purpose, even though the slot holds only one. The
 * callers are writes that have not happened yet — a toggle, a reschedule, a
 * delete — and a write that goes on to fail must leave *another* row's Undo
 * exactly where it was. Only `showActionToast` evicts across records, and it
 * only runs once a write has succeeded.
 *
 * Returns whether it dismissed anything, which is what makes it usable as a
 * re-entrancy guard: the read and the clear are one step.
 */
export const dismissActionToast = (todoId: string): boolean => {
  if (outstandingAction?.todoId !== todoId) return false;

  closeOutstanding();

  return true;
};

/**
 * Claims a press on the action button carrying `token`, once.
 *
 * **Keyed on the toast's own token, not on its record**, and that is the
 * difference between this and the map it replaces. Closing a toast does not
 * unmount it — HeroUI defers the removal — so for a window after a repeat
 * write the DOM holds two action buttons for the same todo, the outgoing one
 * and the incoming one. A guard keyed on the todo id says yes to both, so a
 * press on the *stale* button ran the stale reversal and closed the live
 * toast. A token says yes to exactly the toast the slot is holding.
 *
 * That window used to be an edge case and the cap makes it the ordinary path,
 * which is why it is fixed here rather than filed.
 */
export const claimActionPress = (token: string): boolean => {
  if (outstandingAction?.token !== token) return false;

  closeOutstanding();

  return true;
};
