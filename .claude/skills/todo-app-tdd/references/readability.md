# Making a test file read as a description of its unit

The ask, in the user's own words, was for the project to be TDD **"โดยเน้นการ
อ่านง่ายแหละเป็นกลุ่มๆของแต่ละอัน"** — emphasising readability, and grouping each
unit's tests coherently. Ordering and grouping are one instruction, not a rule
with a note attached.

The target a file has to hit:

> A reader who has never seen the module should be able to answer **"what does
> this do, and what is it careful about"** from the `describe` and test names
> alone, without opening a single body.

This repo already hits it in several places and misses it in others. Both sets
are named below. Read the good ones before you write; they are the template,
and they are real.

---

## Files that already read the way this asks for

### `tests/unit/todoListState.test.ts` — one export, split by the situation it is in

```
describe("applyCompletion — the flip")
describe("applyCompletion — under a status filter")
describe("applyCompletion — the revert")
describe("replaceTodo — reconciling with the server")
describe("applyDueDate — the board's column move")
```

One function appears three times, because it has three situations and they are
what a reader needs to know exist: it flips optimistically, it behaves
differently when a filter is on, and it can be reverted. The `unit — situation`
dash form is the house pattern; copy it.

Inside, the names are sentences about consequences, not about arguments:
*"moves the completed count with the box, so the header agrees"*, *"never
touches the total — a toggle creates and destroys nothing"*, *"a row removed by
a filter is not restored locally — that is a refetch"*. The last one teaches the
reader something the code does not say anywhere.

### `tests/unit/quickAdd.test.ts` — grouped by the parser's concerns, with the refusals collected

```
describe("parseQuickAdd — the PM's example, and the vocabulary")
describe("parseQuickAdd — case is a signal, not noise")
describe("parseQuickAdd — where it must NOT fire")
describe("parseQuickAdd — the tokens, and keeping the text")
describe("heldRelease — a refusal covers the reading, and only that")
describe("releaseAfterEdit — a lapsed refusal does not come back")
```

The third group is the one to steal. **Collect the negatives into their own
block.** "Where it must NOT fire" is the whole of what this parser is careful
about, and gathering it means a reader sees the carefulness as a subject rather
than meeting it one scattered case at a time. The cases inside carry their rule
number (`rule 4: ...`), so a reader can go from a rule in the spec to every test
that holds it.

### `tests/api/isolation.test.ts` — groups that are the threat model

```
describe("B cannot reach A's todo")
describe("a foreign id is indistinguishable from a nonexistent one")
describe("search stays inside the caller's own rows")
describe("signed out, every endpoint refuses and writes nothing")
describe("a spoofed userId in the body is ignored")
```

Five claims, in the order an attacker would try them. Note *"B's own title is
still found, so the empty results above mean something"* — a case that exists to
stop the group's other cases from passing vacuously, and says so in its own
name. Write that case, and name it like that.

### `e2e/undo-semantics.spec.ts` — groups that are the invariants

```
test.describe("one action toast at a time")
test.describe("an armed Undo is live on its first frame")
test.describe("added toasts are receipts, not controls")
```

Each heading is a sentence that would be true if you deleted every test under
it — that is the test for whether a heading is a claim or a label.

### The comments worth keeping — `tests/unit/todoDates.test.ts`, `tests/unit/filterSync.test.ts`

Several tests here carry the **measurement, or the rejected alternative, or the
failed hypothesis** that produced them. Those comments have survived review
precisely because they record something no assertion can. This is a pattern to
keep and to imitate, not clutter to trim.

`tests/unit/todoDates.test.ts`, above *"reports today, for exactly the day the
offset calls today"*, records the two ways the row could have known which date
is today and why both were rejected — comparing the rendered label re-derives
identity from copy, and calling `dueDayOffset` twice asks what day it is at two
different moments. Nothing in the assertion can say that, and without it the
next person re-proposes the label comparison.

`tests/unit/filterSync.test.ts`'s header explains why every test in it is a
*sequence* rather than a single call: the failure the module prevents is an
ordering failure, so a test asserting one transition in isolation would have
passed against the unfixed code too.

Write these where you have one. A test whose reason is non-obvious and whose
comment is missing is a test the next person deletes.

---

## Files that read as a flat inventory — and what is actually wrong with them

