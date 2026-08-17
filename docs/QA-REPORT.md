# QA Report — release gate on `develop`

Gate: `develop` → `main`. Tester: QA engineer. Branch `develop` @ `083d190`
(`Merge branch 'fix/toggle-count-drift' into develop`), working tree clean.
Node 24. App driven on port 3487 against `todo_app_dev`.

Defect numbering continues from previous passes. `DEF-01`…`DEF-18` mean what
they meant before. New defects this pass start at **DEF-19**.

> This report is written incrementally as each result is established. Anything
> below is something I ran, unless it is explicitly marked inferred or
> "could not verify".

---

## 0. Verdict, up front

### **SHIP** — with one known Medium defect accepted knowingly. Full reasoning in §12.

Both suites are green at exactly the expected counts: **222 Vitest**, **56
Playwright**, no retries, no flakes. The build gate is clean.

**The drift I reported is fixed.** My own reproduction — the status-filter
change landing inside a toggle's flight window, the case the first
reload-token attempt missed — now settles in agreement with the server (§5.1).

**Cross-user isolation passes, re-proved independently** over real HTTP rather
than inherited from the suite being green (§4). This is the result I was most
concerned about getting wrong, so it was tested by a different method than the
suite uses, with the effect of every refused write checked, not just its status
code.

New this pass:

- **DEF-20 — Medium** — the residual variant the SDET flagged as unreached
  **reproduces**: a stale list load *delivered* after a toggle's response
  overwrites the correct count, and the −1 offset then persists for the rest of
  the session. Display-only; the database is right throughout; it clears on the
  next page load. **Accepted, not dismissed** — see §8 and §12.
- **DEF-19 — Low** — the production default is genuinely fixed at last, but a
  live Neon credential still sits commented-out in `.env`.
- **DEF-21 — Low (docs)** — the PRD quotes form-error copy that neither the app
  nor the copy deck uses.

Resolved since the last gate: **DEF-13**, **DEF-17**, **DEF-18**.

Two coverage gaps I want read as conditions, not footnotes: the five contrast
and tap-target defects have now gone untested for **two consecutive gates**,
and NFR-04's keyboard criterion for the Undo toast is **unverified** (§10).

---

## 1. Environment verification (the production foot-gun, third gate)

I flagged the production default at the two previous gates. This is the first
gate where `.env` is supposed to be safe by default, so I checked it before
running anything.

**`.env` active line, read directly:**

```
DATABASE_URL="postgresql://postgres@127.0.0.1:5432/todo_app_dev"
```

**Verified:**

| Check | Result |
|---|---|
| Active `DATABASE_URL` is local | **Yes** — `127.0.0.1:5432/todo_app_dev` |
| The Neon production URL is still in the file | **Yes, but commented out** (two commented lines) |
| `PROD_DATABASE_URL` read by any code | **No** — `grep -r PROD_DATABASE_URL src tests e2e` returns nothing outside `.env`'s own comment |
| `.env` gitignored | **Yes** — `.gitignore:40:.env*`; `git ls-files .env` confirms it is untracked |
| Postgres reachable | **Yes** — `pg_isready` OK |
| `todo_app_dev` exists | **Yes** |
| `todo_app_test` exists | **Yes** |

**A plain `npm run dev` now serves local data.** That is the fix I asked for at
the last two gates, and it holds. This is no longer a blocker.

**Residual, recorded not filed as new:** the live Neon connection string —
including the password `npg_rWn7lgZo5dqe` — is still present in `.env` as
commented text. It is inert (nothing reads it, the file is gitignored and
untracked), so it does not block this gate. But a commented-out credential is
still a credential sitting in a working file, and uncommenting one line is all
it takes to point `npm run dev` back at production. Rotating that credential
and deleting the lines is the durable fix. Recorded as **DEF-19 (Low)** in §8.

---

## 2. The existing suites (task 1) — **both green at the expected counts**

### 2.1 Vitest — **222 passed / 222**

Command actually run:

```
TZ=Pacific/Kiritimati \
TEST_DATABASE_URL=postgresql://postgres@127.0.0.1:5432/todo_app_test \
npx vitest run
```

| | |
|---|---|
| Result | **222 passed (222)**, 9 files passed (9) |
| Duration | **3.34s** (transform 134ms, import 2.12s, tests 679ms) |
| Exit code | 0 |

Matches the expected 222 exactly. No skips, no todos, no unhandled rejections.

One non-fatal Vite notice, unchanged from previous gates and not a test result:
`configLoader: 'native'` warns that `vitest.config.ts` and
`tests/setup/testDatabaseUrl.ts` use ESM syntax in a file loaded as CommonJS.
Cosmetic; does not affect the run.

### 2.2 Playwright — **56 passed / 56**

Command actually run:

```
TEST_DATABASE_URL=postgresql://postgres@127.0.0.1:5432/todo_app_test \
npx playwright test
```

| | |
|---|---|
| Result | **56 passed (1.8m)** |
| Exit code | 0 |
| Projects | `chromium-desktop` (1280×800) and `chromium-mobile` (Pixel 7) |
| Retries | 0 — the config sets `retries: 0`, so nothing passed on a second attempt |

Matches the expected 56 exactly. No flakes, no skips, no `test.only`.

The two new specs in `e2e/mid-flight-reload.spec.ts` both pass in both projects:

- `the counter still agrees with the server after a filter change interrupts a toggle`
- `the counter survives a token-driven reload interrupting a toggle`

These are the specs that failed against the first (reload-token) fix with
`Expected: "1 of 3 done", Received: "0 of 3 done"`. They are green against the
landed-loads fix.

**Both suites green.** Nothing red blocks this gate.

> Note on what green means here: the isolation suite calls the route handlers
> **in-process**, with `next/headers` mocked. That is a good test of the
> handlers' `where` clauses and a poor test of everything in front of them.
> §4 re-proves isolation over the wire for that reason.

**Recorded, not filed:** `e2e/support/fixtures.ts` still carries a stale comment
claiming "the suite runs against the real Neon instance". It does not —
`playwright.config.ts` overrides `DATABASE_URL` with `resolveTestDatabaseUrl`,
which refuses hosted hosts outright. The comment describes a danger the config
has since removed, and a reader trusting it would draw the wrong conclusion
about where this suite writes. Documentation only; folded into DEF-19's note.

---
## 3. Test accounts used this pass

All created through the real `POST /api/auth/sign-up/email` on port 3487
against `todo_app_dev`. Password for all: `qa-gate-password-1`.

| Account | Role in this pass |
|---|---|
| `qa-iso-a-1786938622@qagate.test` | User **A** — the victim in the isolation matrix (§4) |
| `qa-iso-b-1786938622@qagate.test` | User **B** — the attacker in the isolation matrix (§4) |
| `qa-story-1786938622@qagate.test` | US-01 / US-05 server-side validation probes (§6.1, §6.5) |
| `qa-drift-1786938869644@qagate.test` | Drift V1 (my original sequence) + variants V3/V4 (§5.1, §5.3, §5.4) |
| `qa-drift2-1786938945756@qagate.test` | **DEF-20** reproduction — stale `GET` delivered late (§5.2) |
| `qa-drift3-1786938978613@qagate.test` | **DEF-20** persistence across later toggles (§5.2) |
| `qa-story2-1786939170344@qagate.test` | US-06…US-11 browser walkthrough (§6) |
| `qa-flat-1786939180530@qagate.test` | US-06 single-section rule, both directions (§6.6) |
| `qa-order-1786939279712@qagate.test` | US-06 default-order and priority tie-break checks (§6.6) |
| `qa-signout2-1786939342820@qagate.test` | US-03 sign-out and Back-button with real history (§6.3) |
| `qa-signout-1786939308137@qagate.test` | US-03 first attempt — inconclusive Back test, superseded above |
| `qa-dom-*@qagate.test` | throwaway, used only to inspect row DOM structure |
| `short-*@qagate.test`, `nobody-*@qagate.test` | never created — the rejected sign-up / sign-in probes (§6.1, §6.2) |

User ids resolved from `GET /api/auth/get-session`:
A = `jXlgWpdZxr3TPIV15wy75UM1IM9tI4NL`, B = `e86U83QZnbik6z0eFXgXpmzB3tqOYIo0`.

All accounts remain in `todo_app_dev`; none were cleaned up, so every
reproduction above can be re-walked as-is.

---

## 4. Cross-user isolation baseline (task 3) — **Pass**

**My method, deliberately different from the suite's.** `tests/api/isolation.test.ts`
imports the route handlers and calls them as functions with a mocked
`next/headers`. That never exercises Next's routing, the proxy, cookie parsing,
or better-auth's real session lookup. I drove **real HTTP with real cookie
jars** against the running dev server instead, so the whole request path is in
scope, and I checked the **effect** of every refused write, not just its status
code.

Two accounts, seeded over the same endpoints the browser uses:

- A owns `A private milk` (note `A secret note text`, priority `high`) and
  `A second errand` (priority `low`).
- B owns `B own task`.

### 4.1 B reaches for A's todo

| Request as B | Status | Body | A's row after |
|---|---|---|---|
| `PATCH /api/todos/{A}` → `{"title":"HACKED BY B",…}` | **404** | `{"code":"NOT_FOUND","message":"That todo no longer exists."}` | unchanged |
| `PATCH /api/todos/{A}/status` → `{"completed":true}` | **404** | identical | still `completed:false` |
| `DELETE /api/todos/{A}` | **404** | identical | still present |
| `GET /api/todos/{A}` | **405** | empty | n/a — route does not exist (DEF-04) |

### 4.2 A foreign id is indistinguishable from a nonexistent one

The same three calls against `totally-made-up-id-xyz` returned **404 with a
byte-identical body** in all three cases. Nothing in the status, the code, or
the message tells B whether a todo exists that isn't theirs. NFR-01 satisfied.

### 4.3 Search and filters — the leak paths that are easiest to regress

B searched for A's content directly:

