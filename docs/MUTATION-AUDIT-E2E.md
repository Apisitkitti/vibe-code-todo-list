# Mutation audit — the e2e suite

**Date:** 2026-08-21
**Audited at:** `d670975` (`develop` at the time of commissioning)
**Scope:** `e2e/` only. The Vitest suites in `tests/` are a separate audit.
**Method:** mutate `src/`, run the specs that claim the behaviour, record whether
anything went red, restore, verify the tree is byte-identical.

31 mutations run. **23 killed, 8 survived.** The survivors fall into three
causes, not eight problems.

---

## How this was run, and what that buys the reader

Two `git worktree` checkouts of `d670975`
(`todo-app-e2e-mutaudit`, `todo-app-e2e-mut2`), each with its own `next dev` on
its own port (3212, 3213) and its own `E2E_PORT`. That is not tidiness: **two
other agents were editing this repo's `src/lib/` while this audit ran.** The
first mutation of this audit was run in the main checkout and a concurrent
agent's mutation of `src/lib/todoGroups.ts` was in the tree at the same time —
that result was discarded and re-run in isolation. A survivor list built on a
shared tree is not a survivor list.

Every mutation went through a driver that **refuses to run when the patch did
not apply**: the anchor text must appear exactly once, the file must differ from
its backup afterwards, and the new text must be read back off disk before
Playwright is invoked. This is the trap
`docs/decisions/2026-08-21-not-rewriting-the-existing-suites.md` names, and it
has fired three times on this project. Restoration is verified the same way, and
the driver aborts the whole plan if `git status` on `src`/`e2e` is not clean
afterwards. Both worktrees and the main checkout were clean at the end.

Baseline before mutating, in the isolated worktree: **360 passed, 1 failed, 33
skipped** in 11.3 minutes. The one failure —
`reschedule.spec.ts:453 focus returns to the row's own trigger after the row
moves section` [chromium-desktop] — **passed on its own re-run**, so the baseline
is 361/33 and the failure is a flake. A second flake was seen during the audit
(a `signUp` timing out in `row-layout.spec.ts` [chromium-mobile], also green on
re-run). With `retries: 0` by design, two flakes in an afternoon is worth
someone's attention on its own.

---

## The survivors, ranked by what they would have cost a user

### 1. A priority chip that draws no word — `PriorityChip` (P1)

**Mutation.** The chip's visible label moved inside an `sr-only` span:

```
-        <span className="sr-only">Priority: </span>
-        {label}
+        <span className="sr-only">Priority: </span>
+        <span className="sr-only">{label}</span>
```

**Result: survived 104 tests** — `grouping`, `row-layout`, `a11y-contrast`,
`quick-add`, `board-card-shape`, both projects.

**What it costs.** Every `High` and `Low` row and card renders a coloured pill
with the glyph and no readable word. That is §6.4's "none of them is
colour-only" broken outright, and WCAG SC 1.4.1 with it — on the one element
whose whole job is to say which level a todo is.

**Why nothing caught it.** Every assertion about the chip is one of:
`toContainText("High")` (reads `textContent`, which is unchanged); a count of
`[data-slot="chip"]` (unchanged); or a resolved `color` / contrast ratio
(unchanged — a clipped element still computes a colour). `a11y-contrast.spec.ts`
*does* measure geometry, but only to prove the announcement takes **no** room.
Nothing anywhere asserts that the word takes **some**.

### 2. A press on a superseded Undo runs the stale reversal — `claimActionPress` (T4)

**Mutation.** The guard keyed on the toast's own token was keyed on nothing:

```
-  if (outstandingAction?.token !== token) return false;
+  if (outstandingAction === null) return false;
```

**Result: survived 46 tests** — `undo-focus`, `undo-semantics`,
`receipts-against-the-undo`, both projects.

