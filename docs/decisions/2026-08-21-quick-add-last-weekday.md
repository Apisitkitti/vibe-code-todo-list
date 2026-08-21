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

## Why: `next friday` already settles it

**The binding argument is precedent, and it is exact.** Everything else below
is supporting.

`next friday` is already refused by this very function — the comment this
change extended says so and says why. The Friday ahead is meaningful,
computable, unambiguous, entirely storable and, by any reasonable guess, typed
far more often than `last tuesday`. It is still declined, deliberately, because
rule 4 says the vocabulary is small, closed and exact and that refusing to be
clever is the feature.

That disposes of the case for reading `last <weekday>` before the merits of past
dates are even reached. **If "the target date is meaningful and storable" were
sufficient grounds to parse a phrase, `next friday` would parse.** It does not.
So adding `last <weekday>` would not be extending the vocabulary by one word; it
would be overturning a standing decision against the *better*-motivated half of
the pair, while leaving that half refused. A parser that reads the past but not
the future is not a smaller decision than one that reads both — it is an
incoherent one.

This is also why the fix is one `UNREAD_DATE_MODIFIERS` guard covering both
words rather than a second guard beside the first. The two phrases are one
decision, and the code should make that hard to un-notice.

## Why, continued: the supporting arguments

Three products were genuinely available. These are the remaining reasons the
chosen one wins.

### Rejected: read `last <weekday>` as the past date

The strongest argument for it, and it is a real one: a past due date is a
first-class state in this app, not a degenerate one. `formatDueDate` has a
`Yesterday` label and an `isOverdue` flag, overdue rows render with `⚠` and
`--warning-soft-foreground`, and `todoFormSchema.dueAt` accepts any valid
`YYYY-MM-DD` with no lower bound. All four verified by reading the code. So
parsing a past date would not be producing a value the app cannot hold.

It loses to the precedent above. It also loses on two counts of its own.

It is ambiguous on the day it matters. "Last Tuesday", said on a Tuesday, is
either seven days ago or today, and English does not settle it. That is the same
ambiguity `src/lib/date.ts` cites as its reason for declining "the start of next
week" for the `Next week` reschedule — neither answer is wrong enough to be
obviously right.

And the two options are not equally reversible. Refusing leaves the phrase as
literal text, so reading it as a date later is a pure addition that costs nobody
anything. Shipping the read and retracting it means todos already created
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

## The guard matches whole words, and must keep doing so

Recorded here rather than only in the test file, because this is the part a
future refactor is most likely to undo while believing it is simplifying.

`isUnreadDateModifier` compares the preceding word against the table with
`includes` on the **array** — an exact, whole-word match. It is *not* a
substring test against the word. Written the shorter-looking way:

```ts
// WRONG — do not "simplify" to this
UNREAD_DATE_MODIFIERS.some((modifier) => word.includes(modifier));
```

…the guard fires on any word that merely *contains* `next` or `last`. This was
found by mutation, and it survived every other test in
`tests/unit/quickAdd.test.ts` before coverage was added for it.

It is a real defect, not a theoretical one. **`context` contains `next`**, so
`book the context friday` would silently lose its date: no chip, no due date,
and no indication that a word in the middle of the title was the reason. That
is a *worse* failure than the one this whole record is about, because the one
this record is about at least leaves visible evidence in the title. `ballast`
and `lastly` do the same thing through `last`.

The point generalises, and it is rule 3 and rule 4 restated: this parser's
vocabulary is matched as whole words everywhere else — `Highlight` is not
`high`, `mondays` is not `monday` — and the modifier table is not an exception
to that. `tests/unit/quickAdd.test.ts` → *"the modifiers are whole words, so a
word merely containing one is not one"* is the test that holds it. If that test
is in your way, the guard is what is wrong, not the test.

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
