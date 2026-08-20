import { describe, expect, it } from "vitest";

import {
  focusIsUnclaimed,
  focusRowAfterRemoval,
  focusUndoAction,
  MAX_WAIT_FRAMES,
  nextFocusIndex,
  nextUndoToken,
  RESCHEDULE_TRIGGER_ATTRIBUTE,
  rescheduleTriggerProps,
  restoreRescheduleFocus,
  restoreToggleFocus,
  TOGGLE_TARGET_ATTRIBUTE,
  toggleTargetProps,
  UNDO_TOKEN_ATTRIBUTE,
  undoTokenProps,
} from "@/lib/rowFocus";

/**
 * The arithmetic behind NFR-04's focus rescue: given the row that was removed
 * and what is left, where does focus land.
 *
 * The DOM half is proved end to end in `e2e/undo-focus.spec.ts`, against a real
 * toast and a real view transition — the part worth pinning here is the choice
 * itself, and in particular the two edges that decide whether focus survives at
 * all: removing the last row, and emptying the list.
 */
describe("nextFocusIndex", () => {
  it("keeps the user in place — the row that slid up into the gap", () => {
    expect(nextFocusIndex(0, 7)).toBe(0);
    expect(nextFocusIndex(3, 7)).toBe(3);
  });

  it("falls back to the new last row when the last row was the one removed", () => {
    // Eight rows, the last one toggled away: index 7 no longer exists.
    expect(nextFocusIndex(7, 7)).toBe(6);
  });

  it("reports nowhere to go when the list is now empty", () => {
    // The caller leaves focus alone rather than moving it to `<body>` itself.
    expect(nextFocusIndex(0, 0)).toBeNull();
  });

  it("reports nowhere to go when focus was not on a row", () => {
    expect(nextFocusIndex(-1, 5)).toBeNull();
  });
});

/**
 * The wait loop itself.
 *
 * `focusRowAfterRemoval` waits for the row count to drop rather than for a
 * fixed number of frames. In a real browser that distinction is invisible:
 * React commits a discrete-input update synchronously, so the row is already
 * gone on the first check — measured at `frame=1` for 4 rows unthrottled and
 * 40 rows at 20x CPU throttling alike. A fixed one-frame version therefore
 * passes every end-to-end test, for reasons that have nothing to do with being
 * correct.
 *
 * So the loop is driven directly here, with a removal that deliberately lands
 * several frames late. That is the only way to tell the two implementations
 * apart, and it is what makes the condition-wait a pinned decision rather than
 * a preference.
 */
describe("focusRowAfterRemoval", () => {
  /** A stand-in for a row checkbox: it records that it was focused. */
  const makeRows = (names: string[]) => {
    let active: unknown = null;

    const rows = names.map((name) => {
      const row = {
        name,
        focus: () => {
          active = row;
        },
      };

      return row;
    });

    return { rows, getActiveElement: () => active };
  };

  it("waits for the removal to land instead of moving on the next frame", async () => {
    // Four rows, the first one toggled away — so `doomed` is what a
    // one-frame implementation would focus, and `next` is the right answer.
    const before = makeRows(["doomed", "next", "third", "fourth"]);
    const [doomed, ...survivors] = before.rows;

    let frames = 0;
    const REMOVAL_LANDS_ON_FRAME = 3;

    const focused = await focusRowAfterRemoval(
      { index: 0, rowCount: 4 },
      {
        readRows: () => (frames < REMOVAL_LANDS_ON_FRAME ? before.rows : survivors),
        getActiveElement: before.getActiveElement,
        waitFrame: async () => {
          frames += 1;
        },
      },
    );

    // The element itself, not merely "yes": it is the anchor step 2's guard
    // compares against (QA DEF-28).
    expect(focused).toBe(survivors[0]);
    expect(frames).toBe(REMOVAL_LANDS_ON_FRAME);
    // The row that slid up, not the one that was about to be unmounted.
    expect(before.getActiveElement()).toBe(survivors[0]);
    expect(before.getActiveElement()).not.toBe(doomed);
  });

  it("gives up after MAX_WAIT_FRAMES when the row never leaves", async () => {
    // A removal that never happens must not spin forever, and must not focus
    // the doomed row as a consolation prize.
    const stuck = makeRows(["one", "two"]);
    let frames = 0;

    const focused = await focusRowAfterRemoval(
      { index: 0, rowCount: 2 },
      {
        readRows: () => stuck.rows,
        getActiveElement: stuck.getActiveElement,
        waitFrame: async () => {
          frames += 1;
        },
      },
    );

    expect(focused).toBeNull();
    expect(frames).toBe(MAX_WAIT_FRAMES);
    expect(stuck.getActiveElement()).toBeNull();
  });

  it("reports failure, and focuses nothing, when the list empties", async () => {
    const before = makeRows(["only"]);

    const focused = await focusRowAfterRemoval(
      { index: 0, rowCount: 1 },
      {
        readRows: () => [],
        getActiveElement: before.getActiveElement,
        waitFrame: async () => {},
      },
    );

    // Step 2's `focusIsUnclaimed` is what catches this case instead, on the
    // `<body>` branch — which is why `null` here must not make it decline.
    expect(focused).toBeNull();
    expect(before.getActiveElement()).toBeNull();
  });
});

