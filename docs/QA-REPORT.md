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
