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