/**
 * The guard on step 2 — QA DEF-28.
 *
 * It used to ask whether the active element was *a* row checkbox. That is a
 * shape, and every row on screen has it, so a user who tabbed from the rescued
 * row to a neighbouring one during a slow write read as a user who had not
 * moved: focus was taken off the row they had deliberately chosen and put on
 * the toast's `Undo`, where their next `Space` reverted a completion instead.
 *
 * The end-to-end half is in `e2e/undo-focus.spec.ts`. What is pinned here is
 * the discrimination itself, which a browser cannot make obvious: the
 * neighbouring row and the rescued row are the same kind of element, and only
 * driving the guard directly shows that it separates them by identity.
 *
 * `<body>` is a separate, load-bearing branch and not an oversight: an emptied
 * list gives step 1 nowhere to land, and requiring an element would make the
 * rescue decline in the one state where nothing else can catch focus at all.
 */
describe("focusIsUnclaimed", () => {
  /** Stand-ins: identity is the only property the guard reads. */
  // Identity is the whole point of these — the guard compares references, it
  // never calls anything on them — but `focus` is part of `FocusTarget`, so a
  // no-op keeps the fixtures honest to the contract they stand in for.
  const stand = (name: string) => ({ name, focus: () => {} });

  const body = stand("body");
  const rescuedRow = stand("rescued row");
  const neighbouringRow = stand("neighbouring row");
  const quickAddInput = stand("quick-add input");

  const world = (active: unknown) => ({
    getActiveElement: () => active,
    getBody: () => body,
  });

  it("admits the row step 1 focused, which the user has not moved off", () => {
    expect(focusIsUnclaimed(rescuedRow, world(rescuedRow))).toBe(true);
  });

  it("declines a neighbouring row the user tabbed to during the write", () => {
    // The whole of DEF-28. Same kind of element, same list, different choice —
    // and the choice is the user's, so the rescue is not entitled to it.
    expect(focusIsUnclaimed(rescuedRow, world(neighbouringRow))).toBe(false);
  });

  it("admits `<body>`, because an emptied list has nowhere else to be", () => {
    // Step 1 returns `null` here, so there is no rescued element to match.
    expect(focusIsUnclaimed(null, world(body))).toBe(true);
    expect(focusIsUnclaimed(null, world(null))).toBe(true);
  });

  it("declines focus the user took outside the list", () => {
    expect(focusIsUnclaimed(rescuedRow, world(quickAddInput))).toBe(false);
  });

  it("declines everything once step 1 failed with focus somewhere real", () => {
    // A rescue that never landed cannot claim a row it did not choose.
    expect(focusIsUnclaimed(null, world(neighbouringRow))).toBe(false);
  });
});

/**
 * Step 2's choice of toast — the whole of DEF-25.
 *
 * The end-to-end spec can show the right Undo taking focus. What it cannot
 * show, because a browser only ever offers one arrangement of the stack at a
 * time, is the property that matters: a toast which is *not* this one is
 * refused **every frame it is offered**, no matter how frontmost it looks or
 * how long it sits there. That is a negative about the lookup itself, so the
 * lookup is driven directly here.
 *
 * The old implementation asked for `[data-frontmost="true"]`. Every case below
 * is one it would have passed by focusing the wrong button on frame 0.
 */
