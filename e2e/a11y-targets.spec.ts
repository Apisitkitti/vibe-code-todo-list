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
 *
 * Sizing it fixed the *rectangle* and left a second way for the same control
 * to be unpressable, which this file now also pins: the field group computes
 * `overflow: hidden`, and a button pushed past the group's content edge is
 * clipped out of hit-testing. See the note on the squeeze test below for the
 * mechanism, and `TodoFilters.tsx` for the fix.
 */

/** The app's own floors: NFR-05 on phones, the `sm:` step-down above 640px. */
const MOBILE_MIN = 44;
const POINTER_MIN = 36;
/** WCAG 2.2 SC 2.5.8 (AA) — the floor nothing in the app may drop below. */
const WCAG_MIN = 24;

const SEARCH_FIELD = '[data-slot="search-field"]';
const SEARCH_GROUP = '[data-slot="search-field-group"]';
const CLEAR_BUTTON = '[data-slot="search-field-clear-button"]';

/**
 * How many times a click may be re-sent when the browser drops it outright.
 *
 * React Aria's `usePress` fires on `pointerup`, so a press can take effect
 * without a `click` ever reaching the button; the loop below exits on either.
 * One extra attempt covers that, and nothing else — the retry that used to
 * live here was aimed at the clipping this file now fixes and pins, and a
 * re-press against a still-clipped control lands in exactly the same place.
 */
const CLICK_DELIVERY_ATTEMPTS = 2;

/**
 * How many times the hit-test sweep is re-read while the **centre** probe
 * misses, and how long to wait between reads.
 *
 * This gates an undiagnosed fault, not the clip. See the note in the probe
 * test: review reproduced all five probes landing on `<html>` with overhang
 * −8 and zero group overflow, so nothing was clipped. The centre is the right
 * gate because a genuinely undersized control hits dead centre and fails only
 * the corners, so a real regression is reported on the first pass and never
 * re-read.
 *
 * Four re-reads at 100ms is **400ms** of settling. The fault's duration is
 * **unknown** — 220 instrumented sweeps against a healthy component never fired
 * the retry once, so there is nothing to fit a number to, and a rate tells you
 * nothing about a duration. This is a bound, not a fit.
 *
 * What justifies it is the baseline rather than the fault: `develop` already
 * ships four re-reads with no delay between them, spanning under 15ms in total.
 * This is strictly more tolerant than the merge target, so the release does not
 * regress on the axis in question.
 */
const MAX_SWEEP_ATTEMPTS = 4;
const SWEEP_RETRY_MS = 100;

/**
 * The width the field is squeezed to in the clipping test.
 *
 * Below the group's unshrunk `min-content` of 242px by more than the clear
 * button's 8px of headroom, so an input that will not shrink pushes the button
 * clean out of the group. Measured on this component: at 240 the group already
 * overflows by 2px and every probe still hits, at 220 the two right-hand probes
 * miss — the CI signature — and at 200 all five do. 200 is chosen so the gate
 * fails on the whole failure, not on the first pixel of it.
 */
const SQUEEZED_FIELD_WIDTH = 200;

const targetFloor = (page: Page): number => {
  const width = page.viewportSize()?.width ?? 0;

  return width < 640 ? MOBILE_MIN : POINTER_MIN;
};

const boxOf = async (locator: Locator) => {
  const box = await locator.boundingBox();

  if (box === null) throw new Error("control is not rendered");

  return box;
};

interface HitProbe {
  name: string;
  hits: boolean;
  /** What `elementFromPoint` actually answered — see `sweepHitTest`. */
  hit: string;
}

interface HitTestSweep {
  probes: HitProbe[];
  button: { x: number; y: number; width: number; height: number };
  group: { x: number; y: number; width: number; height: number };
  /** How far the button's right edge sits past the group's. Negative is safe. */
  overhang: number;
  /** How far the group's content exceeds the box that clips it. 0 is safe. */
  groupOverflow: number;
}

