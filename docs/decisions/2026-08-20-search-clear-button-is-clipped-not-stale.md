# The search clear button was clipped — and that is not the whole story

*2026-08-20 — Junior dev, closing the intermittent reds on
`e2e/a11y-targets.spec.ts`.*

**What was decided:** the search field's `<input>` takes `min-w-0`, so the
group's width cap governs its layout instead of the input's intrinsic width.
`overflow: hidden` stays on the group, the group gets no width floor, and the
hit-test sweep in `e2e/a11y-targets.spec.ts` records **what** each probe landed
on rather than only whether it landed. The sweep's re-read loop is **kept**,
retitled as a workaround for a fault that is still undiagnosed, and the effect
test's click retry is cut from five attempts to two.

**What raised it:** three failures chased separately for days. **Two of them are
this bug. The third is not, and is still open** — see the correction below.

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
cuts the button's headroom from 8px to 3px.

> **Correction, from review.** The original guess, kept here for the record
> rather than as fact, was: *"Geist arrives through `next/font`, so a fallback
> face is measuring the field until the webfont settles — different metrics on
> CI's headless Linux, and transiently during swap locally."*
>
> It does not survive measurement. At the app's real width no face reaches the
> cliff: Geist and seven others sit at 256/256, monospace at 261/256, Courier
> New at 260/256, and every probe hits in all of them. The CI signature needs
> content near 278, about 17px beyond the widest face available.
>
> So the overflow is **reachable by construction** and the trigger that reached
> it on CI is **unknown**. Recorded as unknown deliberately.

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

## Why the re-sweep stays

It was deleted once, and restoring it is the most important correction in this
record.

> **Correction, from review.** The original reasoning for deleting it was:
> *"re-sweeping a still-overflowed layout returns the same answer, so where the
> loop appeared to help it was waiting out a font swap rather than curing
> anything — a sleep with a condition attached."*
>
> Review reproduced the historical signature on the **fixed** tree: 119 of 120
> at `--repeat-each=20`, all five probes landing on `<html>`, with **overhang
> −8 and zero group overflow**. Nothing was clipped. The clip is not that
> failure's cause, and the two families do not unify.

So there are two faults, and they are distinguishable:

- **The clip.** Probes land on `main` (or `body` at extreme squeezes) and the
  right-hand pair goes first, because a clip has an edge. Diagnosed, fixed by
  `min-w-0`, and gated by the squeeze test.
- **The `<html>` fault.** All five probes miss at once and every one lands on
  `<html>`, with the control present, correctly sized and unmoved. **Still
  undiagnosed.** Roughly 0.5–3% of runs, load-dependent — one reviewer saw it
  once in ~186 runs and then not once in 220.

The loop gates on the **centre** probe. That is the right gate because an
undersized control still hits dead centre and fails only the corners, so a real
DEF-16 regression is reported on the first pass having consumed no retries —
measured: `used=0, centreHit=true, corners=4`. It is not true, as an earlier
draft of this record claimed, that the loop never fires for the clip: at a full
clip the centre misses too and all four retries are consumed, costing 435ms and
masking nothing.

The budget is four re-reads at 100ms, so **400ms** of settling. The fault's
duration is **unknown** — 220 instrumented sweeps against a healthy component
never fired the retry once, so there is no measurement to fit. The number is a
bound, not a fit. What justifies it is the baseline: `develop` ships four
re-reads with no delay between them, spanning under 15ms in total, so this is
strictly more tolerant than the merge target rather than a new indulgence.

The click retry in the effect test is cut to two attempts. The one remaining
clause covers React Aria's `usePress` firing on `pointerup`, where a press takes
effect without a `click` — and a second `click()` would then aim at a button the
empty state has made inert. `search-field.css` gives the cleared field's button
`pointer-events-none opacity-0` and leaves the node in place, so the retry would
burn a 20s action timeout on "does not receive pointer events" rather than on
anything true.

## Why the suite could not see this, and what changed

**Playwright's `.click()` cannot fail on this defect.** Its actionability check
calls `scrollRectIntoViewIfNeeded`, and an `overflow: hidden` box is still
programmatically scrollable, so a clipped clear button is *revealed* before it is
clicked. Measured against the unfixed component at a 200px squeeze: the group's
`scrollLeft` goes from 0 to 34 — exactly the button's overhang — and the click
then lands and empties the field. A user has no such affordance.

The reveal-scroll is real — measured, `scrollLeft` 0→34 — but **only under an
induced squeeze**, and it does not explain the historical rate. An earlier draft
of this record said the clip "was present on every run" and that this was why
both tests sat near 3%. Both halves are wrong: at the app's real width nothing
overflows, so there was no clip on any real run to be present; and the probe
test never clicks, so no reveal-scroll can occur in it at all. **Both historical
rates remain unexplained**, and the `<html>` fault is the leading candidate for
each, since the effect test's own trace also ended on `<html>`.

The new gate therefore asserts **geometry**, not a click: the group's content
never exceeds the box that clips it, and the button never leaves that box.

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

## The `<html>` fault: what is known, for whoever picks it up

Split into measurement and guess, because this is the file where that
distinction is the point.

**Measured:**

- **It is there on the very first sweep.** It was caught when no retry loop
  existed, immediately after `expect(clear).toBeVisible()` resolved. It does not
  develop over the life of the test; it is present when the test opens its eyes.
- **The failing observation, verbatim**, so the next person can pattern-match
  rather than re-derive: `button 44×44 at (344, 483)`, `group 380×44 at
  (16, 483)`, chromium-mobile at 412×915. Rect correct, position correct, 138px
  of slack in the group. Nothing clipped.
- **A green run proves very little.** The 220 clean sweeps came *after* the run
  that failed. It wants reproducing under contention — parallel workers, a
  loaded machine — not in a quiet loop.

**The one cheap datum nobody has yet.** `<html>` is far more specific than
"stale": it means nothing between that point and the root accepted the hit, not
that the button was missing. On failure only, record
`document.elementsFromPoint(centre)` — the whole stack, plural. `[html]` alone
means the entire subtree stopped hit-testing and the button is a bystander;
`[html, body, main, …]` with the button absent means the button specifically is
the problem. Those want completely different investigations and today's
instrumentation cannot tell them apart. Alongside it: computed `pointerEvents`
and `visibility` for button, group, `main` and `body`; whether `main` carries
`aria-hidden` or `inert`; and any `[role="dialog"]` present.

**A lead, explicitly untested.** Document-level inerting predicts `<html>`
specifically: `modal.css:99` keeps React Aria's modal container at
`pointer-events: none` by design, and React Aria hides everything outside an
open overlay, so a probe outside one would fall past `main` to the root — and it
would be load-dependent, which matches. **This has not been tested**, no modal
is visible in that test's flow, and the `elementsFromPoint` datum above would
confirm or kill it in a single run. It is a lead, not a mechanism. This record
has been repaired twice for letting a guess be read as a fact; do not let this
be the third.

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