describe("focusUndoAction", () => {
  /**
   * A stack where an older Undo is present from the first frame and this
   * toggle's own arrives late — the shape DEF-25 lives in, with the frames
   * before the success toast mounts held open.
   */
  const stack = (mineArrivesOnFrame: number) => {
    let frames = 0;
    let active: unknown = null;

    const makeAction = (name: string) => {
      const action = {
        name,
        focus: () => {
          active = action;
        },
      };

      return action;
    };

    /** `Todo “keepme” added` — an Undo that is a DELETE of another todo. */
    const staleAction = makeAction("stale");
    const myAction = makeAction("mine");

    return {
      staleAction,
      myAction,
      get frames() {
        return frames;
      },
      getActiveElement: () => active,
      /** Only ever answers with the button carrying the token asked for. */
      findAction: (token: string) => {
        if (token === "mine") return frames >= mineArrivesOnFrame ? myAction : null;
        if (token === "stale") return staleAction;

        return null;
      },
      waitFrame: async () => {
        frames += 1;
      },
    };
  };

  it("waits for this toggle's own Undo rather than taking the one already there", async () => {
    const MINE_MOUNTS_ON_FRAME = 12;
    const world = stack(MINE_MOUNTS_ON_FRAME);

    const focused = await focusUndoAction("mine", () => true, {
      findAction: world.findAction,
      getActiveElement: world.getActiveElement,
      waitFrame: world.waitFrame,
    });

    expect(focused).toBe(true);
    expect(world.frames).toBe(MINE_MOUNTS_ON_FRAME);
    // The stale Undo — a `DELETE` of a todo the user never touched — was on
    // offer for all twelve of those frames and was never taken.
    expect(world.getActiveElement()).toBe(world.myAction);
    expect(world.getActiveElement()).not.toBe(world.staleAction);
  });

  it("moves nothing when this toggle's Undo never arrives", async () => {
    // A toast that never mounts leaves focus parked on the row step 1 chose.
    // The previous behaviour was to settle for whatever else was on screen.
    const world = stack(Number.POSITIVE_INFINITY);

    const focused = await focusUndoAction("mine", () => true, {
      findAction: world.findAction,
      getActiveElement: world.getActiveElement,
      waitFrame: world.waitFrame,
    });

    expect(focused).toBe(false);
    expect(world.frames).toBe(MAX_WAIT_FRAMES);
    expect(world.getActiveElement()).toBeNull();
  });

  it("declines on the frame the button appears, not the frame the wait began", async () => {
    // The user tabbed away mid-flight. `shouldStillMove` is re-read late, so a
    // guard that was true when the toggle started must not carry the move.
    const world = stack(3);
    let moved = true;

    const focused = await focusUndoAction(
      "mine",
      () => {
        moved = false;

        return false;
      },
      {
        findAction: world.findAction,
        getActiveElement: world.getActiveElement,
        waitFrame: world.waitFrame,
      },
    );

    expect(focused).toBe(false);
    expect(moved).toBe(false);
    expect(world.getActiveElement()).toBeNull();
  });
});

/**
 * The token itself.
 *
 * Two Undos for the **same todo** can be in the DOM at once — a toggle
 * dismisses that row's outstanding `added` toast and raises its own, and
 * HeroUI defers the close through a view transition. So the identity cannot be
 * the todo id, and this is what says so.
 */
describe("nextUndoToken", () => {
  it("never repeats, so the toast being closed cannot answer for the one being raised", () => {
    const tokens = [nextUndoToken(), nextUndoToken(), nextUndoToken()];

    expect(new Set(tokens).size).toBe(tokens.length);
  });

  it("travels as the data attribute the action button is found by", () => {
    expect(undoTokenProps("undo-7")).toEqual({ [UNDO_TOKEN_ATTRIBUTE]: "undo-7" });
    expect(UNDO_TOKEN_ATTRIBUTE.startsWith("data-")).toBe(true);
  });
});

/**
 * The reschedule's focus answer, and the reason it is a different function from
 * the toggle's (backlog #5).
 *
 * A reschedule does not remove the row — it moves it into another section, and
 * because sections are separate subtrees React rebuilds the row rather than
 * moving the DOM node, so the trigger the user pressed is destroyed and rebuilt
 * a few pixels away. Focus falls to `<body>` with nothing on screen to show for
 * it. The right answer is to put focus back on that same control, not to
 * redirect it into a toast the way a *removed* row forces.
 *
 * Three properties decide whether that is safe, and none of them can be
 * observed from a browser test that only checks the happy path:
 *
 *  - it acts only on focus that is on the floor;
 *  - it waits for the rebuilt trigger rather than for a frame count;
 *  - it never takes focus the user has moved somewhere themselves.
 */
