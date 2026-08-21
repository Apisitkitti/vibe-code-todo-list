import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * The action-toast slot's own rules, tested where they can be stated.
 *
 * **Why this is not an e2e test.** Two of these rules guard a window that the
 * other half of this change closes. With `wrapUpdate: fn => fn()` the queue no
 * longer defers a close behind a view transition, so the outgoing toast is
 * unmounted before the incoming one is added — measured on this branch, the
 * peak number of action buttons in the DOM during a repeat write is **1**,
 * where under HeroUI's default it was 2. The browser therefore cannot reach
 * the case `claimActionPress` exists for, and a mutation that removes the
 * token guard survives the whole Playwright suite. That is an honest result,
 * not a gap to paper over with a contrived spec: the guard is defence in
 * depth, and depth is exactly what a unit test is for.
 *
 * The queue is stubbed rather than run, because what is under test is the
 * bookkeeping — which toast is standing, and which press is allowed to act on
 * it — and none of that involves rendering anything.
 */

interface Added {
  key: string;
  title: string;
  /** `undefined` means the caller passed none, so the queue's default applies. */
  timeout: number | undefined;
}

const added: Added[] = [];
const closed: string[] = [];

vi.mock("@heroui/react", () => {
  let nextKey = 0;

  class ToastQueue {
    add(content: { title: string }, options?: { timeout?: number }) {
      nextKey += 1;

      const key = `key-${nextKey}`;

      added.push({ key, title: content.title, timeout: options?.timeout });

      return key;
    }

    close(key: string) {
      closed.push(key);
    }
  }

  return { ToastQueue };
});

const importSlot = async () => {
  vi.resetModules();
  added.length = 0;
  closed.length = 0;

  return import("@/lib/toast");
};

const request = (todoId: string, token: string, message: string) => ({
  todoId,
  token,
  message,
  timeout: 12_000,
  actionProps: { children: "Undo" },
});

describe("the action-toast slot", () => {
  let slot: Awaited<ReturnType<typeof importSlot>>;

  beforeEach(async () => {
    slot = await importSlot();
  });

  it("closes the standing action toast when another is raised, across records", () => {
    const first = slot.showActionToast(request("todo-a", "undo-1", "A toggled"));

    expect(closed).toEqual([]);

    slot.showActionToast(request("todo-b", "undo-2", "B toggled"));

    expect(
      closed,
      "raising an action toast must close the one it replaces, whatever record it named",
    ).toEqual([first]);
  });

  it("only the toast the slot holds can claim a press", () => {
    slot.showActionToast(request("todo-a", "undo-1", "A toggled"));
    const live = slot.showActionToast(request("todo-a", "undo-2", "A toggled back"));

    /*
      The stale button, same record, older token. Keyed on the record this
      would say yes — and would close the *live* toast and run the *stale*
      reversal, which is the pair of wrongs the token prevents.
    */
    expect(
      slot.claimActionPress("undo-1"),
      "a press on the replaced toast must not claim the live one",
    ).toBe(false);
    expect(closed).not.toContain(live);

    expect(slot.claimActionPress("undo-2")).toBe(true);
    expect(closed).toContain(live);
  });

  it("a press can be claimed exactly once", () => {
    slot.showActionToast(request("todo-a", "undo-1", "A toggled"));

    expect(slot.claimActionPress("undo-1")).toBe(true);
    expect(
      slot.claimActionPress("undo-1"),
      "the second of two fast presses must find the slot already emptied",
    ).toBe(false);
    expect(closed).toHaveLength(1);
  });

  it("the pre-write disarm is scoped to its own record", () => {
    const standing = slot.showActionToast(
      request("todo-a", "undo-1", "A toggled"),
    );

    /*
      A write starting on another row must not disarm this one. The callers run
      *before* their write, and a write that then fails raises no replacement —
      so an unscoped disarm silently costs the user a reversal they still had
      every right to.
    */
    expect(slot.dismissActionToast("todo-b")).toBe(false);
    expect(closed).toEqual([]);

    expect(slot.dismissActionToast("todo-a")).toBe(true);
    expect(closed).toEqual([standing]);
  });

  it("an emptied slot answers no to everything", () => {
    expect(slot.dismissActionToast("todo-a")).toBe(false);
    expect(slot.claimActionPress("undo-1")).toBe(false);
    expect(closed).toEqual([]);
  });

  it("a plain toast neither takes the slot nor closes what is in it", () => {
    const standing = slot.showActionToast(
      request("todo-a", "undo-1", "A toggled"),
    );

    slot.toast.success("something unrelated");

    expect(closed).toEqual([]);

    // And the slot still holds the Undo, so it is still claimable.
    expect(slot.claimActionPress("undo-1")).toBe(true);
    expect(closed).toEqual([standing]);
  });
});

