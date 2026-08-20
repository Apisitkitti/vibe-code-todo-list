# The search clear button was clipped, not stale

*2026-08-20 — Junior dev, closing the intermittent reds on
`e2e/a11y-targets.spec.ts`.*

**What was decided:** the search field's `<input>` takes `min-w-0`, so the
group's width cap governs its layout instead of the input's intrinsic width.
`overflow: hidden` stays on the group, the group gets no width floor, and the
hit-test sweep in `e2e/a11y-targets.spec.ts` records **what** each probe landed
on rather than only whether it landed. The sweep's re-read loop is **removed**,
and the effect test's click retry is cut from five attempts to two.

**What raised it:** three failures that were chased separately for days and are
one bug.

- All five probes missing at once, with `elementFromPoint` answering `<html>`.
- A press whose `pointerdown`/`mousedown` land on the button and whose
  `mouseup`/`click` retarget to `<html>`, with the button unmoved at its 36×36
  rect.
- A clear button that "does nothing" on CI, reported as the two right-hand
  probes missing.

All three were previously written up as a **stale hit-test tree** — an
undiagnosed browser fault — and, before that, as the search race (which is real,
is fixed, and is pinned in `e2e/search-clear-race.spec.ts`).

## The mechanism

`[data-slot="search-field-group"]` computes `overflow: hidden`, from HeroUI's
own `.search-field__group` rule. Overflow clipping clips **hit-testing**, and it
clips one side, so the failure is asymmetric.

A flex item's automatic minimum size is its min-content width, and an
`<input>`'s min-content is its default intrinsic width — `size=20` worth of
glyphs in whichever face is currently measuring. That is a **font metric**, not
a layout choice. Without `min-w-0` the input will not shrink below it, so once
icon (28) + input min-content + button (44) exceeds the `sm:max-w-64` cap of
256px, the surplus is pushed off the end of the group and clipped away.

Measured on this component, by squeezing the group and reading the sweep:

| group width | overhang | probes that miss |
|---|---|---|
| 256 (the app's own) | −8.0 | none |
| 240 | −6.0 | none — but the group already overflows by 2px |
| 220 | +14.0 | top-right, bottom-right — **the CI signature** |
| 200 | +34.0 | all five, each landing on `main` |
| 180 | +54.0 | all five, on `main` and `body` |

One continuum, three reported symptoms. The group's min-content is 242px against
the 256px cap, so there are 14px of slack and 8px of them are the button's
`margin-inline-end`. Forcing the input to `monospace` takes the group's
`scrollWidth` to 261 against a `clientWidth` of 256 — already overflowing — and
cuts the button's headroom from 8px to 3px. Geist arrives through `next/font`,
**Correction, from review.** A fallback face while `next/font` settles was the
first guess at what tips it over, and it does not survive measurement: at the
app's real width no face reaches the cliff — Geist and seven others sit at
256/256, monospace at 261/256, Courier New at 260/256, every probe hitting. The
CI signature needs content near 278. The overflow is reachable by construction
and the trigger that reached it on CI is **unknown**. What follows is the
original guess, kept for the record rather than as fact.

The original guess was that
metrics on CI's headless Linux, and transiently during swap locally.

## Two standing hypotheses that are now refuted, and must not come back

**The control is not a circle.** Computed `border-radius` is 12px on a 36×36 box
— a rounded square. The 24×24 probe square clears each corner arc by **3.51px**,
not the 1.03px an earlier note claimed by treating it as a circle. Geometry was
never tight, and the probes must not be inset: insetting weakens a gate that
still correctly fails a 20px control, while hiding this defect.

**Sub-pixel rounding is ruled out empirically.** Across widths 641–1440 and
device scale factors 1 through 2.625 the rect is exactly 36×36 with zero misses,
and a fractional `rect.x` cannot eat corner margin because the probes derive from
the same rect and translate with it.

## Why `min-w-0`, and what it costs

Three candidates, and two lose.

- **Give the group real headroom** (raise the cap, or give the group a width
  floor). It takes width from the filter row, where the status toggles and the
  priority select already compete on one line below `sm:`, and it only moves the
  cliff: a wide enough fallback face walks off the new edge too.
- **Remove `overflow: hidden`.** It is load-bearing. The group carries the 12px
  field radius and its children are deliberately squared against it —
  `search-field__input` zeroes its own corner radii, and the focus and autofill
  backgrounds paint to the edge — so the clip is what makes the rounded field
  rounded. Verified by mutation: injecting `overflow: visible` at a squeezed
  width makes all five probes hit while the button still overhangs by 34px, so
  it would *hide* the overflow rather than prevent it.
- **`min-w-0` on the input** puts the cap back in charge. The input yields, the
  button keeps its place, and **no font can push the content out** — the group's
  `scrollWidth` equals its `clientWidth` at every width from 180 to 256, and the
  button's overhang is a constant −8. With the fix in place, forcing
  `monospace`, `Courier New`, `DejaVu Sans` and `Liberation Sans` all leave the
  group at 256/256 and the overhang at −8.

**The cost** is that a narrow field shows fewer characters of the query at once,
because the input is now the thing that shrinks. That is the right thing to give
up: it is recoverable by scrolling within the input, and it is the only thing
the field can give up without taking width from the row beside it.

## Why the re-sweep is gone

The sweep looped while the **centre** probe missed. That was correct for what it
targeted and it never fired for the right-only case, so it never covered the CI
failure at all. The sharper point is that if the cause is clipping rather than
staleness, **re-sweeping a still-overflowed layout returns the same answer** —
**Correction, from review.** The loop was restored. Review reproduced the
historical signature on the fixed tree — 119 of 120 at `--repeat-each=20`, all
five probes on `<html>`, with **overhang −8 and zero group overflow**. Nothing
was clipped, so the clip is not that failure's cause and the two families do
not unify. The clip lands probes on `main` and takes the right pair first; the
undiagnosed fault lands all five on `<html>` at once. The loop gates on the
centre, which is the second and never the first. It is kept as a workaround for
something unexplained, said plainly in the test.

The original reasoning for deleting it was that
curing anything. It was a sleep with a condition attached.

With the cap governing, there is no swap to wait out: the button cannot leave the
group at any font metric. Keeping the loop would only suppress the signal the new
gate exists to produce. The click retry in the effect test was the same
tolerance for the same bug and is cut to two attempts — the one remaining clause
covers React Aria's `usePress` firing on `pointerup`, where a press takes effect
without a `click` and a second `click()` would aim at a button that no longer
exists.

Evidence that nothing was load-bearing: the three previously intermittent
assertions ran **120/120 green with no retries** (`--repeat-each=20`, both
projects). The historical rate was ~3%, which would have produced 3–4 failures.

## Why the suite could not see this, and what changed

**Playwright's `.click()` cannot fail on this defect.** Its actionability check
calls `scrollRectIntoViewIfNeeded`, and an `overflow: hidden` box is still
programmatically scrollable, so a clipped clear button is *revealed* before it is
clicked. Measured against the unfixed component at a 200px squeeze: the group's
`scrollLeft` goes from 0 to 34 — exactly the button's overhang — and the click
then lands and empties the field. A user has no such affordance.

That also explains the rate. The clip was present on every run; only the runs
where a re-render reset that scroll between `mousedown` and `mouseup` lost the
click, which is why both tests sat near 3% rather than at 100%. So the new gate
asserts **geometry**, not a click: the group's content never exceeds the box that
clips it, and the button never leaves that box.

**The instrumentation change is the durable part.** The sweep recorded only
`hits: boolean`, and a miss reported as `false` is equally consistent with a
control that is too small, a control under an overlay, and a control clipped out
of the tree — which have nothing in common. Recording the identity turned this
around in three runs: a probe answering `main` says outright that the point is
over page background. The group's `overhang` and `groupOverflow` ride along in
the same failure message, so the next occurrence diagnoses itself.

## Watched failing

- The new squeeze test, against the tree with `min-w-0` removed: red on both
  projects, reporting `overhang 34px`, `group content exceeds the box that clips
  it by 42px`, and all five probes landing on `main`.
- Mutation — squeeze style tag pointed at a non-existent slot: red on the
  applied-guard (`toHaveCSS` width 256 ≠ 200), so the test cannot pass on a
  condition it failed to create.
- Mutation — `overflow: visible` injected with the fix removed: probes all hit
  while the geometry assertions stay red, which attributes the misses to the clip
  and confirms the geometry assertions are the earlier gate.

## What would change this

- **HeroUI giving the group a real min-width, or dropping `overflow: hidden`.**
  Either makes `min-w-0` redundant rather than wrong; check the group's rule in
  `@heroui/styles` before removing it, and keep the squeeze test either way — it
  asserts the invariant, not the implementation.
- **A design change that makes the field's own width the thing worth protecting**
  — a longer placeholder, or a control added inside the group. Then the answer is
  a wider cap *and* `min-w-0`, not one instead of the other.
- **Playwright learning not to scroll a clipped control into view.** Then a click
  assertion becomes able to fail on this, and the squeeze test could assert
  effect as well as geometry.
