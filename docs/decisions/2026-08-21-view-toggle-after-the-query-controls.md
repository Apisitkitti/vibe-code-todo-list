# The view toggle goes at the end of the filter row, not beside the status filter

*2026-08-21 — Junior dev on `fix/chrome`, ruled by the ui-designer.*

**What was decided:** the view toggle sits at the **end** of `TodoFilters`' row,
after the status filter, the priority select and the search field.
`docs/DESIGN.md` §4.11 says "beside the status filter", twice. **§4.11's
sentence is the half that is wrong and should be amended; the placement stands.**

This record exists because the code now visibly disagrees with a spec sentence,
and the next reader would otherwise find the contradiction without the ruling.
Amending §4.11 in place is the ux-designer's to do, and doing it here would put
the conclusion in the specification with none of the reasoning — which is the
failure this directory was created to stop.

## What raised it

Shipped, the toggle was a shell band of its own: right-aligned, alone, 24px of
`gap-6` plus a 36px control above the filter row. The ui-designer's brief asked
for it to move into the filter row "at the end". §4.11 asks for it "beside the
status filter":

> Chosen with a `ToggleButtonGroup` above the list, matching the status filter
> beside it, and remembered in the URL as `view=board`.

and, in its accent note:

> The view toggle is a second `ToggleButtonGroup` beside the status filter — the
> same control with the same selected treatment, not a new one.

"At the end" and "beside the status filter" are not the same placement: the
priority select and the search field sit between them. The brief was built as
written and the discrepancy raised rather than silently resolved either way.

## Why the end of the row wins

**The row is the query the API is asked. The view is not part of that query.**

`src/app/todos/page.tsx` already draws this line and says why — the view is read
apart from `TodoListFilters` because the filters are handed to the service as
axios params, and "a presentation choice folded into it would travel to a
handler that has no business seeing it". `TodoFilters` takes the toggle as a
`viewToggle: ReactNode` slot rather than `view` / `onSelectView` props for the
same reason.

Seating the toggle *beside the status filter* would put a presentation control
inside the run of query controls — status, priority, search — where it reads as
a fourth thing the list is being filtered by. After them, it reads as what it
is: how the same result set is drawn.

So the spatial arrangement is made to carry the same split the data model
already has, rather than contradicting it.

## What §4.11 was actually protecting, and why it survives intact

§4.11's "beside" is doing two jobs, and only one of them is about position:

1. **It is the same kind of control** — a second `ToggleButtonGroup`, same
   selected treatment, not a new widget. Untouched: both are
   `ToggleButtonGroup`s, both at `LABELLED_CONTROL_SIZING`, both announced by
   react-aria as a `radiogroup`.
2. **It is not on a band of its own** — which is the actual defect the sentence
   was written against, and which this change fixes.

Neither depends on the toggle being the status filter's immediate neighbour.
The suggested amendment to §4.11 is therefore one word of position, not a
rewrite: *at the end of the filter row*, in place of *beside the status filter*,
in both sentences.

## What this bought, measured

At 1280×800, `main`'s top-level children before and after:

| | before | after |
|---|---|---|
| Shell bands | 5 | 4 |
| Chrome above the Card | — | **60px less** (a 24px `gap-6` plus a 36px control) |
| Gaps between adjacent bands | 24.00 / 24.00 / 24.00 / 24.00 | 24.00 / 24.00 / 24.00 |

It also halves the first-todo jump. `hasTodos` flips on the first todo and the
filter row appears; on desktop the toggle appeared with it, so the Card dropped
~120px in one frame instead of ~60.

**The jump itself is accepted, not fixed**, and that was ruled separately by the
ux-designer: `result.totalCount` is account-wide rather than filtered, so any
threshold above one todo produces a state where the URL is filtering and the
control that says so is off screen. Reserving space or delaying the appearance
were both refused. One band instead of two is the half of it that is free.

## What was rejected

- **Hiding the toggle with `lg:` classes** instead of not rendering it. A
  `display: none` radiogroup is still a radiogroup in the document; `getByRole`
  cannot see the difference and one survived a fix that way, leaving a phone
  carrying an inert group named `Choose a view`. `e2e/board.spec.ts` asserts the
  absence at DOM level with `includeHidden: true`, and it was watched going red
  under exactly this mutation. The gate is also **not** `lg` alone — it is
  `isWideEnoughForBoard`, i.e. `(min-width: 1024px) and (pointer: fine)`, so a
  tablet in landscape clears the width and still gets the list.
- **Giving `TodoFilters` `view` and `onSelectView` props.** Cheaper to write and
  it puts a `TodoView` inside the component named after the filters, inviting
  the two to be handed on together — the exact coupling `page.tsx` avoids.

## What would change this

- If the search field ever leaves this row, "at the end" and "beside the status
  filter" collapse into the same position and the distinction stops mattering.
- If a control is ever added to this row that is *also* not part of the query,
  the ordering rule needs stating properly — query controls first, presentation
  controls after — rather than being inferable from a row with one of each.
- If §4.11 is amended as suggested, this record is the reasoning behind that
  amendment and should be cited from it, not superseded by it.