**What it costs.** This is the guard whose docblock records the defect it
replaced: closing a toast does not unmount it, so for a window after a repeat
write the DOM holds two action buttons for the same todo. Keyed on the todo id
rather than the token, a press on the **stale** button ran the stale reversal
and closed the live toast. The cap makes that window the ordinary path.
This is the same class as the documented `undo-focus.spec.ts` failure that
permanently deleted a user's todo.

**Why nothing caught it.** Every spec presses `todos.undoButton`, which is the
frontmost, live button, and asserts *counts* (`toHaveCount(1)`) and *names*
(`the standing Undo is named for its own toast, not the one it replaced`).
`undo-semantics.spec.ts:335` gets within one line of this — it identifies the
outgoing toast and then asserts the *name* of the incoming one instead of
pressing the outgoing one. Naming a wrong button is not the same claim as
pressing it.

### 3. Another row's Undo silently closed — `dismissActionToast` (T3)

**Mutation.** The scoping to the record was removed:

```
-  if (outstandingAction?.todoId !== todoId) return false;
+  if (outstandingAction === null) return false;
```

**Result: survived 46 tests** — same three files.

**What it costs.** `dismissUndo(todo.id)` runs **before** a toggle, a reschedule
and a delete. Scoped, a write to row B leaves row A's Undo alone; unscoped, it
closes it. If B's write then fails, the user has lost A's Undo for a write that
never happened — and the docblock says so in as many words: *"a write that goes
on to fail must leave another row's Undo exactly where it was."*

**Why nothing caught it.** The suite covers the *success* path of a second write
(`a write to another record replaces the standing Undo`,
`an older Undo is disarmed by a later edit`), where `showActionToast`'s own
`closeOutstanding()` produces the same visible outcome either way. No spec holds
or fails a write on record B while record A's Undo is standing, which is the
only place the two differ.

### 4. The untriaged level stops reaching a screen reader — `PriorityChip` (B3)

**Mutation.** `aria-hidden="true"` added to the `Priority: Medium` announcement.
The class stays, the box stays 1px, the DOM text is unchanged.

**Result: survived 51 tests** — `board-card-shape`, `a11y-contrast`,
`row-layout`, `grouping`, `card-row-parity`.

**What it costs.** `medium` is the schema default, so this is *most rows*. A
sighted user infers the level from the chip's absence; a screen-reader user now
hears nothing at all, which the chip's own docblock identifies as
indistinguishable from a render failure.

**Why nothing caught it.** `a11y-contrast.spec.ts` is careful here and says so:
it asserts the wording with `toContainText` **and** measures that every element
carrying it has no box, precisely because `toContainText` cannot tell hidden
from visible. Both halves pass under `aria-hidden`. The pair covers *"is it in
the DOM"* and *"does it take room"*; neither is *"does it reach the
accessibility tree"*.

### 5. Overdue becomes colour-only — `TodoDueDate` (D1, D3)

Two mutations, one cause, so they are one fix.

- **D1** — the visually-hidden `Overdue — ` prefix replaced with a junk string.
  **Survived 57 tests** (`due-date-ramp`, `grouping`, `row-layout`,
  `board-card-shape`, `a11y-contrast`, `card-row-parity`).
- **D3** — the `⚠` glyph deleted. **Survived 50 tests** (`due-date-ramp`,
  `grouping`, `a11y-contrast`, `row-layout`).

**What it costs.** Together these are the entire non-colour half of the overdue
step. `due-date-ramp.spec.ts`'s own header says the ramp is *"none of it
colour-only (§6.4 — every step keeps its word, and the overdue step keeps its
`⚠` and its visually-hidden `Overdue —`)"*. That sentence is asserted nowhere.

**Why nothing caught it.** `due-date-ramp.spec.ts` measures resolved colour and
contrast ratios exclusively — it is a test of the ink, and the ink is untouched.
The only assertion in the suite that mentions `Overdue —` is
`grouping.spec.ts:330`, and it is **negative**: `not.toContainText("Overdue —")`
on a *completed* row. A negative assertion is satisfied by deletion. There is no
positive counterpart on an active overdue row.

