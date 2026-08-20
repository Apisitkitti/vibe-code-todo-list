import type { Locator, Page } from "@playwright/test";

import { expect, test } from "./support/fixtures";

/**
 * DEF-16 — the search field's clear button.
 *
 * QA measured it at 20×20 at every width (`docs/QA-REPORT.md` §A2): the only
 * control in the app below WCAG 2.2 SC 2.5.8's 24×24 floor, and far below
 * NFR-05's 44×44. Missing it puts text back in the search box and silently
 * changes which list the user is looking at.
 *
 * Its accessible name was HeroUI's default `Close` — which describes
 * dismissing something, not clearing a field.
 */

/** The app's own floors: NFR-05 on phones, the `sm:` step-down above 640px. */
const MOBILE_MIN = 44;
const POINTER_MIN = 36;
/** WCAG 2.2 SC 2.5.8 (AA) — the floor nothing in the app may drop below. */
const WCAG_MIN = 24;

const CLEAR_BUTTON = '[data-slot="search-field-clear-button"]';

/**
 * How many times a click may be re-sent when the browser drops it outright.
 *
 * Not a tolerance for a flaky assertion — the assertion is never retried. See
 * the comment on the effect test: a press whose `mouseup` is retargeted to
 * `<html>` never reaches the button at all, and re-sending is the only way to
 * tell that apart from a control that genuinely does nothing.
 */
const CLICK_DELIVERY_ATTEMPTS = 5;

const targetFloor = (page: Page): number => {
  const width = page.viewportSize()?.width ?? 0;

  return width < 640 ? MOBILE_MIN : POINTER_MIN;
};

const boxOf = async (locator: Locator) => {
  const box = await locator.boundingBox();

  if (box === null) throw new Error("control is not rendered");

  return box;
};

