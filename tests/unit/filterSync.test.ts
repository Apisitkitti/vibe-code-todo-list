import { describe, expect, it } from "vitest";

import {
  abandonPendingPushes,
  createFilterSync,
  type FilterSync,
  isPushNeeded,
  MAX_PENDING_PUSHES,
  nextUrlState,
  normalizeSearchQuery,
  recordPush,
  setSearchQuery,
  syncToUrl,
  type TodosUrlState,
} from "@/lib/filterSync";
import type { TodoListFilters, TodoView } from "@/lib/todo";

/**
 * The filter row's ownership rules, driven through the interleavings that
 * produced the defect.
 *
 * These are written as sequences rather than as single calls on purpose. Every
 * failure this module exists to prevent is an *ordering* failure — the
 * controls and the URL each hold a defensible value, and the bug is which one
 * wins — so a test that asserts one transition in isolation would have passed
 * against the unfixed code too.
 *
 * The vocabulary below mirrors the component: `types` is the user, `pushes` is
 * a value being handed to the router, and `lands` is a navigation arriving back
 * as the `filters` prop. `lands` is the only step that is asynchronous in the
 * real component, which is why it is a separate call here: a test can put it
 * anywhere in the sequence, and a browser cannot.
 */

/**
 * A `/todos` URL, written flat because that is how it reads at a call site.
 *
 * The module's own shape nests the filters under `filters` so a URL state
 * cannot be handed to `getTodoList`, which spreads its argument straight into
 * axios params. That matters in the source and only gets in the way here.
 */
const url = (
  over: Partial<TodoListFilters & { view: TodoView }> = {},
): TodosUrlState => ({
  filters: {
    status: over.status ?? "all",
    priority: over.priority ?? "all",
    query: over.query ?? "",
  },
  view: over.view ?? "list",
});

const types = (state: FilterSync, value: string) =>
  setSearchQuery(state, value);

/** The debounce, or a filter control, handing a tuple to the router. */
const pushes = (
  state: FilterSync,
  changes: Parameters<typeof nextUrlState>[1] = {},
) => {
  const pushed = nextUrlState(state, changes);

  return { state: recordPush(state, pushed), pushed };
};

const lands = (state: FilterSync, urlState: TodosUrlState) =>
  syncToUrl(state, urlState);