### 6. `Clear filters` throws the user out of the board — `CLEARED_FILTERS` (U4)

**Mutation.** `view: DEFAULT_VIEW` added to `CLEARED_FILTERS`, so clearing the
filters also resets the view.

**Result: survived 41 tests** — `search-clear-race`, `filtered-toggle`, `board`,
`empty-state-accent`.

**What it costs.** Exactly the ruling `todosUrl.ts` writes down at length:
*"The user asked to stop narrowing the list; they did not ask to leave the board
they are looking at."* Under the mutant, a user on the board whose filters match
nothing presses `Clear filters` and lands back in the list.

**Why nothing caught it.** `grep -rn "Clear filters" e2e/` returns nothing. The
empty state's `Clear filters` button is **never pressed anywhere in the e2e
suite** — the only "clear" the suite exercises is the search field's own clear
button (`a11y-targets.spec.ts`), which is a different control on a different
code path. A documented product ruling with a dedicated constant, a dedicated
comment and zero coverage.

### 7. `view` in the debounce dependency list — `useTodosUrlSync` (U3)

**Mutation.** `view` removed from `useDebouncedEffect`'s dependency array.

**Result: survived 35 tests** — `search-clear-race`, `search-debounce`, `board`,
`filtered-toggle`.

**Not a finding against the suite.** The module says so itself: *"`view` is in
the dependency list on purpose and no test covers it… the case it exists for
needs an outside navigation to `/todos`, and this module's own doc records that
the app has none today."* Recorded because the audit confirmed the claim rather
than because it is a gap someone should close now; the thing to add first is the
outside navigation, not the test.

---

## The shared causes, which are three fixes rather than eight

**A. Nothing in this suite can distinguish "present in the DOM" from "present to
a user" (P1, B3, D1, D3).** Four survivors, four different elements, one
mechanism: the assertions available are `toContainText` / `getByText` (blind to
visibility and to `aria-hidden`), element counts (blind to both), and computed
colour (blind to both). `a11y-contrast.spec.ts` has already built half the
answer — `announcementBoxesIn`, which measures that a screen-reader-only element
has no box, and which its own comment notes `toBeHidden` cannot do because a 1px
clip reports visible. The fix is to finish it: one shared helper in
`e2e/support/assertions.ts` that takes a locator and a wording and asserts both
directions — *this text is visible and occupies a box*, or *this text is in the
accessibility tree and occupies none* — and to use it wherever the claim is
about a word rather than about a colour.

**B. The Undo slot's identity guards are asserted by name and count, never by
pressing the wrong thing (T3, T4).** Both survivors are guards about *which*
toast or *which* record, and every spec presses the frontmost live button. Two
tests close both: press the outgoing action button during a repeat write (it is
still in the DOM — `toast-dead-window.spec.ts` already documents that and works
around it by keying its probes to accessible names); and hold or fail a write on
record B while record A's Undo stands.

**C. One control has no coverage at all (U4).** `Clear filters` is a rendered,
labelled button with a documented product ruling behind it and no e2e test
presses it.

---

## The specs that held, and what killed them

Worth as much as the list above: these are not "green", they are demonstrably
able to go red.

