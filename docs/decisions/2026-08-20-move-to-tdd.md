# Move the project to TDD

**Date:** 2026-08-20
**Status:** agreed, not started — begins after the branches in flight land
**Decided by:** the user, after seeing the evidence below

## What was agreed

Write the test first, everywhere the interface is known. Group tests so that
reading them tells you what the unit does, in coherent blocks per behaviour
rather than a flat list of cases.

Sequencing: **after** `feature/board-view`, `fix/search-clear-race` and
`refactor/style-system` have landed. Not alongside them — a change to how
every test is written, applied while three branches are mid-review, would make
it impossible to tell a conversion problem from a review finding.

## Why, in this project's own evidence

Tests written after the code have repeatedly been green through the defect
they should have caught:

- `undo-focus.spec.ts` asserted the *shape* of the focused element
  (`data-slot`), which the wrong toast's button satisfies equally well — green
  through a defect that permanently deleted a user's todo.
- The board's e2e suite stayed green with the entire column-to-date mapping
  deleted, because nothing ever dragged to `Upcoming`.
- `a11y-contrast.spec.ts` passed under a mutant of the thing it measures.
- Restoring the `display:none` radiogroup defect left 35 tests passing,
  because every assertion went through `getByRole`, which ignores it.
- `filterPredicate.test.ts` — 588 iterations, every assertion behind
  `if (predicate) continue`, so the whole file passes if the predicate always
  returns true.

Tests written first have caught things every time they were used:

- Every SDET bug repro on this project, one of which disproved a plausible
  diagnosis by failing at an assertion nobody expected.
- The UI designer's P3 spec, which named in advance which assertion had to be
  red on current code — and identified that a ratio-only test would pass
  unchanged, because an earlier fix had already moved the token past the floor.

## The shape

Not uniform, because the work is not uniform.

| Work | Mode |
|---|---|
| Pure modules — `quickAdd`, `todoBoard`, `filterSync`, `todoGroups`, `date`, `todoListState`, `rowFocus` | Strict TDD: red, green, refactor, small cycles |
| API routes | Strict TDD, contract first: status, error shape, isolation |
| Bug fixes | Strict TDD — already the rule, and already working |
| HeroUI composition, focus, drag | **Spike, then throw away and redo test-first** |
| Visual and contrast work | Assertion-first: the test is specified before the change |

The word that matters is **throw away**. A spike that is kept is code written
before its tests wearing a different name, which is what happens today.

The exploratory exception is real and this project has the receipts for it:
nobody could have written a failing test in advance for `Typography` claiming
`MenuItem`'s label slot, for `Modal`'s root wrapping children in a
`PressResponder`, for `useMediaQuery` hydrating against the view the server did
not choose, or for a `mouseup` landing on a different node and retargeting the
click to `<html>`. Those were found by building. Demanding a test first for
behaviour nobody knows exists is not rigour, it is guessing.

## Readability, which is half the ask

Tests are read far more often than they are written, and this project's are
already read as the explanation of *why* — several carry the measurement and
the failed hypothesis that produced them, and those comments have survived
review specifically because they record something no assertion can.

So the conversion is not only about ordering. Group each unit's tests by the
behaviour they describe, so the file reads as a description of the unit rather
than an inventory of cases. A reader should be able to answer "what does this
do, and what is it careful about" from the test names alone.

## The cost, stated

Exploratory work gets slower, and some of it gets written twice by design.
What it buys is the one class of defect this project keeps producing: a test
that cannot fail.

## Open, to settle when the work starts

Whether to backfill the existing suites — 400 unit and 258 e2e, some of which
have now been demonstrated unable to fail — or to apply this to new work only
and fix the existing ones as they are touched.

---

## Addendum, 2026-08-21 — the open question above is settled

*Appended rather than edited: this directory's records are immutable once
written, and the body above is what was true on 2026-08-20. The section titled
"Open, to settle when the work starts" is answered here, and its two figures
have moved.*

**The existing suites are not being rewritten.** New work is test-first from
today; the tests that cannot fail are found by mutation audit instead of by
reordering, because reordering after the fact cannot establish the thing
test-first establishes. The reasoning, the alternatives rejected, and the trap
in running mutations at scale are in
`docs/decisions/2026-08-21-not-rewriting-the-existing-suites.md`.

The sizes named in the open question were re-measured on `d670975`: **492**
Vitest tests in 25 files, not 400, and **394** Playwright tests in 32 files
across two projects, not 258.

**The operating instruction now lives in `.claude/skills/todo-app-tdd/`.** The
table in *The shape* above is the doctrine; the skill is what a developer does
on Monday — naming the mode before the first edit, what red has to look like
before it counts, the spike throw-away procedure, and the grouping and naming
rules with this repo's own files as the worked examples. The roles that touch
tests point at it: `junior-dev`, `sdet`, `senior-reviewer`, `ui-designer` and
`qa` were amended the same day, each with what it actually needs.

Nothing in the body above is retracted.
