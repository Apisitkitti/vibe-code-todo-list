import type { TodoListFilters } from "@/lib/todo";

/**
 * Who owns the filter row's values while a URL push of them is still in the
 * air.
 *
 * `TodoFilters` keeps status, priority and the search text in the URL
 * (`docs/PRD.md` US-10), which makes every one of them a round trip: the user
 * acts, a push sets the query string, and the new values arrive back as props
 * some time later. Two things can move them, and only one is allowed to
 * overwrite what the user is looking at:
 *
 *  - a navigation from **outside** this component — a link, Back, a fresh load
 *    — where the controls must follow the URL, and
 *  - **our own** push finally landing, where they must not: the user has had
 *    the whole round trip in which to act again, and their newer input is the
 *    truth.
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
 * guessing from its content.
 *
 * **Why not DEF-20's monotonic stamp.** Not because there is nothing to stamp:
 * this component composes the URL it pushes and could perfectly well mint a
 * nonce and read it back off `searchParams`. It is that the URL is a shared
 * product surface — US-10 exists so a filtered list can be reloaded, bookmarked
 * and sent to someone — and a correlation id in the query string is visible in
 * the address bar, survives a copy-paste, and outlives the session it meant
 * something in. A stamp here is affordable in mechanism and unaffordable in
 * product terms, so identity is recovered from the only thing that already
 * survives the round trip: the pushed values themselves.
 *
 * That trade has one residual. Matching by value cannot distinguish an outside
 * navigation that happens to carry exactly the tuple we have in flight, and
 * will swallow it. `MAX_PENDING_PUSHES` bounds how long any recording can lurk,
 * but the reason this is not reachable today is a property of the app rather
 * than of this module: nothing links to `/todos`, `clearFilters` pushes no
 * `q`, and every filter change is a `replace`, so no history entry is laid
 * down to go Back to. **Nothing pins that property.** If a `/todos` link, a
 * `push`, or a second writer of these params appears, re-read this paragraph
 * before assuming the guard still holds.
 *
 * It lives here as pure functions, rather than inline in the component, for
 * the reason `todoListState.ts` gives: the interleavings that break it are
 * exactly the ones a browser cannot be asked to produce on demand, and a
 * property with no verifier is not a property. `tests/unit/filterSync.test.ts`
 * drives them directly.
 */

/**
 * How many unacknowledged pushes are remembered.
 *
 * A recording is normally consumed by the navigation it describes. One can be
 * stranded — a `replace` that a full page load or another navigation
 * supersedes before it lands — and a stranded recording silently swallows a
 * later *outside* navigation carrying the same tuple.
 *
 * The bound is what caps that, and it is the only thing that does.
 * `abandonPendingPushes` moves a strand to `disowned` rather than deleting it,
 * so giving up stops the strand distorting `settled` but does not stop it
 * suppressing adoption — deliberately, and for the reason `disowned` gives.
 * Both lists carry this bound.
 *
 * Exported so the test that pins the bound reads the same number the module
 * enforces rather than a copy of it.
 */
export const MAX_PENDING_PUSHES = 8;