describe("restoreRescheduleFocus", () => {
  const makeTrigger = (name: string) => {
    const world: { active: unknown; body: unknown } = { active: null, body: {} };

    const trigger = {
      name,
      focus: () => {
        world.active = trigger;
      },
    };

    return { trigger, world };
  };

  it("waits for the rebuilt trigger instead of giving up on the first frame", async () => {
    const { trigger, world } = makeTrigger("rebuilt");

    world.active = world.body;

    let frames = 0;
    const REBUILD_LANDS_ON_FRAME = 4;

    const restored = await restoreRescheduleFocus("todo-1", {
      findTrigger: () => (frames < REBUILD_LANDS_ON_FRAME ? null : trigger),
      getActiveElement: () => world.active,
      getBody: () => world.body,
      waitFrame: async () => {
        frames += 1;
      },
    });

    expect(restored).toBe(true);
    expect(frames).toBe(REBUILD_LANDS_ON_FRAME);
    expect(world.active).toBe(trigger);
  });

  /**
   * The common case, and the one that must do nothing: the row stayed in its
   * section, so react-aria's own menu close already put focus back on the
   * trigger. Firing here would be a redundant focus call at best and a fight
   * with the library at worst.
   */
  it("declines while focus is still on the trigger", async () => {
    const { trigger, world } = makeTrigger("untouched");
    const stillThere = { name: "menu-restored-me", focus: () => {} };

    world.active = stillThere;

    let frames = 0;

    const restored = await restoreRescheduleFocus("todo-1", {
      findTrigger: () => trigger,
      getActiveElement: () => world.active,
      getBody: () => world.body,
      waitFrame: async () => {
        frames += 1;
      },
    });

    expect(restored).toBe(false);
    expect(frames).toBe(MAX_WAIT_FRAMES);
    expect(world.active).toBe(stillThere);
  });

  /**
   * The same discrimination DEF-28 forced one level up: focus the user has
   * placed is theirs. Here it is expressed as "only `<body>` qualifies",
   * because an unmounted focused element is the only thing that leaves it.
   */
  it("never takes focus the user has moved somewhere else", async () => {
    const { trigger, world } = makeTrigger("not-mine");
    const elsewhere = { name: "quick-add-input", focus: () => {} };

    world.active = elsewhere;

    const restored = await restoreRescheduleFocus("todo-1", {
      findTrigger: () => trigger,
      getActiveElement: () => world.active,
      getBody: () => world.body,
      waitFrame: async () => {},
    });

    expect(restored).toBe(false);
    expect(world.active).toBe(elsewhere);
  });

  it("gives up rather than spinning when the row never comes back", async () => {
    const { world } = makeTrigger("never-arrives");

    world.active = world.body;

    let frames = 0;

    const restored = await restoreRescheduleFocus("todo-1", {
      findTrigger: () => null,
      getActiveElement: () => world.active,
      getBody: () => world.body,
      waitFrame: async () => {
        frames += 1;
      },
    });

    expect(restored).toBe(false);
    expect(frames).toBe(MAX_WAIT_FRAMES);
  });

  /**
   * The latent half of review F1. What refuses focus is a control that is
   * momentarily unavailable, so giving up the first time it does is giving up
   * on the one condition worth waiting for — a restore landing a frame before
   * React flushes the end of the pending state would leave focus on the floor
   * permanently. The earlier version returned `false` here, and a test pinned
   * that, which is how it would have survived review.
   */
  it("keeps trying while the trigger refuses focus, and takes it when it stops", async () => {
    const world: { active: unknown; body: unknown } = { active: null, body: {} };

    world.active = world.body;

    let frames = 0;
    const BECOMES_FOCUSABLE_ON_FRAME = 5;

    const trigger = {
      name: "pending-then-ready",
      focus: () => {
        if (frames < BECOMES_FOCUSABLE_ON_FRAME) return;

        world.active = trigger;
      },
    };

    const restored = await restoreRescheduleFocus("todo-1", {
      findTrigger: () => trigger,
      getActiveElement: () => world.active,
      getBody: () => world.body,
      waitFrame: async () => {
        frames += 1;
      },
    });

    expect(restored).toBe(true);
    expect(frames).toBe(BECOMES_FOCUSABLE_ON_FRAME);
    expect(world.active).toBe(trigger);
  });

  it("still gives up eventually when the trigger never accepts focus", async () => {
    const world = { active: null as unknown, body: {} };
    const refuses = { name: "never-focusable", focus: () => {} };

    world.active = world.body;

    let frames = 0;

    const restored = await restoreRescheduleFocus("todo-1", {
      findTrigger: () => refuses,
      getActiveElement: () => world.active,
      getBody: () => world.body,
      waitFrame: async () => {
        frames += 1;
      },
    });

    expect(restored).toBe(false);
    expect(frames).toBe(MAX_WAIT_FRAMES);
  });

  /** The identity the DOM carries, so a row can be found after it has moved. */
  it("names the row by its todo id, not by its position", () => {
    expect(rescheduleTriggerProps("todo-42")).toEqual({
      [RESCHEDULE_TRIGGER_ATTRIBUTE]: "todo-42",
    });
    expect(RESCHEDULE_TRIGGER_ATTRIBUTE.startsWith("data-")).toBe(true);
  });
});

