"use client";

import { useEffect, useRef } from "react";

/**
 * Run `effect` once the values in `deps` have stopped changing for `delayMs`.
 *
 * Extracted from `useTodosUrlSync`, where it was an inline `setTimeout` effect
 * carrying a line-level suppression of `react-hooks/exhaustive-deps`. **The
 * point of the extraction was to delete that suppression, not to move it.** A
 * disable in a shared file is worse than one at a single call site, because
 * every future caller inherits a suppression it never asked for and nobody
 * re-reads the reason. So the shape below is the one that lints clean on
 * `eslint-plugin-react-hooks@7.1.1` with nothing suppressed — verified by
 * running it, not by reading the rule.
 *
 * ## Why the deps are serialised rather than spread
 *
 * The obvious signature — forward `deps` into the inner `useEffect` — cannot be
 * written without a suppression. Both spellings were tried against the
 * installed rule and both warn:
 *
 * - `}, [delayMs, ...deps])` → *"has a spread element in its dependency array.
 *   This means we can't statically verify whether you've passed the correct
 *   dependencies"*
 * - `}, deps)` → *"was passed a dependency list that is not an array literal"*,
 *   plus a missing-dependency report for `delayMs`.
 *
 * That is the rule working as intended: a dependency array it cannot read
 * statically is a dependency array it cannot check, and the honest options are
 * to suppress it or to stop handing it one. `eslint-plugin-react-hooks`'s own
 * README says the same thing about the escape hatch that would paper over it —
 * of `additionalHooks` it says *"We suggest to use this option very sparingly,
 * if at all"*, and recommends custom hooks avoid a dependencies argument in
 * favour of an API focused on a specific use case.
 *
 * So the array stays in the *public* signature, where it is the natural way to
 * say "restart when any of these change", and is reduced to one scalar before
 * it reaches React. The inner effect then has a static array literal of two
 * plain identifiers, which the rule reads and checks in full.
 *
 * ## Why the callback is a ref
 *
 * `effect` is a fresh closure on every render, so listing it as a dependency
 * would restart the timer on every render and the debounce would never fire.
 * Holding the latest one in a ref is what lets the timer be keyed on the values
 * that should restart it and nothing else.
 *
 * The consequence is deliberate and worth stating: the callback that runs is
 * the one from the **most recent render**, not the one from the render that
 * scheduled the timer. That is the correct half of the trade — a debounced
 * write should act on the freshest state it can see, not on the state as it
 * was 300ms ago — and it is what `useTodosUrlSync` wants, where a push must be
 * laid over the settled target *including* any push recorded while the timer
 * was running.
 *
 * The ref is written inside an effect rather than during render. React 19's
 * `react-hooks/refs` treats a render-phase ref write as an error, and rightly:
 * render must be pure and repeatable. The write effect is declared above the
 * timer effect so that on any commit both run, the callback is refreshed
 * before a new timer is scheduled.
 *
 * ## Where this hook is tested, and why not here
 *
 * **The timer, its cleanup and the latest-callback ref have no unit test, and
 * that is a decision rather than an oversight.** Do not read the gap as work
 * left undone and do not close it by reaching for a DOM environment.
 *
 * `vitest.config.ts` runs `environment: "node"`, and neither `jsdom` nor a
 * React testing library is a dependency of this project. Adding both to render
 * one hook would be a larger change than the hook itself, and it would buy a
 * weaker check than the one that already exists.
 *
 * That is the substantive half of the argument. The behaviour worth protecting
 * here is **coalescing** — that a burst of dependency changes produces one run
 * of the effect and not one per change. A fake-timer unit test asserts the
 * callback ran once against a clock it controls, which is a restatement of the
 * implementation. `e2e/search-debounce.spec.ts` instead counts
 * `history.replaceState` calls across a real typed word in a real browser: it
 * counts the *journey* rather than the destination.
 *
 * That distinction is not theoretical. Deleting this hook's `clearTimeout` left
 * `e2e/search-clear-race.spec.ts` and `e2e/filtered-toggle.spec.ts` both green,
 * because a debounce with no cleanup reaches the same settled URL — just via
 * one navigation per keystroke instead of one. The counting spec is what kills
 * that mutant, and it is the check a unit test would have been added to
 * duplicate less well.
 *
 * What *is* unit-tested is the part that is pure and can be silently wrong:
 * `debouncedEffectKey`, in `tests/unit/useDebouncedEffect.test.ts`.
 */

/**
 * What a dependency may be.
 *
 * Deliberately not `unknown`: these values are serialised, so admitting objects
 * would mean comparing them by a structural key while a reader would reasonably
 * expect `Object.is`, which is how React's own dependency arrays work. Keeping
 * the type to scalars means the serialised comparison and the one a reader
 * expects are the same comparison.
 */
export type DebouncedEffectDep = string | number | boolean | null;

/**
 * The dependency array reduced to one value that changes exactly when the array
 * does.
 *
 * `JSON.stringify` rather than `join`, and that is the whole reason this is a
 * named function with tests of its own. A delimiter-joined key collides on any
 * input containing the delimiter — and one of this hook's real dependencies is
 * the search box's raw text, which is arbitrary user input and can contain any
 * delimiter that might be chosen. `["a|b", "c"]` and `["a", "b|c"]` join to the
 * same string, so a keystroke that moved a character across that boundary would
 * not restart the timer. Quoting makes the encoding unambiguous: a `"` inside a
 * string is escaped, so no value can forge the boundary between two values.
 *
 * **Known limit, stated rather than papered over:** `JSON.stringify` maps
 * `NaN` and `±Infinity` onto `null`, so those three collide with each other and
 * with a literal `null`. Nothing in this app passes one — the only numeric
 * dependency is an integer counter — and pre-encoding every number to cover a
 * case no caller can reach would be a guard nobody could watch fail. If a
 * caller ever does need a non-finite number as a dependency, this is the
 * function to fix and `tests/unit/useDebouncedEffect.test.ts` is where the
 * failing test goes.
 */
export const debouncedEffectKey = (deps: readonly DebouncedEffectDep[]): string =>
  JSON.stringify(deps);

export const useDebouncedEffect = (
  effect: () => void,
  delayMs: number,
  deps: readonly DebouncedEffectDep[],
): void => {
  const latestEffect = useRef(effect);
  const depsKey = debouncedEffectKey(deps);

  /*
    Unkeyed on purpose: this runs after every commit, so the ref always holds
    the newest closure. Declared first so it has run before the timer effect
    below schedules anything on the same commit.
  */
  useEffect(() => {
    latestEffect.current = effect;
  });

  useEffect(() => {
    const timer = setTimeout(() => latestEffect.current(), delayMs);

    return () => clearTimeout(timer);
  }, [depsKey, delayMs]);
};
