# The board's column gap stays `gap-2`, because it is not 8px

*2026-08-21 — Junior dev, on `fix/layout`, while un-deferring the board card's
metadata line.*

**What was decided:** the board's grid keeps `gap-2` and the cards keep
`gap-1.5`. The proposal to take the column gap to `gap-4` is **not** built,
because the premise it rests on — that a card is 8px from its neighbour in the
next column and 6px from the one below it — is wrong by 18px. The requirement
the proposal itself named is already met.

## What raised it

A brief asked for `gap-4` on `TodoBoard`'s grid, arguing:

> Cards sit `gap-1.5` (6px) apart inside a column; columns sit `gap-2` (8px)
> apart. Six versus eight is not a distinction the eye can make, so the grid
> reads as one field of cards with headings scattered through it rather than as
> five columns.

and set the bar as: *"the between-column step must be a different step on §2.2's
ladder and at least double the within-column step, or proximity does not group."*

## The measurement

Chromium, 1280×800, five columns, cards seeded into four of them so that
adjacent columns each had one. Read from `getBoundingClientRect`, card box to
card box — which is what a reader actually sees, the column `<section>` being
`border-transparent` with no fill at rest.

| Reading | Value |
|---|---|
| Grid `gap-2` | 8.00px |
| Column `<section>` padding, each side | 8.00px |
| Column `<section>` border, each side | 1.00px |
| **Card to card, across two columns** | **26.00px** |
| Card to card, down one column (`gap-1.5`) | 6.00px |

The 8px in the brief is the gap between two column *boxes*. Between two
**cards** there is also each column's own `p-2` and its 1px transparent border —
9px on each side — so the whitespace a reader sees between columns is
8 + 9 + 9 = **26px**, not 8. Against 6px within a column that is **4.33×**, and
it clears the brief's own bar (a different step, at least double) by a wide
margin. The proposal would take it to 34px.

## Why it is not built

- **The stated requirement is already satisfied**, at 4.33× rather than the 2×
  asked for. Building to a requirement that is already met is not a fix; it is a
  preference, and this project's rule is that a spacing change carries a
  measurement.
- **It costs width, and it costs it to the thing this same change just
  widened.** The grid is 1168px inside `max-w-7xl` at 1280. At `gap-2` each
  column is 227.19px and each card 209.20px, giving a card 183.20px of content.
  At `gap-4` the four gaps cost 64px instead of 32, so each column is 220.80px,
  each card 202.80px, and the content width falls to **176.80px** — 6.40px off
  every card. The card restructure landed on the same day exists precisely to
  give the metadata line the full content width instead of a 51.20px remainder;
  narrowing it by 6.40px the same afternoon is spending the thing that was just
  bought.
- **The eye-grouping claim was not reproduced.** The brief's premise is
  arithmetic that omits `p-2`, so the visual conclusion drawn from it does not
  follow. What has *not* been done is a fresh judgement of whether 26px groups
  adequately — that is the ui-designer's call, on the real numbers rather than
  on 6-versus-8.

## What would change this

- **A ui-designer looks at the board knowing the gap is 26px and says it still
  reads as one field.** That is a legitimate finding and this record does not
  pre-empt it; it only refuses the argument as stated.
- **The columns gain a fill or an outline.** The brief is right that they cannot
  today — `--surface-secondary` measures 1.15:1 light / 1.13:1 dark against
  `--surface`, and `--border-secondary` is the same token at the same weight as
  the cards nested inside it — but if either becomes possible, the column's own
  `p-2` stops reading as between-column whitespace and the 26px drops to 8.
  **That is the case to watch**, and it inverts this decision rather than
  weakening it.
- **A sixth column, or a viewport below 1280 reaching the board.** Both squeeze
  the column, and at some width 26px of gutter is worth more than 6.4px of card.

## What is verified and what is not

Every number above was read from `getBoundingClientRect` in Chromium at
1280×800 and is reproducible. The `gap-4` column and card widths (220.80 /
202.80 / 176.80) are **computed**, not measured — the change was not applied.
Whether 26px groups the columns to a reader's eye is **not** verified by
anything here; this record refutes the arithmetic the request was built on, and
takes no position on the aesthetic question underneath it.
