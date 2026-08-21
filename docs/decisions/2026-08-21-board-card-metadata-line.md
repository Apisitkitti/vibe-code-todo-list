# A board card's metadata line, deferred with its numbers

*2026-08-21 — Junior dev, during the UI polish batch on `feature/ui-polish`.*

**What was decided:** the board card keeps `flex-wrap` for now. The
ui-designer's proposal — explicit metadata and action lines, with the metadata
line rendered only when it has content — is **not** in this batch. This record
exists so the next person does not have to re-measure it.

**What raised it:** QA measured a card's metadata budget while auditing the
alignment defects PX-02, PX-03 and PX-07. `High` overflows it by less than a
pixel, and a card's height then changes by 28.

## The measurement

Taken on `feature/ui-polish` at 1280×800, five columns, after this batch's
`h-6` change to the checkbox wrapper. Column inner width 225px, card 209.20px.

| Reading | Value |
|---|---|
| Metadata row width | 183.20px |
| `TodoActions`, always present | 124.00px |
| §2.2 `gap-2` between them | 8.00px |
| **What is left for chips and the date** | **51.20px** |
| `Low` chip | 48.45px — fits |
| `Medium` chip | not drawn (the untriaged default, `ee49c3b`) |
| `High` chip | **52.16px — over by 0.96px** |

The row is `flex flex-wrap`, so 0.96px of overflow moves the whole action
cluster onto a second line. Card heights in one board:

| Card | Metadata row | Card |
|---|---|---|
| `Low`, no date | 36px | 94px |
| `Medium`, no date | 36px | 94px |
| `High`, no date | 64px | 122px |
| `Low`, dated | 68px | 126px |
| `High`, dated | 68px | 126px |
| `High`, dated, three-line title | — | 174px |

So on a board of otherwise identical cards, **whether a card is two lines or
three depends on nothing the user can see except whether it says `High`.** A
28px step bought with 0.96px is not a design; it is `flex-wrap` making a
decision nobody took.

(These are 12px shorter than the same cards measured before this batch —
106/134/138/186 — because the checkbox wrapper stopped setting the height of a
block it is only a marker in. The relationship is unchanged.)

## Why it is not in this batch

- **It is a restructure, not an alignment fix.** The other three changes are a
  class each, measured before and after. This one changes what elements a card
  is made of, and it decides something the measurements do not: whether
  `TodoActions` gets a line of its own on every card, which raises the height of
  the cards that are currently *correct*.
- **The same fix belongs to the row as well.** Below `sm:` a row centres its
  checkbox against a metadata cluster that is rendered even when it is empty —
  an untriaged, undated, noteless todo draws a zero-height `div` that still
  takes the `gap-1` before it, so the control sits 2.00px below the title
  instead of 0.00. That is the same "render the line only when it has content"
  change, in the other view. Doing the board alone would fix half of one thing
  and leave the halves in different shapes, which is the fault PX-07 was.
- **Nobody is looking at it.** The board renders only at `lg:` with a fine
  pointer. Production holds 24 todos across 18 accounts and nobody has come back
  for a second day, so the count of users who have seen a board with enough
  `High` cards to notice the step is plausibly zero. That is an argument about
  *urgency*, not about correctness — the defect is real either way.
- **The batch is under review.** Three measured changes and a doc renumber is a
  reviewable diff. A card restructure inside it is not.

## What would change this

Any one of these, and it should be built rather than deferred again:

- **`Medium` gains a chip**, or any fourth priority arrives. The untriaged
  default is the only reason a majority of cards clear the budget today; give it
  a chip and every card is in the overflow at once.
- **Somebody comes back for a second day on a wide screen.** The urgency
  argument above is entirely a usage argument, and it expires the moment the
  analyst can show a returning `lg:` user with more than a handful of todos.
- **A fourth thing joins the metadata row** — a label, a project, a second
  marker. The budget is 51.20px and `High` alone already exceeds it; there is no
  room for an addition and the wrap would stop being about one priority.
- **The row's `sm:` stacking is touched for any other reason.** The row half of
  this is the same change, so a batch already in that code should take both.

## What is verified and what is not

