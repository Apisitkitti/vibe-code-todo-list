# `last <weekday>` is refused, not read as a past date

**Decided:** the quick-add parser refuses to read any date word preceded by
`last`, leaving the whole phrase in the title. It does **not** gain past-tense
vocabulary. `last` joins `next` in `UNREAD_DATE_MODIFIERS` in
`src/lib/quickAdd.ts`, which is one guard covering both.

## What raised it

Reported: `pay rent last tuesday` yields a due date in the future and a title
still containing `last`. Reproduced by execution against `eae9dd1`, with
`now` = Wednesday 2026-08-19:

| input | title | dueAt |
|---|---|---|
| `pay rent last tuesday` | `pay rent last` | `2026-08-25` |
| `pay rent last monday` | `pay rent last` | `2026-08-24` |
| `pay rent last tomorrow` | `pay rent last` | `2026-08-20` |
| `pay rent last today` | `pay rent last` | `2026-08-19` |

The mechanism is rule 1 plus a gap in rule 4's table. The scan reads
right-to-left; `tuesday` is vocabulary and is lifted as the next Tuesday
*ahead*; `last` is then an unknown word, so the scan stops and it stays in the
title. `2026-08-25` is six days *after* the date the user named (2026-08-18).

The family is wider than the report: `last` strands in front of every date word,
not only weekdays. `last week`, `last month` and `last year` were already safe,
because `week`/`month`/`year` are not vocabulary on their own — so the defect
was exactly the set of words that *are*.

## Why

Three products were genuinely available. The one chosen is the one already
written down in this file for the mirror-image phrase.

### Rejected: read `last <weekday>` as the past date

The strongest argument for it, and it is a real one: a past due date is a
first-class state in this app, not a degenerate one. `formatDueDate` has a
`Yesterday` label and an `isOverdue` flag, overdue rows render with `⚠` and
`--warning-soft-foreground`, and `todoFormSchema.dueAt` accepts any valid
`YYYY-MM-DD` with no lower bound. All four verified by reading the code. So
parsing a past date would not be producing a value the app cannot hold.

It loses on precedent, and the precedent is exact. **`next friday` is already
refused** — see the comment this change extended — even though the Friday ahead
is meaningful, computable, unambiguous and fully supported. If "the target date
is meaningful and storable" were sufficient grounds to parse a phrase, `next
friday` would parse. It does not, deliberately, because rule 4 says the
vocabulary is small, closed and exact and that refusing to be clever is the
feature. Adding `last <weekday>` would not be extending the vocabulary by one
word; it would be overturning a decision this module already made against the
better-motivated half of the pair. `next friday` is a phrase people type far
more often than `last tuesday`, and it was still declined.

It is also ambiguous on the day it matters. "Last Tuesday", said on a Tuesday,
is either seven days ago or today, and English does not settle it. That is the
same ambiguity `src/lib/date.ts` cites as its reason for declining "the start of
next week" for the `Next week` reschedule — neither answer is wrong enough to be
obviously right.

Finally, the two options are not equally reversible. Refusing leaves the phrase
as literal text, so reading it as a date later is a pure addition that costs
nobody anything. Shipping the read and retracting it means todos already created
carrying dates the parser guessed at, which no later change can find.

### Rejected: leave it, and document that there is no past-tense vocabulary

This is what the code did, and it is the option the report was filed against.
It fails on its own terms: the failure is not "the parser declined to read
`last`", it is "the parser read half a phrase". A user who types `last tuesday`
gets a title with a stray `last` in it and a date pointing the opposite way to
the one they named — silently, because the todo saves and the toast says it
saved. Rule 4 already names this the worst case: *"a phrase that half-matches is
the worst of them, because it strands the half it did not read in the title."*
Documenting it would be documenting a known violation of the module's own rule.

### Chosen: refuse the phrase whole

It kills the reported failure mode outright — no unread word left in the title,
no unrequested date — and it does so with the guard that was already there for
`next`, generalised rather than duplicated. Refusing can only ever keep more
words than it takes, so it cannot introduce a new way to eat a title.

The escape hatch already exists and is already documented: `YYYY-MM-DD` is in
the vocabulary precisely for dates the closed word list cannot express, and it
reaches the past as easily as the future. A user who wants a todo due last
Tuesday can type the date.

## What I verified, and what I did not

- **Verified by execution.** The reproduction table above, before the change.
  The new tests in `tests/unit/quickAdd.test.ts` red against the unfixed parser
  and green after. Three hand mutations of the guard, each caught — recorded in
  the branch report.
- **Verified by reading.** That past due dates are storable and renderable
  (`src/lib/date.ts`, `src/lib/todo.schema.ts`).
- **Assumed, not measured.** That `last <weekday>` is typed less often than
  `next <weekday>`. Nothing in this app records what users type into the bar, so
  the relative frequency is judgement. It is not load-bearing: the argument from
  precedent stands whichever is more common, because the more common phrase is
  the one already refused.

## What would change this

Evidence that people actually type `last <weekday>` into the bar and mean a due
date by it — which today would require instrumenting the quick-add bar, and
there is no such instrumentation. If that arrives, the change to make is **not**
this guard alone: it is to reopen `next <weekday>` at the same time, because the
two phrases are one decision and splitting them would leave the parser reading
the past but not the future.

A second trigger: if the app ever grows a "logged/completed on" date distinct
from a due date, `last tuesday` becomes unambiguous in a way it is not today,
and belongs to that field rather than this one.
