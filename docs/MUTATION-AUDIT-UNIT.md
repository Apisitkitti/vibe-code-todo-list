# Mutation audit — the unit/api suite

Auditor: SDET. Branch `develop` @ `d670975`, working tree clean before and
after.

> `develop` moved to `2d12e17` while this ran — two other agents' branches
> merged in. Checked rather than assumed: nothing under `tests/` changed, and
> the only `src/` file touched was `src/app/todos/components/TodoFilters.tsx`,
> which is not under unit test and was never a mutation target. No run was
> contaminated and no revert clobbered anyone's work. Every result below holds
> identically on `d670975` and on `2d12e17`.

Node 24 (`v24.14.0`). `.env` verified at
`postgresql://…@127.0.0.1:5432/todo_app_dev` before the first database-backed
run. Baseline: **492 passed / 25 files**, 8.3s.

Scope: the Vitest suite only — `tests/unit/**` and `tests/api/**`. The
Playwright suite is a separate audit and is not covered here. Where a finding
below hands a property to e2e, it is marked **→ e2e**.

> Everything below was established by execution. Each mutation was written to
> disk, **read back off disk to confirm it landed**, run against the whole
> suite, then reverted and the file checked byte-identical against a pristine
> copy taken before any edit. A mutation whose anchor did not match exactly
> once was refused rather than run. `src/` and `tests/` are unmodified by this
> work.

---

## 0. Result, up front

**178 mutations run. 144 killed, 33 survived, 1 refused to apply.**

The unit suite is in better shape than the five documented defects would
suggest. Every module that the TDD decision names as a *pure module* —
`quickAdd`, `todoBoard`, `filterSync`, `todoGroups`, `date`, `todoListState`,
`rowFocus` — killed the overwhelming majority of mutations aimed at what its
tests claim, including every boundary flip, every off-by-one and every
inverted comparison in its core logic. `quickAdd` killed 12 of 13.
`todoGroups` and `todoBoard` killed 11 of 11. `date` killed 8 of 8.
`filterSync` killed 12 of 14. **This is not a suite that cannot fail.**

The survivors cluster into **six causes**, and five of the six are one fix
each rather than one fix per survivor. The single most valuable finding is
§2.1: two test files assert a constant against itself, so the number they
exist to pin is free to change to anything within a wide band.

Ranked by what the surviving mutation would have cost a user:

| # | Severity | Cause | Survivors |
|---|---|---|---|
| 2.1 | **High** | A constant asserted against itself | `T3`, `F4` |
| 2.2 | **High** | 400 response *bodies* never asserted — only status codes | `X1`, `X2`, `X1b`, `X3` |
| 2.3 | **Medium** | "Did the focus actually land" has no refusing fixture | `R5`, `R12` |
| 2.4 | **Medium** | Input validators reachable only through callers that never send junk | `P2`, `P3`, `P2b`, `P3b` |
| 2.5 | **Medium** | Success-path response shape unasserted on two write routes | `I3`, `I3b`, `C14`, `C14b` |
| 2.6 | **Low** | Depth-2 and multi-metacharacter cases never constructed | `F1`, `F1b`, `A9`, `A9b`, `H1`, `H1b` |
| 3.x | — | Not defects: equivalent or near-equivalent mutants | `S2`, `Q6`, `I4`, `A13`, `C5`, `C8`, `C9`, `TO7`, `R13`, `R1`… |

---

## 1. What held, and it is most of it

Saying this plainly is worth as much as the list of holes, so it goes first.

**`src/lib/date.ts` — 8/8 killed.** Including the two mutations this project
has already paid for once: reading `now` in UTC rather than the viewer's local
calendar day (`D4`), and reading a stored `dueAt` in local time rather than
UTC (`D3`). `tests/unit/todoDates.test.ts` pins the round trip at every hour
of the local day, and it works — `D4` took six tests red, `D3` took three
across two files. The `isOverdue` boundary (`<` → `<=`, `D5`) and the
`Yesterday` boundary (`-1` → `-2`, `D6`) both died.

**`src/lib/todoGroups.ts` and `src/lib/todoBoard.ts` — 11/11 killed.** Both
section boundaries died (`G1`, `G2`). Completion-wins-over-date died (`G4`).
The empty-section rule died in both directions — the list omitting empty
sections (`G5`) and the board keeping them (`B5`). Most importantly for the
board's own documented history: **`B1`, the mutation that lets an active card
be dropped on `Overdue` and invents yesterday as its due date, was killed by
two tests.** The e2e suite once stayed green with the entire column-to-date
mapping deleted; the unit suite does not. `B2` (Today/Upcoming offsets
swapped) also died.