Every number in the tables above was read from `getBoundingClientRect` in
Chromium at 1280×800 and is reproducible. **Not verified:** that an explicit
two-line card is what the ui-designer's proposal should become — the height cost
to the currently-correct cards has not been measured, and it is the thing that
decides whether the proposal is right. Measure it before building it.

## What the next person should not have to rediscover

- The budget is **51.20px** and `High` needs **52.16px**. Widening the chip is
  not the fix and neither is shrinking it: the point of the proposal is that
  metadata should have the full **183.20px** rather than a 51.20px remainder
  left over after the actions.
- `Medium` draws no chip at all, so the untriaged default is the *cheapest*
  card. Anything that gives `Medium` a chip lands it in the same overflow —
  check this table before doing it.
- Whatever is built must keep `e2e/card-row-parity.spec.ts` green: the
  checkbox sits on the title's **first line**, on a one-line card and on a
  wrapped one. That file's row test is skipped below `sm:` precisely because of
  the 2.00px above, and un-skipping it is how the row half of this proposal
  proves it landed.

---

## Addendum, later on 2026-08-21 — built. This deferral is closed.

*Appended rather than edited: this directory's records are immutable once
written, and the body above is what was true on 2026-08-21. This says what
happened next, so nobody reads the deferral as though it still stood.*

**Built on `fix/layout`, both halves in one change**, as the body predicted it
would have to be. Two of the four expiry conditions had come due — the row's
`sm:` stacking was being touched anyway, and the row half is the same change —
and the brief asked for it directly.

### What was measured, and what the body got wrong

Re-measured at 1280×800, five columns, Chromium, before touching anything.
Everything in *The measurement* table above reproduced exactly:

| Reading | Recorded | Re-measured |
|---|---|---|
| Metadata row width | 183.20 | 183.203125 |
| `TodoActions` | 124.00 | 124.00 |
| `gap-2` | 8.00 | 8.00 |
| Budget | 51.20 | 51.203125 |
| `Low` chip | 48.45 | 48.453125 |
| `High` chip | 52.16 | 52.15625 |

So the sub-pixel claim holds. The overflow is **0.953125px**, which the body
and the brief both round to 0.96; it is 0.95 to two places. That is the only
number in the record that was off, and it is off in the third decimal.

### The cost the body left unmeasured

The body closed with: *"Not verified: that an explicit two-line card is what the
ui-designer's proposal should become — the height cost to the currently-correct
cards has not been measured, and it is the thing that decides whether the
proposal is right."* It is now measured. One-line titles, before → after:

| The card carries | Before | After |
|---|---|---|
| nothing (`Medium`, undated) | 94 | 94 |
| a `Low` chip | 94 | **122** |
| a `High` chip | 122 | 122 |
| a date, either chip | 126 | 126 |

**One shape pays, and nothing gets shorter.** A `Low`, undated card grows 28px;
every other shape is unchanged. The trade is 28px on one shape against a 28px
step that turned on 0.95px, and it is worth taking — but the record was right
that this was the number the decision rested on, and it is not free.

The 122/126 step is the date's own line box: `TodoDueDate` is `body-sm` at
`leading-6` (24px) where a chip is 20px. That is the card carrying more, which
is what a height is now allowed to mean.

### The row half

`e2e/card-row-parity.spec.ts`'s row test is **no longer skipped below `sm:`**,
which the body named as the proof that the row half landed. Measured on a Pixel
7 viewport: the control-to-title-first-line delta on an untriaged, undated,
noteless row went **2.00px → 0.00px**.

### What the record did not say, and should have

A mobile row that *does* draw a chip sits **12.00px** below its title's first
line, and always has. The body describes the 2.00px as though a chipped row
were correct; it is not — the row centres its checkbox against the whole
stacked block, so the offset is half the metadata line plus the gap. Fixing the
empty case does not touch it and this change does not claim to. See
`docs/decisions/2026-08-21-mobile-row-checkbox-against-a-stacked-block.md`.

### What keeps it closed

- `e2e/board-card-shape.spec.ts` — height by content shape, the actions on a
  line of their own, no empty metadata line, and the card's own `Priority:`
  announcement, which nothing covered before.
- `e2e/card-row-parity.spec.ts` — now on both projects.
- Six mutations were watched red before they were green, including removing the
  `sr-only` announcement outright.
