# Below `sm:`, a row with metadata centres its checkbox 12px low — deferred

*2026-08-21 — Junior dev, on `fix/layout`, found while un-deferring the board
card's metadata line.*

**What was decided:** the row's stacked (`< sm:`) checkbox alignment is left as
it is for now. The empty-metadata case is fixed — that was the brief — but a
mobile row that *draws* a chip, a date or a note marker still sits **12.00px**
below its title's first line, and that is a bigger, older change than the one
this branch took.

## What raised it

`docs/decisions/2026-08-21-board-card-metadata-line.md` records the mobile row
as measuring 2.00px instead of 0.00 because an empty metadata cluster took the
`gap-1` before it, and describes that as the whole of the row's fault. Measuring
it to confirm the fix showed it is not:

| Row, Pixel 7 viewport | Control centre − title first-line centre |
|---|---|
| `medium`, undated, no note — before | 2.00px |
| `medium`, undated, no note — after | **0.00px** |
| `high`, undated, no note — before *and* after | **12.00px** |

## The mechanism

Below `sm:` the content column is `flex-col gap-1`, so a row that draws anything
is two stacked lines. The `<li>` is `items-center`, which centres the checkbox
against the **whole stacked block**:

- title line box 28px, `gap-1` 4px, chip line 20px → block 52px, centre at 26
- title first line centre at 14
- 26 − 14 = **12.00px**

That is the same rule `TodoCard` had to state carefully and the same fault
`e2e/card-row-parity.spec.ts` exists for: *a box centre-aligns to text, and on a
multi-line block "the text" means the first line.* The row's desktop layout is
`sm:flex-row sm:items-center`, one line, so it measures 0.00 there and always
did.

## Why it is not fixed here

- **It is a different change.** The empty-cluster fix is a conditional render;
  this needs the row to stop centring against the block — `items-start` on the
  `<li>` plus a one-line-tall wrapper around the checkbox, which is exactly what
  `TodoCard` does with `h-6`. That moves the checkbox on *every* row at every
  width and has to be re-measured against the desktop 0.00 it must not break.
- **It reaches past this branch's files.** The `<li>`'s `items-center` also
  positions `TodoActions`, which is another dev's file this week.
- **The brief did not ask for it and did not know about it.** Building it
  quietly inside a change scoped to the empty case is how a 12px regression on
  desktop would ship unnoticed.

## What would change this

- **Anyone touching the row's `< sm:` stacking again.** This is the same
  argument the metadata-line record made about the row half, and it was right:
  a batch already in that code should take both.
- **A mobile parity test.** `e2e/card-row-parity.spec.ts` now runs its row test
  on both projects, but only on the bare shape — the shape that measures 0.00.
  Adding a chipped row to it turns this record into a red test, which is the
  right next step and is deliberately not taken here, because a red test with no
  fix behind it is a broken gate.
- **The board becoming reachable below `lg:`.** Cards and rows would then be two
  shapes of the same object on the same screen, 12px apart.

## What is verified and what is not

The three deltas above were read from `getBoundingClientRect` and the element's
computed `line-height` in Chromium on a Pixel 7 viewport, and reproduce. The
proposed fix (`items-start` plus an `h-6` checkbox wrapper, as `TodoCard` does)
is **not** verified — it is the shape of the card's fix applied to the row by
analogy, and nobody has measured what it does to the desktop row.
