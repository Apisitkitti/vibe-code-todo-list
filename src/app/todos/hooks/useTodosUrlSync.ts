"use client";

import { useEffect, useState, useTransition } from "react";

import { useRouter } from "next/navigation";

import {
  abandonPendingPushes,
  createFilterSync,
  isPushNeeded,
  nextUrlState,
  recordPush,
  setSearchQuery,
  syncToUrl,
  type UrlStateChange,
} from "@/lib/filterSync";
import type { TodoListFilters, TodoView } from "@/lib/todo";
import { CLEARED_FILTERS, todosUrl } from "@/lib/todosUrl";

import { useDebouncedEffect } from "./useDebouncedEffect";

/**
 * The single writer of the `/todos` query string, and the owner of everything
 * about it that is still in flight.
 *
 * **Why this is a hook on the screen rather than state inside `TodoFilters`.**
 * The filters were the only thing in the URL when the guard was written, so
 * living beside the search box was the same thing as living beside the URL.
 * The view broke that, and for two structural reasons rather than one.
 *
 * `ViewToggle` and the empty state's `Clear filters` are **siblings** of
 * `TodoFilters`, not children of it, so state held inside the filter row
 * cannot reach either of them however it is exposed. And `ViewToggle` is
 * **conditionally mounted** — `hasTodos && isWideEnoughForBoard`, which is
 * strictly narrower than the filter row's `hasTodos` — so state held inside
 * *it* would be destroyed every time the viewport crossed `lg` or the last
 * todo was deleted. Neither component can own this; the screen is the nearest
 * thing that outlives both.
 *
 * (An earlier version of this paragraph said `ViewToggle` renders when
 * `TodoFilters` does not. That is backwards — it renders strictly less often —
 * and it was never measured. The conclusion is unchanged, but the reason
 * above is the true one.)
 *
 * Two components writing one URL is the shape
 * `src/lib/todosUrl.ts` was already built to survive — it takes the whole state
 * so no writer can omit what it does not know about — but that only fixes the
 * *string*. It does nothing about the *timing*, and the timing is where this
 * app has repeatedly lost user input.
 *
 * A push is in the air for a whole navigation, and during that window the URL
 * still reads as it did before. A second writer reading the URL therefore
 * builds its push from a state one change out of date and silently deletes the
 * first change. Both directions were reproduced before this hook existed
 * (`e2e/search-clear-race.spec.ts`): a view toggle inside a typing window
 * pushed `?view=board` with the old `q`, and a keystroke inside a view press's
 * window pushed the text with `view=list`, dropping the user back out of the
 * board with nothing left to notice it — `ViewToggle` renders `view` straight
 * from the prop, so a lost view change is simply gone.
 *
 * So there is one owner. Every control hands it a change; it lays that change
 * over the *settled target* — what the URL will hold once everything already
 * pushed has landed — and no writer ever reads the URL directly. That is the
 * same argument `todosUrl` makes about the string, made about time instead,
 * and it is why a third control can be added without re-learning any of this.
 */

const SEARCH_DEBOUNCE_MS = 300;
/**
 * How long a push is given to land before its recording is disowned.
 *
 * A `replace` that is dropped or superseded reports nothing, so the only way
 * to notice is to stop waiting. Comfortably longer than a debounce plus a
 * round trip on a loaded machine, and short enough that a user who has been
 * left looking at a stale URL gets the correcting push rather than a wrong
 * list.
 */
const PUSH_SETTLE_MS = 2000;

export interface TodosUrlSync {
  /** What the search box shows — raw, so a trailing space survives. */
  query: string;
  /** The user typed. Does not push; the debounce below does. */
  setQuery: (value: string) => void;
  /** A control changed something. Pushes immediately. */
  push: (change?: UrlStateChange) => void;
  /** `Clear filters`: the filters go back to their defaults, the view stays. */
  clearFilters: () => void;
  /**
   * `Clear search`: the search term goes, and nothing else does.
   *
   * Separate from `clearFilters` because the two labels are two promises. The
   * empty state under `No matches` says `Clear search`, and it used to call
   * `clearFilters` — dropping the status and priority the user had chosen
   * along with the term they asked about. It also shares its accessible name
   * with the search field's own `×`, which has only ever cleared the text, so
   * one name covered two different amounts of work.
   */
  clearSearch: () => void;
}

