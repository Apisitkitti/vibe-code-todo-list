import { describe, expect, it } from "vitest";

import {
  createSearchQuerySync,
  isSearchQueryPushNeeded,
  normalizeSearchQuery,
  recordQueryPush,
  type SearchQuerySync,
  setSearchQuery,
  syncSearchQueryToUrl,
} from "@/lib/searchQuerySync";

/**
 * The search box's ownership rules, driven through the interleavings that
 * produced the defect.
 *
 * These are written as sequences rather than as single calls on purpose. Every
 * failure this module exists to prevent is an *ordering* failure — the field
 * and the URL each hold a defensible value, and the bug is which one wins —
 * so a test that asserts one transition in isolation would have passed against
 * the unfixed code too.
 *
 * The vocabulary below mirrors the component: `types` is the user, `pushes` is
 * the debounce handing a value to the router, and `lands` is a navigation
 * arriving back as the `filters.query` prop. `lands` is the only step that is
 * asynchronous in the real component, which is why it is a separate call here:
 * a test can put it anywhere in the sequence, and a browser cannot.
 */

const types = (state: SearchQuerySync, value: string) =>
  setSearchQuery(state, value);

const pushes = (state: SearchQuerySync, value: string) =>
  recordQueryPush(state, normalizeSearchQuery(value));

const lands = (state: SearchQuerySync, urlQuery: string) =>
  syncSearchQueryToUrl(state, urlQuery);

describe("searchQuerySync", () => {
  it("follows a navigation that came from outside the component", () => {
    const state = lands(createSearchQuerySync(""), "from a link");

    expect(state.query).toBe("from a link");
  });

  it("does not undo a clear made while its own push was in flight", () => {
    // Type, debounce fires, then clear the field before `?q=abc` lands.
    let state = createSearchQuerySync("");

    state = types(state, "abc");
    state = pushes(state, "abc");
    state = types(state, "");

    // The navigation this component asked for finally arrives.
    state = lands(state, "abc");

    expect(state.query).toBe("");
    // And the URL is now the stale one, so the debounce must correct it.
    expect(isSearchQueryPushNeeded(state, "abc")).toBe(true);
  });

  it("does not undo typing that continued while its own push was in flight", () => {
    let state = createSearchQuerySync("");

    state = types(state, "abc");
    state = pushes(state, "abc");
    state = types(state, "abcdef");
    state = lands(state, "abc");

    expect(state.query).toBe("abcdef");
    expect(isSearchQueryPushNeeded(state, "abc")).toBe(true);
  });

  it("recognises an older push landing after a newer one was issued", () => {
    /*
      Two pushes in the air at once: `abc`, then `abcd` 300ms later, with
      `?q=abc` still to land. Matching only the newest recording would read the
      older echo as an outside navigation and put `abc` back in the box.
    */
    let state = createSearchQuerySync("");

    state = types(state, "abc");
    state = pushes(state, "abc");
    state = types(state, "abcd");
    state = pushes(state, "abcd");

    state = lands(state, "abc");
    expect(state.query).toBe("abcd");

    state = lands(state, "abcd");
    expect(state.query).toBe("abcd");
    expect(isSearchQueryPushNeeded(state, "abcd")).toBe(false);
  });

  it("still follows an outside navigation while a push of its own is pending", () => {
    let state = createSearchQuerySync("");

    state = types(state, "abc");
    state = pushes(state, "abc");

    state = lands(state, "somebody else");
    expect(state.query).toBe("somebody else");

    // …and the pending push is still recognised when it lands.
    state = lands(state, "abc");
    expect(state.query).toBe("somebody else");
  });

  it("settles: a clear that raced a push converges on the empty URL", () => {
    let state = createSearchQuerySync("");

    state = types(state, "abc");
    state = pushes(state, "abc");
    state = types(state, "");
    state = lands(state, "abc");

    // The correcting push the component's effect now makes.
    expect(isSearchQueryPushNeeded(state, "abc")).toBe(true);
    state = pushes(state, "");
    state = lands(state, "");

    expect(state.query).toBe("");
    expect(isSearchQueryPushNeeded(state, "")).toBe(false);
  });

  it("records the trimmed value, because that is what comes back", () => {
    /*
      `src/app/todos/page.tsx` trims `q`. Recording the raw text would make the
      echo unrecognisable and take the user's trailing space away.
    */
    let state = createSearchQuerySync("");

    state = types(state, "abc ");
    state = pushes(state, "abc ");
    state = lands(state, "abc");

    expect(state.query).toBe("abc ");
    // Nothing left to say: the URL already holds everything it can hold.
    expect(isSearchQueryPushNeeded(state, "abc")).toBe(false);
  });

  it("does not record a push that cannot change the URL", () => {
    /*
      The status and priority controls push the current search text unchanged.
      Recording that would strand an entry that no navigation ever consumes,
      and a stranded entry swallows a later outside navigation of that value.
    */
    let state = createSearchQuerySync("abc");

    state = pushes(state, "abc");

    expect(state.pendingQueries).toHaveLength(0);

    state = lands(state, "abc from elsewhere");
    state = lands(state, "abc");
    expect(state.query).toBe("abc");
  });

  it("returns the identical state when there is nothing to reconcile", () => {
    const state = createSearchQuerySync("abc");

    expect(syncSearchQueryToUrl(state, "abc")).toBe(state);
    expect(setSearchQuery(state, "abc")).toBe(state);
  });

  it("bounds the pending list so a stranded push cannot accumulate", () => {
    let state = createSearchQuerySync("");

    for (let index = 0; index < 40; index += 1) {
      state = pushes(state, `q${index}`);
    }

    expect(state.pendingQueries.length).toBeLessThanOrEqual(8);
    // The newest is always kept — it is the one still most likely in flight.
    expect(state.pendingQueries.at(-1)).toBe("q39");
  });
});
