# The existing suites are not being rewritten test-first

**Date:** 2026-08-21
**Status:** decided, in force from today
**Settles:** the open question at the foot of
`docs/decisions/2026-08-20-move-to-tdd.md`

## What was decided

**The existing tests stay as they are; TDD binds new work from today; and the
tests among them that cannot fail are found by mutation audit rather than by
rewriting anything.**

## What raised it

`2026-08-20-move-to-tdd.md` closes with the question it deliberately did not
answer:

> Whether to backfill the existing suites — 400 unit and 258 e2e, some of which
> have now been demonstrated unable to fail — or to apply this to new work only
> and fix the existing ones as they are touched.

The work has now started, so the question has come due.

The figures in that sentence have moved, which is worth recording because they
are the size of the thing being decided about. Measured today on `d670975`:

| | Recorded 2026-08-20 | Measured 2026-08-21 |
|---|---|---|
| Vitest (`tests/unit` + `tests/api`) | 400 | **492** in 25 files |
| Playwright (`e2e`) | 258 | **394** across two projects |

The Vitest number is from `npm run test:run` redirected to a file, exit code 0
recorded separately: `Test Files 25 passed (25) / Tests 492 passed (492)`. The
Playwright number is from `npx playwright test --list`, which enumerates without
running: `Total: 394 tests in 32 files`. It counts each spec once per project it
is enabled for, and `chromium-mobile` excludes the pointer specs, so it is not
simply twice the declaration count. Neither number is the number of `test(` calls
in the files — parameterised loops make the declaration count lower (421 and 193
respectively).

The brief that commissioned this work quoted 492 and **361**. The 492 is exactly
right; the 361 is not reproducible today and is presumably an e2e count from
before `fix/e2e-attribution` and `feature/board-view` landed. Recorded because a
number carried between documents without a re-measurement is how the 400/258
above went stale in a day.

## Why

**Reordering after the fact buys nothing.** To rewrite an existing passing test
test-first, you would delete it and write it again — with the implementation
sitting in the editor beside you, already known, already read. You cannot
un-know it. The red you can then manufacture (revert the module, watch the test
fail, restore it) proves that the test observes the module. It does not prove
what test-first actually proves, which is that the assertion was chosen by
someone who did not yet know how the code would be shaped. That is the entire
mechanism, and it is not recoverable retroactively at any price.

**What TDD buys is measurable directly.** The benefit named in the move-to-TDD
record is the elimination of one defect class: a test that cannot fail. That
property is not a fact about when a test was written — it is a fact about the
test as it stands now, and mutation testing measures it. Break the guard, every
way it could plausibly break, and see whether anything goes red. The mutation
does not care what order anything was written in, and it has found a real gap on
this project every single time it has been run.

So the audit *is* the backfill. It reaches the same defects, on the tests that
have them rather than on all 886, and it produces a survivor list — a thing you
can act on — rather than a diff.

**What was rejected, and what it would have cost.**

- *Rewrite everything test-first.* 886 tests, each rewritten with its
  implementation in view, for a property the rewrite cannot actually establish.
  It also risks the most valuable content in these suites: several tests carry
  the measurement, the rejected alternative or the failed hypothesis that
  produced them — `tests/unit/todoDates.test.ts` on why the row must not read
  "today" off the rendered label, `tests/unit/filterSync.test.ts` on why every
  case in it is a sequence rather than a single call. A rewrite loses those
  silently, because nothing goes red when a comment disappears.
- *Rewrite only the five tests already demonstrated unable to fail.* Those five
  are not a backfill programme; they are five defects with a known repro, and
  they are fixed under the ordinary rule — strict mode, red first, as bug fixes.
  Naming them as a special category would have implied the rest were cleared,
  which nothing has established.
- *Rewrite by directory, worst first.* Requires knowing which directory is worst,
  which is the audit. Deciding it by reading is how three of this quarter's
  false conclusions were produced.

**Migration is by contact.** When anyone touches an old test file, the block they
touched comes out grouped to the readability rules in
`.claude/skills/todo-app-tdd/references/readability.md`. The block, not the file.
A reviewer asking for more than that is out of scope, and the reviewer file now
says so — a rule that expands on contact with an eager reviewer stops being
followed.

## The audit, and the trap in it

Two read-only mutation audits were running against this repo while this was
written; their working-tree mutations were visible in `src/lib/date.ts`,
`src/app/todos/components/TodoDueDate.tsx` and `src/lib/todoListState.ts` at
various points. That is the shape of the replacement: mutate one guard, run the
suite, record whether anything went red, restore.

The trap is already written down in `.claude/agents/_shared-rules.md` and it has
fired three times here: **a mutation that never applied reads exactly like a
surviving mutation**, and reads as "the tests do not cover this", which is the
opposite of the truth. A `sed` whose pattern missed, a `perl` substitution that
applied zero times, an edit written to the wrong path — all exit 0. Any runner
doing this at scale must refuse to proceed when the patch did not apply, rather
than relying on the operator to remember. A survivor list built without that
guard is worse than no survivor list, because it will be believed and it will
send someone to rewrite a test that was fine.

## What would change this

Revisit if any of these becomes true:

- The audit's survivors cluster inside one file or module in a way that a
  rewrite of that file, specifically, would fix more cheaply than case-by-case
  repair. That is a rewrite of *one file*, decided on evidence — not a reversal
  of this record.
- Grouping turns out to obstruct the audit: if survivors are being missed
  because a flat 900-line file makes it impossible to tell which behaviour a
  mutation should have reddened, then the readability work has a correctness
  argument behind it and stops being a matter of contact.
- Migration by contact demonstrably is not happening. It is checkable: take the
  test files changed in the last quarter's merges and see whether the blocks
  that changed are grouped. If they are not, contact is not a mechanism and
  something scheduled has to replace it.

## Verified versus assumed

**Verified by execution:** the 492 and the 25 files (`npm run test:run`, exit 0
recorded separately); the 394 and the 32 files (`npx playwright test --list`,
exit 0); the declaration counts 421 and 193 (unpiped `grep -c`); that the
`e2e/` project list contains `chromium-desktop` and `chromium-mobile` and that
the mobile project excludes the pointer specs (read from `playwright.config.ts`).

**Verified by reading:** the five tests named in the move-to-TDD record as
demonstrated unable to fail — that record is the evidence for them and they were
not re-demonstrated here; the comment examples in `todoDates` and `filterSync`.

**Assumed:** that 361 was a pre-merge e2e count. Nothing was found asserting it,
and no attempt was made to reconstruct it from history.

**Not done:** the e2e suite was not run for this record. The count comes from
`--list`, which enumerates without executing, chosen deliberately because other
agents were working in this repo at the time and a full Playwright run competes
for the shared `todo_app_test` database and a port.