/**
 * Hit-tests a centred `minSize` square on the clear button, and records **what
 * each probe landed on** rather than only whether it landed.
 *
 * The identity is the whole point. Two investigations stalled on a `hits:
 * boolean`, because a miss reported as `false` is equally consistent with a
 * control that is too small, a control covered by an overlay, and a control
 * clipped out of the hit-test tree — and those have nothing in common. With
 * the identity recorded, a probe answering `main` or `body` says outright that
 * the point is over page background, which is what a clipped control looks
 * like and what neither of the other two would produce.
 *
 * The group's geometry rides along for the same reason: `overhang` and
 * `groupOverflow` name the cause directly, so the next occurrence diagnoses
 * itself off the failure message instead of off a bisect.
 *
 * Measured and probed inside one evaluation, so a re-render cannot land
 * between reading the rectangle and aiming at it.
 */
const sweepHitTest = (page: Page, minSize: number): Promise<HitTestSweep | null> =>
  page.evaluate(
    ({ buttonSelector, groupSelector, size }) => {
      const button = document.querySelector(buttonSelector);
      const group = document.querySelector(groupSelector);

      if (button === null || group === null) return null;

      const rect = button.getBoundingClientRect();
      const groupRect = group.getBoundingClientRect();
      const centreX = rect.x + rect.width / 2;
      const centreY = rect.y + rect.height / 2;
      const half = size / 2;

      const points: [string, number, number][] = [
        ["centre", centreX, centreY],
        ["top-left", centreX - half, centreY - half],
        ["top-right", centreX + half, centreY - half],
        ["bottom-left", centreX - half, centreY + half],
        ["bottom-right", centreX + half, centreY + half],
      ];

      const describe = (element: Element | null): string => {
        if (element === null) return "nothing";

        const slot = element.getAttribute("data-slot");
        const tag = element.tagName.toLowerCase();

        return slot === null ? tag : `${tag}[data-slot="${slot}"]`;
      };

      const box = (source: DOMRect) => ({
        x: source.x,
        y: source.y,
        width: source.width,
        height: source.height,
      });

      return {
        probes: points.map(([name, x, y]) => {
          const hit = document.elementFromPoint(x, y);

          return {
            name,
            hits: hit?.closest(buttonSelector) != null,
            hit: describe(hit),
          };
        }),
        button: box(rect),
        group: box(groupRect),
        overhang: rect.right - groupRect.right,
        groupOverflow: group.scrollWidth - group.clientWidth,
      };
    },
    { buttonSelector: CLEAR_BUTTON, groupSelector: SEARCH_GROUP, size: minSize },
  );

/** The whole sweep as one block of failure copy, so a red run is readable. */
const describeSweep = (sweep: HitTestSweep | null): string => {
  if (sweep === null) return "the clear button is not rendered";

  const round = (value: number) => Math.round(value * 100) / 100;

  return [
    `button ${round(sweep.button.width)}×${round(sweep.button.height)} at (${round(sweep.button.x)}, ${round(sweep.button.y)})`,
    `group ${round(sweep.group.width)}×${round(sweep.group.height)} at (${round(sweep.group.x)}, ${round(sweep.group.y)})`,
    `button overhangs the group's right edge by ${round(sweep.overhang)}px`,
    `group content exceeds the box that clips it by ${round(sweep.groupOverflow)}px`,
    ...sweep.probes.map(
      (probe) => `  ${probe.name}: ${probe.hits ? "hits" : `misses, landed on ${probe.hit}`}`,
    ),
  ].join("\n");
};