**`src/lib/quickAdd.ts` — 12/13 killed.** Every one of the parser's four
stated rules has a test that dies when the rule is broken: rule 1's scan
boundary (`Q10`, 9 red), rule 2's never-empty-the-title (`Q1`, 7 red), rule
3's case sensitivity for both priorities (`Q5`) and weekdays (`Q11`), rule 4's
refusal of `next friday` (`Q2`) and its `in` anchor (`Q9`). The strict date
parse (`Q8`), the `tonight` synonym (`Q7`), the 365-day horizon (`Q4`) and the
weekday-is-today→next-week wrap (`Q3`) all died. The one survivor is an
equivalent mutant (§3.2).

**`src/lib/filterSync.ts` — 12/14 killed.** Every one of the module's
load-bearing decisions is pinned: matching an echo *anywhere* in pending
rather than at the head (`F2`), disowning rather than dropping on abandon
(`F9`) and on a landed echo (`F12`), refusing to adopt a late disowned push
(`F3`), leaving the search box alone on a view-only outside navigation (`F8`),
building a push on `settled` rather than `applied` (`F10`), the pre-short-
circuit ordering in `syncToUrl` (`F11`), the view being part of the tuple
(`F7`), normalisation on both sides (`F5`), and identity-on-no-op (`F14`).

**`src/lib/routes.ts` — 4/4 killed, including both security mutations.**
Accepting a backslash (`RT1`) and accepting a protocol-relative `//host`
(`RT2`) both went red.

**Cross-account isolation — every mutation killed.** Dropping the `userId`
scope from the list `where` (`C1`, 18 red), folding it into one `OR` arm and
leaving the other unscoped (`C2`), scoping `PATCH` / `DELETE` / `/status` /
`/due` by id alone (`I1`, `I2`, `J1`, `K1`), and taking ownership from the
request body (`C13`) all died. So did unauthenticated `GET` and `POST`
(`C15b`, `C16`). `tests/api/isolation.test.ts` is doing exactly its job.

**`rowFocus` — 11/13 killed**, `toast` slot — 7/8, `getErrorMessage` — 4/4,
`todoFormSchema` — 5/5, `ordering` — 5/5, `searchWildcards` — 3/4,
`rateLimit` — 4/4, `todosUrl` — 4/4, `listHeaderLine` — 4/4,
`todoListState` — 9/10, `handoff` — 2/3, `truncateForAnnouncement` — 3/4,
`useDebouncedEffect` — 1/1.

---

## 2. The survivors that are defects

### 2.1 High — a constant asserted against itself

**Survivors: `T3`, `F4`.** One cause, two files, one fix each.

`tests/unit/truncateForAnnouncement.test.ts` builds every expectation *from*
`DIALOG_TITLE_MAX_LENGTH`:

```ts
const exact = "a".repeat(DIALOG_TITLE_MAX_LENGTH);
expect(truncateForAnnouncement(exact)).toBe(exact);
```

Changing `DIALOG_TITLE_MAX_LENGTH` from **45 to 40** leaves all six tests
green (`T3`). The file is a careful one — it has a dedicated case for the
`<=`/`<` off-by-one, and that case *does* kill `T1` — but the number the
whole file exists to bound is never compared to a literal, so it is free.

The bound is not *entirely* free, and the discriminator says exactly how far:
raising it to **5000** does go red (`T3b`), because
`expect(truncateForAnnouncement(longest)).toHaveLength(DIALOG_TITLE_MAX_LENGTH + 1)`
stops truncating once the bound exceeds `TITLE_MAX_LENGTH`. So the suite pins
`0 < DIALOG_TITLE_MAX_LENGTH < 200` and nothing narrower. A silent drop to 40
— or a rise to 199 — ships, and the cost is §7.5's actual product rule: a
dialog name read in full, on open, with no way to skip it.

The same shape in `tests/unit/filterSync.test.ts`:

```ts
expect(state.pending.length).toBeLessThanOrEqual(MAX_PENDING_PUSHES);
```

`MAX_PENDING_PUSHES` **8 → 1000** survives (`F4`). The assertion compares the
module's own constant against itself and cannot fail for any value.
`filterSync.ts`'s own comment says the bound "is the only thing that caps"
a stranded recording suppressing a later outside navigation — and it is
unpinned. The bound's *existence* is covered (removing the `.slice` outright
kills, `F4b`); only its value is not.