/**
 * The board's toggle loses the control the user pressed for the same reason a
 * reschedule does — the card moves to another **column**, columns are separate
 * subtrees, React rebuilds the card — and the answer is the same restoration
 * rather than the list's redirect into the toast (`docs/DESIGN.md` §8.8).
 *
 * The three properties are the ones `restoreRescheduleFocus` is held to, and
 * they are re-asserted rather than assumed shared: the two now run the same
 * loop, and a test that only covered one of them would go on passing if a
 * future change gave them separate ones again.
 */
describe("restoreToggleFocus", () => {
  const makeToggle = (name: string) => {
    const world: { active: unknown; body: unknown } = { active: null, body: {} };

    const toggle = {
      name,
      focus: () => {
        world.active = toggle;
      },
    };

    return { toggle, world };
  };

  it("waits for the rebuilt checkbox instead of giving up on the first frame", async () => {
    const { toggle, world } = makeToggle("rebuilt");

    world.active = world.body;

    let frames = 0;
    const REBUILD_LANDS_ON_FRAME = 3;

    const restored = await restoreToggleFocus("todo-1", {
      findToggle: () => (frames < REBUILD_LANDS_ON_FRAME ? null : toggle),
      getActiveElement: () => world.active,
      getBody: () => world.body,
      waitFrame: async () => {
        frames += 1;
      },
    });

    expect(restored).toBe(true);
    expect(frames).toBe(REBUILD_LANDS_ON_FRAME);
    expect(world.active).toBe(toggle);
  });

  /**
   * A card that did not change column keeps its DOM node, so focus never left
   * the checkbox. Firing here would be a redundant focus call on a control the
   * user is already standing on.
   */
  it("declines while focus is still on the checkbox", async () => {
    const { toggle, world } = makeToggle("untouched");
    const stillThere = { name: "same-checkbox", focus: () => {} };

    world.active = stillThere;

    const restored = await restoreToggleFocus("todo-1", {
      findToggle: () => toggle,
      getActiveElement: () => world.active,
      getBody: () => world.body,
      waitFrame: async () => {},
    });

    expect(restored).toBe(false);
    expect(world.active).toBe(stillThere);
  });

  it("never takes focus the user has moved somewhere else", async () => {
    const { toggle, world } = makeToggle("not-mine");
    const elsewhere = { name: "quick-add-input", focus: () => {} };

    world.active = elsewhere;

    const restored = await restoreToggleFocus("todo-1", {
      findToggle: () => toggle,
      getActiveElement: () => world.active,
      getBody: () => world.body,
      waitFrame: async () => {},
    });

    expect(restored).toBe(false);
    expect(world.active).toBe(elsewhere);
  });

  it("gives up rather than spinning when the card never comes back", async () => {
    const { world } = makeToggle("never-arrives");

    world.active = world.body;

    let frames = 0;

    const restored = await restoreToggleFocus("todo-1", {
      findToggle: () => null,
      getActiveElement: () => world.active,
      getBody: () => world.body,
      waitFrame: async () => {
        frames += 1;
      },
    });

    expect(restored).toBe(false);
    expect(frames).toBe(MAX_WAIT_FRAMES);
  });

  /**
   * The anchor is an identity, not a position — the same lesson DEF-25 records
   * for the Undo token. It has to be, because the checkbox's own accessible
   * name changes with the press that moves the card.
   */
  it("names the card rather than describing it", () => {
    expect(toggleTargetProps("todo-9")).toEqual({
      [TOGGLE_TARGET_ATTRIBUTE]: "todo-9",
    });
  });
});