/** Puts the field in the state where it has a clear button to press. */
const searchFor = async (page: Page, text: string) => {
  const search = page.getByRole("searchbox", { name: "Search todos" });
  const clear = page.locator(CLEAR_BUTTON);

  await search.fill(text);
  await expect(clear).toBeVisible();

  return { search, clear };
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

    const { clear } = await searchFor(signedIn, "something");

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

    await searchFor(signedIn, "something");

    /*
      A box that measures 36 but does not hit-test is not a target, so this
      probes the shape rather than trusting the rectangle — the same
      `elementFromPoint` method QA used to close DEF-01.

      The probes trace the corners of a **centred 24×24 square**, not the
      bounding box's own corners. SC 2.5.8 asks for a 24×24 region that accepts
      the pointer, and this control is a 36×36 box with a 12px `border-radius`
      — a rounded square, not a circle — so the 24×24 square clears each corner
      arc by 3.51px. A 20px control contains no such region at all, which is
      what makes this fail on the unfixed DEF-16 button.

      Do not inset the probes to quieten a failure here. The margin is 3.5px,
      not the ~1px an earlier note claimed from treating the control as a
      circle, and sub-pixel rounding is ruled out empirically: across widths
      641–1440 and device scale factors 1 to 2.625 the rectangle is exactly
      36×36 with no misses, and a fractional `rect.x` cannot eat the corner
      margin because the probes derive from that same rectangle and translate
      with it. Insetting would weaken a gate that still correctly fails a 20px
      control, while hiding the reachability defect the next test pins.

      **The re-sweep below covers a fault nobody has diagnosed, and it is not
      the clip.** This loop was deleted once, on the theory that overflow
      clipping — the defect the next test pins — explained every red here. It
      does not. Review reproduced the historical signature on the *fixed* tree,
      at `--repeat-each=20`, 119 of 120: all five probes missing, every one
      landing on `<html>`, with the instrumentation reporting **overhang −8 and
      groupOverflow 0**. There was no clip. The clip cannot be the cause.

      The two failures are distinguishable and the distinction is what the loop
      gates on. Clipping lands probes on `main` (or `body` at extreme squeezes)
      and takes the right-hand pair first, because the clip has an edge. This
      one lands every probe on `<html>` at once, with the control present,
      correctly sized and unmoved.

      The loop re-reads only while the **centre** misses. It cannot mask a
      genuinely undersized control, because a small control still hits dead
      centre and fails the corners on the first pass — measured, with zero
      retries consumed. It is not true that the loop never fires for the clip:
      at a full clip the centre misses too and all four retries are spent,
      costing 435ms and masking nothing.

      So this is a workaround for something unexplained, kept deliberately
      rather than because it is understood. What is known: it survives the
      `min-w-0` fix, it occurs where no clip exists, it reproduces on mobile
      where the group cannot clip at all (380px against a 242px min-content),
      and no font reaches the cliff at the app's real width. Roughly 0.5–3%.
      Whoever picks this up: the instrumentation below already records what each
      probe hit, which is what turned the clip diagnosis around — the next step
      is finding what `<html>` means here when nothing is clipped.
    */
    let sweep = await sweepHitTest(signedIn, WCAG_MIN);
    let retriesUsed = 0;

    while (
      retriesUsed < MAX_SWEEP_ATTEMPTS &&
      sweep !== null &&
      sweep.probes.some((probe) => probe.name === "centre" && !probe.hits)
    ) {
      retriesUsed += 1;

      await signedIn.waitForTimeout(SWEEP_RETRY_MS);

      sweep = await sweepHitTest(signedIn, WCAG_MIN);
    }

    /*
      Reported on every failure, because without it a red cannot tell you
      whether the budget was spent and lost or the fault was there on the first
      read — and those want opposite responses. Nobody should have to re-derive
      this to tune the numbers above.
    */
    const budget = `retries used: ${retriesUsed} of ${MAX_SWEEP_ATTEMPTS}`;

    expect(sweep, "the clear button is not rendered").not.toBeNull();

    for (const probe of sweep?.probes ?? []) {
      expect
        .soft(probe.hits, `probe ${probe.name}\n${budget}\n${describeSweep(sweep)}`)
        .toBe(true);
    }

    expect(
      sweep?.probes.every((probe) => probe.hits),
      `not every probe landed on the clear button\n${budget}\n${describeSweep(sweep)}`,
    ).toBe(true);
  });

  /*
    The reachability defect, pinned deterministically.

    `[data-slot="search-field-group"]` computes `overflow: hidden`, and overflow
    clipping clips **hit-testing** — a button pushed past the group's content
    edge stops taking the pointer even though its own rectangle is untouched.
    The clip has an edge, so the failure is asymmetric: the right-hand probes go
    first, then the centre, then all five, as the button slides out.

    What pushes it out is a font metric. A flex item's automatic minimum size is
    its min-content width, and an `<input>`'s min-content is its default
    intrinsic width — `size=20` worth of glyphs in whichever face is currently
    measuring. Forcing the input to `monospace` here takes the group's
    `scrollWidth` to 261 against a `clientWidth` of 256 and cuts the button's
    headroom from 8px to 3px, on a component that is otherwise fine.

    **What actually pushed it past the edge on CI is not established.** A
    fallback face while `next/font` settles was the first guess and review
    defeated it: at the app's real width no face reaches the cliff — Geist and
    seven others sit at 256/256, monospace at 261/256 and Courier New at
    260/256, and every probe still hits in all of them. The CI signature needs
    content near 278, roughly 17px past the widest face available. So the
    mechanism below is real and reachable by construction, and the trigger that
    reached it in that particular run is unknown. Recorded as unknown rather
    than filled in, because a record that asserts a mechanism nobody measured
    gets believed.

    That is why this presented for days as three unrelated intermittents: all
    five probes missing with `elementFromPoint` answering the page background, a
    click whose `mouseup` retargets to `<html>` while the button sits unmoved at
    its 36×36 rect, and a clear that "does nothing". One clip, three readings of
    it.

    **Squeezing the field is how this becomes a gate rather than a coincidence.**
    At the default macOS metrics the component fits with 8px to spare and every
    probe passes, so a test that only ran at those metrics was passing because
    the local font happened to fit — which is precisely what let this run. The
    squeeze reproduces the CI condition on any machine: it caps the field below
    the input's unshrunk min-content, which is the same state a wider fallback
    face produces on its own.

    The invariant asserted is not "the button is 36 wide" but **"the group's cap
    governs"** — its content never exceeds the box that clips it, and the button
    never leaves that box. That survives any font, which the geometry alone
    does not.
  */
  test("stays inside the field's clip when the field is narrower than the input wants", async ({
    signedIn,
    todos,
  }) => {
    await todos.quickAdd("something to search for");
    await expect(
      signedIn.locator("main").getByText("something to search for"),
    ).toBeVisible();

    await searchFor(signedIn, "something");

    await signedIn.addStyleTag({
      content: `${SEARCH_FIELD} { max-width: ${SQUEEZED_FIELD_WIDTH}px !important; }`,
    });

    /*
      The squeeze is verified before anything is concluded from it. A style tag
      that lost to a later rule would leave every assertion below passing for
      the wrong reason — a green check on a condition that was never created.
    */
    await expect(signedIn.locator(SEARCH_GROUP)).toHaveCSS(
      "width",
      `${SQUEEZED_FIELD_WIDTH}px`,
    );

    const sweep = await sweepHitTest(signedIn, WCAG_MIN);

    expect(sweep, "the clear button is not rendered").not.toBeNull();

    expect
      .soft(
        sweep?.groupOverflow,
        `the field group's content overflows the box that clips it\n${describeSweep(sweep)}`,
      )
      .toBe(0);

    expect
      .soft(
        (sweep?.overhang ?? 0) <= 0,
        `the clear button is clipped by the field group\n${describeSweep(sweep)}`,
      )
      .toBe(true);

    for (const probe of sweep?.probes ?? []) {
      expect
        .soft(probe.hits, `probe ${probe.name}\n${describeSweep(sweep)}`)
        .toBe(true);
    }

    expect(
      sweep?.probes.every((probe) => probe.hits) === true &&
        sweep?.groupOverflow === 0 &&
        sweep.overhang <= 0,
      `the clear button is not fully inside the field's clip\n${describeSweep(sweep)}`,
    ).toBe(true);

    /*
      **There is deliberately no `clear.click()` here, and it is the reason this
      defect survived a suite that clicks that button elsewhere.**

      Playwright's actionability check calls `scrollRectIntoViewIfNeeded`, and
      an `overflow: hidden` box is still programmatically scrollable — so a
      clipped clear button is *revealed* before it is clicked. Measured against
      the unfixed component at this width: the group's `scrollLeft` goes from 0
      to 34, exactly the button's overhang, and the click then lands and empties
      the field. A user has no such affordance; the field does not scroll under
      their finger.

      So a click assertion here would pass on the broken component and prove
      nothing, which is also why the effect test below only ever reddened at ~3%
      instead of always — it was catching the presses where a reflow landed
      mid-gesture, not the clip itself. Geometry is the only thing that can be
      false here, so geometry is what is asserted.
    */
  });

  /*
    Split out of the probe test above, where it used to be a two-line tail
    ("the probes prove reach, this proves effect").

    It was not paying for itself there. This assertion failed for four
    different people, and because it failed inside a test named for a 24×24
    region taking a press, all four read it as geometry: a tap-target
    regression was always the plausible story, and the run gave no evidence
    against it.

    It was not geometry, and it was not the search race either — the race is
    real, fixed, and pinned deterministically in `e2e/search-clear-race.spec.ts`,
    where holding the navigation open makes it fail 100% against the unfixed
    component rather than 3% against anything.

    It was the clip, seen through Playwright's own workaround for it. The
    actionability check scrolls the clipping box to reveal the button before
    pressing — measured at exactly the overhang, see the squeeze test — and a
    re-render or reflow between `mousedown` and `mouseup` puts that scroll back
    to 0, snapping the button out of the clip mid-gesture. That is precisely the
    trace nobody could explain: `pointerdown` and `mousedown` on the button,
    then `mouseup` and `click` retargeted to `<html>`, with the button still
    present, unmoved, at the same 36×36 rect. `click` fires on the common
    ancestor of press and release, so it went to the document and the handler
    never ran.

    It also explains the rate. The clip was there on every run; only the runs
    where a re-render landed inside the press window lost the click, which is
    why this and the probe test each sat near 3% rather than at 100%.

    What this test still earns its place for is the half neither the probes nor
    the squeeze cover at the app's real width: reach without effect is not a
    target.
  */
  test("the press actually empties the field", async ({ signedIn, todos }) => {
    await todos.quickAdd("something to search for");
    await expect(
      signedIn.locator("main").getByText("something to search for"),
    ).toBeVisible();

    const { search } = await searchFor(signedIn, "something");
    const clear = signedIn.locator(CLEAR_BUTTON);

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
      This loop is **not** a tolerance for the clip, and the version of it that
      allowed five attempts was. Re-pressing a clipped button aims at the same
      clipped place, so the retry bought nothing but a slower red; the clip is
      fixed in the component and gated by the squeeze test above.

      What is left is one clause with a specific job. React Aria's `usePress`
      fires on `pointerup`, not `click`, so a press can take effect while the
      counter stays 0 — and a second `click()` then aims at a button the empty
      state has made inert. `search-field.css` gives the cleared field's button
      `pointer-events-none opacity-0` and leaves the node in place, so the
      retry burns a 20s action timeout on "does not receive pointer events"
      rather than on anything true. Breaking on the field being empty removes
      that flake shape.

      **This assertion has no sensitivity to a refill**, and an earlier comment
      claimed it did. Disabling the echo guard outright — so a real press is
      followed by a genuine permanent refill — passed this test 20/20:
      `toHaveValue("")` sees the transient empty value and resolves before the
      ~300ms refill. The refill is `e2e/search-clear-race.spec.ts`'s job.
    */
    for (let attempt = 0; attempt < CLICK_DELIVERY_ATTEMPTS; attempt += 1) {
      await clear.click();

      if ((await presses()) > 0) break;
      if ((await search.inputValue()) === "") break;
    }

    if ((await search.inputValue()) !== "") {
      expect(
        await presses(),
        `the browser did not deliver a click to the clear button in ${CLICK_DELIVERY_ATTEMPTS} attempts`,
      ).toBeGreaterThan(0);
    }

    await expect(search).toHaveValue("");
  });
});