**Fix, both files:** one assertion per constant against a literal.
`expect(DIALOG_TITLE_MAX_LENGTH).toBe(45)` and
`expect(MAX_PENDING_PUSHES).toBe(8)`, each with the reason beside it. The
derived assertions are right to stay derived — this adds an anchor, it does
not replace the style. `filterSync.ts` already documents that the constant is
exported *"so the test that pins the bound reads the same number the module
enforces rather than a copy of it"*; that is exactly the reasoning that makes
the assertion vacuous, and the comment should be corrected with the test.

### 2.2 High — 400 bodies are never asserted, only 400 statuses

**Survivors: `X1`, `X2`, `X1b`, `X3`.** One cause, one fix.

`grep -rn "fieldErrors" tests/` returns **nothing**. `tests/api/` asserts
`response.status` roughly forty times and never once reads the error body. So
every mutation to `src/app/api/todos/errors.ts` survives:

- `X1` — dropping the `isTodoFieldName` check, so a zod path the form does not
  know about (the toggle's `completed`, a renamed field) is typed through as a
  form error. This is **review m-6 reintroduced**, and the file's own comment
  says the check exists so it is not "discovered by the client".
- `X2` — last message per field wins instead of the first, so an input can show
  a different error than intended.
- `X1b` — **dropping every field error entirely**, so all 400 bodies carry
  `fieldErrors: {}`. Still green.
- `X3` — dropping the top-level `message`, so `toast.danger` has nothing to
  show. Still green.

`X1b` is the one that matters: the whole field-error mechanism can be deleted
and 492 tests pass. What a user gets is a form that refuses their input and
marks no field, or a toast with no sentence in it.

This is the `filterPredicate.test.ts` shape in a new place — the assertions
are all real, and none of them reaches the thing.

**Fix:** in `tests/api/writeContract.test.ts`, at three or four of the
existing 400s, assert the body: the `fieldErrors` key set, the field the error
lands on, and that a non-form key (`completed`) never appears in it.

### 2.3 Medium — no fixture where focus is refused

**Survivors: `R5`, `R12`.** One cause, two functions.

`focusUndoAction` and `focusRowAfterRemoval` both end by *verifying* the move
landed:

```ts
return deps.getActiveElement() === action;      // focusUndoAction
return deps.getActiveElement() === target ? (target ?? null) : null;
```

Replacing either verification with an unconditional success survives (`R5`,
`R12`). The cause is in the harness: `tests/unit/rowFocus.test.ts`'s fake row
is

```ts
focus: () => { active = row; },
```

— a `focus()` that **always succeeds**. So the comparison is true whenever
`focus()` was called, and its false branch has no test. The discriminators
confirm the tests are otherwise honest: removing the `focus()` *call* is
caught in both (`R5b`, `R12b`). What is uncovered is precisely the case of a
control that is present but momentarily unfocusable.

That case is not hypothetical here — `rowFocus.ts`'s own comment (review F1)
describes a restore landing one frame before React flushed, giving up
permanently and leaving focus on the floor. And the third function, `restoreFocusTo`,
**does** have a refusing fixture: `R8`, the same mutation on the restore loop,
was killed by two tests. So the fixture exists in the file; two of the three
loops just do not use it.

**Fix:** a fake whose `focus()` declines (leaves `active` unchanged) for the
first *n* frames, applied to the `focusUndoAction` and `focusRowAfterRemoval`
blocks, asserting each reports `false`/`null` rather than a phantom success.

### 2.4 Medium — validators with no adversarial caller

**Survivors: `P2`, `P3`, `P2b`, `P3b`.**

`parseStatusFilter` and `isTodoPriority` in `src/lib/todo.ts` can be reduced
to `typeof value === "string"` (`P2`, `P3`) or to `return true` (`P3b`), or
made to pass any string straight through as a `TodoStatusFilter` (`P2b`), and
nothing goes red. Their *defaults* are covered — `P1`, changing the fallback
from `DEFAULT_STATUS_FILTER` to `"completed"`, took 15 tests red — but their
*rejection* is not: no test hands them a value that should be rejected.

These sit on the URL, which the app's own comment calls "something people
edit". `?status=nonsense` reaching the `where` clause as `completed: false`
is the failure this guards.

**Fix:** a small table-driven block in `tests/unit/` — each parser against a
handful of junk inputs (`"nonsense"`, `""`, `null`, `5`, `{}`, `["active"]`),
asserting the default comes back.

### 2.5 Medium — success-path response shape on two write paths

**Survivors: `I3`, `I3b`, `C14`, `C14b`.**

`DELETE /api/todos/[id]` can return `200 {ok:true}` (`I3`) or **`500`**
(`I3b`) on the success path and the suite stays green. `tests/api/isolation.test.ts`
asserts `DELETE`'s **404** thoroughly — the cross-account refusal is pinned
twice — but no test asserts what a *successful* delete answers. A client
branching on 204 would break on a change nothing catches.

Separately, `POST /api/todos` can store every note as `NULL` (`C14b`) or store
`""` instead of `NULL` for an empty note (`C14`) with nothing red. `note` is
asserted on the *update* path (`writeContract` checks `after?.note`) and never
on create.

**Fix:** assert `204` and an empty body on the successful `DELETE`; assert the
created row's `note` on `POST`, for both a supplied note and an omitted one.

### 2.6 Low — cases the fixtures never reach depth for

Three unrelated survivors, grouped because each is "the test builds depth 1
where the code branches at depth 2".

- **`F1` / `F1b` — `settled()` at pending depth ≥ 2.** Changing
  `state.pending.at(-1)` to `at(0)` survives, and so does a version that
  differs *only* at depth ≥ 2 (`F1b`). The suite does build two pending pushes
  — `F2` proves it — but never reads `settled` while both are outstanding, so
  "a new push builds on the newest thing we asked for" is only exercised where
  newest and oldest coincide. Cost: a filter press inside a second in-flight
  window spreads a superseded value, which is the defect the module's second
  half exists to stop.
- **`A9` / `A9b` — `escapeLikePattern` with two metacharacters.** Making the
  regex non-global (`A9`, escapes only the first) or escaping only the last
  (`A9b`) both survive. `tests/api/searchWildcards.test.ts` kills every
  single-metacharacter mutation (`A6`, `A7`, `A8` all red) but every fixture
  term carries exactly one. A search for `50%_off` is still a pattern box.
- **`H1` / `H1b` — `createHandoff`'s clear-before-resolve.** Swapping
  `pending = null; resolve?.(value)` to resolve first survives. The comment
  says this ordering exists so "a continuation that asks again during its own
  resolution cannot be answered by the call it is still inside" —
  `tests/unit/handoff.test.ts` covers ask/answer/supersede (`H2`, `H3` both
  red) but never re-enters `ask` from inside a resolution.

**Fix:** one added case each — a third pending push before reading
`nextUrlState`; a search term with `%` and `_` together plus one with `\` and
`%`; an `answer` whose awaiting continuation calls `ask` again.

---

## 3. Survivors that are **not** defects

Reported because a mutation audit that lists equivalent mutants as coverage
gaps is worse than no audit. Each of these survived and each should have.

**3.1 `S2` — `clampCount` → identity.** The clamp guards a count going below
zero. No caller can reach it: `applyCompletion` refuses a no-op flip
(`current.completed === completed`) so it cannot double-decrement, and
`replaceTodo` corrects by difference. It is reachable only from *inconsistent
input* — a `completedCount` of 0 alongside a completed row, which the comment
names as the mid-flight-reload case. The upper half of the clamp is covered:
`Math.max(1, …)` takes four tests red (`S2b`). Defensive code with no
reachable input, correctly written and correctly untested.

**3.2 `Q6` — `/^\d{1,3}$/` → `/^\d+$/`.** Behaviourally equivalent for every
input a user can type: a 4+ digit count that the regex would have rejected is
rejected one line later by `MAX_RELATIVE_DAYS`. They differ only on leading
zeros (`in 0003 days`), which is not a case worth a test.

**3.3 `I4` — `PATCH`'s `result.count === 0` guard.** Removing it still answers
404, because the `if (!todo)` re-read guard immediately below catches the same
case. The two guards are redundant for the *status*; the first only saves a
query. Near-equivalent.

**3.4 `A13` — `findOwnedTodo` dropping its `userId` filter.** Survives, and
does not leak: every caller runs it *after* a `updateMany`/`deleteMany` already
scoped by `userId` that returned `count > 0`, so the id provably belongs to
the caller. Defence in depth with no live path. Worth knowing it is unpinned —
`A13b`, making it return *another* user's row, is caught by five tests, so the
function is not unwatched, only its second scope clause is.

**3.5 `C5` — one search arm losing `mode: "insensitive"`.** Survives because
`isolation.test.ts`'s case-insensitivity fixtures happen to match on the arm
that kept it; making **both** arms case-sensitive is caught (`C5b`). A gap of
one fixture, not of a property. Listed here rather than in §2 because the
property itself is pinned.

**3.6 `C8` — `totalCount` counting the filtered set.** `totalCount` is
asserted twice, both times in unfiltered contexts, so the "counts describe the
account, not the page" rule is only observable under a filter. Borderline;
worth one assertion if `tests/api/ordering.test.ts` is being touched anyway.

**3.7 `C9` — dropping `.trim()` on the query param.** Survives on its own but
the trimming *behaviour* is pinned: prefixing a space instead (`C9b`) takes
seven tests red across two files.

**3.8 `TO7` — HeroUI's default `wrapUpdate` restored.** Cannot be killed by
this suite by construction: `tests/unit/actionToastSlot.test.ts` mocks
`@heroui/react` with a `ToastQueue` that ignores its constructor options
entirely, and the file's own header says so honestly. **→ e2e** — the whole of
§4.10 rests on `e2e/toast-dead-window.spec.ts`. Flagging it for the e2e audit:
if that spec is also weak, nothing anywhere guards the dead window.

**3.9 `R13` — the `undo-token` dropped from `undoActionSelector`, leaving
`[data-slot="toast-action-button"]`.** Survives because every unit test injects
`findAction`; the real selector string is only used by `browserUndoDeps`,
which nothing here constructs. **→ e2e**, and pointedly: *this is the exact
shape of the `undo-focus.spec.ts` defect* — a selector matching by slot shape
rather than by identity, which the wrong toast's button satisfies equally
well. The unit tests correctly pin the *identity* rule (`R6`, `R11`, `TO2` all
red); what is unpinned is that the production selector implements it. Worth
the e2e auditor's attention above anything else in this list.

---

## 4. Corrections to the brief

Two, both small.

**"Your half is the unit suite — 492 tests in `tests/`."** Correct on the
count, but `tests/` is not purely unit: 7 of the 25 files are under
`tests/api/` and drive the real route handlers against Postgres. Several
findings above (§2.2, §2.4, §2.5) are API-contract gaps rather than unit gaps,
and the fixes belong in `tests/api/`. Nothing was mis-scoped — `vitest run`
covers both — but "the unit suite" undersells what the half contains.

**`filterPredicate.test.ts` is no longer the file described.** The brief lists
it as "588 iterations, every assertion behind `if (predicate) continue`". On
`d670975` it kills mutations: `S1` (inverted status predicate) takes it red,
as do `S6` (dropping the note arm), `S7` (dropping the accent fold), `C1` and
`C3`. Whatever it was when the decision doc was written, it is a working test
now — the decision doc's evidence list is a historical record and should stay
as it is, but the brief reads as though the defect were current.

One thing that is right and worth confirming: **the harness caught one of my
own mutations failing to apply.** `L3` used `\\u00b7` inside a JSON string,
which decodes to a literal backslash-u rather than `·`, so the anchor matched
zero times. It was refused rather than run, re-issued correctly as `L3b`, and
killed by three tests. Reported as a `PATCH_ERROR` rather than as a survivor,
which is the whole reason the runner refuses to proceed on a failed patch.

Separately, one of my mutations was a genuine no-op and I initially recorded
it as a survivor: `C15` inserted `void 0;` ahead of the auth check without
removing it. Re-issued as `C15b` (returning an empty list instead of a 401)
and killed by two tests. It is counted as a mutation run, not as a survivor.

---

## 5. Recommended order of work

1. **§2.2** — assert 400 bodies. One file, three or four added expectations,
   closes four survivors and reinstates review m-6's guard.
2. **§2.1** — pin the two constants. Two lines.
3. **§2.3** — a refusing-focus fake. One helper, reused twice.
4. **§2.4** — junk inputs to the two parsers.
5. **§2.5** — `DELETE`'s 204, `POST`'s `note`.
6. **§2.6** — three added cases, one each.

Nothing here needs a rewrite of a file. All six are additions to tests that
already work, which is consistent with
`docs/decisions/2026-08-21-not-rewriting-the-existing-suites.md`.

## Appendix — how to re-run

The runner and the five mutation batches are in this session's scratchpad and
are not committed. The method, which is the part worth keeping: apply by exact
anchor matching **exactly once**, read the file back off disk and assert the
mutated text is present before running anything, run the full suite, restore
from a pristine pre-audit copy, and assert the restored file's SHA-256 matches
that copy. Refuse to run on any patch that did not verifiably land. Three
false "coverage gap" conclusions on this project came from skipping that last
step, and one more nearly did here.
