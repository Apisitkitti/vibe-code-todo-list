# Toasts cut rather than slide, and the animation is gone rather than shortened

*2026-08-21 — Junior dev, implementing the action-toast cap on `fix/interaction`.*

**What was decided:** the app builds its own `ToastQueue` with
`wrapUpdate: fn => fn()` — the escape hatch `docs/DESIGN.md` §4.10 names — and
accepts that **toasts now appear and disappear with no animation at all**. Not a
faster slide: no slide. This is a visible behaviour change with no ticket behind
it, so it is written down here rather than left for someone to file as a
regression.

**What raised it:** the ux-designer capped action-bearing toasts at one. Under a
cap every repeat write becomes a close-then-add, and a close-then-add is where
HeroUI's view transition costs the most. §4.10 already specified `wrapUpdate` as
the fix and said the trade is "worth making the moment an action matters more
than the animation". The cap is that moment. The two shipped together; neither
was viable alone.

## The mechanism, because the cause is not where it looks

HeroUI runs every toast queue update — each add and each close — inside
`document.startViewTransition`
(`node_modules/@heroui/react/dist/components/toast/toast-queue.js`, the default
`wrapUpdate`). While a transition runs, the browser paints the
`::view-transition` snapshot layer over the page and **that layer takes the
hit-testing**. The real button underneath is mounted, painted and focusable, and
a pointer press lands on the snapshot instead.

The part that makes this a *removal* rather than a *shortening* is in the
stylesheet. The slide is defined **only** on the view-transition pseudo-elements
(`@heroui/styles/dist/components/toast.css`):

```css
::view-transition-new(.toast-bottom):only-child { animation: toast-slide-bottom-in 350ms; }
::view-transition-old(.toast-bottom):only-child { animation: toast-slide-bottom-out 350ms; }
```

There is no transition or keyframe on the toast element itself. So opting out of
the view transition does not shorten the slide, it deletes the only place the
slide was ever declared. A future reader looking for "why did the toast stop
animating" will find nothing in our code, because the change is the absence of a
wrapper.

## What it bought, measured

Real pointer presses driven through the browser's own input pipeline, one page
reload per sample, measured **from the user's own press** rather than from the
toast button's first frame. `e2e/toast-dead-window.spec.ts` is the harness; run
it with `MEASURE_TOAST=1`.

| | before | after |
|---|---|---|
| lone add | swallowed at 357ms, landed at 417ms | landed at 200ms, 0 blocked frames |
| close-then-add | swallowed at **729ms**, landed at **760ms** | landed at 200ms, 0 blocked frames |

§4.10's figures — 350–400ms, and roughly twice that for a close-then-add —
reproduce. While a press is swallowed, `document.elementFromPoint` at the
button's own centre returns `<main>`: the snapshot layer answering for it, which
is the mechanism confirmed directly rather than inferred from a symptom.

**The origin matters and I got it wrong first.** Measured from the toast
button's first frame, both paths read ~360ms and the pairing looks fabricated.
A close-then-add spends its extra ~350ms *before its button exists at all* —
the close animates, and the add is queued behind it. Anyone re-checking these
numbers should measure from the press.

## A second thing it bought, unplanned

Peak simultaneous action buttons in the DOM during a repeat write went from
**2 to 1**. HeroUI's deferred unmount is what put two Undos for one todo on
screen at once, and that window is the one `nextUndoToken`, QA DEF-25 and DEF-26
were all built around. It is now closed.

The token machinery is **kept anyway**, as defence in depth, and
`src/lib/rowFocus.ts` says so in the past tense rather than deleting the
reasoning: a future change that puts the transition back would put the defect
back with it. `tests/unit/actionToastSlot.test.ts` tests that logic directly,
because the browser can no longer reach it — a mutation removing the token guard
survives the whole Playwright suite, which is an honest result and not a gap.

## What it cost

The slide. Toasts cut in and out.

I think this is the right trade and I would not reverse it, but the argument is
not that the animation was worthless — it is that an armed control which is
inert for three quarters of a second, with no visual tell, is worse than a
toast that arrives without ceremony. §4.10 reached the same conclusion before
the cap existed.

**What would change my mind:** a way to keep the animation and the hit target
together. A CSS transition on the toast element itself would do it — it would
animate without a snapshot layer — but that is a change to
`@heroui/styles`, not to us. If HeroUI ever moves the slide off the pseudos,
this decision should be revisited rather than inherited.

## Not decided here

A receipt raised after an armed Undo **physically covers it**: HeroUI stacks
newest-in-front with no expand-on-hover, so `elementFromPoint` at the Undo's
centre returns the receipt's `toast-content`, for the receipt's full 12s life.
Pointer-only; keyboard activation is unaffected. That is a separate
reachability gap, it is not caused by this change, and the design call is with
the ux-designer. It is measured by the ungated `an Undo buried by a later toast`
test in `e2e/toast-dead-window.spec.ts` so it can be pointed at.