test.describe("DEF-16 — the search clear button is a real target", () => {
  test("clears at the app's own tap-target floor, and never below WCAG's", async ({
    signedIn,
    todos,
  }) => {
    await todos.quickAdd("something to search for");
    await expect(
      signedIn.locator("main").getByText("something to search for"),
    ).toBeVisible();

    const search = signedIn.getByRole("searchbox", { name: "Search todos" });
    const clear = signedIn.locator(CLEAR_BUTTON);

    // The button only exists once the field has something to clear.
    await search.fill("something");
    await expect(clear).toBeVisible();

    const box = await boxOf(clear);
    const floor = targetFloor(signedIn);

    expect.soft(box.width, "clear button width").toBeGreaterThanOrEqual(floor);
    expect.soft(box.height, "clear button height").toBeGreaterThanOrEqual(floor);

    // Restated independently: whatever the app's own bar is, SC 2.5.8 binds.
    expect(Math.min(box.width, box.height)).toBeGreaterThanOrEqual(WCAG_MIN);
  });

  test("is named for what it does, not for HeroUI's default", async ({
    signedIn,
    todos,
  }) => {
    await todos.quickAdd("something to search for");
    await expect(
      signedIn.locator("main").getByText("something to search for"),
    ).toBeVisible();

    const search = signedIn.getByRole("searchbox", { name: "Search todos" });

    await search.fill("something");

    await expect(
      signedIn.getByRole("button", { name: "Clear search", exact: true }),
    ).toBeVisible();
    await expect(
      signedIn.getByRole("button", { name: "Close", exact: true }),
    ).toHaveCount(0);
  });

  test("a full 24×24 region of it actually takes the press", async ({
    signedIn,
    todos,
  }) => {
    await todos.quickAdd("something to search for");
    await expect(
      signedIn.locator("main").getByText("something to search for"),
    ).toBeVisible();

    const search = signedIn.getByRole("searchbox", { name: "Search todos" });
    const clear = signedIn.locator(CLEAR_BUTTON);

    await search.fill("something");
    await expect(clear).toBeVisible();

    /*
      A box that measures 36 but does not hit-test is not a target, so this
      probes the shape rather than trusting the rectangle — the same
      `elementFromPoint` method QA used to close DEF-01.

      The probes trace the corners of a **centred 24×24 square**, not the
      bounding box's own corners: this control is a circle, and the corners of
      a circle's bounding box are outside the circle by construction. SC 2.5.8
      asks for a 24×24 region that accepts the pointer, and a 36px circle
      contains one (24×√2 = 33.9 < 36). A 20px circle contains no such region
      at all, which is what makes this fail on the unfixed control.
    */
    /*
      Measured and probed inside **one** evaluation, deliberately: an earlier
      version read the box over one round trip and then hit-tested over five
      more, so a re-render landing between them aimed the probes at
      coordinates that described the control a moment ago.

      **This does not close the window, and the comment here used to claim it
      did.** Reading `getBoundingClientRect` beside `elementFromPoint` removes
      the round trips but not the failure: this test still fails about **2 in
      40** on `develop`, and when it does it is *all five* probes including
      centre, which no coordinate skew can explain — the centre of the control
      is the one point that survives a re-measure.

      Diagnostics captured at the moment of failure: the rect is exactly 36×36
      at a stable position, `pointerEvents: auto`, `opacity: 1`,
      `visibility: visible`, `getAnimations().length: 0` — and
      `document.elementFromPoint(centre)` returns **`<html>`**. The control is
      there, is the right size, and is not animating; the hit-test tree simply
      does not know about it yet. That is a stale hit-test tree, and it is
      **an open, undiagnosed failure mode** — not geometry.

      It is very probably the *same* open failure mode as the one behind the
      effect test below, which is worth knowing before either is chased
      separately. That one was traced to `mouseup` and `click` being retargeted
      to `<html>` while the button sat unmoved at its 36×36 rect — the same
      element, the same `<html>`, the same roughly-3% rate. One reports it
      through `elementFromPoint`, the other through where a real press lands,
      and neither has been traced below that. Treat a red here and a red there
      as one bug with two symptoms until someone shows otherwise.

      What it is *not* is the search race. That is a genuine product defect,
      it is fixed, and it is pinned deterministically in
      `e2e/search-clear-race.spec.ts` rather than probabilistically here.
    */
    const results = await signedIn.evaluate((minSize) => {
      const target = document.querySelector(
        '[data-slot="search-field-clear-button"]',
      );

      if (target === null) return null;

      const rect = target.getBoundingClientRect();
      const centreX = rect.x + rect.width / 2;
      const centreY = rect.y + rect.height / 2;
      const half = minSize / 2;

      const probes: [string, number, number][] = [
        ["centre", centreX, centreY],
        ["top-left", centreX - half, centreY - half],
        ["top-right", centreX + half, centreY - half],
        ["bottom-left", centreX - half, centreY + half],
        ["bottom-right", centreX + half, centreY + half],
      ];

      return probes.map(([name, x, y]) => {
        const hit = document.elementFromPoint(x, y);

        return {
          name,
          hits:
            hit !== null &&
            hit.closest('[data-slot="search-field-clear-button"]') !== null,
        };
      });
    }, WCAG_MIN);

    expect(results, "the clear button is not rendered").not.toBeNull();

    for (const probe of results ?? []) {
      expect.soft(probe.hits, `probe ${probe.name} lands on the clear button`).toBe(
        true,
      );
    }
  });

  /*
    Split out of the probe test above, where it used to be a two-line tail
    ("the probes prove reach, this proves effect").

    It was not paying for itself there. This assertion failed for four
    different people, and because it failed inside a test named for a 24×24
    region taking a press, all four read it as geometry: a 24 probe in a 36px
    circle leaves about a pixel of margin, so a tap-target regression was
    always the plausible story, and the run gave no evidence against it.

    **It is not geometry, and it is not the search race either** — which is
    worth stating plainly, because the race was the second wrong answer and it
    is a much more convincing one. A clear that gets undone by the field's own
    `?q=` push landing late leaves the box reading `something`, and so does
    this; the two are indistinguishable from the failure message alone. That
    race is real, and it is fixed and pinned in
    `e2e/search-clear-race.spec.ts`, where holding the navigation open makes it
    fail 100% against the unfixed component rather than 3% against anything.

    Instrumented, this one is neither. Over 141 runs of exactly this journey,
    four failed, and in all four the component never received the clear at all:
    a single `onChange` for the `fill`, none for the click, and a filter state
    that was wholly self-consistent afterwards (`query`, `applied` and the URL
    all agreeing on `something`, no push recorded and lost). Nothing was
    overwritten, because nothing was ever cleared. A DOM-level trace of one
    failure has `pointerdown` and `mousedown` landing on the button and then
    `mouseup` and `click` retargeted to `<html>` — with the button still
    present, the same node, at the same 36×36 rect, and `elementFromPoint` over
    its centre still answering BUTTON. The click event fires on the common
    ancestor of press and release, so it went to the document and the button's
    handler never ran.

    That is the browser losing an input, and it is the same `<html>` signature
    the probe test above reports when *it* fails. The retry below is aimed at
    exactly that and nothing else: it re-clicks only while the button has
    provably received no click, so a genuine regression — one where the press
    lands and the field still does not empty — fails on the first attempt as it
    should.
  */
  /*
    A note on the evidence, since it is a Heisenbug and that limits what the
    above can claim. The failure reproduces at ~3% with component-level
    logging (4/141) and still reproduces with DOM listeners for
    pointerdown/mousedown/mouseup/click plus a MutationObserver attached
    (1/~30). Adding listeners for pointerup, pointercancel, lostpointercapture,
    scroll, focus and blur suppressed it completely: 0/250. So the root cause
    below the retargeting is *not* established, and the missing pointer-event
    trace is the piece that would establish it. What is established is that the
    clear never reaches the component, and that no filter state is lost.

    What is left here is worth keeping — reach without effect is not a target,
    and this is the only place that closes that gap for the clear button — but
    it needs to fail under its own name. If it goes red and the spec above is
    green, the shape of the control is not the problem; start from the race.
  */
  test("the press actually empties the field", async ({ signedIn, todos }) => {
    await todos.quickAdd("something to search for");
    await expect(
      signedIn.locator("main").getByText("something to search for"),
    ).toBeVisible();

    const search = signedIn.getByRole("searchbox", { name: "Search todos" });
    const clear = signedIn.locator(CLEAR_BUTTON);

    await search.fill("something");
    await expect(clear).toBeVisible();

    await signedIn.evaluate((selector) => {
      const counter = window as unknown as { __clearPresses?: number };

      counter.__clearPresses = 0;

      document.addEventListener(
        "click",
        (event) => {
          if ((event.target as Element | null)?.closest?.(selector)) {
            counter.__clearPresses = (counter.__clearPresses ?? 0) + 1;
          }
        },
        true,
      );
    }, CLEAR_BUTTON);

    const presses = () =>
      signedIn.evaluate(
        () => (window as unknown as { __clearPresses?: number }).__clearPresses ?? 0,
      );

    /*
      Retries the *delivery* of the click, never its effect. The loop exits the
      moment the button has received one, so the assertion below always judges
      a press that actually happened — a field that refills itself after a real
      press fails here on the first attempt, which is the behaviour a retry
      must not soften.
    */
    for (let attempt = 0; attempt < CLICK_DELIVERY_ATTEMPTS; attempt += 1) {
      await clear.click();

      if ((await presses()) > 0) break;
    }

    expect(
      await presses(),
      `the browser did not deliver a click to the clear button in ${CLICK_DELIVERY_ATTEMPTS} attempts`,
    ).toBeGreaterThan(0);

    await expect(search).toHaveValue("");
  });
});
