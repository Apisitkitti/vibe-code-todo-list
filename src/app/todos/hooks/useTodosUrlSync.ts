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

/**
 * The single writer of the `/todos` query string, and the owner of everything
 * about it that is still in flight.
 *
 * **Why this is a hook on the screen rather than state inside `TodoFilters`.**
 * The filters were the only thing in the URL when the guard was written, so
 * living beside the search box was the same thing as living beside the URL.
 * The view broke that: `ViewToggle` writes the same query string, sits outside
 * the filter row, and renders when `TodoFilters` does not (there is no filter
 * row until there are todos). Two components writing one URL is the shape
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

  // Typing should not push a history entry per keystroke.
  useEffect(() => {
    if (!isPushNeeded(synced, { filters, view })) return;

    const timer = setTimeout(() => {
      push();
    }, SEARCH_DEBOUNCE_MS);

    return () => clearTimeout(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [query, filters.query, filters.status, filters.priority, view, pushAttempt]);

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
  };
};
