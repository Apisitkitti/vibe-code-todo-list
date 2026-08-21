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

const added: string[] = [];
const closed: string[] = [];

vi.mock("@heroui/react", () => {
  let nextKey = 0;

  class ToastQueue {
    add(content: { title: string }) {
      nextKey += 1;

      const key = `key-${nextKey}`;

      added.push(`${key}:${content.title}`);

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

  it("receipts do not pass through the slot at all", () => {
    const standing = slot.showActionToast(
      request("todo-a", "undo-1", "A toggled"),
    );

    slot.toast.success("Todo “B” added — hidden by your filters");

    expect(
      closed,
      "a receipt must neither take the slot nor close what is in it",
    ).toEqual([]);

    // And the slot still holds the Undo, so it is still claimable.
    expect(slot.claimActionPress("undo-1")).toBe(true);
    expect(closed).toEqual([standing]);
  });
});