/**
 * `docs/DESIGN.md` §7.13.1 and §7.17 — the two `added` receipts are not the
 * same object, and the difference is whether the row is on screen.
 *
 * | receipt | life | against a standing Undo |
 * |---|---|---|
 * | `added` | the queue's default (4s) | yields — not raised at all |
 * | `added — hidden by your filters` | 12s | takes the slot, closing it |
 *
 * The lives are asserted here rather than in a browser because asserting a
 * timeout end to end means waiting for it, which buys a slow flaky test for a
 * value that is passed straight through. This is the layer that passes it.
 */
describe("the two receipts", () => {
  let slot: Awaited<ReturnType<typeof importSlot>>;

  beforeEach(async () => {
    slot = await importSlot();
  });

  it("a yielding receipt is raised when nothing is standing", () => {
    expect(slot.showYieldingReceipt("Todo “A” added")).toBe(true);
    expect(added.map((toast) => toast.title)).toEqual(["Todo “A” added"]);
  });

  it("a yielding receipt is not raised at all when an Undo stands", () => {
    slot.showActionToast(request("todo-a", "undo-1", "A toggled"));
    added.length = 0;

    expect(
      slot.showYieldingReceipt("Todo “B” added"),
      "it must report that it stayed silent",
    ).toBe(false);

    /*
      Not raised, rather than raised behind. §4.10.1's region is a deck: the
      newest toast takes the only operable slot, so raising this would hold the
      Undo inert to pointer for the receipt's whole life.
    */
    expect(added, "nothing may be raised over a standing Undo").toEqual([]);
    expect(closed, "and the Undo must be left alone").toEqual([]);
  });

  it("a yielding receipt takes the queue's own default life, not the Undo's 12s", () => {
    slot.showYieldingReceipt("Todo “A” added");

    /*
      §7.17 gives it "HeroUI's default 4s". Passing no timeout is how that is
      expressed, so the deck and the queue cannot drift apart — restating 4000
      here would be a second source for one number.
    */
    expect(
      added[0].timeout,
      "the visible receipt borrowed 12s from a window it does not have",
    ).toBeUndefined();
  });

  it("a superseding receipt closes the standing Undo and keeps its own 12s", () => {
    const standing = slot.showActionToast(
      request("todo-a", "undo-1", "A toggled"),
    );

    added.length = 0;
    slot.showSupersedingReceipt("Todo “B” added — hidden by your filters", 12_000);

    expect(closed, "the sentence takes the slot from the control").toEqual([
      standing,
    ]);
    expect(added).toHaveLength(1);
    expect(added[0].timeout).toBe(12_000);
  });

  it("a superseding receipt does not occupy the slot it took", () => {
    slot.showActionToast(request("todo-a", "undo-1", "A toggled"));
    slot.showSupersedingReceipt("Todo “B” added — hidden by your filters", 12_000);

    /*
      It has no action, so there is nothing to claim or disarm. Leaving it in
      the slot would mean the next write closed a receipt instead of an Undo,
      and `claimActionPress` would have a token it could never match.
    */
    expect(slot.claimActionPress("undo-1")).toBe(false);
    expect(slot.dismissActionToast("todo-a")).toBe(false);
  });

  it("an action toast raised after a superseding receipt still works normally", () => {
    slot.showSupersedingReceipt("Todo “B” added — hidden by your filters", 12_000);
    closed.length = 0;

    const key = slot.showActionToast(request("todo-c", "undo-9", "C toggled"));

    expect(closed, "there was nothing in the slot to close").toEqual([]);
    expect(slot.claimActionPress("undo-9")).toBe(true);
    expect(closed).toEqual([key]);
  });
});