describe("filterSync", () => {
  it("follows a navigation that came from outside the component", () => {
    const state = lands(createFilterSync(url()), url({ query: "from a link" }));

    expect(state.query).toBe("from a link");
  });

  it("follows an outside navigation that changed a filter rather than the text", () => {
    const state = lands(
      createFilterSync(url()),
      url({ status: "completed", priority: "high" }),
    );

    expect(state.applied.filters.status).toBe("completed");
    expect(state.applied.filters.priority).toBe("high");
  });

  it("does not undo a clear made while its own push was in flight", () => {
    // Type, debounce fires, then clear the field before `?q=abc` lands.
    let state = createFilterSync(url());

    state = types(state, "abc");
    state = pushes(state).state;
    state = types(state, "");

    // The navigation this component asked for finally arrives.
    state = lands(state, url({ query: "abc" }));

    expect(state.query).toBe("");
    // And the URL is now the stale one, so the debounce must correct it.
    expect(isPushNeeded(state, url({ query: "abc" }))).toBe(true);
  });

  it("does not undo typing that continued while its own push was in flight", () => {
    let state = createFilterSync(url());

    state = types(state, "abc");
    state = pushes(state).state;
    state = types(state, "abcdef");
    state = lands(state, url({ query: "abc" }));

    expect(state.query).toBe("abcdef");
    expect(isPushNeeded(state, url({ query: "abc" }))).toBe(true);
  });

  it("recognises an older push landing after a newer one was issued", () => {
    /*
      Two pushes in the air at once: `abc`, then `abcd` 300ms later, with
      `?q=abc` still to land. Matching only the newest recording would read the
      older echo as an outside navigation and put `abc` back in the box.
    */
    let state = createFilterSync(url());

    state = types(state, "abc");
    state = pushes(state).state;
    state = types(state, "abcd");
    state = pushes(state).state;

    state = lands(state, url({ query: "abc" }));
    expect(state.query).toBe("abcd");

    state = lands(state, url({ query: "abcd" }));
    expect(state.query).toBe("abcd");
    expect(isPushNeeded(state, url({ query: "abcd" }))).toBe(false);
  });

  it("still follows an outside navigation while a push of its own is pending", () => {
    let state = createFilterSync(url());

    state = types(state, "abc");
    state = pushes(state).state;

    state = lands(state, url({ query: "somebody else" }));
    expect(state.query).toBe("somebody else");

    // …and the pending push is still recognised when it lands.
    state = lands(state, url({ query: "abc" }));
    expect(state.query).toBe("somebody else");
  });

  it("settles: a clear that raced a push converges on the empty URL", () => {
    let state = createFilterSync(url());

    state = types(state, "abc");
    state = pushes(state).state;
    state = types(state, "");
    state = lands(state, url({ query: "abc" }));

    // The correcting push the component's effect now makes.
    expect(isPushNeeded(state, url({ query: "abc" }))).toBe(true);
    state = pushes(state).state;
    state = lands(state, url());

    expect(state.query).toBe("");
    expect(isPushNeeded(state, url())).toBe(false);
  });

  it("records the trimmed value, because that is what comes back", () => {
    /*
      `src/app/todos/page.tsx` trims `q`. Recording the raw text would make the
      echo unrecognisable and take the user's trailing space away.
    */
    let state = createFilterSync(url());

    state = types(state, "abc ");

    const { state: recorded, pushed } = pushes(state);

    expect(pushed.filters.query).toBe("abc");

    state = lands(recorded, url({ query: "abc" }));

    expect(state.query).toBe("abc ");
    // Nothing left to say: the URL already holds everything it can hold.
    expect(isPushNeeded(state, url({ query: "abc" }))).toBe(false);
  });

  it("does not record a push that cannot change the URL", () => {
    /*
      Recording a push that changes nothing would strand an entry that no
      navigation ever consumes, and a stranded entry swallows a later outside
      navigation of that value.
    */
    let state = createFilterSync(url({ query: "abc" }));

    state = pushes(state).state;

    expect(state.pending).toHaveLength(0);

    state = lands(state, url({ query: "abc from elsewhere" }));
    state = lands(state, url({ query: "abc" }));
    expect(state.query).toBe("abc");
  });

  /* ── the two directions of the push site, which must stay symmetric ─────── */

  it("a filter press carries typing that has not landed yet", () => {
    let state = createFilterSync(url());

    state = types(state, "abc");

    // Active pressed inside the debounce window, before `?q=abc` lands.
    const { pushed } = pushes(state, { status: "active" });

    expect(pushed).toEqual(url({ status: "active", query: "abc" }));
  });

  it("typing carries a filter press that has not landed yet", () => {
    /*
      The mirror, and the one the first fix missed. Building the debounced push
      from the URL's tuple spreads a `status` the press has already superseded
      — and unlike the search text, `status` has no local state to notice the
      loss and re-push it, so the press is simply gone.
    */
    let state = createFilterSync(url());

    state = pushes(state, { status: "active" }).state;
    state = types(state, "abc");

    const { pushed } = pushes(state);

    expect(pushed).toEqual(url({ status: "active", query: "abc" }));
  });

  /* ── a push that never lands ────────────────────────────────────────────── */

  it("asks for nothing when the field already agrees with the URL", () => {
    /*
      The clear-during-flight case, from the URL's point of view. `?q=abc` is
      still in the air, so the URL is still empty — and so is the field again.
      There is nothing to say yet, and the correcting push is owed only once
      the stale navigation actually lands.
    */
    let state = createFilterSync(url());

    state = types(state, "abc");
    state = pushes(state).state;
    state = types(state, "");

    expect(isPushNeeded(state, url())).toBe(false);
  });

  it("stops building on a target once its push is abandoned", () => {
    /*
      What giving up actually changes. While the press is recorded, every later
      push is built on top of it — which is right until the navigation turns out
      to be dead, at which point it is a target the URL will never reach.
    */
    let state = createFilterSync(url());

    state = pushes(state, { status: "active" }).state;
    expect(nextUrlState(state).filters.status).toBe("active");

    state = abandonPendingPushes(state);
    expect(nextUrlState(state).filters.status).toBe("all");
  });

  it("recognises a push it gave up on, if it lands after all", () => {
    /*
      **This replaces a test that asserted the opposite**, and the inversion is
      the point. That version had abandoning a push *forget* it, so a genuine
      navigation carrying the same tuple was adopted again — which reads as
      recovering from a strand, and is really the defect coming back. Giving up
      is a decision to stop predicting the URL from a push; it is not evidence
      the push died. A `replace` that was merely slow still lands, and when it
      does it is our own echo carrying text the user has already replaced.

      Forgetting it made that echo indistinguishable from a stranger's
      navigation: `abcdef` would be overwritten by `abc`, and `isPushNeeded`
      would then read false against it, so no correction would follow. State
      agreeing with itself at the wrong value, permanently — the shape this
      module exists to eliminate, reintroduced by its own recovery path.

      The cost is that an outside navigation carrying exactly a disowned tuple
      is suppressed too. That is the value-matching residual the module doc
      describes, bounded by `MAX_PENDING_PUSHES`, and it is the cheaper
      mistake: refusing a stranger loses one adoption, adopting our own stale
      push loses the user's typing for good.
    */
    let state = createFilterSync(url());

    state = types(state, "abc");
    state = pushes(state).state;
    state = types(state, "abcdef");

    // The settle timer gives up on the first push…
    state = abandonPendingPushes(state);
    // …the debounce pushes the newer text…
    state = pushes(state).state;
    // …and only then does the abandoned one arrive.
    state = lands(state, url({ query: "abc" }));

    expect(state.query).toBe("abcdef");
    // …and the URL is the stale one, so a correction is still owed.
    expect(isPushNeeded(state, url({ query: "abc" }))).toBe(true);
  });

  it("acknowledges a push that lands on the tuple the URL already held", () => {
    /*
      Pins the ordering inside `syncToUrl`: the recordings are consulted before
      the "nothing changed" short circuit. Swapping those two blocks leaves
      every other test in this file green, because the state they inspect
      converges either way — this is the one place the difference is visible.

      The case is the clear-during-flight one. The correcting push of the empty
      tuple lands on a URL that is already empty, so `sameFilters(url, applied)`
      is true and short-circuiting first returns the identical state, leaving a
      recording behind for a navigation that has in fact already arrived.
    */
    let state = createFilterSync(url());

    state = types(state, "abc");
    state = pushes(state).state;
    state = types(state, "");
    state = pushes(state).state;

    expect(state.pending).toHaveLength(2);

    const landed = lands(state, url());

    // Not the identical object: a navigation happened and was acknowledged,
    // even though it changed none of the URL's values.
    expect(landed).not.toBe(state);
    expect(landed.pending).toHaveLength(0);
    // The older push is no longer predictive, but is still ours if it lands.
    expect(landed.disowned).toEqual([url({ query: "abc" })]);
  });

  /* ── the view, which is in the URL but is not a filter ──────────────────── */

  it("recognises its own view push when it lands", () => {
    /*
      Identity is on the whole URL tuple, view included. If it were on the
      filters alone, a push that changed only the view would land looking
      exactly like the state we were already in — the recording would never be
      consumed, `settled` would go on claiming it, and the strand would sit
      there until the settle timer disowned it.
    */
    let state = createFilterSync(url());

    state = pushes(state, { view: "board" }).state;
    expect(state.pending).toHaveLength(1);

    state = lands(state, url({ view: "board" }));

    expect(state.pending).toHaveLength(0);
    expect(state.applied.view).toBe("board");
  });

  it("a view change carries typing that has not landed yet", () => {
    let state = createFilterSync(url());

    state = types(state, "abc");

    const { pushed } = pushes(state, { view: "board" });

    expect(pushed).toEqual(url({ query: "abc", view: "board" }));
  });

  it("typing carries a view change that has not landed yet", () => {
    /*
      The direction with no recovery. The search text has local state and
      re-pushes what it notices missing; the view is rendered straight from the
      prop, so a dropped view change leaves nothing that remembers it.
    */
    let state = createFilterSync(url());

    state = pushes(state, { view: "board" }).state;
    state = types(state, "abc");

    const { pushed } = pushes(state);

    expect(pushed).toEqual(url({ query: "abc", view: "board" }));
  });

  it("a navigation that moved only the view does not reach into the search box", () => {
    /*
      An outside navigation is allowed to overwrite the field, and before the
      view joined the tuple that was unambiguous: the only reason to see one
      was that somebody had set `q`. Now a view toggle is also an outside
      navigation to this state, and adopting on the strength of *any*
      difference would delete text the user had typed and not yet pushed.
    */
    let state = createFilterSync(url());

    state = types(state, "abc");
    state = lands(state, url({ view: "board" }));

    expect(state.query).toBe("abc");
    expect(state.applied.view).toBe("board");
    // …and the text is still owed to the URL.
    expect(isPushNeeded(state, url({ view: "board" }))).toBe(true);
  });

  it("still follows an outside navigation that does change the search text", () => {
    let state = createFilterSync(url());

    state = types(state, "abc");
    state = lands(state, url({ query: "from a link", view: "board" }));

    expect(state.query).toBe("from a link");
  });

  it("returns the identical state when there is nothing to reconcile", () => {
    const state = createFilterSync(url({ query: "abc" }));

    expect(syncToUrl(state, url({ query: "abc" }))).toBe(state);
    expect(setSearchQuery(state, "abc")).toBe(state);
    expect(abandonPendingPushes(state)).toBe(state);
  });

  it("bounds the pending list so a stranded push cannot accumulate", () => {
    let state = createFilterSync(url());

    for (let index = 0; index < 40; index += 1) {
      state = types(state, `q${index}`);
      state = pushes(state).state;
    }

    expect(state.pending.length).toBeLessThanOrEqual(MAX_PENDING_PUSHES);
    // The newest is always kept — it is the one still most likely in flight.
    expect(state.pending.at(-1)?.filters.query).toBe("q39");
  });

  it("bounds the disowned list too, so it cannot refuse navigations forever", () => {
    let state = createFilterSync(url());

    for (let index = 0; index < 40; index += 1) {
      state = types(state, `q${index}`);
      state = pushes(state).state;
      state = abandonPendingPushes(state);
    }

    expect(state.disowned.length).toBeLessThanOrEqual(MAX_PENDING_PUSHES);
  });

  it("normalises the way the page does", () => {
    expect(normalizeSearchQuery("  abc  ")).toBe("abc");
  });
});