| Area | Mutation | Killed by |
|---|---|---|
| Receipt yields to a standing Undo | `showYieldingReceipt` never yields | `receipts-against-the-undo:84` |
| Superseding receipt takes the slot | `showSupersedingReceipt` stops closing the Undo | `receipts:119`, `receipts:163` |
| The §4.10 dead window | HeroUI's default `wrapUpdate` restored | `undo-semantics:548` |
| One action toast at a time | `showActionToast` stops closing the outstanding one | 4 tests in `undo-semantics` |
| Card metadata line, conditional render | line always boxed | `board-card-shape:330` |
| Row metadata line, conditional render | line always boxed | `card-row-parity:158` |
| The card's `sr-only` level survives the dropped box | `else` branch returns `null` | `board-card-shape:394` |
| The URL omits defaults | `view` always written | `search-clear-race:87`, `:376` |
| The URL carries `q` | `q` never written | 10 tests |
| Header line's loading guard | `groups === null` guard removed | 20 tests |
| Header line omits zero clauses | zero clause spelled out | 9 tests |
| §7.16 list heading inset | `SECTION_HEADING` back to `px-2` | `section-heading-alignment` (list) |
| §7.16 board heading inset | board heading back to `px-1` | `section-heading-alignment` (board) |
| §4.7 empty state centring | body loses `align="center"` | `empty-state-centring` |
| §2.2 empty state hierarchy | `gap-4` → `gap-2` | `empty-state-centring` |
| The view toggle is absent, not hidden | rendered on mobile behind `hidden lg:` | `board:613` |
| Card checkbox on the title's first line | `h-6` wrapper removed | `card-row-parity` |
| Board column → date mapping | `Today`/`Upcoming` offsets swapped | `board:144`, `board:184` |
| Quick-add rule 2 (never empty the title) | `canLift` allows emptying | `quick-add` (2 tests) |
| Quick-add rule 4 (`next`/`last` refused whole) | modifier guard removed | `quick-add` |
| Quick-add rule 3 (lowercase only) | weekday match case-folded | `quick-add` (2 tests) |
| The due-date ramp's middle step | `Today` muted again | `due-date-ramp` (4 tests) |

Two of these deserve a specific note because the kill is **fragile**:

- **The dated header line (H4).** Making the line `sr-only` — invisible, text
  unchanged — was killed by exactly one test: `list-header.spec.ts:348`, the
  §7.19 *geometry* test that measures the gap to the heading. All **eleven**
  tests in the `the dated header line` describe block passed, because every one
  of them goes through `page.locator("main").getByText(HEADER_LINE_PATTERN)` and
  `toHaveText`, which cannot see visibility. The suite's only tripwire on
  "is this line on screen" is a test written to measure something else. This is
  the same accidental-tripwire pattern `board.spec.ts:613` records having lost
  once already.
- **The row's metadata line (M2).** Always-boxing the row's metadata was killed
  only by `card-row-parity.spec.ts:158`, and only in `chromium-mobile`.
  `row-layout.spec.ts`, which is the file named after that part of the row,
  passed.

And one test claims more than it delivers: `receipts-against-the-undo.spec.ts:163`
is introduced as *"the discriminating case… a change that got the branch
backwards passes each of the two tests above only if they are read alone"*. Under
T1 (the visible-row receipt no longer yields) it **passed** — its visible-row
half asserts only that the Undo is still standing, which it is; it never asserts
the receipt stayed unraised. `receipts:84` is what caught T1.

---

## The 33 skipped tests

All 33 are skipped by construction, none is abandoned, and the two categories
are legitimate for different reasons.

**27 are project-gated on viewport, and correct.** 25 skip on
`chromium-mobile` because the board needs a desktop viewport
(`board.spec.ts` ×13, `board-card-shape.spec.ts` ×4,
`section-heading-alignment.spec.ts` ×2, `search-clear-race.spec.ts` ×2,
`card-row-parity`, `console-clean`, `page-rhythm`, `pick-a-date-focus`), and 2
skip on `chromium-desktop` because they are the phone fallback
(`board.spec.ts:613`, `board.spec.ts:657`). Each has a stated reason, each names
a real breakpoint behaviour, and each runs in the project where the behaviour
exists. Nothing here is dead.

**6 are gated on `MEASURE_TOAST` and never run** — `toast-dead-window.spec.ts`
lines 290 and 337 (×2 parameterisations), in both projects. This is the
diagnostic harness behind §4.10's 350–400ms / 700–800ms figures. Its own docblock
argues for keeping it: the numbers in `src/lib/toast.ts` and `docs/DESIGN.md` are
only as good as the harness that produced them, and the next person to doubt them
should be able to re-run it rather than rebuild it. That is a real reason and I
would keep them.