export const useTodosUrlSync = (
  filters: TodoListFilters,
  view: TodoView,
): TodosUrlSync => {
  const [sync, setSync] = useState(() => createFilterSync({ filters, view }));
  /**
   * Bumped when a push is given up on, purely to re-run the debounce effect.
   *
   * The effect is keyed on the field's text and the URL's own values, which is
   * what stops a recorded push from re-triggering it — see `isPushNeeded`. The
   * cost of that is that abandoning a push changes nothing the effect watches,
   * so without this counter a push that never landed would never be retried
   * and the field and the URL would sit disagreeing forever.
   */
  const [pushAttempt, setPushAttempt] = useState(0);
  const [, startTransition] = useTransition();

  const router = useRouter();

  /*
    Adjusted during render rather than in an effect: the controls follow the
    URL when navigation changes it from outside this screen.

    What they must *not* follow is one of our own pushes landing, which arrives
    through these same props and is indistinguishable from an outside
    navigation by its values alone — that is the revert `syncToUrl` exists to
    stop. Reading the reconciled state below rather than `sync` keeps this
    render on the answer just computed instead of the one being replaced.
  */
  const synced = syncToUrl(sync, { filters, view });

  if (synced !== sync) setSync(synced);

  const { query } = synced;

  const push = (change: UrlStateChange = {}) => {
    const next = nextUrlState(synced, change);

    setSync((current) => recordPush(current, next));

    startTransition(() => {
      router.replace(todosUrl(next.filters, next.view), { scroll: false });
    });
  };

  /*
    Typing should not push a history entry per keystroke.

    **`view` is in the dependency list on purpose and no test covers it.** It
    matters only when the URL's view changes while a push of ours is pending:
    the debounce has to re-ask `isPushNeeded` against the new URL, or the text
    is left owed to a URL nobody will tell it about. Every path that changes
    the view *from here* goes through `push`, which is why removing this dep
    leaves the suite green — the case it exists for needs an outside navigation
    to `/todos`, and this module's own doc records that the app has none today.

    So it is here for the same reason the pending list matches anywhere rather
    than at the head: the guard does not rest on "that cannot happen". Do not
    tidy it away as unused — if you are about to, the thing to add first is the
    outside navigation that would prove it.

    **`isPushNeeded` is now asked when the timer fires rather than when it is
    scheduled**, which is the one behavioural difference the extraction to
    `useDebouncedEffect` carried with it. A hook cannot be skipped
    conditionally, so the guard moved inside the callback; the timer is
    therefore always scheduled and simply does nothing when no push is owed.

    That is the better of the two orders, not merely the reachable one. The
    question this guard answers — is the URL still owed this state? — is a
    question about the moment the push would happen, and asking it 300ms early
    is how a push gets sent for a target that has since been recorded by
    another writer. `e2e/search-clear-race.spec.ts` is the spec that covers the
    window it matters in.
  */
  useDebouncedEffect(
    () => {
      if (!isPushNeeded(synced, { filters, view })) return;

      push();
    },
    SEARCH_DEBOUNCE_MS,
    [query, filters.query, filters.status, filters.priority, view, pushAttempt],
  );

  /*
    Nothing reports a `replace` that was dropped or superseded, so a recording
    for it would otherwise sit in `pending` for the life of the page — claiming
    a target the URL will never reach, and suppressing the next outside
    navigation that happened to carry the same tuple. Giving up on it puts the
    field back in disagreement with the real URL, and the counter re-runs the
    debounce above, which is the whole of the retry path.
  */
  useEffect(() => {
    if (synced.pending.length === 0) return;

    const timer = setTimeout(() => {
      setSync(abandonPendingPushes);
      setPushAttempt((attempt) => attempt + 1);
    }, PUSH_SETTLE_MS);

    return () => clearTimeout(timer);
  }, [synced]);

  return {
    query,
    setQuery: (value) => setSync((current) => setSearchQuery(current, value)),
    push,
    /*
      The field is emptied *and* the cleared tuple is pushed explicitly, rather
      than letting the push read the field. Emptying state is queued, so a push
      that took the text from `synced` would carry the value being cleared.
      `CLEARED_FILTERS` carries no view, so the view survives on the settled
      target — which is the product ruling, not a side effect.
    */
    clearFilters: () => {
      setSync((current) => setSearchQuery(current, ""));
      push(CLEARED_FILTERS);
    },
    /*
      The same two steps as `clearFilters`, and the same reason for the
      explicit `query`: emptying the field is queued, so a push that read the
      text from `synced` would carry the value being cleared. What it does not
      carry is a status or a priority — `nextUrlState` takes those from the
      settled target, so whatever the user chose survives, including a press
      that has not landed yet.
    */
    clearSearch: () => {
      setSync((current) => setSearchQuery(current, ""));
      push({ query: "" });
    },
  };
};