Naming these is not a plan to rewrite them. They are not being rewritten
(`docs/decisions/2026-08-21-not-rewriting-the-existing-suites.md`). They are here
because "grouped by behaviour" means nothing until you have seen the alternative
in this codebase's own voice.

### `tests/unit/filterSync.test.ts` — 25 cases, one `describe`, 478 lines

`describe("filterSync")` and then everything. The prose header is excellent and
the case names are good sentences; the structure is the only thing wrong, which
is what makes it the cleanest example. A reader has to hold twenty-five
independent race scenarios in their head with no scaffolding, and cannot tell
that the file is really about four separate things:

- following a navigation that came from outside the component;
- not undoing an edit that was made while its own push was in flight;
- recognising its own pushes landing late, out of order, or after being
  abandoned;
- bounding the pending and disowned lists so a stranded push cannot accumulate.

Four headings would say that. None exist, so the reader has to derive it.

### `tests/unit/todoDates.test.ts` — `describe("formatDueDate")`, cases named `"today"`, `"tomorrow"`

```
test("today")
test("tomorrow")
test("yesterday is overdue")
test("a date later this year omits the year")
```

The first two name an **input**, not a behaviour. They are an inventory of the
values you can pass, so the reader learns the argument list and nothing about
what the function is careful about — which, given the rest of this file, is a
lot. The later cases in the same block get it right, which is the giveaway.

Same file, so: a file can be excellent in its comments and its properties and
still be flat where it lists its examples. Judge the block, not the file.

### `tests/api/ordering.test.ts` — cases named after query parameters

```
describe("the order survives every filter, and so does the scoping")
  test("status=active")
  test("status=completed")
  test("priority=high")
```

The heading is a good claim. The cases under it are URL fragments. `status=active`
tells a reader which request was made and nothing about what was asserted, and
the difference matters: two of the cases in that block are about ordering and two
are about scoping to the caller's own rows, which the names hide completely.

### `e2e/quick-add.spec.ts` — 24 tests, one `test.describe`, 906 lines

`test.describe("quick-add bar")` covers at least four subjects: what the parser
shows on screen, how long a refusal survives editing, the handoff into the modal
via *More options*, and what happens when the create fails. They interleave. A
900-line file under one heading is the file telling you it holds more than one
subject.

### `tests/unit/rowFocus.test.ts` — good names, headings that are just the export list

```
describe("nextFocusIndex")   describe("focusRowAfterRemoval")
describe("focusIsUnclaimed") describe("focusUndoAction")
describe("nextUndoToken")    describe("restoreRescheduleFocus")
describe("restoreToggleFocus")
```

The case names here are among the best in the repo — *"never repeats, so the
toast being closed cannot answer for the one being raised"*, *"names the row by
its todo id, not by its position"*. But the headings are the module's export
list, so the file reads as an API index. A reader learns which functions exist
before learning that the module is about one thing: **not letting focus land on
something the user did not ask for.**

This is the common near-miss. Export-named groups are defensible when a module
is a toolbox of unrelated helpers. They stop being defensible the moment one
export has phases (`todoListState`'s does) or the module has a single theme the
headings could be stating instead.

---

## The rules, extracted

1. **A `describe` states a claim or names a situation.** Test it: would the
   heading still be a true sentence about the unit with every case under it
   deleted? "one action toast at a time" passes. "filterSync" does not.
2. **Split one export across several groups when it has phases** — the
   `applyCompletion — the revert` dash form. Do not split a group across
   several exports.
3. **Case names are sentences about behaviour**, in the vocabulary the product
   uses. Never an input value (`"today"`), never a request (`"status=active"`),
   never a bare restatement of the function name.
4. **Collect the negatives.** What the unit refuses to do is usually the
   interesting half; give it a block rather than sprinkling it.
5. **Write the case that proves the others are not vacuous**, and name it so —
   *"B's own title is still found, so the empty results above mean something"*.
6. **Keep the comment that records what an assertion cannot**: the measurement,
   the alternative that was rejected and why, the hypothesis that turned out
   wrong. Attach it to the test it explains.
7. **Length is a signal.** Past roughly 400 lines under a single heading, the
   file is holding more than one subject. Add headings; splitting the file is a
   separate decision and usually not required.
8. **When you touch an old file, leave the block you touched grouped.** Not the
   file — the block. That is the whole of the migration plan.