export interface FilterSync {
  /**
   * What the search box shows. Nothing but the user's own typing and an
   * outside navigation may change it.
   *
   * Held raw, untrimmed — the field is allowed a trailing space the URL cannot
   * carry. Status and priority need no equivalent: they have no intermediate
   * state a user can be halfway through, so the pushed tuple is the whole of
   * what is pending about them.
   */
  readonly query: string;
  /** The URL's filters as of the last change this state was reconciled against. */
  readonly applied: TodoListFilters;
  /**
   * The tuples pushed from here whose navigation has not been seen landing
   * yet, oldest first.
   */
  readonly pending: readonly TodoListFilters[];
  /**
   * Tuples this component pushed and has stopped waiting for, oldest first.
   *
   * **Disowned, not forgotten, and the distinction is the whole point.** Two
   * different things stop a push being pending: a settle timer giving up on
   * it, and a newer push of ours landing ahead of it. In both cases we stop
   * *building* on it — it can no longer be trusted to describe where the URL is
   * going — but it is still a tuple **we** put on the wire, and if it turns up
   * late it is still our echo and still must not overwrite what the user has
   * typed since.
   *
   * Dropping the recording instead makes a merely-slow push indistinguishable
   * from a stranger's navigation when it lands: it gets adopted, the user's
   * newer text is overwritten, and `isPushNeeded` then reads false against it —
   * state agreeing with itself at the wrong value, permanently, which is the
   * exact shape this module exists to eliminate.
   *
   * The cost is that an outside navigation carrying one of these tuples is
   * suppressed too. That is the same value-matching residual described above,
   * bounded the same way, and it is the cheaper of the two mistakes: refusing
   * a stranger's navigation loses one adoption, adopting a stale push of our
   * own loses the user's typing for good.
   */
  readonly disowned: readonly TodoListFilters[];
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

const sameFilters = (a: TodoListFilters, b: TodoListFilters): boolean =>
  a.status === b.status && a.priority === b.priority && a.query === b.query;

export const createFilterSync = (urlFilters: TodoListFilters): FilterSync => ({
  query: urlFilters.query,
  applied: urlFilters,
  pending: [],
  disowned: [],
});

/**
 * Move tuples out of `pending` without losing the fact that we pushed them.
 *
 * Bounded like `pending`, and for the same reason: these suppress adoption, so
 * an unbounded list would go on refusing outside navigations forever.
 */
const disown = (
  state: FilterSync,
  abandoned: readonly TodoListFilters[],
): readonly TodoListFilters[] =>
  abandoned.length === 0
    ? state.disowned
    : [...state.disowned, ...abandoned].slice(-MAX_PENDING_PUSHES);

/**
 * The filters the URL will hold once everything already pushed has landed.
 *
 * This, and not `applied`, is what a new push must build on. Spreading the
 * URL's tuple instead is the defect this module's second half exists to stop:
 * press Active and type inside the window and the debounced push spreads a
 * `status` the press has already superseded, discarding it at the push site.
 */
const settled = (state: FilterSync): TodoListFilters =>
  state.pending.at(-1) ?? state.applied;

/** The user typed. The field is the only authority on its own value. */
export const setSearchQuery = (state: FilterSync, query: string): FilterSync =>
  query === state.query ? state : { ...state, query };

/**
 * The tuple a push should carry: the settled target, with the field's current
 * text and the caller's own change laid over it.
 *
 * Every push in the component goes through here, which is what makes the
 * symmetry hold — typing cannot drop a pending filter press and a filter press
 * cannot drop pending typing, because neither one reads the URL directly.
 */
export const nextFilters = (
  state: FilterSync,
  changes: Partial<TodoListFilters> = {},
): TodoListFilters => ({
  ...settled(state),
  query: normalizeSearchQuery(state.query),
  ...changes,
});

/**
 * A push of `pushed` has just been handed to the router.
 *
 * A push that does not change the tuple produces no navigation to acknowledge,
 * so recording one would strand an entry immediately.
 */
export const recordPush = (
  state: FilterSync,
  pushed: TodoListFilters,
): FilterSync =>
  sameFilters(pushed, settled(state))
    ? state
    : {
        ...state,
        pending: [...state.pending, pushed].slice(-MAX_PENDING_PUSHES),
      };

/**
 * Stop waiting for every push still outstanding.
 *
 * A `router.replace` that is dropped or superseded produces no navigation and
 * no error — nothing tells this component its push died. Without this, a
 * recording for it sits in `pending` forever, making `settled` claim a target
 * the URL will never reach. Called on a timer by the component, after which
 * `isPushNeeded` sees the field disagreeing with the real URL again and the
 * debounce re-pushes. That re-push is the only retry path there is.
 *
 * The tuples are **disowned rather than dropped**: giving up on a push is a
 * decision about whether to keep *predicting* the URL from it, not a claim
 * that it never happened. See `FilterSync.disowned` — a push that was merely
 * slow rather than dead must still be recognised as ours if it lands.
 */
export const abandonPendingPushes = (state: FilterSync): FilterSync =>
  state.pending.length === 0
    ? state
    : { ...state, pending: [], disowned: disown(state, state.pending) };

/**
 * The URL's filters are now `urlFilters`. Decide whether the controls follow.
 *
 * Returns the identical state when there is nothing to reconcile, so this can
 * be called on every render and its result compared by identity — the same
 * adjust-during-render pattern `useTodoList` uses for `isLoading`.
 *
 * Matching *anywhere* in the pending list, not just at the head, is what makes
 * this correct under two pushes in flight at once: `abc` then `abcd`, with
 * `?q=abc` landing first, must be recognised as ours even though it is no
 * longer the newest thing we asked for. Everything ahead of the match stops
 * being pending with it — a push older than one that has landed can no longer
 * be trusted to say where the URL is going — but it is **disowned rather than
 * dropped**, because it is still ours and may still land.
 *
 * Deliberately not resting on the router discarding a superseded payload.
 * Matching anywhere in the list exists precisely for the case supersession is
 * claimed to prevent, and this module holds that posture everywhere rather
 * than in most places.
 */
export const syncToUrl = (
  state: FilterSync,
  urlFilters: TodoListFilters,
): FilterSync => {
  const echoIndex = state.pending.findIndex((pushed) =>
    sameFilters(pushed, urlFilters),
  );

  /*
    The pending list is consulted *before* the "nothing changed" short circuit,
    because a push can land on a tuple the URL already held and still be a
    navigation worth acknowledging. Clearing a field whose `?q=` push is still
    in flight does exactly that: the correcting push of the empty tuple lands
    on a URL that is already empty, and short-circuiting first would leave its
    recording in `pending` for `abandonPendingPushes` to mop up seconds later —
    and, until then, claiming a target that has in fact already arrived.
  */
  if (echoIndex !== -1) {
    return {
      ...state,
      applied: urlFilters,
      pending: state.pending.slice(echoIndex + 1),
      disowned: disown(state, state.pending.slice(0, echoIndex)),
    };
  }

  const disownedIndex = state.disowned.findIndex((pushed) =>
    sameFilters(pushed, urlFilters),
  );

  /*
    A push we had stopped waiting for, arriving after all. Acknowledged so
    `applied` tracks the URL, and pointedly *not* adopted: the controls have
    moved on and this is the stale answer, not a new instruction.
  */
  if (disownedIndex !== -1) {
    return {
      ...state,
      applied: urlFilters,
      disowned: state.disowned.slice(disownedIndex + 1),
    };
  }

  if (sameFilters(urlFilters, state.applied)) return state;

  /*
    Somebody else navigated. The controls follow — but both lists are kept,
    because our own pushes are still in the air and must still be recognisable
    when they land. Dropping them here would turn the next echo into an
    "outside navigation" and reintroduce the defect one step later.
  */
  return { ...state, query: urlFilters.query, applied: urlFilters };
};

/**
 * Whether the URL still has to be told about the controls.
 *
 * Compares the tuple a push would carry against the URL as it stands. Two
 * consequences are worth stating, because both are load-bearing:
 *
 *  - It is compared against the *normalised* text. The URL cannot hold the
 *    untrimmed form, so an untrimmed field is not out of date with it and
 *    pushing again would achieve nothing.
 *  - It goes on reading `true` for the whole time a push is in the air, since
 *    the URL does not change until the navigation lands. **This does not cause
 *    a re-push**, and the reason lives in the component rather than here: the
 *    debounce effect is keyed on the field's text and the URL's own values, so
 *    recording a push does not re-run it. Anything that re-runs that effect on
 *    this module's state instead would push every 300ms until the navigation
 *    landed — which is the trap `abandonPendingPushes` deliberately routes
 *    around by way of an explicit attempt counter.
 */
export const isPushNeeded = (
  state: FilterSync,
  urlFilters: TodoListFilters,
): boolean => !sameFilters(nextFilters(state), urlFilters);