It is worth being clear about what that costs, though, because the audit
measured it: the §4.10 dead window itself **is** covered — restoring HeroUI's
default `wrapUpdate` (T5) went red at
`undo-semantics.spec.ts:548 a press as soon as the button exists is not
swallowed`. So the skipped measurement harness is not load-bearing for the
regression, which is the good outcome. The *stacking* test in the same file is
deliberately not gated and does run.

---

## Where this brief is wrong

- **"361 passing, 33 skipped" is right, and
  `docs/decisions/2026-08-21-not-rewriting-the-existing-suites.md` is wrong to
  doubt it.** That record says the 361 "is not reproducible today and is
  presumably an e2e count from before `fix/e2e-attribution` and
  `feature/board-view` landed". It is reproducible: 361 + 33 = **394**, which is
  the same total the record itself measures with `--list`. `--list` enumerates
  skips; a run reports them separately. Measured here on `d670975`:
  `Total: 394 tests in 32 files` from `--list`, and `360 passed, 1 failed
  (flake), 33 skipped` from a full run. The two numbers were never in conflict.
- **"The board's e2e suite stayed green with the entire column-to-date mapping
  deleted, because nothing ever dragged to `Upcoming`" is now closed.** Swapping
  the `Today` and `Upcoming` day offsets in `src/lib/todoBoard.ts` was killed by
  `board.spec.ts:144` and `board.spec.ts:184 a drop on Upcoming writes tomorrow,
  not today`. The brief presents this as a live example; it is a fixed one.
- **"Restoring the `display:none` radiogroup defect left 35 tests passing" is
  also closed.** Rendering the view toggle on mobile behind `hidden lg:` instead
  of not rendering it was killed by `board.spec.ts:613`, which asserts the
  absence at the DOM level with `includeHidden: true` and a raw
  `[role="radiogroup"]` count. The comment in that test explains exactly why.
- **The audit could not be run where the brief said to run it.** Two other
  agents were mutating `src/lib/` in the working tree during this window
  (`todoGroups.ts`, `todoBoard.ts`, and per the decision record also `date.ts`,
  `TodoDueDate.tsx` and `todoListState.ts`), and a third was running a full
  Playwright suite from `todo-app-hfix` against the same `todo_app_test`
  database. "Stay in `e2e/` and `src/` as a reader" is not compatible with
  "mutate the source"; isolation has to be part of the instruction, not left to
  the auditor to notice.

## Verified versus assumed

**Verified by execution:** every KILLED / SURVIVED verdict above, each from a
recorded Playwright exit code with the patched text read back off disk first;
the baseline 360/1/33 and the flake's green re-run; the 394 from `--list`; that
`new ToastQueue({})` really does restore HeroUI's view-transition `wrapUpdate`
(read from `node_modules/@heroui/react/dist/components/toast/toast-queue.js`:
`options?.wrapUpdate ?? defaultWrapUpdate`); that `.env` points at local
`todo_app_dev` and that the suite wrote only to `todo_app_test` (checked by
listing users in both databases before and after).

**Verified by reading:** the reachability arguments for T3 and U4 — that
`dismissUndo` is called before a toggle, a reschedule and a delete, and that the
board renders the same empty state as the list including its `Clear filters`
action. Neither was driven end to end.

**Not done:** no survivor was re-run against the *entire* 394-test suite. Each
was run against the spec files that claim the behaviour (46–104 tests each,
listed per survivor above). A survivor could in principle be caught by a file
outside that set; none of the candidates looked plausible, but it was not
measured. The new `e2e/page-alignment.spec.ts` that landed on `develop` at
`2d12e17` during this audit is not covered here at all.
