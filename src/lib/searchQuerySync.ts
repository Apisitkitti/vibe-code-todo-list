/**
 * Who owns the search box's value while a URL push of that value is still in
 * the air.
 *
 * `TodoFilters` keeps the search text in the URL (`docs/PRD.md` US-10), which
 * makes the field's value a round trip: the user types, a debounce pushes
 * `?q=…`, and the new value arrives back as a prop some time later. Two things
 * can move the value, and only one of them is allowed to overwrite what the
 * user is looking at:
 *
 *  - a navigation from **outside** this component — a link, Back, a fresh load
 *    — where the box must follow the URL, and
 *  - **our own** push finally landing, where the box must not: the user has
 *    had the whole round trip in which to type again, and their newer input is
 *    the truth.
 *
 * The unfixed code compared the incoming `q` against the last one it had seen
 * and could not tell those apart. Type `abc`, clear the field inside the 300ms
 * debounce plus the navigation, and the landing `?q=abc` read as an outside
 * change: the box refilled itself with `abc`, and because the debounce then
 * found the field and the URL in agreement it never pushed a correction. The
 * field stayed wrong until the user edited it again.
 *
 * This is the same shape as DEF-20 in `src/app/todos/hooks/useTodoList.ts` — a
 * stale answer landing after a local write and speaking over it — and it is
 * closed the same way, by making the answer identifiable rather than by
 * guessing from its content. Every `q` this component pushes is recorded;
 * an incoming `q` that matches a recording is our own echo and is acknowledged
 * without touching the field, and anything else is somebody else's navigation
 * and is adopted.
 *
 * It lives here as pure functions, rather than inline in the component, for
 * the reason `todoListState.ts` gives: the interleavings that break it are
 * exactly the ones a browser cannot be asked to produce on demand, and a
 * property with no verifier is not a property. `tests/unit/searchQuerySync.test.ts`
 * drives them directly.
 */

/**
 * How many unacknowledged pushes are remembered.
 *
 * A recording is normally consumed by the navigation it describes. One can be
 * stranded — a `replace` that a full page load or another navigation
 * supersedes before it lands — and a stranded recording would silently swallow
 * a later *outside* navigation that happened to carry the same text. Bounding
 * the list means at most this many can ever be pending at once, and a bound
 * this size is far above any real burst: pushes are debounced at 300ms and
 * each one supersedes the timer of the last.
 */
const MAX_PENDING_QUERIES = 8;

export interface SearchQuerySync {
  /**
   * What the search box shows. Nothing but the user's own typing and an
   * outside navigation may change it.
   */
  readonly query: string;
  /** The URL's `q` as of the last change this state was reconciled against. */
  readonly appliedQuery: string;
  /**
   * The `q` values pushed from here whose navigation has not been seen
   * landing yet, oldest first.
   */
  readonly pendingQueries: readonly string[];
}

/**
 * The `q` a push of this text will come back as.
 *
 * `src/app/todos/page.tsx` trims the parameter before it reaches the props, so
 * a push of `"abc "` lands as `"abc"`. Recording the raw text would make every
 * such push unrecognisable — the echo would not match its own recording, would
 * be read as an outside navigation, and would take the user's trailing space
 * away. Normalising on both sides is what keeps the echo identifiable; it is
 * deliberately the same `trim()` the page performs, and the two must move
 * together.
 */
export const normalizeSearchQuery = (query: string): string => query.trim();

export const createSearchQuerySync = (urlQuery: string): SearchQuerySync => ({
  query: urlQuery,
  appliedQuery: urlQuery,
  pendingQueries: [],
});

/** The `q` the URL will hold once everything already pushed has landed. */
const settledTarget = (state: SearchQuerySync): string =>
  state.pendingQueries.at(-1) ?? state.appliedQuery;

/** The user typed. The field is the only authority on its own value. */
export const setSearchQuery = (
  state: SearchQuerySync,
  query: string,
): SearchQuerySync => (query === state.query ? state : { ...state, query });

/**
 * A push of `pushedQuery` has just been handed to the router.
 *
 * A push that does not change `q` produces no navigation to acknowledge — the
 * status and priority controls push the current search text unchanged on every
 * press — so recording one would strand an entry immediately. `pushedQuery` is
 * expected already normalised, because that is the form it will return in.
 */
export const recordQueryPush = (
  state: SearchQuerySync,
  pushedQuery: string,
): SearchQuerySync => {
  if (pushedQuery === settledTarget(state)) return state;

  return {
    ...state,
    pendingQueries: [...state.pendingQueries, pushedQuery].slice(
      -MAX_PENDING_QUERIES,
    ),
  };
};

/**
 * The URL's `q` is now `urlQuery`. Decide whether the field follows it.
 *
 * Returns the identical state when there is nothing to reconcile, so this can
 * be called on every render and its result compared by identity — the same
 * adjust-during-render pattern `useTodoList` uses for `isLoading`.
 *
 * Matching *anywhere* in the pending list, not just at the head, is what makes
 * this correct under two pushes in flight at once: `abc` then `abcd`, with
 * `?q=abc` landing first, must be recognised as ours even though it is no
 * longer the newest thing we asked for. Everything ahead of the match is
 * dropped with it — a push older than one that has landed can no longer be
 * distinguished from an outside navigation anyway, and keeping it would only
 * let it swallow one.
 */
export const syncSearchQueryToUrl = (
  state: SearchQuerySync,
  urlQuery: string,
): SearchQuerySync => {
  if (urlQuery === state.appliedQuery) return state;

  const echoIndex = state.pendingQueries.indexOf(urlQuery);

  if (echoIndex === -1) {
    /*
      Somebody else navigated. The field follows — but the pending list is
      kept, because our own pushes are still in the air and must still be
      recognisable when they land. Dropping them here would turn the next echo
      into an "outside navigation" and reintroduce the defect one step later.
    */
    return { ...state, query: urlQuery, appliedQuery: urlQuery };
  }

  return {
    ...state,
    appliedQuery: urlQuery,
    pendingQueries: state.pendingQueries.slice(echoIndex + 1),
  };
};

/**
 * Whether the URL still has to be told about the field.
 *
 * Compared against the normalised text rather than the raw value: the URL
 * cannot hold the untrimmed form, so an untrimmed field is not out of date
 * with it and pushing again would achieve nothing.
 */
export const isSearchQueryPushNeeded = (
  state: SearchQuerySync,
  urlQuery: string,
): boolean => normalizeSearchQuery(state.query) !== urlQuery;
