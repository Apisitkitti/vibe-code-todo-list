import { expect, test } from "./support/fixtures";

/**
 * Typing coalesces into one navigation.
 *
 * This is the property `useDebouncedEffect` exists for, and it was found
 * uncovered by mutation: deleting the hook's `clearTimeout` cleanup — so every
 * keystroke's timer survives and fires on its own — left both
 * `e2e/search-clear-race.spec.ts` and `e2e/filtered-toggle.spec.ts` green.
 *
 * They cannot see it, and not by oversight. Both assert on the *settled*
 * result: which text the box ends up holding, which URL the list ends up
 * showing. A debounce with no cleanup reaches the same settled result, because
 * the last timer to fire carries the newest text and wins. What changes is the
 * number of navigations taken to get there — one per keystroke instead of one —
 * and a test that only reads the destination cannot count the journey.
 *
 * So this spec counts the journey. It is the difference between "the debounce
 * produced the right answer" and "the debounce debounced".
 *
 * ── Why `history.replaceState` and not the network ──────────────────────────
 *
 * The push is `router.replace(..., { scroll: false })`, a client-side
 * navigation. Counting RSC requests would count Next's own fetching strategy —
 * which caches, dedupes and prefetches on its own schedule — so the count would
 * be measuring the framework rather than this app's behaviour, and would move
 * when Next changed. `history.replaceState` is called once per `router.replace`
 * and by nothing else on this screen, so it counts exactly the thing the
 * debounce is supposed to be reducing.
 *
 * The wrapper is installed after the screen is ready, so the sign-up
 * navigation and the list's first load are not in the count.
 */

/** Long enough to be unambiguous: a per-keystroke push would be 9, not 1. */
const SEARCH_TEXT = "gardening";

/**
 * The debounce is 300ms (`SEARCH_DEBOUNCE_MS`). This is the window the test
 * waits *after* the URL has already settled, purely to catch the extra pushes a
 * broken debounce would still be delivering behind the correct one.
 */
const TRAILING_QUIET_MS = 1200;

declare global {
  interface Window {
    __replaceCount?: number;
  }
}

test("typing a query pushes one navigation, not one per keystroke", async ({
  todos,
  signedIn: page,
}) => {
  await todos.quickAdd("Gardening gloves");
  await expect(todos.row("Gardening gloves")).toBeVisible();

  await page.evaluate(() => {
    window.__replaceCount = 0;

    const original = history.replaceState.bind(history);

    history.replaceState = (...args: Parameters<History["replaceState"]>) => {
      window.__replaceCount = (window.__replaceCount ?? 0) + 1;

      return original(...args);
    };
  });

  const search = page.getByRole("searchbox", { name: "Search todos" });

  /*
    `pressSequentially`, not `fill`. `fill` sets the value in one DOM operation
    and fires a single input event, which is one dependency change and would
    coalesce even with no debounce at all — the assertion would then hold for a
    reason that has nothing to do with the hook. Typing character by character
    is what produces the nine separate dependency changes this is about.
  */
  await search.pressSequentially(SEARCH_TEXT, { delay: 40 });

  // The debounce has landed when the URL carries the query.
  await expect(page).toHaveURL(new RegExp(`[?&]q=${SEARCH_TEXT}`));

  /*
    Then wait out a further debounce-and-a-bit. Without this the assertion could
    pass while the stragglers a missing cleanup produced are still arriving —
    the count would be read before the thing it is counting had finished
    happening, which is the shape of assertion this suite's own notes warn
    about.
  */
  await page.waitForTimeout(TRAILING_QUIET_MS);

  const replaceCount = await page.evaluate(() => window.__replaceCount ?? 0);

  /*
    Not `toBe(1)`. One navigation is the intent, but the screen legitimately
    reconciles once more when the pushed URL lands and `syncToUrl` settles the
    recorded push, and pinning the exact number would make this spec fail for a
    change in that reconciliation rather than in the debounce. Two is the
    headroom; nine — one per character — is the defect, and anything approaching
    it fails.
  */
  expect(replaceCount).toBeGreaterThan(0);
  expect(replaceCount).toBeLessThanOrEqual(2);
});
