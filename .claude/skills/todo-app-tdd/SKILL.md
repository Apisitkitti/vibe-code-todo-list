---
name: todo-app-tdd
description: How this project writes tests now — test-first for everything whose interface is known, spike-then-throw-away for HeroUI composition and focus and drag, assertion-first for visual and contrast work, and the grouping and naming rules that make a test file read as a description of its unit. Use BEFORE writing any test, any new API route, any pure module, any bug fix, and before starting a UI change you expect to explore. Use it when the question is "do I write the test first here?", "what do I do with the spike I just wrote?", "how do I name and group these tests?", "what counts as red enough?", or "how do I show a reviewer this test could fail?". The decision behind it is `docs/decisions/2026-08-20-move-to-tdd.md`; this file is the instruction, not the argument.
---

# How we write tests here

Two rules, both binding on new work from now:

1. **The test comes before the code**, wherever the interface is known — and
   where it is not, the exploration is thrown away and redone test-first.
2. **A test file reads as a description of its unit**, not an inventory of
   cases. That is half of what was asked for, and it is the half that gets
   dropped. `references/readability.md` is where it is spelled out, with this
   repo's own files as the examples.

None of this applies retroactively. The existing 492 unit/api and 394 e2e tests
are not being rewritten — see
`docs/decisions/2026-08-21-not-rewriting-the-existing-suites.md`. You are bound
by this when you write something new or touch something old.

## First: pick the mode, and say which one out loud

Before the first edit, decide which row you are in and write it in the commit
body or the branch's first message. A reviewer will ask, and "I forgot" reads
as "I wrote the code first".

| What you are building | Mode |
|---|---|
| Pure modules — `src/lib/quickAdd.ts`, `todoBoard`, `filterSync`, `todoGroups`, `date`, `todoListState`, `rowFocus`, and anything else that is arithmetic over values | **Strict**: red, green, refactor, small cycles |
| An API route under `src/app/api/**` | **Strict, contract first**: status, error shape, isolation — before the handler exists |
| A bug fix, anywhere, including a UI one | **Strict**: the repro is the test, and it is red before the fix |
| HeroUI composition, focus management, drag | **Spike, then throw the spike away and redo it test-first** — `references/spikes.md` |
| Visual, spacing and contrast work | **Assertion-first**: name the assertion and the number it must produce before you touch the CSS |

The rows are not a difficulty ranking. They are a statement about when the
interface is knowable in advance: a predicate's is, a route's is, a repro's is.
`Modal`'s was not.

## Strict mode, concretely

1. Write the test. Put it at the lowest layer that can fail for the reason you
   care about — the table in
   `.claude/skills/todo-app-structure/references/testing.md` decides which
   suite.
2. Run it and **watch it go red**. Record the output:

       npm run test:run > /tmp/red.log 2>&1; echo "EXIT=$?"

   Never through a pipe. Read the file back.
3. **Read the failure message.** Red is not enough on its own — it has to be
   red *for the reason you expect*. A test that fails on `undefined is not a
   function` because the module does not exist yet has proved nothing about the
   assertion. Get to the point where the assertion itself is the thing failing,
   with the expected and actual values both printed.
4. Write the smallest thing that turns it green. Run again, record the exit
   code again.
5. Refactor with the test green.
6. Then mutate: break the guard you just added, each way it could plausibly
   break, and check something goes red. Report survivors, **including a
   mutation that turned out never to have applied** — that has been reported
   three times on this project as a coverage gap when it was the opposite.
   Assert the patch exists (`git diff --name-only` non-empty, or grep the new
   text back) before you believe any mutation result.

Keep the red output. Paste the failing assertion into the commit body or the
review message. It is the only evidence that separates a test written first
from a test written after and asserted to have been written first.

## The exploratory exception, honestly

Nobody could have written a failing test in advance for `Typography` claiming
`MenuItem`'s label slot, for `Modal`'s root wrapping its children in a
`PressResponder`, for `useMediaQuery` hydrating against the view the server did
not choose, or for a `mouseup` landing on a different node and retargeting the
click to `<html>`. Those were found by building something and watching it
misbehave. Demanding a test first for behaviour nobody knows exists is not
rigour, it is guessing — and a rule that pretends otherwise gets ignored
wholesale, including the parts that work.

So the exception is real. Its boundary is exactly this:

**The exception covers the discovery, never the fix.** The moment you can name
what the library does, the interface is known, and you are back in strict mode:
the test that names the mechanism goes first and is watched failing against the
unfixed code. "I had to explore" is a reason to have written a spike. It is
never a reason for the fix to arrive with its test attached afterwards.

And the spike itself does not survive. See `references/spikes.md` — that is the
word the whole decision turns on.

## Assertion-first, for visual work

You cannot always watch a contrast test go red before you know the token you
are changing. What you can always do is **write down, before the change, which
assertion has to be red on current code and what number it currently produces.**

The precedent is the UI designer's P3 spec, which named the failing assertion in
advance — and in doing so caught that a ratio-only test would have passed
unchanged, because an earlier fix had already moved the token past the floor. A
test specified after the change would have been written to fit the change.

So: measure current, state the target, write the assertion against the target,
watch it fail on current code, then move the token. If the assertion is already
green before you start, the change you are about to make is not the change you
think it is — stop and say so.

## What a reviewer will ask you for

- Which mode, named.
- The red output, with the assertion failing for the stated reason.
- For a spike: the commit that deleted it, or the statement that nothing from it
  survived into the diff.
- Your mutations and their results, survivors included.
- The test file read end to end as prose — see `references/readability.md`. A
  file whose `describe` blocks are export names and whose cases are input values
  will come back, and that is not a style note: it is the difference between a
  suite you can audit and one you can only re-run.

## Where the rest of it lives

- `references/readability.md` — grouping and naming, with the files in this repo
  that already do it well and the ones that do not.
- `references/spikes.md` — the throw-away procedure, and what counts as having
  thrown it away.
- `.claude/skills/todo-app-structure/references/testing.md` — which suite, the
  isolation rules, the `E2E_PORT` and timezone hazards, definition of done.
- `docs/decisions/2026-08-20-move-to-tdd.md` — the argument and the evidence.
  Do not re-litigate it here; if it is wrong, write a new record.