| B's query | Rows returned |
|---|---|
| `query=A private milk` (A's exact title) | `[]` |
| `query=a PRIVATE MILK` (case-insensitive) | `[]` |
| `query=secret note` (text from A's **note**) | `[]` |
| `query=milk` (substring) | `[]` |
| `query=own` — **control** | `['B own task']` |

The control matters: without it, an endpoint silently returning nothing would
have passed every row above and proved nothing.

Filter combinations `priority=high` (matching A's row, not B's),
`status=completed`, and `status=active&priority=low` each returned `[]` for B
with `totalCount: 1` — B's own account total, never A's.

### 4.4 Ownership comes from the session, not the body

B posted a todo with `"userId": "<A's id>"` in the body. The todo was created
**201** and filed under **B**: it appears in B's list (`Filed by B onto A`) and
is absent from A's. Client-supplied ownership is ignored, as NFR-01 requires.

### 4.5 Signed out, and with a forged cookie

| Request, no cookie | Status |
|---|---|
| `GET /api/todos` | **401** `UNAUTHORIZED` |
| `POST /api/todos` | **401** |
| `PATCH /api/todos/{A}` | **401** |
| `PATCH /api/todos/{A}/status` | **401** |
| `DELETE /api/todos/{A}` | **401** |
| `GET /api/todos` with `better-auth.session_token=forged.signature` | **401** |

### 4.6 The effect check — A's data after every attempt above

```json
{"todos":[
  {"title":"A private milk","note":"A secret note text","priority":"high","completed":false},
  {"title":"A second errand","note":null,"priority":"low","completed":false}],
 "totalCount":2,"completedCount":0}
```

Title, note, priority, completion and both counts are exactly as seeded.
**No refused request wrote anything.** No refusal was a 500.

### 4.7 Protected routes (US-04 / release criterion 3)

| Request, no session | Result |
|---|---|
| `GET /todos` | **307** → `/sign-in?next=%2Ftodos` |
| `GET /todos?status=active` | **307** → `/sign-in?next=%2Ftodos%3Fstatus%3Dactive` (query preserved) |
| `GET /todos/anything` | **307** → `/sign-in?next=%2Ftodos%2Fanything` |
| Body of the redirect response | **zero occurrences** of A's title — no todo data rendered |
| `GET /sign-in` / `/sign-up` **with** a session | **307** → `/todos` |

**Isolation verdict: Pass, proved independently over the wire.** This is not a
pass inherited from the suite being green.

---
## 5. The counter drift, re-run against the current code (task 2)

I found this by hand at an earlier gate and called it "worse than reported".
The code has changed twice underneath since, so everything below is re-run
against `develop` @ `083d190`, not carried forward.

Method: a real Chromium driven against port 3487, holding requests at the
network layer with route interception — a gate resolved by the script, never a
timer — and comparing the **rendered** `N of M done` against a fresh
`GET /api/todos` from the same session. UI and server are compared every time;
"agrees" below always means agrees with the server, not agrees with my
expectation.

### 5.1 My original sequence — **now correct**

Status filter `Active`, three active todos, the `PATCH` held before it reaches
the server, a status-filter change driven into the window, then released:

| Step | Rendered counter |
|---|---|
| initial | `0 of 3 done` |
| after the optimistic flip (row correctly gone from `Active`) | `1 of 3 done` |
| after the filter change, `PATCH` still held | `0 of 3 done` — the server's pre-write count |
| **settled, after release** | **`1 of 3 done`** — server: `1 of 3 done` ✅ |

**Confirmed fixed.** This is the sequence I reported, and the landed-loads
guard closes it. The filter-change trigger — the one the reload-token fix
missed — is genuinely covered now, because `landedLoadsRef` is incremented at
the line that replaces `result` rather than by whichever caller remembered to
bump a token.

### 5.2 Residual variant A — a stale `GET` landing **after** the `PATCH` response — **STILL PRESENT**

This is the variant judged "narrow, predating both fixes, and cured properly
only by a monotonic stamp on loads". **It reproduces.** Filed as **DEF-20**.

The guard compares `landedLoadsRef.current` against its value at the press,
and it makes that comparison *once*, synchronously, immediately after
`await toggleTodo(...)` resolves. A load that lands one tick **later** is
outside the comparison entirely — it is not a load that interrupted the
toggle, it is a load that arrives after the toggle stopped watching.

Reproduction (exact, and it is a sequence a user can perform):

1. `/todos`, no filter, four active todos — `0 of 4 done`.
2. Delete an unrelated todo. That calls `reloadSilently()`, which bumps the
   reload token and issues a `GET` **without** a skeleton, so the other rows
   stay on screen and remain clickable. The `GET` is answered by the server at
   this moment: `{"totalCount":3,"completedCount":0}`.
3. Its **response is held** — the request already reached the server and was
   answered; only delivery is delayed.
4. Tick a different todo. The `PATCH` commits; the server now holds
   `1 of 3`. `landedLoadsRef` has **not** moved (nothing landed), so the guard
   takes the splice branch. Counter reads **`1 of 3 done` — correct.**
5. Release the held `GET`. It carries `completedCount: 0`, computed before the
   write committed. `setResult` replaces state wholesale and
   `landedLoadsRef` increments — too late for anyone to read it.

| | |
|---|---|
| after the `PATCH` settled, `GET` still held | `1 of 3 done` (server: `1 of 3`) ✅ |
| **after the stale `GET` was delivered** | **`0 of 3 done`** (server: `1 of 3`) ❌ |

**And it does not self-heal.** Continuing to use the app without reloading:

| Action | Rendered | Server | |
|---|---|---|---|
| drift established | `0 of 3 done` | `1 of 3 done` | off by one |
| toggle a second todo | `1 of 3 done` | `2 of 3 done` | still off by one |
| toggle a third todo | `2 of 3 done` | `3 of 3 done` | still off by one |

The −1 offset is carried forward indefinitely, because since m-7 no toggle
refetches. It clears only on the next **landed** load — a page reload, a filter
change, or the next delete — and a fresh page load did restore `1 of 3 done`.

**Criterion violated** — `docs/PRD.md` US-07, "acceptance criteria — the flip":

> Given the counts beside the page heading (`N of M done`), When a toggle
> applies and again when it reverts, Then N moves by exactly one and M does not
> move.

What actually happened: N moved by exactly one, and was then **moved back** by
a load that predated the write. The header reported one fewer completed todo
than the account holds, for the rest of the session.

Note what this is *not*: no write is lost, no data is corrupted, nothing
crosses a user boundary. The database is right throughout; only the header
lies. See §8 for severity and why I do not treat it as a blocker.

### 5.3 Residual variant B — `totalCount` after a delete — **correct, no defect**

`removeTodoLocally` decrements `totalCount` by hand, then `reloadSilently()`
refetches. Both halves checked separately:

| | Rendered | Server |
|---|---|---|
| before delete | `2 of 3 done` | `2 of 3 done` |
| immediately after confirm — **hand arithmetic only**, before the refetch | `2 of 2 done` | — |
| settled, after the refetch landed | `2 of 2 done` | `2 of 2 done` ✅ |

The hand-decrement is correct **on its own**, so the refetch is confirming it
rather than repairing it. That matters: were the refetch to fail, the counter
would still be right.

### 5.4 Residual variant C — `totalCount` after a create, then Undo of that create — **correct, no defect**

| | Rendered | Server |
|---|---|---|
| before create | `2 of 2 done` | `2 of 2 done` |
| after create | `2 of 3 done` | `2 of 3 done` ✅ |
| immediately after Undo — hand arithmetic only | `2 of 2 done` | — |
| settled | `2 of 2 done` | `2 of 2 done` ✅ |

Again correct before the refetch as well as after.

**On "asserted by no end-to-end test":** that is still true. §5.3 and §5.4 pass,
but they pass unwitnessed — nothing in `e2e/` pins either, so a future change to
`removeTodoLocally` would break them silently. I am not filing that as a defect
(the behaviour is correct today); I am recording it as the thinnest remaining
spot in the suite, and it is the same class of gap that let the original drift
through: 19 Vitest cases asserted the pure state and every one of them stayed
green while the caller misused them.

---
## 6. User stories US-01 → US-11 (task 4)

Walked against the **amended** PRD. US-07's and US-10's filter criteria are
called out in detail because they are the ones the recent work touched.

| Story | Verdict |
|---|---|
| US-01 — Sign up | **Pass** |
| US-02 — Sign in | **Pass** — DEF-17 resolved by the PRD amendment; copy now matches |
| US-03 — Sign out | **Pass** — DEF-13 still fixed |
| US-04 — Protected routes | **Pass** — see §4.7 |
| US-05 — Create a todo | **Partial** — behaviour correct; inline error copy diverges from the PRD (**DEF-21**) |
| US-06 — List todos | **Pass** |
| US-07 — Toggle complete/incomplete | **Partial** — every criterion passes except the counter under the §5.2 interleaving (**DEF-20**) |
| US-08 — Edit a todo | **Partial** — same copy divergence as US-05 (**DEF-21**) |
| US-09 — Delete with confirmation | **Pass** |
| US-10 — Filter by status and priority | **Pass** |
| US-11 — Empty state | **Pass** |
| US-12 — Dated list header | **Not built by design** — not tested (PRD §3 says "Not yet built") |

### 6.1 US-01 — Sign up — **Pass**

Server-side, against `POST /api/auth/sign-up/email`:

| Input | Result |
|---|---|
| password of 7 characters | **400** `PASSWORD_TOO_SHORT` — no account created |
| `not-an-email` (no `@`) | **400** `VALIDATION_ERROR` — `[body.email] Invalid email address` |
| valid name/email/8+ password | **200**, session issued, lands on `/todos` |
| the same email a second time | **422** `USER_ALREADY_EXISTS_USE_ANOTHER_EMAIL` — no second account |

NFR-03's server-side half is real: the short password is rejected by the
server, not only by the client. Last criterion checked directly —
`emailVerified` is `false` on the new account and `GET /api/todos` still
returns **200** for that user, so verification is genuinely not required.

### 6.2 US-02 — Sign in — **Pass** (DEF-17 closed)

The criterion that matters is the indistinguishability one, and it holds at
**both** layers:

- **Server:** wrong password → `{"message":"Invalid email or password","code":"INVALID_EMAIL_OR_PASSWORD"}` `401`.
  Nonexistent email → **byte-identical** body and status. I compared the two
  captured strings, not my reading of them.
- **Client:** `SignInForm.tsx` funnels both branches through one constant
  (`INVALID_CREDENTIALS_MESSAGE`), so one string is structurally impossible to
  diverge per-branch.

**DEF-17 is resolved.** The PRD was amended to quote the copy deck's string,
and the implementation matches it exactly — I byte-compared the apostrophe,
which is the part the criterion calls out: `SignInForm.tsx` line 26 contains
`e2 80 99` (U+2019) in `don’t`, as US-02 requires.

One residual, doc-only: `docs/DESIGN.md` line 1065 — the copy deck US-02 points
at — still spells it with an **ASCII apostrophe** (`0x27`): `don't`. The PRD
demands U+2019 and the code has U+2019, so the deck is now the odd one out.
Folded into **DEF-21**, since it is the same class of problem.

### 6.3 US-03 — Sign out — **Pass**

Account menu shows the signed-in identity and a `Sign out` item. On activation
the session is destroyed, the session cookie is cleared (checked in the browser
cookie jar, not inferred), and the browser lands on `/sign-in`.

The Back-button criterion — the old DEF-13 — needed real history to test at
all, because sign-out uses `replace`. With genuine `/todos` entries in the
stack:

| Step | Result |
|---|---|
| history `/todos?status=all` → `/todos?status=active`, then sign out | at `/sign-in` |
| browser **Back** | `/sign-in?next=%2Ftodos%3Fstatus%3Dall` — redirected, original path preserved |
| page body | **no todo data rendered** |
| a **second** Back | still `/sign-in`, still no todo data |

**DEF-13 remains fixed.**

### 6.4 US-04 — Protected routes — **Pass**

Covered in §4.5 and §4.7: every mutation endpoint is `401` with no session and
writes nothing; `/todos`, `/todos?status=active` and `/todos/anything` all
`307` to `/sign-in` with the requested path preserved; the redirect body
carries zero todo data; a signed-in user hitting `/sign-in` or `/sign-up` is
sent to `/todos`.

### 6.5 US-05 — Create a todo — **Partial (DEF-21, copy only)**

Behaviour is correct throughout, and the boundaries are right rather than
off-by-one:

| Input | Result |
|---|---|
| empty title | **400**, `fieldErrors.title` — nothing created |
| whitespace-only title | **400** — trimmed before the length check |
| 201-character title | **400** |
| **200-character title** | **201** — the boundary is inclusive, as §2 says |
| 2001-character note | **400**, `fieldErrors.note` |
| `completed` in the create body | **400** — "Completion is changed by the checkbox, not by saving the todo." |
| `dueAt: "2026-02-31"` | **400** — strict parsing, not rolled over into March |

Placement under the default order is correct and matches the **amended**
criterion (§6.6 proves the ordering directly). **DEF-18 is resolved**: the
criterion now spells out that the new todo is "not necessarily the first row of
the section", which is what the app actually does.

The divergence is the wording — see **DEF-21**.

### 6.6 US-06 — List todos — **Pass**

**Order.** Four todos due −3d / today / +7d / undated rendered as:

```
["Overdue one", "Due today one", "Upcoming one", "Undated one"]
```

undated last. Adding two todos due the same day, one `low` and one `high`:

```
["Overdue one","Due today one","Same day HIGH","Same day LOW","Upcoming one","Undated one"]
```

- `high` before `low` on the same date — **Pass**
- `Due today one` (medium, today) before `Same day HIGH` (high, +3d) — **Pass**,
  priority never lifts a todo above an earlier due date

Completing the overdue todo moved it to the very end:

```
["Due today one","Same day HIGH","Same day LOW","Upcoming one","Undated one","Overdue one"]
```

so a completed past-due todo sits under `Completed` and does **not** rejoin
`Overdue`.

**Sections.** Headings render exactly `Overdue`, `Today`, `Upcoming`, `No date`
and, once something is complete, `Completed` — in that order, with **no heading
for an empty section**.

**The single-section rule, both directions** (fresh account):

| State | Headings rendered |
|---|---|
| two todos, both undated | `[]` — **no heading at all**, one flat list |
| add one dated todo | `["Upcoming","No date"]` — headings appear over both |

**Accessibility.** The section headings are `h2` (queried by
`getByRole("heading", { level: 2 })`, which is what the criterion asks for), and
`main` contains one list container per section — four sections, four lists — so
each section is counted separately by assistive technology rather than reported
as one run spanning sections.

### 6.7 US-07 — Toggle — **Partial (DEF-20)**

**The flip.** Optimistic: the row shows completed styling on press, before the
server answers. Only `completed` changes. Counts move by exactly one on the
first number, and the second number does not move (`1 of 4` → `2 of 4` → back
to `1 of 4` on undo).

**Under a status filter (the ruling)** — this is the part the recent work
implements, and it holds:

| Criterion | Result |
|---|---|
| under `Active`, completing a row makes it leave **immediately** | **Pass** — row count 0 within 300ms, before the server answered |
| **no `Completed` heading appears under `Active` at any point** | **Pass** — I polled `h2` contents every 60ms across the whole toggle and the string never appeared once |
| counts still move although the row left the page | **Pass** — `1 of 4` → `2 of 4` |
| the counter is account-wide and a filter never changes it | **Pass** — same value under `All`, `Active`, and `active&priority=high` |

The "never appears" criterion is the one worth being careful about, because a
single-frame flash would satisfy an end-state assertion and still violate it.
I sampled continuously rather than checking the end state.

**Undo after the row is gone.** The toast carried `Undo` after the row had
left; pressing it restored the todo, the **row reappeared in the list**, and
the counter returned to `1 of 4`. The re-inserted row was in its default-order
place, consistent with the refetch path.

**The one failure is the counter under the §5.2 interleaving — DEF-20.**

### 6.8 US-08 — Edit — **Partial (DEF-21, copy only)**

Edit opens pre-filled with the current title. Clearing the title and saving
makes no update and shows an inline error. A valid rename shows on the row and
survives a reload. The same length rules as US-05 apply. Scoping by
`id` + `userId` is proved in §4.1 — a foreign id is a 404 that writes nothing.

Only the error wording diverges — **DEF-21**.

### 6.9 US-09 — Delete with confirmation — **Pass**

| Criterion | Result |
|---|---|
| dialog appears naming the todo's title | **Pass** |
| Escape closes it and the todo still exists | **Pass** |
| confirming removes the row without a page reload | **Pass** |
| it stays gone after a reload | **Pass** |
| `totalCount` after the delete | **Pass** — §5.3, correct before *and* after the refetch |

### 6.10 US-10 — Filters — **Pass**

| Criterion | Result |
|---|---|
| defaults are `All` / `All priorities` | **Pass** |
| `status=active&priority=high` shows only rows that are both | **Pass** — `["High active"]` |
| filter state survives a reload (URL) | **Pass** — reload kept both params and the same single row |
| a matching-nothing combination shows "No todos match these filters" | **Pass** |
| with a control to clear the filters | **Pass** — `Clear filters` present |
| visually distinct from the US-11 empty state | **Pass** — no "Nothing here yet" in that view |
| results contain only my own todos under every filter | **Pass** — §4.3 |
| a row leaves the filtered list at the moment of the change | **Pass** — §6.7 |
| no heading for todos the filter excludes | **Pass** — under `Active`, headings were `["Today","Upcoming","No date"]`, never `Completed` |

### 6.11 US-11 — Empty state — **Pass**

On a brand-new account: heading `Nothing here yet`, the guidance line
`Add your first todo and it will show up here.`, and a `New todo` call to
action. **No filter chrome** is rendered (the status radiogroup is absent from
the DOM, not merely hidden) and **no counter** is shown, so nothing implies
missing data. The call to action opens the create form with the Title field
focused. Deleting down to zero restores it (§6.9 plus the delete run in §5.3).

---

## 7. Console and network sweep (task 5)

Collected across every browser session I drove this pass — the drift
reproductions, the story walkthrough, the order checks and the sign-out runs.

### 7.1 Console

| Message | Assessment |
|---|---|
| `A PressResponder was rendered without a pressable child. Either call the usePress hook, or wrap your DOM node with <Pressable> component.` | **DEF-02**, known and open. Confirmed present and **not re-diagnosed**. It is the only console output in any run: 12 occurrences in the story walkthrough, 6 in the drift run — **1 unique message**, every time |

**No React key warnings, no hydration mismatches, no unhandled promise
rejections, no `pageerror` of any kind.** Apart from DEF-02 the console is
clean. The same warning appears in the Playwright run's `[WebServer] [browser]`
output, so it is not an artefact of my harness.

### 7.2 Network

In the normal flows — sign-up, list, create, toggle, edit, delete, undo, filter
changes, sign-out — **zero responses of status ≥ 400** were recorded. Every
`4xx` I saw this pass was one I provoked on purpose:

| Response | Why |
|---|---|
| `401` on every endpoint | the signed-out and forged-cookie probes (§4.5) |
| `404` on `PATCH`/`DELETE` | B reaching for A's rows, and the nonexistent-id controls (§4.1, §4.2) |
| `400` on create/edit/status | the validation probes (§6.1, §6.5) |
| `405` on `GET /api/todos/[id]` | DEF-04, unchanged — that route does not exist, identically for owner and stranger |
| `422` on duplicate sign-up | US-01 |

No unexpected requests, no request storms, and no N+1 pattern visible in the
server log — a list render is one `GET /api/todos`, and a toggle is one
`PATCH` with no follow-up `GET` except on the paths that are documented to
refetch.

---
## 8. Defects

### DEF-19 — **Low** — a live production credential sits commented-out in `.env`, and a stale comment misdescribes where the e2e suite writes

**Status:** new. **Does not block.**

**What is true and good:** the active `DATABASE_URL` is
`postgresql://postgres@127.0.0.1:5432/todo_app_dev`. The default is finally
safe, which is the fix I asked for at two previous gates (§1).

**What remains:** the file still contains, as comments, the full Neon
production connection string including the password `npg_rWn7lgZo5dqe` — twice.
Nothing reads it, `.env` is gitignored and untracked, and `PROD_DATABASE_URL`
is confirmed unreferenced anywhere in `src`, `tests`, `e2e` or `prisma`. So the
exposure today is a local-file exposure only.

**Why it is still worth fixing:** the distance between "safe by default" and
"pointing at production" is **uncommenting one line** — and the two previous
gates are evidence that this file drifts. A credential that has been sitting in
a working file across at least three gates should be assumed compromised.

**Recommendation:** rotate the Neon credential and delete both commented lines.
The comment explaining the history is worth keeping; the password is not.

**Secondary, same class:** `e2e/support/fixtures.ts` states "the suite runs
against the real Neon instance". It does not — `playwright.config.ts` resolves
`DATABASE_URL` through `resolveTestDatabaseUrl`, which refuses hosted hosts and
any database not named `*_test`. The comment describes a risk that has been
engineered away, and a reader trusting it would misjudge where the suite
writes.

---

### DEF-20 — **Medium** — the header counter drifts permanently when a stale list load is *delivered* after a toggle's response

**Status:** new. **Does not block** — see the severity reasoning below.
**Affects:** US-07 (Must). **No data impact: the database is correct throughout.**

This is the residual the SDET flagged as "narrow, predating both fixes, and
cured properly only by a monotonic stamp on loads". I set out to confirm or
refute it. **It reproduces.**

**Criterion violated** — `docs/PRD.md` US-07, acceptance criteria — the flip:

> Given the counts beside the page heading (`N of M done`), When a toggle
> applies and again when it reverts, Then N moves by exactly one and M does not
> move. The counts describe the whole account, not the filtered page, so a
> filter never changes them.

**What actually happened:** N moved by exactly one, correctly — and was then
moved **back** by a list load whose answer predated the write. The header then
under-reports the completed count by one for the remainder of the session.

**Exact reproduction** (fully automated in my harness; every step is something
a user can do):

1. Sign in with four active todos. Header reads `0 of 4 done`.
2. Delete an unrelated todo. This calls `reloadSilently()` — it bumps the
   reload token and issues a `GET /api/todos` **without** raising the skeleton,
   so the remaining rows stay on screen and stay clickable. The server answers
   that `GET` now, with `{"totalCount":3,"completedCount":0}`.
3. **Delay the delivery of that response** (I held it at the network layer; in
   the field this is the `GET` losing the race to the `PATCH`).
4. Tick a *different* todo. The `PATCH` commits — the database now holds
   `1 of 3`. `landedLoadsRef` has not moved, because nothing has landed, so
   `runToggle` takes the splice branch. Header reads **`1 of 3 done` —
   correct.**
5. Deliver the held `GET`. It carries `completedCount: 0`. `setResult` replaces
   state wholesale.

| Observation point | Rendered | Server |
|---|---|---|
| after the `PATCH` settled, `GET` still held | `1 of 3 done` | `1 of 3 done` ✅ |
| **after the stale `GET` was delivered** | **`0 of 3 done`** | `1 of 3 done` ❌ |
| after toggling a second todo | `1 of 3 done` | `2 of 3 done` ❌ |
| after toggling a third todo | `2 of 3 done` | `3 of 3 done` ❌ |
| after a fresh page load | `1 of 3 done` | `1 of 3 done` ✅ (heals) |

**Root cause, precisely.** `TodoListScreen.runToggle` reads
`landedLoadsRef.current` at the press and compares it **once**, synchronously,
immediately after `await toggleTodo(...)` resolves:

```ts
if (landedLoadsRef.current === landedLoadsAtPress) {
  setResult((current) => replaceTodo(current, saved));
} else {
  reloadSilently();
}
```

That detects a load which lands *inside* the flight window. It cannot detect a
load which lands *after* it, because by then the toggle has stopped looking —
and such a load may still be carrying an answer computed **before** the write
committed. The counter is a count, not a value, so a wholesale replacement from
a stale snapshot is silently wrong rather than visibly stale.

**Why the fix so far does not cover it.** The landed-loads counter is a strict
improvement over the reload token — it correctly covers the filter-change
trigger that the token missed, and my original reproduction is genuinely fixed
(§5.1). But both are *ordering* signals with no notion of **when the server's
answer was computed**. The proper cure is the one already identified: stamp
each load with a monotonic marker taken when the request is issued, and have
`setResult` refuse to apply a load whose stamp predates the most recent
committed local write.

**Why Medium and not Major, and why it does not block:**

- **No data is wrong.** Every write commits correctly; isolation is untouched;
  nothing is lost. Only the header's rendered count is wrong.
- **It self-heals** on the next landed load — a reload, a filter change, or the
  next delete.
- **The trigger is narrow.** It needs a silent reload in flight *and* a toggle
  landing inside it *and* the `GET` response to lose the race to the `PATCH`.
  On local latency that window is single-digit milliseconds; I had to hold the
  response open deliberately to hit it reliably.

**Why not Low:** within a session it is **persistent, not transient**, and it
degrades silently — the number stays plausible, so a user has no cue that it is
wrong. That is worse than an obviously broken display.

---

### DEF-21 — **Low (documentation)** — the PRD quotes form-error copy that neither the app nor the copy deck uses

**Status:** new. **Does not block.** **The application behaviour is correct**;
this is a wording divergence, and the PRD is very likely the document that is
wrong — the same shape as DEF-17, which was closed by amending the PRD.

**Criteria affected** — `docs/PRD.md` US-05 and US-08:

> "Then no todo is created and I see the inline error **"Title is required"**."
> "…the inline error **"Title must be 200 characters or fewer"**."
> "…the inline error **"Note must be 2000 characters or fewer"**."

**Actual, from the running server and rendered inline in the form:**

| PRD says | App and `docs/DESIGN.md` say |
|---|---|
| `Title is required` | `Enter a title.` |
| `Title must be 200 characters or fewer` | `Keep the title under 200 characters.` |
| `Note must be 2000 characters or fewer` | `Keep the note under 2000 characters.` |

`docs/DESIGN.md` lines 1019, 1020 and 1129 specify exactly the implemented
strings, so the app matches its copy deck and both disagree with the PRD.

**Plus the US-02 apostrophe residual** (§6.2): the PRD requires U+2019 in
`don’t` and the code has it, but `docs/DESIGN.md` line 1065 — the deck the PRD
points at — still uses ASCII `0x27`. Byte-verified both.

**One substantive nit inside the copy itself:** "Keep the title under 200
characters" is inaccurate. A 200-character title is **accepted** (I checked the
boundary: 200 → `201 Created`, 201 → `400`). "Under 200" describes a limit of
199. `docs/DESIGN.md`'s own note says the message is built from the constant so
it cannot drift — but the preposition is wrong regardless of the number.

**Recommendation:** amend US-05 and US-08 to quote the copy deck; fix the deck's
apostrophe at line 1065; and reword the length messages to "200 characters or
fewer" so they describe the boundary the code actually enforces.

---

### Previously-known defects — status this pass

| Defect | Status |
|---|---|
| **DEF-13** (Back button after sign-out) | **Still fixed** — re-tested properly with real history (§6.3) |
| **DEF-17** (sign-in copy vs US-02) | **Resolved.** PRD amended to quote the deck; code byte-matches including U+2019 (§6.2). Deck residual folded into DEF-21 |
| **DEF-18** (US-05 criterion self-contradictory) | **Resolved.** The amended criterion now states the row is "not necessarily the first row of the section"; app behaviour matches (§6.5, §6.6) |
| **DEF-02** (`PressResponder` warning) | **Still open — confirmed present, not re-diagnosed.** The only console message in any run this pass (§7.1) |
| **DEF-04** (`GET /api/todos/[id]` is a 405) | **Unchanged, informational** — re-observed, and **identical for owner and stranger** (§4.1), so it leaks nothing |
| **DEF-11** (deleted row stays live until refetch) | **Still fixed** — row disappears on confirm (§6.9) |
| **DEF-12** (pending guard on rapid toggles) | **Not re-tested directly** — the e2e "Undo twice sends exactly one request" covers it and passed |
| **DEF-01** (44×44 touch target) | **Not re-measured this pass** — see §10 |
| **DEF-08** (dark-mode checkbox contrast) | **Not re-tested this pass** — see §10 |
| **DEF-14** (primary button contrast) | **Not re-tested this pass** — see §10 |
| **DEF-15** (muted count contrast) | **Not re-tested this pass** — see §10 |
| **DEF-16** (search clear button 20×20 at mobile) | **Not re-tested this pass** — see §10 |

---

## 9. Build quality gate (NFR-10 / release criterion 4) — **Pass**

| Command | Result |
|---|---|
| `npx tsc --noEmit` | **clean**, exit 0 |
| `npm run lint` | **clean**, exit 0 — no warnings, no errors |
| `npm run build` | **succeeded** — `prisma generate` + `next build`, 8/8 static pages, all 10 routes emitted |

**NFR-07 — no secrets in the client bundle — checked directly** against the
freshly built `.next/static/`:

| Searched for | Occurrences |
|---|---|
| the Neon password `npg_rWn7lgZo5dqe` | **0** |
| `BETTER_AUTH_SECRET`'s value | **0** |
| `todo_app_dev` / `neondb_owner` / `postgresql://` | **0** |

No client component (`"use client"`) imports `generated/prisma`, `@/lib/prisma`,
`@/lib/auth` or `@/lib/session`. The only `NEXT_PUBLIC_*` strings in the bundle
are variable *names* read by Next and Vercel tooling, carrying no values.

---

## 10. What I did **not** test — stated plainly

A pass is only worth what its coverage is, so these are gaps, not omissions I
am hoping go unnoticed.

- **Visual contrast and tap targets (DEF-01, DEF-08, DEF-14, DEF-15, DEF-16).**
  **Not measured this pass.** No contrast sampling and no mobile-viewport
  inspection. **Their status is unknown, not fixed.** They have now gone
  untested for two consecutive gates, which is itself worth a decision.
- **Dark mode (NFR-06).** Not exercised. No theme switch, no flash-of-wrong-
  theme check.
- **Keyboard-only operation (NFR-04).** Only partially: I confirmed the create
  form takes focus on its Title field and that Escape closes and cancels the
  delete dialog. I did **not** walk the full tab order, verify focus return to
  the triggering control after every dialog, or check that the Undo toast is
  reachable by keyboard from where focus lands after a row is removed — the
  last of these is an explicit US-07 criterion and is **unverified**.
- **Responsive layout at 320px (NFR-05).** Not checked at all this pass. The
  Playwright suite's `chromium-mobile` project (Pixel 7, 412px) passed, which
  is evidence for 412px and none at all for 320px.
- **Text search beyond isolation.** I proved search cannot cross accounts
  (§4.3). I did not test its own behaviour — no-match copy, URL persistence of
  `query`, or combination with the other filters.
- **US-12 (dated list header).** Not built, by the PRD's own statement. Not
  tested.
- **The 200-todo performance figure in NFR-09.** Not measured. I observed no
  N+1 pattern in the server log, which is weaker evidence than a measurement.
- **The `PATCH`-fails revert path.** The e2e fault-injection spec covers it and
  passed; I did not reproduce it by hand.

---

## 11. Environment notes

- Both suites and every manual probe ran on Node 24 via `nvm use 24`.
- Vitest ran against `todo_app_test` with `TZ=Pacific/Kiritimati`; Playwright
  against `todo_app_test` on its own dev server (port 3117); all of my manual
  work against `todo_app_dev` on port 3487.
- I started the port-3487 dev server myself and stopped it myself before
  running `npm run build`. **No process I did not start was signalled, and no
  broad `pkill` was used.**
- The working tree carries exactly one modification: `docs/QA-REPORT.md`.
  Confirmed with `git status --porcelain`. No branch was switched, nothing was
  committed.
- Test accounts were left in `todo_app_dev` rather than cleaned up, so the
  reproductions above can be re-walked. They are listed in §3 and in §5.

---

## 12. Ship / do not ship

### **SHIP.**

Against `docs/PRD.md` §7, Release criteria for v1:

| # | Criterion | Met |
|---|---|---|
| 1 | All **Must** stories pass their acceptance criteria | **Yes, with one qualification** — US-07's counter criterion fails under the DEF-20 interleaving. Every other Must criterion passes |
| 2 | A test proves User A cannot read, edit, toggle or delete User B's todo via a direct request | **Yes** — the suite proves it in-process, and I re-proved it independently over real HTTP with effect checks (§4) |
| 3 | Unauthenticated access to every protected route redirects to `/sign-in` | **Yes** — server-side and client-side, with the requested path preserved (§4.7, §6.3) |
| 4 | The build quality gate (NFR-10) is green | **Yes** — `tsc`, `lint` and `build` all clean (§9) |

**The reasoning, in full.**

Both suites are green at exactly the expected counts — **222 Vitest**, **56
Playwright** — with no retries and no flakes. The defect this gate was
convened around is **fixed**: my own reproduction, the one the first
reload-token attempt missed, now settles in agreement with the server, and the
two new specs that failed against that attempt pass against this one.

Cross-user isolation — the thing I said was the worst possible false pass — I
re-proved from scratch by a different method than the suite uses, over real
HTTP, checking the effect of every refusal and not just its status code. B
cannot read, search, edit, toggle or delete A's data; a foreign id is
byte-identical to a nonexistent one; a spoofed `userId` is ignored; signed-out
and forged-cookie requests are refused and write nothing; and A's row was
unchanged in every field after every attempt. **That is a real pass, not an
inherited one.**

**DEF-20 is real and I am not shipping it silently — I am shipping it
knowingly.** It is a display-only defect: no write is lost, no data is
corrupted, nothing crosses a user boundary, and it clears on the next page load
or filter change. Its trigger requires a silent reload in flight, a toggle
inside that window, and the `GET` losing the race to the `PATCH` — I had to
hold a response open deliberately to hit it. Set against that, blocking a
release that fixes a **reproducible, user-facing counter bug** in order to also
fix a rarer variant of the same bug would make the product worse this week, not
better. The fix that landed is a strict improvement and does not regress
anything I tested.

What I will not do is let it be recorded as closed. The proper cure — a
monotonic stamp on loads — is already understood, and DEF-20 should be the
next change on this file rather than a note that decays. **The third attempt at
this guard should be the last one.**

DEF-19 and DEF-21 are a credential-hygiene task and a documentation
reconciliation. Neither touches behaviour.

**Two things I want on the record as conditions of this ship, not as
afterthoughts:**

1. **The contrast and tap-target defects (DEF-01, DEF-08, DEF-14, DEF-15,
   DEF-16) have now gone untested for two consecutive gates.** I am not
   claiming they are fixed and I am not claiming they are broken — I do not
   know. Five accessibility defects drifting out of sight across successive
   releases is how a product ends up inaccessible by accumulation. The next
   gate should either re-test them or formally accept them.
2. **NFR-04's keyboard criterion for the Undo toast is unverified** (§10). The
   PRD requires the toast to be "reachable by keyboard from where focus landed
   after the row was removed", and since the US-07 ruling makes the toast the
   *only* route back from a toggle under a filter, that path being
   keyboard-unreachable would be a genuine accessibility failure. It is
   untested, not passed.

**Recommendation: merge `develop` to `main` and deploy**, with DEF-20 filed as
the next scheduled change and the two conditions above carried into the next
gate as explicit scope.

---

*Report written incrementally during the pass; every result above was observed,
and the places where I inferred rather than observed are marked as such.*

---
---

# Accessibility audit — 2026-08-17

**Not a release gate.** This is the bounded re-test I asked for as a condition
of the last ship: the five contrast and tap-target defects that had gone two
gates without measurement, plus NFR-04's Undo criterion, plus the surfaces
added in the last two releases that nobody had ever measured. **No story walk,
no isolation run, no suite run** — those were done at the gate above and
nothing since has touched them.

## A0. What was actually measured, and on which tree

This matters more than usual, so it goes first.

The checkout was **not on `develop`**. It was on `feature/quick-add`, and it
moved **three times underneath me** during the audit:

| Observed | HEAD | State |
|---|---|---|
| audit start | `5c2cd9d` | identical to `develop` |
| during harness build | `5255f36` | develop + 2 commits, quick-add bar present |
| after phase 1–4 | `f6c44fb` | branch **force-reset**; quick-add gone from the tree entirely, replaced by a `useTodoList` extraction |
| at write-up | `f6c44fb` | quick-add **re-staged** in the index (`git status` shows the developer's staged work again); measurements were already complete |

`develop` itself never moved — it is still `5c2cd9d`. I did not switch
branches, commit, or touch anything but this file; the movement is the
developer's, and the working tree was clean at every observation.

**Why the numbers below are still `develop`'s numbers.** Every file carrying a
surface I measured is **byte-identical to `develop`** — verified with
`git diff develop HEAD -- <file>` returning zero lines, at both the quick-add
HEAD and the reset HEAD:

`TodoRow.tsx`, `TodoDueDate.tsx`, `TodoGroupedList.tsx`, `TodoFilters.tsx`,
`TodosHeader.tsx`, `PriorityChip.tsx`, `globals.css`, `layout.tsx`,
`sign-up/page.tsx`.

The only audited file that ever differed was `TodoListScreen.tsx`, which
carries the toast — so §A5 records exactly how that affects the NFR-04 result.

**And I re-ran everything after the reset.** Phases 1–3 were executed twice,
once on each tree. **Every contrast and tap-target figure reproduced to the
last decimal place.** Where a figure below could only have come from the
quick-add tree it is marked as such and corroborated from a develop-identical
surface.

## A1. Method

Two independent measurements of every colour result, because one of them is a
model and models are how I produced a wrong number last time by treating a
12%-alpha layer as opaque.

1. **Analytic.** `getComputedStyle`, the full ancestor stack composited root
   downwards. Colours resolved by painting them into a 1×1 canvas and reading
   the pixel back, so `color-mix()`, `lab()` and `oklab()` become real sRGB
   rather than strings I parse by hand. Alpha composited per layer; `opacity`
   handled as a **group** multiplier, not as a per-layer alpha.
2. **Empirical.** Real screenshots at `deviceScaleFactor: 1` (so 1 CSS px = 1
   image px), decoded to raw RGB. Background = modal pixel of the element's
   box; foreground = the pixel furthest in luminance from it, which with the
   app's grayscale `antialiased` rendering is a fully-covered glyph stem, not
   an AA blend.

**The two agreed to 2 d.p. on every shared target.** That is the cross-check.

**Three hand-checks**, done on paper against the harness:

- Muted `rgb(113,113,122)` at 60% over white → `169.8,169.8,175.2`; relative
  luminance `0.9278 × 0.40098 + 0.0722 × 0.42981 = 0.4031`;
  `1.05 / 0.4531 = ` **2.32**. Harness: 2.3178. ✅
- Foreground `rgb(24,24,27)` at 60% over white → `116.4,116.4,118.2`;
  L = 0.1764; `1.05 / 0.2264 = ` **4.64**. Harness: 4.6385. ✅
- Screenshot ground truth for the same pending row: glyph core `[169,169,175]`
  on `[255,255,255]` → **2.34** (integer-rounded pixels vs the model's
  unrounded 2.32). ✅

**Sanity check on the opacity model:** the row action buttons are `lg:opacity-0`
at desktop, and the harness reports their painted colour as *exactly* the
backdrop and their ratio as 1.00 — which is what a correct group-opacity
implementation must do at `opacity: 0`. At mobile, where they are opaque, the
same buttons report 17.72. The model behaves correctly at both ends.

**Thresholds used** — from `docs/PRD.md`, not invented here:

| Judged against | Source |
|---|---|
| **4.5:1** body text | NFR-06; WCAG 2.2 SC 1.4.3. Nothing measured qualifies as large text (needs ≥24px, or ≥18.66px bold) |
| **3:1** control boundary | WCAG 2.2 SC 1.4.11, the standard the checkbox fix itself cites |
| **44×44** tap target | NFR-05, "Primary tap targets are at least 44x44px" |
| **24×24** tap target | WCAG 2.2 SC 2.5.8 (AA) — the floor below the project's own stricter bar |

Environment: Node 24, `todo_app_dev`, my own `next dev` on port 3489, which I
started myself. **No broad `pkill`; no process I did not start was signalled.**
Fixture accounts `qa-a11y-*@qagate.test` created through the app's own sign-up,
left in place so every measurement can be re-walked.

## A2. The five untested defects — current status

| Defect | Verdict | Measured | Threshold |
|---|---|---|---|
| **DEF-01** checkbox tap target | **Fixed** | 44×44 mobile / 36×36 desktop, all 5 hit points land | 44×44 (NFR-05) |
| **DEF-08** checkbox contrast | **Fixed — and unmoved** | 5.14:1 dark / 3.40:1 light | 3:1 |
| **DEF-14** primary button label | **Still broken** | **3.59:1** both themes | 4.5:1 |
| **DEF-15** muted count | **Still broken** | **4.43:1** light (7.72:1 dark) | 4.5:1 |
| **DEF-16** search clear button | **Still broken** | **20×20** at every width | 44×44 / 24×24 |

### DEF-01 — **Fixed.** The row rewrite did not shrink the target

The hit host is the `<label data-slot="checkbox-content">`, and its floor is
`min-h-11 min-w-11 sm:min-h-9 sm:min-w-9` — **44×44 below 640px, 36×36 above**.

`elementFromPoint` at the centre and all four corners returns an element inside
that label at **both** widths and in both themes — 20 probes, 20 hits, every
one of which drives the checkbox.

**Why the markup churn was harmless, specifically:** the 44px floor lives on
`Checkbox.Content`, not on the row. The border, the `gap-1.5` spacing that
replaced `divide-y`, and `py-3` → `py-3.5` all change the row's box; none of
them can shrink a child with its own min-size. `py-3.5` (14px) against a 44px
child is not even the binding constraint on row height.

**The 36×36 desktop figure is not a regression** — it is the deliberate `sm:`
step-down for pointer input, it clears SC 2.5.8's 24×24, and NFR-05's 44×44 is
written about phones. Recording it so nobody re-opens it as a defect later.

### DEF-08 — **Fixed, and the composite did not move**

`color-mix(in srgb, var(--foreground) 50%, transparent)`, 1px, resolving to
`color(srgb 0.094 0.094 0.106 / 0.5)` light and `… 0.988 … / 0.5` dark.

**5.14:1 dark, 3.40:1 light** — *identical to the numbers this defect was
closed with.* The concern in the brief was that the row's new border and
background relationship would move the composite. **It does not**, and the
reason is checkable: at rest the `<li>` paints **no background** — it carries a
border only — so the checkbox's backdrop is the Card surface both before and
after the change.

I also measured the **hovered** row specifically, because `docs/DESIGN.md`
flags light-mode headroom as thin (3.25:1) once `divide-y` went. **Hovered:
still 3.40:1 light / 5.14:1 dark.** `hover:bg-surface-hover` lands on the
`<li>`, but the control's own field background is opaque, so the hover colour
never reaches the surface the border is judged against.

**Row border vs Card** (the `divide-y` replacement): **1.71:1 light / 1.79:1
dark** — matching the developer's in-code claim of 1.71 / 1.78 to the decimal.
A decorative separator, not a control boundary, so SC 1.4.11's 3:1 does not
bind it. Recorded as verified-as-described, not as a defect.

### DEF-14 — **Still broken. 3.59:1, unchanged, in both themes**

`rgb(4,133,247)` with a white label at 14px/500. **3.59:1 light and dark**
against 4.5:1. 14px at weight 500 is not large text, so 4.5 is the right bar.

The "one token, every primary button" claim in the original defect **is
correct, and I confirmed it across three different buttons on three different
routes**:

| Button | Route | Ratio |
|---|---|---|
| `New todo` | `/todos` (develop's own) | 3.59:1 |
| `Create account` | `/sign-up` (file byte-identical to develop) | 3.59:1 |
| `Add` | quick-add bar, while that tree existed | 3.59:1 |

The third is from the now-deleted tree and is included only because it
corroborates the token claim; the first two are develop's and stand on their
own.

### DEF-15 — **Still broken at 4.43:1 — but the diagnosis is now precise**

`0 of 4 done`, muted `lab(47.87 …)` = `rgb(113,113,122)`, 14px/400, on page
background `rgb(245,245,245)` → **4.43:1** (analytic and screenshot agree
exactly). Dark: **7.72:1**, passes.

**The token is not the problem — the surface is.** The identical muted token
measures **4.83:1** wherever it sits on the Card (section headings, due-date
text, §A4). It fails only against the page background *outside* the Card. It is
0.07 short, on one surface.

Same token, same surface, same failure: the **`Account menu` button label**
(12px muted) — also **4.43:1** light. It travels with the count.

### DEF-16 — **Still broken. 20×20, and it is the one control below the WCAG floor**

`[data-slot="search-field-clear-button"]`, **20×20 at 375px and at 1280px**,
measured with the field non-empty and the button confirmed visible (`padding:
4px`, no min-size).

It fails NFR-05's 44×44, and — alone among everything I measured — it also
fails **WCAG 2.2 SC 2.5.8's 24×24 minimum**. Every other control in the app
clears that floor: rows' edit/delete are 36×36 desktop / 44×44 mobile, filter
toggles and the priority select are 44 at mobile.

**Secondary, same control:** its accessible name is **"Close"**, not "Clear
search" — HeroUI's default leaking through. "Close" describes dismissing
something, which is not what it does.

## A3. NFR-04 — the Undo toast by keyboard. **Verified, and it fails on any realistic list**

Previously "unverified". It is now measured, at both widths, end to end.

**First: my harness can deliver activation keys this time.** This has bitten me
before with empty `key`/`code`/`keyCode`, so I proved it before drawing any
conclusion. Recorded from a live `keydown` listener:

```
{ key: "Tab",   code: "Tab",   keyCode: 9,  which: 9,  isTrusted: true }
{ key: "Enter", code: "Enter", keyCode: 13, which: 13, isTrusted: true }
{ key: " ",     code: "Space", keyCode: 32, which: 32, isTrusted: true }
```

Fully populated and trusted. **No "could not verify" is being hidden behind a
tooling excuse here.**

### What happens

Under `?status=active`, a keyboard toggle completes the row and the row leaves
the filter — the US-07 ruling, so the toast is the only route back.

1. **Focus is dropped on the floor.** The focused checkbox is destroyed with
   its row, and `document.activeElement` becomes **`<body>`**. Measured at both
   widths. There is no focus management on removal.
2. **The toast is the last thing in the document.** `Toast.Provider` is a
   portal in `<body>` after `<main>`, so Tab must cross **every remaining row**
   to reach Undo — and each row is **3 tab stops** (checkbox, edit, delete).
3. **The toast lives 12.0s.** Measured 12,015–12,029ms across runs;
   `UNDO_WINDOW_MS = 12_000`, deliberately raised from HeroUI's 4s default.
4. **The timer pauses once Undo has focus** — still present after 16s with the
   button focused. So *reaching* it is the entire problem.

### The result depends on how many todos you have

| Account | Width | Tabs to Undo | Outcome |
|---|---|---|---|
| 3 todos | desktop | 9 | **Reached.** Enter fired the `PATCH`, row restored ✅ |
| 3 todos | mobile | 6 | **Reached.** Enter fired the `PATCH`, row restored ✅ |
| **19 todos, first row toggled** | desktop @ 300ms/tab | 39 tabs, 12.36s | **Toast expired mid-walk. Never reached** ❌ |
| **19 todos, first row toggled** | desktop @ 500ms/tab | 23 tabs, 12.21s | **Toast expired mid-walk. Never reached** ❌ |

The 3-todo pass is real but it is a *small-account* pass. The traversal cost is
`3 × (rows below the toggled row) + 3`, against a fixed 12s budget, at a pace
the user does not control. **At 19 todos it is not reachable at any human
typing speed.** 300ms per keypress is brisk; 500ms is ordinary; both lose.

**F6 works, partially.** react-aria's jump-to-toast-region hotkey moves focus
to `[data-slot="toast-region"]` (`aria-label: "2 notifications."`) in one
press, bypassing the row walk entirely — then needs **one further Tab** to land
on Undo, since it lands on the region and not the button. So there *is* a route
that beats the timer. It is undocumented, unhinted in the UI, and unknown to
essentially every user.

**Verdict: Still broken.** The PRD requires the toast to be "reachable by
keyboard from where focus landed after the row was removed". Where focus lands
is `<body>`, and from there the route is length-dependent and usually expires.
The criterion passes only on a near-empty account.

**Branch caveat, stated plainly.** `TodoListScreen.tsx` is the one audited file
that differed from `develop`. But every mechanism above lives in code that is
byte-identical to develop: the DOM order (`TodoGroupedList`, `TodoRow`), the
portal position (`layout.tsx`), the 12s constant, and the absence of focus
management. Quick-add's only effect was to add two tab stops **before** the
list — which is not between the toggled row and the toast — and the figures
above were reproduced after the branch was reset, with quick-add gone. **This
result is develop's.**

## A4. New surfaces from the last two releases

Never measured before. Analytic and screenshot agreed exactly on all of these.

| Surface | Light | Dark | Threshold | Verdict |
|---|---|---|---|---|
| Section headings (`Overdue`/`Today`/`Upcoming`/`No date`), 14px/600 muted | **4.83:1** | **6.75:1** | 4.5:1 | **Pass** |
| Due-date row text, normal | **4.83:1** | **6.75:1** | 4.5:1 | **Pass** |
| Due-date row text, **overdue** (`text-warning-soft-foreground`) | **5.72:1** | **11.74:1** | 4.5:1 | **Pass** |
| Row title at rest | 17.72:1 | 17.27:1 | 4.5:1 | **Pass** |
| **`opacity-60` pending row — completing** | **2.32:1** | **3.25:1** | 4.5:1 | **Fail** |
| `opacity-60` pending row — un-completing | 4.64:1 | 6.85:1 | 4.5:1 | Pass (light is thin) |

**The overdue treatment is not colour-alone** — it ships a `⚠` glyph plus an
`sr-only` "Overdue — " prefix alongside the colour change, which is what
NFR-04's "status is never conveyed by color alone" asks for. Confirmed in the
DOM, not assumed.

### The `opacity-60` signal defeats itself

This is the one worth acting on, and it is the case the brief predicted:
"if it drops below a legible threshold the signal is not being sent."

Completing a row is the **common** direction, and it is the bad one. The
optimistic flip applies `text-muted line-through` *before* the request settles,
and the row is simultaneously dimmed to `opacity-60`. The two stack:

```
muted rgb(113,113,122) → 60% over white → rgb(170,170,175) → 2.32:1
```

**2.32:1 is below even the 3:1 large-text floor**, on 16px text, for the
duration of the round trip. The row is not "dimmed but readable"; while the
user is waiting to find out what happened, the thing they are waiting on is
the least readable thing on the screen. Screenshot ground truth: **2.34:1**.

The other direction (un-completing, where the title stays foreground) is
**4.64:1** — it passes, with 0.14 of headroom.

## A5. Summary table

| Item | Verdict | Number | Threshold |
|---|---|---|---|
| DEF-01 tap target | **Fixed** | 44×44 mobile, 20/20 hit probes | 44×44 |
| DEF-08 checkbox contrast | **Fixed** | 3.40 light / 5.14 dark (also on hover) | 3:1 |
| DEF-14 primary button | **Still broken** | 3.59 both themes, 3 buttons | 4.5:1 |
| DEF-15 muted count | **Still broken** | 4.43 light | 4.5:1 |
| DEF-16 search clear | **Still broken** | 20×20 all widths | 44×44 / 24×24 |
| NFR-04 Undo by keyboard | **Still broken** | focus → `<body>`; unreached at 19 todos | reachable |
| Section headings | **Pass** | 4.83 / 6.75 | 4.5:1 |
| Due date + overdue | **Pass** | 4.83–11.74 | 4.5:1 |
| `opacity-60` pending row | **Fail** | 2.32 light | 4.5:1 |

**Nothing regressed.** The two changes that prompted this audit — the row
rewrite and the section headings — are both clean. What is broken was already
broken, and has been through three gates.

## A6. What I would fix first

Ranked by what a user actually hits, not by the size of the gap.

1. **NFR-04 — move focus when a toggle removes a row.** The only item here that
   costs a user their data rather than their comfort. US-07 makes the toast the
   sole route back; focus lands on `<body>`; the route out is 3 tab stops per
   remaining row against a 12s clock, and it does not survive a 19-item list at
   any human pace. Focusing the toast (or the next row) on removal fixes it
   outright and is a few lines. **Everything else on this list is legibility;
   this one is recoverability.**

2. **DEF-16 — the 20×20 search clear.** The only control in the app below WCAG
   2.2's 24×24 floor, and it is on the touch surface where it is smallest
   relative to a finger. A missed tap here puts text back in the search box and
   silently changes what list the user is looking at. One sizing class, and fix
   the "Close" label while it is open.

3. **The `opacity-60` pending row at 2.32:1.** Hit on *every single completion*
   — the most frequent interaction in the product — and it is unreadable during
   exactly the window the user is watching it. Raise the opacity to ~0.75, or
   dim only the action buttons and leave the text alone. The dimming is meant
   to say "working on it", not "you may not read this".

4. **DEF-14 — primary button at 3.59:1.** Every primary button in every theme,
   which sounds worse than it is: these are large, high-salience, and nobody
   fails to *find* the blue button. It is a real AA failure and a one-token
   fix, but it costs comprehension, not task completion. Darken the blue —
   `rgb(4,133,247)` needs roughly a 20% luminance reduction to clear 4.5:1
   against white.

5. **DEF-15 — the muted count at 4.43:1.** Last deliberately. It is 0.07 short,
   on one surface, in one theme, on decorative information that the list itself
   already conveys. The precise fix is now known — the same token clears 4.83:1
   on the Card, so either darken muted slightly or put the header on the Card
   surface. Worth doing; not worth doing before the four above.

**On the two conditions carried out of the last gate:** condition 1 (re-test or
formally accept the five defects) is now discharged — two are genuinely fixed
and three are confirmed still broken with current numbers. Condition 2
(NFR-04's Undo criterion) is discharged as a **failure**, not a pass. Neither
was accepted silently.

---

*Every number above was measured twice by independent methods and three of them
were re-derived by hand; all figures were reproduced on both trees the checkout
occupied during the audit. Where the tree moved under me, §A0 says so rather
than quietly reporting whichever run looked cleaner.*

---

# Release gate — quick-add bar — 2026-08-17

Gate: `develop` → `main` (auto-deploys to Vercel). Branch `develop` @ `421ff7b`
(`Merge branch 'feature/quick-add' into develop`), working tree clean. Node
24.14.0. App driven by hand in Chromium on **port 3100** against
`todo_app_dev`; the Playwright run used its own server on 3117 against
`todo_app_test`. Nothing was pointed at Neon.

Seven commits since `main` @ `6cb2776`. New defects this pass start at
**DEF-22**, continuing from DEF-21.

> Written as each result was established. Everything below was run, on the
> tree named above.

---

## 0. Verdict, up front

### **HOLD**

Two blocking defects, both in the quick-add bar, both the same shape as the two
this feature already produced:

- **DEF-22 — High — the refusal is revoked by any edit anywhere in the line,
  including one that changes no word at all.** Press the chip to keep
  `tomorrow` in your title, then fix a typo at the *start* of the line — or
  just type a trailing space — and the word is lifted again. The todo saves
  with the title short by a word and a due date the user explicitly refused.
  **This is the third "a partial read leaves debris in the title", and it is
  the one that survives the two fixes already in this branch.**
- **DEF-23 — High — `More options` empties the bar before anything is
  committed.** Cancel or press `Escape` in the modal and every character typed
  is gone, with no Undo and nothing created. The bar deliberately keeps the
  text on a 500 (`QuickAddBar`: "there is no route through this function that
  loses a keystroke"); it does not keep it on a cancel, which is the more
  common path.

Both are single-cause and small to fix. Neither is in `parseQuickAdd` — the
parser itself came through this gate clean.

**The suites are green at the stated counts** — 274 Vitest, 86 Playwright, no
retries. That was the entry condition and it held; it is not the verdict, and
neither suite covers either defect above.

**The regression sweep is clean.** Create, edit, delete, toggle, Undo, the
counter, filters, search, due-date grouping, the empty state and its call to
action, sign-out/sign-in and the `?next=` redirect all behave. The
`useTodoList` extraction shows no seam: nothing regressed around it (§3).

**Accessibility of the new UI is otherwise good** and better than the surfaces
around it. The chips are keyboard-reachable, return focus to the input when
activated, are announced through the live region, are 44 px on mobile, and
measure **14.88:1** light / **14.52:1** dark. The two failures on the bar are
both **already-filed** defects arriving on new furniture: DEF-14 (`Add`,
3.59:1) and DEF-15 (the muted token, 4.43:1) — but DEF-15 now carries the
feature's only *visible* statement of the escape hatch, which raises its
stakes (§4.2).

---

## 1. DEF-22 — High — **a refusal is revoked by an edit that changes no word**

**Blocking.** Third of the "partial read leaves debris in the title" family
(after B-1, fixed in `dee0e1f`/`c1e6ead`, and RB-1, fixed in `beb4d66`).

### Reproduction A — fix a typo at the far end of the line

1. `/todos`, signed in. Type into the quick-add bar: `Cal mum about tomorrow`
2. The chip `Due Tomorrow — keep "tomorrow" in the title` appears. **Press it.**
   The chip goes; the bar reads `Cal mum about tomorrow`; the title is whole.
   This is the case §7.17 says the chips exist for.
3. Put the caret after `Cal` and type the missing `l` — a correction three
   words away from the tail, which changes nothing the parser reads.
4. **The chip is back.**
5. Press `Enter`.

**Expected:** a todo titled `Call mum about tomorrow`, no due date. The user
refused this reading and did not withdraw the refusal.

**Actual:** a todo titled **`Call mum about`**, priority Medium, **due
Tomorrow**. Confirmed in the list and in the success toast.

### Reproduction B — a trailing space (whitespace only)

1. Type `Call mum about tomorrow`, press the chip. Chip gone.
2. Press `End`, type **one space**.
3. **The chip is back** — on a keystroke that adds no word, and that
   `parseQuickAdd` itself discards (`input.trim()`, `split(/\s+/)`).
4. `Enter` → title **`Call mum about`**, due Tomorrow.

Backspacing the space away restores the refusal, which confirms the mechanism:
the release is keyed to an *exact* string.

### Reproduction C — the same, via `Esc`

`Remember the meeting friday` → `Esc` → chip gone → type one trailing space →
chip back → `Enter` → title **`Remember the meeting`**, due Aug 21.

### Cause

`QuickAddForm.tsx`, the `QuickAddRelease` record:

```ts
const activeRelease = release.text === text ? release.kinds : [];
```

`text` is the raw field value. Any difference — a leading edit, a trailing
space, a doubled space — is a different string, so the refusal is dropped and
the parse re-fires.

The docstring on `QuickAddRelease` (review B-2) accepts one trade knowingly:
*"an edit-and-retype re-offers a parse the user already refused"*. That
argument is about the user **re-typing the tail**. It does not cover a
correction elsewhere in the line, and it certainly does not cover whitespace —
the parser's own rule 4 is that whitespace is not a word. The implementation is
stricter than the reasoning that justifies it.

### Severity

High, and blocking. The failure is quiet in the way this feature says it must
never be: it produces a *saved record* that is short by a word, reported by a
success toast, and reached by pressing exactly the control the design deck
calls "the whole mitigation". The chip is technically on screen at the moment
of `Enter` — but the feature's own doctrine (rule 3, "nothing to notice and
nothing to undo") treats "the user had to notice" as the weaker guarantee, and
the trailing-space trigger is invisible by construction. Two blockers of this
exact family have already shipped out of this branch; a third should not ship
into `main`.

### Suggested fix

Key the release to the parse-relevant form of the text rather than the raw
string — `text.trim().split(/\s+/).join(" ")` is the normalisation
`parseQuickAdd` already performs — or key it to the token text it was made
against. Either kills reproductions B and C outright and reduces A to "the tail
changed", which is the trade B-2 actually argued for.

---

## 2. DEF-23 — High — **`More options` discards the typed text if the modal is cancelled**

**Blocking.**

### Reproduction

1. `/todos`. Type into the bar:
   `Draft the quarterly report and circulate it tomorrow high` (57 characters).
2. Press **`More options`**. The modal opens, correctly pre-filled — Title
   `Draft the quarterly report and circulate it`, High, due Tomorrow.
3. Change your mind. Press **`Cancel`** (or **`Escape`**, or the close `×` —
   all three close the dialog the same way).

**Expected:** the modal closes and the bar still holds what was typed. Nothing
was committed, so nothing should be lost.

**Actual:** the bar is **empty**. No todo was created. There is no Undo — Undo
belongs to mutations, and this was not one. The text is unrecoverable.

Verified for `Cancel` and for `Escape`, with and without an active chip
release, at desktop and at Pixel 7 width (the mobile modal is `size="full"`,
which makes the accidental dismissal easier, not harder).

### Cause

`QuickAddForm.tsx`, the `More options` handler:

```ts
onPress={() => {
  onMoreOptions(toFormValues());
  clearTo("");
}}
```

`clearTo("")` fires on the *press*, not on the modal's save. `TodoFormModal`'s
`closeForm` only closes; there is no path back to the bar.

### Why this is blocking rather than cosmetic

- It contradicts the bar's own stated contract. `QuickAddBar` keeps every
  character through a 500, a 502 and a field error, and `e2e/quick-add.spec.ts`
  pins that — "retyping a todo the app lost is what makes people stop trusting
  it (`docs/PRD.md` US-05)". Losing the text on a *user-initiated, reversible*
  action is worse than losing it on a server error, and it is the path nothing
  tests.
- `Escape` is the dismissal a keyboard-first feature invites, and it is also
  the key §7.17 trains the user to press in the bar itself, for a different
  purpose.
- §7.17 says `More options` "carries whatever is already typed into it". It
  does not say the bar is emptied. The behaviour is undocumented as well as
  lossy.

### Suggested fix

Clear the bar when the modal *saves*, not when it opens — or leave the text and
let the create path clear it, since a create through the modal already
refetches and toasts. Either way the bar must survive a cancel.

---

## 3. Regression sweep — **clean**

Driven by hand on 3100 against `todo_app_dev`, on fresh accounts. The bar sits
above the list and `useTodoList(filters)` was just extracted, so this
concentrated on the seam between them.

| Area | Result |
|---|---|
| Create (quick-add, ×3, burst) | Rows land in §2 order; counter `0 of 4 done` correct |
| Create (modal, via `More options`) | Pre-filled from the parse; saves; toast + Undo |
| Edit | `Beta task` → `Beta task edited`, row updates in place |
| Toggle + Undo (default filter) | `0 of 4` → `1 of 4` → `0 of 4`; row restored |
| Toggle + Undo (`?status=active`) | Row leaves the list on the flip, comes back in its §2 place on Undo; counter `0 of 3` → `1 of 3` → `0 of 3` |
| Delete + confirm | Row removed, dialog names the todo, counter follows |
| Filters | `?priority=high`, `?status=completed` both correct, with the right empty copy |
| Search | `?q=Alpha` filters; `?q=zzzz` gives `No matches` / `No todos match "zzzz"` / `Clear search`; typing in the box drives the URL and back |
| Create under an active search | `Todo "Zeta thing" added — hidden by your filters`, not inserted, Undo still offered — US-10 holds |
| Grouping | `Upcoming` / `No date` headings correct |
| Empty state | `Nothing here yet` + `Add a todo`; the CTA moves focus into the quick-add input (§7.18) |
| Sign out / sign in | Account menu → `Sign out` → `/sign-in`; `/todos` while signed out → `/sign-in?next=%2Ftodos`; signing back in restores the same rows |
| Console / network | No page errors, no console errors, **no 4xx/5xx** across the whole sweep |
| Mobile (Pixel 7) | No horizontal overflow (`scrollWidth` 412 = `clientWidth` 412); bar, chips and buttons all usable |

**No regression found around the hook extraction.** The counter, the optimistic
toggle, the mid-flight reconciliation and the filtered-create receipt all still
behave, including the two paths (`?status=active` toggle, create under a search)
where a badly-moved hook would have shown.

## 4. Accessibility — the new UI only

### 4.1 Keyboard and focus — **pass**

- Tab order from the input: `Add` → `Due …` chip → `… priority` chip →
  `More options` → the filter bar. Every new control is reachable; the chips
  sit between the submit button and `More options`, which is unusual but
  consistent with their DOM position and is not a trap.
- Activating a chip with `Enter` releases that kind and **returns focus to the
  input** (measured: `INPUT[text]`), even though the pressed chip unmounts.
- After a successful submit, focus is still in the input and the field is
  cleared — the feature's headline claim, and it holds.
- `Esc` in the input releases every chip without moving focus.
- The focus ring on a chip renders (blue, `rgb(0,95,204)`, `data-focus-visible`
  set) — verified from a screenshot, since the computed `outline-style` reads
  `none` and the ring is drawn another way.
- Mobile targets: chips **44 px** tall (137×44, 123×44), `More options`
  110×44, `Add` 380×44. All clear the 44×44 floor.

### 4.2 Live region — **pass, with one caveat**

Empty when nothing is read; on `Buy milk tomorrow high` it reads exactly the
§7.17 string: `Read from your text: Due Tomorrow, High priority. Press Esc to
keep your text exactly as typed.` It clears on `Esc`. The visible hint is
`aria-hidden`, so `dee0e1f` did what it claimed — the sentence is announced
once, not twice.

Caveat: the announcement is derived from the *reading*, so under DEF-22 it
re-announces the parse the user refused. Fixing DEF-22 fixes this too.

### 4.3 Contrast — measured, composited over the real stack

Alpha composited up the ancestor chain to the page background; colours resolved
through the browser's own parser (the theme uses `lab()`/`oklab()`, which a
naive `rgb()` regex silently misreads). Ratios reproduced by hand.

| Element | Light | Dark | Needs | Verdict |
|---|---|---|---|---|
| Chip label + `×` `rgb(24,24,27)` on `rgb(235,235,236)` | **14.88** | **14.52** | 4.5 | **Pass** |
| `More options` | **14.88** | **14.52** | 4.5 | **Pass** |
| Quick-add input text | **17.72** | **17.27** | 4.5 | **Pass** |
| Chip hint `rgb(113,113,122)` on `rgb(245,245,245)` | **4.43** | 7.72 | 4.5 | **Fail (light)** — this is **DEF-15** |
| `Add` button `rgb(252,252,252)` on `rgb(4,133,247)` | **3.59** | **3.59** | 4.5 | **Fail (both)** — this is **DEF-14** |

**The chips themselves are fine** — they are the highest-contrast text on the
bar. Neither failure is new: both are the tokens already filed as DEF-14 and
DEF-15 in the 2026-08-17 audit, at the same numbers, now appearing on new
furniture.

**One thing has changed about DEF-15, though.** The muted token now carries
`Press Esc to keep your text exactly as typed.` — the *only visible* statement
of the escape hatch on which, per §7.17, the whole parser's licence to exist
depends. It was ranked last of five when it was decorating a count the list
already conveyed. At 4.43:1 on the sentence that tells a user how to refuse a
parse, it should be re-ranked. **Not blocking** — it is 0.07 short, it passes in
dark, and the live region carries the same sentence for screen-reader users —
but it should not stay at the bottom of the queue.

## 5. What the parser got right

Worth recording, because it is where the risk was assumed to be and is not.

- An exhaustive sweep of every 1–4-word input over a vocabulary-heavy alphabet,
  under all four release combinations, holds three invariants with **no
  counterexample**: no word is ever lost or duplicated between the title and
  the chips; the title is never emptied; and a release never lets the parser
  take *more* than it took unreleased (the RB-1 property).
- Chips pressed in either order, on either word order, keep the other reading
  (`Ring the bank high tomorrow` and `… tomorrow high`, priority-first and
  date-first — four permutations, all correct).
- Meant-literally cases all decline to fire: `Casual Friday`,
  `high priority handover`, `ship the deck next friday`, `count the 3 days`,
  `buy milk tomorrow!`, `buy milk, tomorrow.`, `review 2026-02-31`,
  `renew the lease in 366 days`.
- Rule 2 holds at the edge: `tomorrow high` → title `tomorrow`;
  `high in 3 days` → title `high`.
- **Non-English titles are safe.** `ซื้อนม tomorrow`, `买牛奶 high`,
  `Приготовить ужин friday`, `אספקה tomorrow`, `café tomorrow` and
  `🎉 party tomorrow high` all lift the trailing English vocabulary and leave
  the non-English title whole. `réunion demain` fires nothing — the vocabulary
  is English-only, which is a product decision, not a defect.
- A 313-character line reports `Keep the title under 200 characters.` and
  **keeps every character in the field**.
- `More options` carries an active release correctly: after refusing the date,
  the modal opens on the full title `Call mum about tomorrow` with no due date.

## 6. Observations — not defects

- **Pasting several lines** into the bar produces one todo:
  `Buy milk⏎Call the vet tomorrow⏎high` becomes
  `Buy milk Call the vet` + Tomorrow + High. That is what a single-line
  `<input>` does with a multi-line paste, and the chips show the reading before
  it commits. Worth a product decision (split on newlines? refuse?), not a bug.
- **Trailing/repeated spaces are collapsed** into the saved title
  (`buy milk   tomorrow   high   ` parses correctly). Correct, and the same
  normalisation DEF-22 fails to apply to the release key.
- Next 16 refuses a second `next dev` in the same directory, so the Playwright
  run required stopping the manual server on 3100 first. Environmental.

## 7. What I did not test

- Real assistive technology. The live region and the labels were read from the
  DOM and the accessibility tree, not heard through VoiceOver or NVDA.
- Cross-user isolation and the API trust boundary — re-proved at the previous
  gate (§4 above) and untouched by these seven commits.
- Anything about the older accessibility queue beyond confirming DEF-14 and
  DEF-15 still measure what they measured.

## 8. Ship / do not ship

**HOLD.** Fix DEF-22 and DEF-23 and this ships; both are contained, neither
touches `parseQuickAdd`, and both should carry a test — the trailing-space
revocation and the cancelled `More options` are each one assertion.

DEF-15's re-ranking is a recommendation, not a condition.

---

# Re-gate — quick-add release blockers — 2026-08-17

Gate: `develop` → `main` (auto-deploys to Vercel). Branch `develop` @ `c32a947`
(`Merge branch 'fix/quick-add-release-blockers' into develop`), working tree
clean. Node 24.14.0. Playwright drove its own `next dev` on **3117** against
`todo_app_test`; Vitest ran against `todo_app_test`. The two `bun` processes
listening on 3000 and 3100 are not mine and were left alone. Nothing was
pointed at Neon.

**Narrow re-gate**, not a second full gate. The parser sweep (§5 above), the
regression sweep (§3) and the accessibility pass (§4) from the 2026-08-17 gate
stand and were not repeated; this pass re-runs my own two blocking defects,
probes for a third of the same family, and takes a smoke pass. Defect numbering
continues from DEF-23, so the one new defect here is **DEF-24**.

> Written as each result was established. Everything below was run, on the tree
> named above.

---

## 0. Verdict, up front

### **SHIP**

**DEF-22 is closed.** All three of my reproductions — the typo fix at the far
end of the line, the bare trailing space, and `Esc` followed by a trailing
space — now save the full title with **no due date**, re-run verbatim in
Chromium against a real account and a real database (§1).

**DEF-23 is closed.** All three dismissals — `Cancel`, `Escape`, the close `×` —
keep every character, keep an active chip refusal with them, and return focus
to the quick-add input. A save through the modal clears the bar exactly once:
one `POST`, one row, one toast (§3).

**The residual behaves as `docs/DESIGN.md` §7.17 documents it**, and is not
wider than the doc says. A pathless whole-line replacement keeps a refusal
whose words the new line ends in; a submit clears it, and it does not reach a
second todo (§2).

**New: DEF-24 — Low — non-blocking.** `Esc` records the refusal against a
reading wider than the one on screen, so on a line whose title is made
entirely of parser vocabulary (`in 3 days high`, `next week high`,
`tomorrow high`) a later edit to a *title* word revokes it and the refused word
is eaten. Same family as DEF-22, at a small fraction of its reach: it needs a
degenerate line, it needs `Esc` rather than the chip, and the chip is visibly
back on screen when it happens. **I am not holding the release for it** (§4).

The third failure the fix was asked to survive is not there. I looked for it
two ways and found neither: an edit path that returns to the reading without
leaving it, and a lapse firing when the reading never changed. The one-way rule
holds — 0 resurrections in 4,000 randomised edit walks, and the one path that
looked like a way back (erasing the prefix down to the tail word and retyping a
new one) ends the refusal correctly, because deleting the space that separates
two words merges them and leaves the reading (§1.4).

---

## 1. DEF-22 — **closed**

Fixed in `b5f74a9` (`fix(quick-add): end a refusal at the edit that leaves the
reading`) after `800a42c` — the raw-text keying I suggested — left
reproduction A standing.

The mechanism now: a refusal is `{ tail, kinds }` where `tail` is the words the
parse read (`QuickAddResult.tail`), and `releaseAfterEdit` is applied to
**every** edit, dropping the refusal the moment the text stops ending in those
words. That is one-way, which is what stops a retyped line reviving it.

### 1.1 The three reproductions, re-run verbatim — **all pass**

Driven in Chromium (Playwright, desktop 1280×800) on fresh accounts against
`todo_app_test`, asserting the saved row, not just the bar.

| # | Steps | Result |
|---|---|---|
| A | Type `Cal mum about tomorrow`; press the `Due Tomorrow` chip; `Home`, `→→→`, type `l`; `Enter` | Saves **`Call mum about tomorrow`**, row carries **no `<time>`** — pass |
| B | Type `Cal mum about tomorrow`; press the chip; `End`, one space; `Enter` | Saves **`Cal mum about tomorrow`**, no `<time>` — pass |
| C | Type `Remember the meeting friday`; `Esc`; `End`, one space; `Enter` | Saves **`Remember the meeting friday`**, no `<time>` — pass |

Reproduction C is the one the merged suite did not already cover — it pins
`Esc` + trailing space, where `e2e/quick-add.spec.ts` pins chip + trailing
space and `Esc` + retype. It passes, but nothing in the repository holds it
there. **Worth one assertion in `e2e/quick-add.spec.ts`.**

### 1.2 The same three at the state-machine level

I transcribed the bar's state machine (`handleTextChange` → `releaseAfterEdit`,
chip press → `releaseAgainst`, render → `heldRelease`, submit → `clearTo`) and
drove `src/lib/quickAdd.ts` through it character by character, so each
keystroke is a separate edit rather than one `fill`. A, B and C all produce
`{ title: <the whole line>, dueAt: "", priority: "medium" }`.

### 1.3 Hunt — a lapse firing when the reading never changed

Exhaustive: every 2-word and 3-word line over a 12-word vocabulary alphabet
plus 7 ordinary words, each chip pressed singly and together via `Esc`, then
every word **outside the reading the chips named** replaced with each of four
substitutes — **14,416 edits**. The refusal held on all but 89, and every one
of those 89 falls in the single narrow class filed below as DEF-24. Outside
that class, no edit the parser cannot see withdraws a refusal.

### 1.4 Hunt — an edit path that returns to the reading without leaving it

Not found, and the obvious candidate fails for a good reason. Because
`stillReads` is a suffix test, a path that edits only the prefix never leaves
the reading — so I tried to walk one all the way to a different todo: refuse
`Due Tomorrow` on `Cal mum about tomorrow`, then erase the prefix one character
at a time and type `Buy milk ` in front of the surviving word.

The refusal **ends**, correctly, and the chip is back by the time the line
reads `Buy milk tomorrow` (saved: title `Buy milk`, due Tomorrow). Deleting the
space between two words merges them — `about tomorrow` becomes
`abouttomorrow` — and that state is not the reading, so the one-way rule fires
exactly as designed. There is no ordinary-typing route from one line to an
unrelated line that never passes through such a state.

Randomised walks agree: 4,000 trials, up to 12 word-level edits each, starting
from a refusal — **0 resurrections**. Once a refusal has lapsed it never comes
back without a fresh chip press.

---

## 2. The residual — **behaves as documented, and is bounded**

`docs/DESIGN.md` §7.17 and the `QuickAddRelease` doc comment both state it: a
single edit that replaces the line without passing through anything else keeps
a refusal whose words the new line happens to end in.

| Check | Result |
|---|---|
| One-edit whole-line replacement (`input` event, no intermediate states) ending in the same word keeps the refusal | **Yes** — as documented |
| The refusal survives a *cancelled* `More options` handoff | **Yes** — intended; nothing was committed |
| A submit clears it | **Yes** — `clearTo` sets `NO_RELEASE` |
| It can reach a second todo | **No** — after submitting the pasted line, `Call the vet tomorrow` shows `Due Tomorrow` again |
| The fast-typist path (`current.slice(submitted.length)`) leaves a stale refusal behind | **No** — `clearTo` runs on that branch too |

Not wider than the doc says. The prefix-editing behaviour in §1.4 is the same
guarantee stated from the other side — §7.17 explicitly says an edit outside
the reading leaves the refusal standing — and it terminates on its own, so it
is not a second residual.

---

## 3. DEF-23 — **closed**

Fixed in `427fb4b` and `d6015a0`. The bar now awaits an answer from the modal
(`src/lib/handoff.ts`), and only a save clears it.

| Check | `Cancel` | `Escape` | close `×` |
|---|---|---|---|
| Bar keeps every character (57-char line) | pass | pass | pass |
| An active chip refusal survives the handoff | pass | pass | pass |
| Focus returns to the quick-add input | pass | pass | pass |
| No todo created, no success toast | pass | pass | pass |
| The line is still submittable as it stands | pass | pass | pass |

The refusal check is the one the merged suite does not make: refuse
`Due Tomorrow` on `Call mum about tomorrow`, press `More options` — the modal
opens on the **full** title with no due date, so the refusal travelled — dismiss
it, and the chip is still absent. `Enter` then saves `Call mum about tomorrow`
with no `<time>`. All three dismissals.

**A save clears the bar exactly once.** Typing
`Draft the report tomorrow high`, `More options`, `Add todo`: **one**
`POST /api/todos`, **one** row, **one** `Todo “Draft the report” added` toast,
bar empty, and no stale refusal left behind — the next line gets its chip back.
That is the invariant `d6015a0` and `createHandoff` were written for, and it
holds.

---

## 4. DEF-24 — Low — **`Esc` records a refusal wider than the reading it refused**

**Not blocking.** Same family as DEF-22, and the same harm, but reachable only
on a line whose entire title is parser vocabulary.

### Reproduction

1. `/todos`, signed in. Type into the quick-add bar: `in 3 days high`.
2. One chip appears: **`High priority`**. The title reads `in 3 days` — rule 2
   refuses to lift the date because it would leave the title empty, so **no
   date chip is offered and none is applied**.
3. Press **`Esc`** to keep the text exactly as typed. The chip goes.
4. Correct your own title, by keystroke, not by paste: `Home`, `→→→`,
   `Shift+→`, type `4`. The line reads `in 4 days high`. **No word any chip
   ever named has been touched.**

**Expected:** the refusal holds — this is an edit to the title, outside the
reading, and §7.17 says such an edit "cannot withdraw a refusal of what it
read".

**Actual:** the refusal lapses. `High priority` is back on screen, and `Enter`
saves a todo titled **`in 4 days`** with priority **High** — the refused word
eaten off the end of the title, exactly DEF-22's harm.

Also reproduces on `next week high`, `tomorrow high`, `high friday`,
`high in 3 days` and 20 other lines of the same shape.

### Cause

`handleKeyDown` releases `ALL_TOKEN_KINDS` — both kinds — regardless of which
ones actually fired. `releaseAgainst` then re-parses with both released, and
the released branch in `parseQuickAdd` steps over a matched run **without
consulting `canLift`**. So the scan walks straight past the run that rule 2 had
refused to lift, and the recorded `tail` reaches words that are still sitting
in the title. `stillReads` then reads an edit to those title words as a change
to the reading.

Pressing the chip instead of `Esc` does not do this, because a chip only ever
releases a kind that fired.

### Bound — measured, not estimated

41,356 lines of 2, 3 and 4 words over an 11-word vocabulary plus 3 ordinary
words, each refused both ways:

- **via a chip press: 0** lines record a tail wider than the chips claimed;
- **via `Esc`: 24**, and every one of them has a title containing **no**
  ordinary word — the whole line is vocabulary;
- **0** affected lines have an ordinary word anywhere in the title.

That bound is structural, not statistical: with any non-vocabulary word in the
line, rule 2's budget always leaves a survivor, so the run is lifted, a chip is
shown, and the recorded tail matches what the chip claimed.

### Why it is not blocking

- The line has to be built entirely from vocabulary — a todo literally titled
  `in 3 days`, `next week` or `tomorrow`. DEF-22 fired on
  `Call mum about tomorrow` with a typo, which is an ordinary Tuesday.
- The refusal has to have been made with `Esc` rather than the chip.
- When it fires, the chip is **on screen again** before the user presses Enter.
  DEF-22's own doctrine ranks a visible unwanted chip well below a silently
  disabled parser, and this is the visible one.
- Nothing is lost that the user cannot see and re-type; there is a success
  toast naming the saved title, and an Undo behind it.

### Suggested fix

Have `Esc` release the kinds that actually fired —
`parsed.tokens.map(t => t.kind)` — rather than both unconditionally. That is
the chip-press path, which the sweep above shows never records an over-wide
tail. It changes one line, and it should carry the `in 3 days high` case as a
test. The deeper cause — that a released run is stepped over without consulting
`canLift`, so a release can make the scan read further left than the unreleased
parse ever did — is worth a look at the same time, since it is the same shape
as RB-1.

---

## 5. Smoke pass — **clean**

One account, one session, Chromium at 1280×800, with the console and every
response watched.

| Step | Result |
|---|---|
| Create through the bar (×2, one with `tomorrow high`) | Rows land, toasts name them, chips read correctly |
| Edit | `Buy milk` → `Buy oat milk`, `updated` toast |
| Status toggle | Checkbox checks, `marked complete` toast |
| Undo | Reverts, `marked not complete` toast |
| One filter (`Active`) | URL carries `status=active`, completed row leaves, active row stays, `All` restores it |
| One search (`vet`) | Matching row only; clearing restores the list |
| Delete | Confirm dialog, row goes, `deleted` toast |
| Sign out | Lands on `/sign-in` |
| Sign back in | Lands on `/todos`, the todo and its completed state survived |

**4xx/5xx: none. Console errors: none.** The only console output is HeroUI's
`PressResponder was rendered without a pressable child` warning, which is a
`warn` from the library's own toast internals and predates this branch.

---

## 6. Suites

- **Vitest: 293 passed / 293, 12 files**, including the new
  `tests/unit/handoff.test.ts` and the additions to `tests/unit/quickAdd.test.ts`
  that the fix commits carry.
- **Playwright: 102 passed / 102** across `chromium-desktop` and
  `chromium-mobile`, no retries, no flakes. The four fix commits add 246 lines
  to `e2e/quick-add.spec.ts`; all 23 of that spec's desktop cases pass.
- The five checks I wrote for this re-gate (repro C, the refused chip through
  all three dismissals, the exactly-once save, the residual bound, and the
  DEF-24 case) were run as a scratch spec and removed afterwards; none of them
  are in the repository. The first two are worth keeping — see §1.1 and §3.

---

## 7. What I did not test

- The parser sweep, the regression sweep and the accessibility pass from the
  gate above. They stand on that tree, and the four fix commits touch
  `QuickAddForm`, `TodoListScreen`, `src/lib/handoff.ts` and the release
  helpers in `src/lib/quickAdd.ts` — not `parseQuickAdd` itself.
- Mobile width for the re-gate specifically. The full Playwright run covers
  `chromium-mobile`, but my own five checks were desktop only.
- Real assistive technology, again. DEF-24 puts a chip back on screen; whether
  the live region announces that clearly to a screen-reader user mid-edit is
  not something I can answer from the DOM.
- DEF-14 and DEF-15 remain where they were. DEF-15 still carries the only
  visible statement of the escape hatch at 4.43:1, and I still think it should
  be re-ranked.

---

## 8. Ship / do not ship

**SHIP.** Both blockers are closed on their own reproductions, the fix's stated
rule survives every attack I could construct against it, the residual is
exactly as wide as the doc admits, and the smoke pass is clean with no 4xx,
no 5xx and no console errors.

DEF-24 goes on the backlog, not in front of this release: it is one line to
fix, it needs a todo titled `in 3 days` to reach, and it announces itself with
a visible chip when it fires. It should not, however, sit there indefinitely —
it is the fourth member of a family that has now cost this feature four fixes,
and the family keeps coming back in the same place.

---

# Release gate — list freshness + accessibility queue — 2026-08-17

Gate: `develop` → `main` (auto-deploy). Tester: QA engineer. Branch `develop`
@ `c00d702` (`Merge branch 'fix/accessibility' into develop`), working tree
clean, single worktree. Node 24. Driven headless **and** headed in Chromium at
1280×800 and 390×844, against `todo_app_test` on `E2E_PORT=3487`; `.env`
re-read before starting and confirmed pointing at `127.0.0.1/todo_app_dev`.

Defect numbering continues from `DEF-24`. New defects this pass start at
**DEF-25**.

> Everything below was run. Where a number is inherited rather than measured,
> it says so.

---

## 0. Verdict, up front

### **HOLD.** One Critical defect that destroys user data, on the keyboard path this release added.

**DEF-25 — Critical — a keyboard toggle can arm a *different* todo's deletion
under the user's next keypress, and pressing it destroys that todo
permanently.** Reproduced 6 times out of 6 attempts on its own repro, headless
and headed, with the `DELETE` observed on the wire and the loss confirmed
against the database through `GET /api/todos`. There is no confirm dialog on
this path and no undo behind it. Details and repro in §4.

Everything else in this release is in good shape, and I want that on the record
rather than buried:

- **Line 1 is sound.** The DEF-20 residual does not reproduce on the exact
  interleaving it describes — a `GET` answered by the server *before* the write
  committed and delivered *after* the write's response is refused, re-asked,
  and the counter ends in agreement with the database (§2.1). Four further
  races, including two tabs and a deliberate filter/toggle storm, all converge.
- **Search over notes is correct**, case- and accent-insensitively, and the
  client-side "hidden by your filters" predicate agrees with the server on a
  note-only match (§2.2).
- **Every contrast number I re-measured independently matches the claim**, to
  0.01, with one 0.20 discrepancy in dark that is not near a threshold (§3.1).
- **The 44×44 target is real, not merely sized** (§3.2).
- **Regression smoke is clean** — no 4xx, no 5xx, no console errors beyond the
  pre-existing HeroUI `PressResponder` warning (§5).

Two further findings, neither blocking on its own:

- **DEF-26 — High** — the focus rescue frequently does not run: in 8 of 12
  trials focus ended on `<body>`, which is the exact state NFR-04's fix exists
  to eliminate. The criterion is met on a quiet screen and not otherwise.
- **DEF-27 — Low (docs)** — `docs/DESIGN.md` §6.8's measured escape-route table
  is wrong on its `Shift+Tab` rows.

I was also asked to judge the documented keyboard trade on its merits. I think
it is worse than what it replaced, and for a reason that is independent of
DEF-25 — §6.

---

## 1. Entry condition — verified, not assumed

`rm -rf .next` first, then build, then typecheck; `npm run lint` unpiped.

| Gate | Result |
|---|---|
| `npm run build` | ✓ compiled, TypeScript pass, 8/8 static pages |
| `npx tsc --noEmit` | exit 0 |
| `npm run lint` (unpiped) | exit 0 |
| `npm run test:run` | **306 passed / 306**, 13 files |
| `npx playwright test` (`E2E_PORT=3487`) | **146 passed / 146**, 4.0m, no retries, no flakes |

Exactly the claimed counts. This is the entry condition and nothing more; the
verdict below is not derived from it, and §4 is the reason that distinction
matters — the suite is green *through* DEF-25.

---

## 2. Line 1 — list freshness and search

### 2.1 The races

Each of these was constructed rather than waited for, and each ends with the
rendered counter compared against a fresh `GET /api/todos` — the database, not
another reading of the same local state.

| # | What was provoked | Result |
|---|---|---|
| R1 | Toggle, then change the status filter **inside** the `PATCH` flight window (write held 1500ms) | `1 of 3 done`, server agrees. Row correctly gone from `Active` |
| **R2** | **The DEF-20 residual exactly.** The list `GET` is `route.fetch()`-ed at the moment the filter changes — so the server answers it from a database that has not seen the write, proved by the held body carrying `completedCount: 0` — and its **delivery** is withheld until after the `PATCH` response has landed and settled | Counter reads `1 of 3 done` before delivery and **still `1 of 3 done` 3s after** the stale body is delivered. Server agrees. **The residual does not reproduce.** |
| R3 | Type a search query while a write is in flight | `1 of 3 done`, all three matching rows present |
| R3b | Change the search query while a write is in flight, sampled every frame | See below |
| R4 | Two tabs, one account, writes from both | Tab A goes stale (expected — there is no live sync) and **converges on `3 of 3 done` after one filter round trip**; server agrees |
| R5 | Toggle/filter storm: toggle, Active, All, toggle, Completed, All, with randomised 300–800ms writes | Settles at `2 of 4 done` = server, **no skeleton left up** |

R2 is the one that mattered and it is clean. The stamp rule does what its
comment says: the stale answer is refused because its issue stamp is not newer
than what the write has since applied, the refusal re-asks, and the re-ask —
issued after the write — lands.

**R3b, the frame trace, is worth recording as an observation rather than a
defect.** Changing the search query inside a write's flight window produces a
window where the counter is briefly wrong:

```
t+0ms      no skeleton   rows: charlie,bravo,alpha   counter: 0 of 3 done
t+60ms     no skeleton   rows: charlie,bravo,alpha   counter: 1 of 3 done   <- optimistic flip
t+556ms    SKELETON      rows: (blank)               counter: 1 of 3 done   <- query changed
t+587ms    no skeleton   rows: charlie               counter: 0 of 3 done   <- load lands, pre-commit
t+1336ms   no skeleton   rows: charlie               counter: 1 of 3 done   <- write lands, refetch
```

For **749ms** the counter reads `0 of 3` when the truth is `1 of 3`. This is
the *other* half of DEF-20 — the load landing **first** — and it is caught by
`landedLoadsRef`, which is why it self-heals one round trip later. It is
transient, self-correcting, and strictly better than the drift it replaced; I
would not hold a release for it. It is here so nobody re-discovers it and
believes DEF-20 is back.

### 2.2 Search

| Check | Result |
|---|---|
| Note-only match, lowercase `oatmilk` against note `Remember the OatMilk` | Matches; the non-matching row is filtered out |
| `OATMILK`, `OatMilk`, `remember the oat` | All match |
| Title match, `GROCER` against `Groceries` | Matches |
| **Predicate agreement:** create a row through the modal whose **note** contains the active query and whose title does not | Toast reads `Todo “Trip to the park” added` — **not** "hidden by your filters" — and the row is on screen |
| Quick-add under `Completed` (new todos are active) | Toast correctly reads `… added — hidden by your filters` |

The predicate was widened with the handler. The case backlog #4 warned about —
the client calling a note-matching row hidden while the list renders it — does
not occur.

---

## 3. Line 2 — the accessibility claims, re-measured

### 3.1 Contrast

Measured with my own compositing implementation, written from the WCAG
definitions rather than reused from `e2e/support/contrast.ts`: every colour
painted into a 1×1 canvas on black and on white and solved for straight
`rgba`, ancestors composited root-down, group `opacity` multiplied through.
Nothing below is estimated from a token string.

| Surface | Light | Dark | Claimed | Threshold | Verdict |
|---|---|---|---|---|---|
| `Add` button label on its fill | **4.65** | **4.65** | 4.65 / 4.65 | 4.5 | **Pass, matches** |
| Muted on `--background` (done counter, chip hint) | **5.14** | **7.72** | 5.14 | 4.5 | **Pass, matches** |
| Muted on `--surface` — **pending row title, un-hovered** | **5.60** | — | 5.60 | 4.5 | **Pass, matches** |
| Muted on `--surface-hover` — completed/pending row under the pointer | **4.65** | — | 4.65 | 4.5 | **Pass, matches** |
| Focus ring (`--focus`) vs the page | **4.37** | **4.25** | 4.37 / 4.25 | 3.0 | **Pass, matches** |
| Selected filter chip label | **5.60** | **6.38** | 5.60 / 6.18 | 4.5 | Pass; dark differs by 0.20 |
| Row title at rest | **17.72** | **17.27** | 17.72 / 17.27 | 4.5 | Pass |

Two things I checked rather than took on trust:

- **The 2.32:1 pending row is fixed by removing the dim, not by raising it.**
  `opacity-60` is gone from the row in both states — I walked the ancestor
  chain of the title of a row with a `PATCH` held open for 5s and every
  ancestor reported `opacity: 1`. The pending signal is now `aria-busy="true"`
  plus the disabled control, and the title measures **5.60** un-hovered and
  **4.65** under the pointer. Both clear 4.5, the second by 0.15.
- **The `--muted` override really is light-only** and the `--accent` override
  really is unguarded: the dark done-counter reads 7.72 (HeroUI's own value,
  untouched) while the dark `Add` label reads 4.65 (the override applying).
  The guard behaves as `docs/DESIGN.md` §3 describes.

The one discrepancy — dark selected chip, 6.38 measured against 6.18 claimed —
is a compositing difference on a translucent chip fill, 1.9 above the
threshold either way. Not worth acting on; recorded so the next reader does not
think one of us mis-measured.

### 3.2 Tap targets

The clear button is **44×44 at 390px** and **36×36 at 1280px**, and carries
`aria-label="Clear search"` — the "Close" leak is gone.

**Hittable, not merely sized.** I probed a 5×5 grid strictly inside the
bounding box with `document.elementFromPoint` at both widths: **21 of 25 points
resolve to the button**, and the four that do not are the four corners, which
fall outside the control's border radius and return the search field group
behind it. That is how a rounded control behaves and is not a defect; the
centre and all eight edge mid-points hit, and a click 2px inside the corner
does *not* clear the field while a centre click does. Nothing overlaps the
control — every miss is geometry, not an occluding layer.

Other targets at 390px: row checkbox label wrapper 44×44, `Edit` 44×44,
`Delete` 44×44, status toggles 44×44, priority select 44 tall. The bare
`<input type="checkbox">` measures 13×13 and the visual control 16×16, but the
`<label>` that wraps both is the target and it is 44×44.

**Observation, not a defect:** the toast `Close` buttons measure 19×19 and
20×20 at mobile — below WCAG 2.2 SC 2.5.8's 24×24. These are HeroUI's own toast
chrome, unchanged by this release, and were never in scope. Worth a backlog
line now that the app's own controls have all cleared the floor.

### 3.3 Keyboard, driven end to end

Tab order follows visual order in both themes, with and without rows, and
wraps cleanly:

```
theme toggle → Account menu → quick-add input → Add → More options
  → All/Active/Completed → Priority → Search → [per row: checkbox, Edit, Delete]
  → (toast region, when present) → wrap to top
```

No control is skipped, nothing is reachable only by pointer, the row action
buttons become focusable and visible when tabbed to, and the focus ring is
painted (via `box-shadow`; `outline-style` is `none`, which is HeroUI's own
mechanism, not a `focus:outline-none` violation). Creating a todo purely from
the keyboard works and returns focus to the quick-add input, as US-05 requires.

**Focus is not trapped.** From the toast's `Undo`, forward `Tab` reaches the
list again, and backward `Shift+Tab` also eventually does. See DEF-27 for how
that differs from what §6.8 says.

---

## 4. DEF-25 — **Critical** — a keyboard toggle arms the wrong Undo, and the next keypress destroys a different todo

### Severity

**Critical, blocking.** Silent, permanent, unconfirmed loss of a todo the user
did not act on, triggered by a single keypress on the app's most frequent
interaction, along the exact path `docs/DESIGN.md` §6.8 tells the user to
expect. There is no confirm dialog on this path and nothing to undo it with.

### Repro

1. Sign in. Have at least one todo so the filter bar renders.
2. Select the **Active** filter.
3. Through the quick-add bar, add two todos in quick succession — e.g.
   `keepme`, then `target`. (Both raise a `Todo “…” added` toast with an
   `Undo`; `UNDO_WINDOW_MS` is 12s, so both are still on screen.)
4. **From the keyboard**, put focus on `target`'s checkbox and press `Space`.
   The row completes and leaves the `Active` list; the focus rescue runs.
5. Press `Enter` (or `Space`) — the key §6.8 says will activate Undo.

### Expected

Per `docs/DESIGN.md` §6.8: focus is on **the toast's action** for the toggle
that just happened, and `Enter` there un-completes `target` and returns it to
the list. The doc's own stated cost is precisely this: *"the next `Space` press
activates Undo rather than toggling the next row."*

### Actual

Focus lands on the `Undo` of the **`Todo “keepme” added`** toast — a different
toast, for a different todo, for a different action. Read back from the DOM at
the moment focus settles:

```
focus: BUTTON[data-slot="toast-action-button"]
owner toast:        Todo “keepme” added
owner is frontmost: false
toasts on screen:  *Todo “target” marked complete     <- frontmost
                    Todo “keepme” added               <- focus is HERE
                    Todo “anchor” added
                    Account created for “…”
```

`Enter` then fires:

```
DELETE /api/todos/cmsx…
```

**`keepme` is permanently deleted.** Confirmed against the database, not just
the screen — `GET /api/todos` before and after:

```
before: total 3, completed 0, titles [target, keepme, anchor]
after:  total 2, completed 1, titles [anchor, target]
```

`target` was correctly completed. `keepme` no longer exists. The user pressed
one key, aimed at undoing a completion, and lost an unrelated todo. No confirm
dialog appeared at any point (`document.querySelector('[data-slot="alert-dialog-dialog"]')`
was `null` across the whole `keydown`/`keyup` sequence, which I recorded with a
capture-phase listener).

### Reproducibility

| Run | Conditions | Result |
|---|---|---|
| D3 ×5 | three quick-adds, then toggle the newest, then `Space` | **5/5 destroyed a todo** (`p0a`…`p4a`) |
| D1 | four quick-adds across a filter change, then toggle, then `Space` | destroyed `bread` |
| E2 | two quick-adds, then toggle, then **`Enter`** | destroyed `keepme` |
| E2, **headed** Chromium | as above, real window | destroyed `keepme` |
| B6/B9 | instrumented, `DELETE` captured on the wire, `keydown`/`keyup` both on the toast action | destroyed `cee` |

Six independent constructions, all positive. This is not a flake.

### Mechanism

`focusFrontmostToastAction` (`src/lib/rowFocus.ts`) polls each frame for

```
[data-slot="toast"][data-frontmost="true"] [data-slot="toast-action-button"]
```

and focuses the first match. The trouble is what "frontmost" means at the
instant it matches:

1. `handleToggle` calls `dismissUndo(todo.id)` first, which closes the toggled
   row's **own** outstanding `added` toast. So the toggled todo's toast is gone
   from the stack.
2. The toggle's success toast is queued behind `document.startViewTransition`
   — the file's own comment says so, which is why step 2 waits at all.
3. In the frames before it mounts, `data-frontmost="true"` still sits on the
   **previous** toast, which after a burst of quick-adds is
   `Todo “<some other todo>” added`.
4. The poll matches that toast, focuses its `Undo`, and returns. The new toast
   then mounts and takes `data-frontmost`, but focus has already been placed
   and is never revised.
5. The `Undo` of an **added** toast deletes the todo it created. So the armed
   action is a delete, on a todo the user never touched.

The wait loop guards against the toast *not existing yet*. It does not guard
against the wrong toast existing already, and the selector cannot tell them
apart because it names a position in the stack rather than the toast that was
just raised.

The same shape hits an **edit** toast (E3): with a `Todo “edited title” updated`
toast on screen, the rescue focuses *its* `Undo` and `Enter` reverts that edit
instead of the completion. Same defect, recoverable consequence.

### Boundary — where it does and does not fire

| Screen state when the toggle happens | Where focus lands | Outcome |
|---|---|---|
| **No other action toast on screen** (13s+ since the last one) | the toggle's own `Undo`, `frontmost=true` | Correct. `Enter` restores the row. Nothing lost |
| Another action toast on screen, raised ~0s earlier | **that** toast's `Undo`, `frontmost=false` | **Data loss** |
| ~3s earlier | the toast **container** (not a button) | No loss; `Space`/`Enter` do nothing at all |
| ~7–11s earlier | `<body>` | No loss; focus lost (DEF-26) |
| No status filter (`All`) — no row removed | `<body>` | Rescue does not run; harmless |

So it needs a status filter *and* another action toast inside its 12s window.
Both are ordinary: the filter is the case US-07 and §6.8 are written about, and
`UNDO_WINDOW_MS` was deliberately raised to 12s precisely so toasts linger.
Capturing a few todos through the bar and then completing one is the app's
headline flow.

### Why the suite is green through it

`e2e/undo-focus.spec.ts` calls `page.goto("/todos?status=active")` between
seeding and toggling. A full navigation destroys every outstanding toast, so
the spec always runs in the one screen state where the defect cannot fire.
Its assertion is also

```ts
await expect.poll(() => activeSlot(signedIn)).toBe("toast-action-button");
```

— the `data-slot` of whatever has focus. Focusing the **wrong** toast's action
satisfies it exactly as well as focusing the right one. The spec cannot see
this defect by construction, in two independent ways.

### Suggested fix and the test that should carry it

Focus the action of **the toast this toggle raised**, identified by the key
`toast.success(...)` already returns and `undoToastKeys` already stores —
`showUndoableSuccess` has that key in hand. Resolve the element from the key
rather than from stack position, and keep the frame wait for the mount. A
positional selector cannot express "the one I just raised" and should not be
asked to.

The regression test must assert the **owning toast's title**, not the slot, and
must run with an older action toast deliberately on screen. `page.goto` between
seeding and acting should be removed from `undo-focus.spec.ts` for the same
reason — it sterilises the state the defect lives in.

---

## 5. DEF-26 — **High** — the rescue often does not run at all

**Severity: High, not independently blocking** (the outcome is the pre-fix
behaviour, not a worse one), but it means NFR-04's criterion is **not**
delivered outside a quiet screen, and it should be fixed alongside DEF-25.

Twelve trials, four fresh todos each, a keyboard toggle of the last row under
`Active`, varying the gap between the last quick-add and the toggle:

| Gap | Trials | Focus after the toggle |
|---|---|---|
| 0ms | 3 | toast container ×1, a **stale** toast's `Undo` ×2 |
| 300ms | 3 | **`<body>` ×3** |
| 1500ms | 3 | **`<body>` ×3** |
| 4000ms | 3 | **`<body>` ×3** |

**8 of 12 ended on `<body>`** — focus on the floor, which is verbatim the state
`docs/QA-REPORT.md` §A3 reported and this release set out to fix. A separate
run with a settled screen (E1, all toasts expired) landed correctly on the
toggle's own `Undo` with `frontmost=true`, and `Enter` restored the row. So the
mechanism works; it works only when nothing else is on screen.

I did not chase the root cause beyond establishing it is real and frequent —
it lives in the same few lines as DEF-25 and should be diagnosed with it.

---

## 6. The documented trade — my view, as asked

Set DEF-25 aside for a moment and judge §6.8's trade on its own terms: after a
qualifying toggle, focus sits on `Undo`; the next `Space` activates Undo rather
than toggling the next row; there is no cheap keyboard route back to the list.

**I think it is worse than what it replaced**, for a reason that is not about
taste and not about the bug:

- The old failure was **inert**. Focus fell to `<body>`; a stray `Space`
  scrolled the page. The user lost their place and had to tab back. Annoying,
  costly on a long list, recoverable.
- The new behaviour is **armed**. Focus is moved — without the user asking —
  onto a control whose activation *mutates data*, and the very next keypress in
  the app's most repeated interaction fires it. §6.8 acknowledges this
  ("the next `Space` press activates Undo") and treats it as a papercut. It is
  not a papercut: it is auto-focusing a mutating control, and the moment the
  wrong toast is under that focus — which DEF-25 shows is easy — the same
  design turns a papercut into destruction. DEF-25 is not an unlucky bug
  bolted onto a sound design; it is the failure mode this design makes
  available.

The reachability problem was real and worth solving. But step 2 solves it by
spending safety, and step 1 already buys most of the value at no risk: landing
focus on the row that replaced the removed one keeps the user's place, keeps
burst-completion working (the next `Space` toggles the next row, which is what
a burst-completing user wants), and arms nothing.

**What I would ship instead:** keep step 1, drop the automatic hop to the
toast, and give the toast a discoverable, documented keyboard route — the
region is already `role="alertdialog"` and react-aria already has a
jump-to-toast hotkey; §A3 of the earlier audit found `F6` reaches the region in
one press. Name it in the UI or in the toast's own accessible description, and
NFR-04's "reachable from where focus landed" is satisfied in one deliberate
keypress rather than by pre-positioning the user on a live action they did not
choose.

Reasonable people can disagree about that last paragraph. What is not a matter
of taste is that the trade as *documented* is not the trade as *implemented*:
§6.8 promises the toast's action for the toggle that just happened, and the
code delivers whichever toast is frontmost at poll time.

---

## 7. DEF-27 — **Low (docs)** — §6.8's escape-route table is wrong on `Shift+Tab`

§6.8 presents a measured table and says plainly *"`Shift+Tab` does not work"*.
Measured from focus-on-`Undo` on this tree:

| Keys | §6.8 says | I measured |
|---|---|---|
| `Shift+Tab` | the toast **container** | the toast's **`Close`** button |
| `Shift+Tab` ×2 | **out of the document entirely** | **back on `Undo`** |
| `Shift+Tab` ×3 | — | the toast container |
| `Shift+Tab` ×5 | — | out of the document |
| `Shift+Tab` ×6 | — | **back into the list** (`Delete "…"`) |
| `Tab` ×1 / ×2 / ×3 / ×5 | `Close` / out / theme toggle / quick-add | **all four confirmed exactly** |

So backwards is a short cycle between `Undo` and `Close` before it breaks out,
and it does eventually reach the list — six presses, better than "out of the
document entirely". The forward table is exactly right.

**Caveat, stated rather than hidden:** these were measured against `next dev`,
whose `NEXTJS-PORTAL` devtools element occupies a tab stop between the toast
region and the document edge. The "out of the document" steps are therefore
dev-mode readings and the counts may shift by one in production. The
`Undo` ↔ `Close` cycle is independent of that element and is not affected.

Nothing here is trapped, so this does not change the safety conclusion — but
§6.8's table is the artifact a reviewer uses to judge whether the trade is
acceptable, and it currently overstates the cost in one direction while §6.8's
prose understates it in another.

---

## 8. Regression smoke — **clean**

One account, one session, Chromium at 1280×800 and 390×844, every response and
console message watched.

| Step | Result |
|---|---|
| Quick-add with parse (`Buy milk tomorrow high`) | Row `Buy milk`, `Priority: High`, `Tomorrow` |
| Quick-add chips (`pay rent friday high`) | `Due Aug 21 ×`, `High priority ×`, hint `Press Esc to keep your text exactly as typed.` |
| `Esc` to refuse the chips | Text kept, chips released |
| Modal create with note | `Vet appointment` created |
| Edit | → `Vet appointment (moved)`, `updated` toast |
| Due-date grouping | `Upcoming` / `No date` sections, correct membership; a dated row shows `Aug 24` |
| Toggle + Undo | `1 of 2 done` → Undo → `0 of 2 done` |
| Filters | `?status=active` in the URL, 1 row; `Completed` 1 row; `All` restores |
| Search on a **note** (`carrier`) | 1 row; clear restores 2 |
| Clear button | Clears, and the list reloads |
| Delete | Confirm dialog, row gone, `deleted` toast |
| Empty state | 0 rows, `Add a todo` call to action present |
| Sign out | Lands on `/sign-in` |
| Sign back in | Lands on `/todos` |
| Mobile pointer pass @390 | Toggle, Undo, modal (full-screen, 390×844), all targets 44×44 |

**4xx/5xx: none. Console errors: none.** The only console output is HeroUI's
`A PressResponder was rendered without a pressable child` warning, a `warn`
from the library's own toast internals that predates this branch.

---

## 9. What I did not test

- **Real assistive technology.** I can read the accessibility tree and
  `document.activeElement`; I cannot tell you what VoiceOver says when the
  rescue moves focus onto a toast for an action the user did not take. Given
  DEF-25, that is worth a real screen-reader pass once the fix lands, because
  the announcement in that moment is the user's only warning.
- **The production build's tab order.** §7's caveat. Everything else was
  measured on `next dev`, which is what the Playwright harness serves.
- **Sustained load.** The toast stack grew past twenty entries during the
  twelve-trial run in §5 with no cap in evidence. I did not pursue it; it is
  the condition DEF-25 needs, so it will get attention anyway.
- **Line 1's server side.** Cross-user isolation was re-proved at a previous
  gate and nothing in this release touches the handler's `where` scoping.

---

## 10. Ship / do not ship

**HOLD.**

One defect blocks: **DEF-25**. A keyboard user who captures a few todos and
then completes one under a status filter — the flow the product is built
around — can lose an unrelated todo to a single keypress, silently,
permanently, with no confirmation and nothing to undo it with. It reproduced
six times out of six, headless and headed, and the loss is visible in the
database and not only on screen. This is auto-deploying to production on merge.

**DEF-26** should be fixed in the same change: without it, NFR-04's criterion
is not actually met, and shipping the fix's cost without its benefit is the
worst of both.

**DEF-27** is a documentation correction and can ride along.

Nothing else blocks, and I want to be plain about that rather than pad the
list. Line 1 is the best-verified work I have seen through this gate: the
residual it set out to close does not reproduce on its own construction, and
five further races all converge on the database. Every contrast figure I
re-derived independently matched the claim. The tap target is genuinely
hittable. The smoke pass is clean. **The accessibility queue's colour and
target work is ready; its focus work is not.**

