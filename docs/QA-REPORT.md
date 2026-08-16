# QA Report — Personal Todo App (v1) — **Release-gate pass on `develop`**

**Date:** 2026-08-16
**Branch under test:** `develop` @ `cd0f869` (`Merge branch 'feature/due-date-ordering' into develop`)
**Working tree:** clean at start; this file is the only thing this pass changed.
**⚠ The checkout was moved to `fix/deploy-region` by something outside this session while the pass ran — see §11.1. Every result here is for `develop` @ `cd0f869`, which is unchanged.**
**Tester:** QA
**Purpose:** release gate. If this pass is clean, `develop` merges to `main` and deploys.

Defect numbering continues from previous passes. `DEF-01`…`DEF-16` mean what
they meant before. New defects this pass start at **DEF-17**.

---

## 0. Verdict, up front

> ## **SHIP.**

Both suites are green at the counts expected. **DEF-13, the Major that blocked
the last gate, is fixed** — I re-tested both of its reproductions and both now
redirect correctly. Cross-user isolation holds under an independent method
(31/31 checks over real HTTP). The due-date feature is correct at the two
places I expected it to be thin: the **timezone boundary** and the
**single-section rule**, both proved at the level a user experiences them.

Two new defects, **both Low, neither blocking**:

- **DEF-17** — the sign-in error copy does not match the string US-02 quotes.
  The *security* property that criterion exists to protect (no account-existence
  oracle) is fully intact; this is a wording divergence between PRD and
  `DESIGN.md`, and I believe the PRD is the doc that is wrong.
- **DEF-18** — **US-05's amended criterion contradicts itself** and is not
  executable as written. This is the one the brief asked me to look for. Detail
  in §8; the app's behaviour is correct, the sentence is not.

Neither touches a Must story's *behaviour*. Full reasoning in §9.

---

## 1. Test accounts created for this pass

All in the **local `todo_app_test`** database. Production was never connected
to — proof in §2.

| Account | Purpose |
|---|---|
| `db-probe-1786895251@isolation.test` | One-shot probe proving the dev server wrote to the test DB (§2) |
| `qa-a-1786895338@isolation.test` | Isolation baseline, user A (owns the data) |
| `qa-b-1786895338@isolation.test` | Isolation baseline, user B (the attacker) |
| `qa-tz-plus14-1786895594297@isolation.test` | Timezone boundary at UTC+14 |
| `qa-tz-minus11-1786895594297@isolation.test` | Timezone boundary at UTC−11 |
| `qa-sect-1786895716916@isolation.test` | Single-section rule, both directions |
| `qa-filt-1786895716916@isolation.test` | Grouping under filter and search |
| `qa-midnight-1786895716916@isolation.test` | Tab left open across local midnight |
| `qa-ui-1786895877267@isolation.test` | US-01 / US-02 / US-11 walkthrough |
| `qa-crud-1786895877267@isolation.test` | US-05 / US-07 / US-09 walkthrough |
| `qa-def13-1786895877267@isolation.test` | DEF-13 reproduction B |
| `qa-copy-1786896219975@isolation.test` | US-02 error copy (DEF-17) |
| `qa-list-1786896219975@isolation.test` | US-06 / US-08 / US-10 walkthrough |
| `qa-d13a-1786896219975@isolation.test` | DEF-13 reproduction A |
| `qa-order-1786896307500@isolation.test` | US-06 four-key ordering + section a11y |
| `qa-signout-1786896307500@isolation.test` | US-03 sign out |
| `qa-us05-1786896340775@isolation.test` | US-05 criterion (DEF-18) |

Password for all: `qa-release-gate-8chars`. The `@isolation.test` domain is
deliberate, so these are distinguishable from suite-created rows.

---

## 2. The production foot-gun, and proof the override held

**`.env` is unchanged since I flagged it last pass.** It still reads:

```
DATABASE_URL="postgresql://neondb_owner:…@ep-purple-sea-azewd2z4-pooler.c-3.ap-southeast-1.aws.neon.tech/neondb?…"
```

That is a live Neon branch holding real user data, and it is what `next dev`
loads by default. So the override is still mine to apply, and still mine to
prove. **This remains the single most dangerous thing in the repo for anyone
running the app locally.**

I ran the app as:

```
DATABASE_URL="postgresql://postgres@127.0.0.1:5432/todo_app_test" npx next dev -p 3483
```

Next.js does not overwrite a variable already present in `process.env`, so the
shell value wins over `.env` — but "should win" is not evidence, so:

1. Created an account through the **running server on :3483**:
   `POST /api/auth/sign-up/email` → `200`, `db-probe-1786895251@isolation.test`.
2. Looked for it in the **local** database:

```
psql postgresql://postgres@127.0.0.1:5432/todo_app_test \
  -tAc "select email, \"createdAt\" from \"user\" where email='db-probe-1786895251@isolation.test';"
→ db-probe-1786895251@isolation.test|2026-08-16 15:47:32.912
```

The row the server wrote is in the **test** database. **Override confirmed.**
Both suites resolve their own target through
`tests/setup/testDatabaseUrl.ts` / `e2e/support/testDatabaseUrl.ts`, which
refuse hosted hosts and any database not named `*_test`, so they were never at
risk.

**Note on the port:** the app must be driven over `http://localhost:3483`, not
`http://127.0.0.1:3483`. Next 16's dev-origin check answers `403` to
`/_next/static/*` when the browser's origin does not match the server's, which
leaves the page stuck on the loading skeleton. Not a product defect — a dev
harness detail worth knowing before someone reports a phantom bug.

---

## 3. The existing suites — **both green** (task 1)

Run first, before anything else.

### 3.1 Vitest

```
TZ=Pacific/Kiritimati npm run test:run
```

| | |
|---|---|
| Result | **8 files, 188 tests, 188 passed, 0 failed** |
| Vitest-reported duration | **3.17 s** (transform 117 ms, import 1.95 s, tests 775 ms) |
| Wall clock | **3.53 s** |

**188 — matches the expected count exactly.**

### 3.2 Playwright

```
CI=true npm run test:e2e
```

| | |
|---|---|
| Result | **38 passed, 0 failed** (chromium-desktop + chromium-mobile) |
| Playwright-reported duration | **1.2 m** |
| Wall clock | **1:13** |

**38 — matches the expected count exactly.** Exit code 0, both projects ran.

**Neither suite is red on `develop`, so nothing here blocks the release.**

### 3.3 An extra run the brief did not ask for

Since the whole feature turns on the viewer's calendar day, I ran the Vitest
suite at six offsets rather than one:

| TZ | Offset | Result |
|---|---|---|
| `Pacific/Kiritimati` | +14 | 188 passed |
| `Pacific/Chatham` | +12:45 / +13:45 | 188 passed |
| `Asia/Bangkok` | +7 | 188 passed |
| `UTC` | 0 | 188 passed |
| `America/Los_Angeles` | −7 | 188 passed |
| `Pacific/Midway` | −11 | 188 passed |

Green everywhere, including a **45-minute** offset, which is the case most
date arithmetic gets wrong. Good result.

### 3.4 Where I judged the suites to be thin — and it is one specific thing

**No test in either suite pins a timezone.** Vitest inherits ambient `TZ`; the
Playwright config sets **no `timezoneId`** on either project, so the browser
also inherits it. And `e2e/grouping.spec.ts` builds its fixture dates with
`localDay()` — in *local* time — which is correct for the assertion but means
the fixture and the assertion **shift together**. The spec therefore passes at
every offset without ever discriminating between them.

The CI workflow's `TZ: Pacific/Kiritimati` is doing all the work, and it is set
on the *job*, not on the *test*. Anyone running the suite locally, or a future
config that drops the env var, gets green tests that no longer prove the thing
they were written to prove. §4 is where I spent the effort instead.

*(Recommendation, not a defect: set `timezoneId` explicitly per Playwright
project, and use `vi.setSystemTime` with a fixed instant in the unit tests, so
the guarantee lives in the test rather than in the environment.)*

---

## 4. The timezone boundary as a user experiences it (task 2) — **Pass**

This is the headline check and it needed a real browser, because grouping is
computed client-side from `new Date()`.

Method: real Chromium, `timezoneId` set per context, **and the wall clock
pinned** with `clock.setFixedTime()` to an instant where the viewer's local
calendar day and the UTC calendar day genuinely **disagree**. That last part is
what makes the test discriminate — at most instants the two agree and a
UTC-based implementation would pass by luck.

### 4.1 UTC+14 — `Pacific/Kiritimati`

Pinned to `2026-08-16T11:00:00Z` → the browser's local time is
`Mon Aug 17 2026 01:00:00 GMT+1400`.

| | |
|---|---|
| Local calendar day | **2026-08-17** |
| UTC calendar day | **2026-08-16** |

| Todo (`dueAt`) | Expected section | Actual |
|---|---|---|
| `2026-08-17` (the user's today) | `Today` | **`Today`** ✓ |
| `2026-08-16` (the user's yesterday) | `Overdue` | **`Overdue`** ✓ |
| `2026-08-18` (the user's tomorrow) | `Upcoming` | **`Upcoming`** ✓ |
| none | `No date` | **`No date`** ✓ |

A UTC-based grouping would have put the first row in `Upcoming`. It did not.

### 4.2 UTC−11 — `Pacific/Midway`

Pinned to `2026-08-17T05:00:00Z` → local time
`Sun Aug 16 2026 18:00:00 GMT-1100`.

| | |
|---|---|
| Local calendar day | **2026-08-16** |
| UTC calendar day | **2026-08-17** |

| Todo (`dueAt`) | Expected section | Actual |
|---|---|---|
| `2026-08-16` (the user's today) | `Today` | **`Today`** ✓ |
| `2026-08-15` | `Overdue` | **`Overdue`** ✓ |
| `2026-08-17` | `Upcoming` | **`Upcoming`** ✓ |
| none | `No date` | **`No date`** ✓ |

A UTC-based grouping would have called the first row `Overdue`. It did not.

**14/14 checks passed.** Headings rendered in PRD order in both zones, and the
row labels agreed with the sections (`Today`, `Tomorrow`, `Overdue — Yesterday`).

**Verdict: the "user's today" definition in PRD §2 is implemented correctly, at
a positive and a negative offset, in both directions of disagreement.**

---

## 5. Behaviour the suites do not cover (task 2) — **Pass**, 20/20

### 5.1 The single-section rule, in both directions — **Pass**

The criterion:

> "Given every todo currently shown belongs to a single section … **no heading
> appears at all** and the todos render as one flat list."

| Step | Expected | Actual |
|---|---|---|
| Three todos, none with a due date | **zero** `<h2>` | **0** ✓ |
| …rendered as one flat list | 1 section, 3 rows | **1 section, 3 rows** ✓ |
| Give one of them a due date of today | headings over **both** sections | **`Today`, `No date`** ✓ |
| Clear that due date again | headings **disappear** | **0** `<h2>` ✓ |

Both directions, including the return trip the PRD explicitly calls for. **A
user who never sets a due date sees exactly the list that shipped before.**

### 5.2 Grouping under a filter and under search — **Pass**

| Case | Expected | Actual |
|---|---|---|
| No filter | `Today`, `Upcoming`, `No date`, `Completed` | ✓ |
| A completed **overdue** todo | under `Completed`, never `Overdue` | ✓ |
| Two todos same day, `high` / `low` | `high` first | ✓ |
| `?priority=high` | only sections with survivors: `Today`, `Upcoming`, `Completed` | ✓ |
| `?status=active&priority=high` | `Today`, `Upcoming` | ✓ |
| `?status=completed` (survivors all in one section) | **no heading at all** | **0** `<h2>` ✓ |
| `?q=TODAY` (survivors all in one section) | **no heading at all** | **0** `<h2>` ✓ |
| `?q=TODAY` ordering | default order preserved | `TODAY-high`, `TODAY-low` ✓ |
| `?q=O` (survivors span sections) | headings return | all four ✓ |

The single-section rule holds **under filters and under search**, not just on
the unfiltered list — including the case where filtering *collapses* a
multi-section list down to one.

### 5.3 A tab left open across local midnight — **confirmed as described, out of scope**

The PM knows and ruled this out of scope. Recording it, not filing it.

Setup: `timezoneId: UTC`, clock pinned to `2026-08-16T23:50:00Z`, one todo due
`2026-08-16` plus one undated todo (so headings render at all).

| Step | Observed |
|---|---|
| At 23:50 | `Today`, `No date` — correct |
| Advance the clock to 00:10 the next day, **tab untouched** | **still `Today`, `No date`** — stale |
| Reload (any re-render) | **`Overdue`, `No date`** — correct |

**Confirmed exactly as the PM described.** `groupTodos()` is called during
render with a default of `new Date()`, and nothing subscribes to a clock tick,
so the grouping is only as fresh as the last render. It self-corrects on any
re-render — reload, filter change, or any mutation. No data is wrong, only the
heading a row sits under, and only in a tab left idle across midnight.

**Not filed as a defect, per the PM's ruling.** Worth a line in the release
notes rather than a fix.

---

## 6. Cross-user isolation — **re-proved independently** (task 3) — **Pass**

The ordering change touched the same query, so this was proved a second time by
a **different method** from the Vitest suite. The suite imports the route
handlers and calls them in-process with mocked `next/headers`. I drove the
**running dev server over real HTTP with `curl`**, real `Set-Cookie` session
cookies, through the real proxy and the real Next routing layer.

Script: `isolation.sh` (scratchpad). **31 checks, 31 passed, 0 failed.**

### 6.1 B reaches for A's data

Two fresh accounts; A creates two todos; B signs in and reaches for them.

| Attempt (as B) | Expected | Actual |
|---|---|---|
| `GET /api/todos` | none of A's | `"totalCount":0` — **empty** |
| `GET /api/todos` — A's title present? | no | **not present** |
| `GET /api/todos?query=secret` (matches only A's row) | no match | **no match** |
| `PATCH /api/todos/{A1}` | `404` | **`404`** |
| `PATCH /api/todos/{A1}/status` | `404` | **`404`** |
| `DELETE /api/todos/{A1}` | `404` | **`404`** |
| `DELETE /api/todos/{A2}` | `404` | **`404`** |

**On `GET` by id:** there is still **no `GET /api/todos/[id]` route** — the
`[id]` route exports only `PATCH` and `DELETE`, so the read surface is the
collection endpoint, which is what I tested (unfiltered, and with a search term
chosen to match A's row). That is **DEF-04**, unchanged and informational.

### 6.2 Not-found must be indistinguishable from not-yours

| Attempt | Status | Body |
|---|---|---|
| `PATCH` a **foreign** id | `404` | `{"code":"NOT_FOUND","message":"That todo no longer exists."}` |
| `PATCH` a **nonexistent** id | `404` | *byte-identical* |

**No existence oracle.**

### 6.3 A path the suite does not cover: validation runs *before* ownership

I found this by accident (a malformed body in my own script) and then tested it
deliberately, because it is exactly the shape a leak takes.

`PATCH /api/todos/[id]` parses the body with `todoFormSchema` **before** the
ownership lookup. So an **invalid** body against a **foreign** id returns
`400`, not `404`. That would be an oracle if the `400` differed between a
foreign id and one that does not exist:

| Attempt (as B, `{"note": 5}`) | Status | Body |
|---|---|---|
| foreign id | `400` | `{"code":"BAD_REQUEST","message":"The note must be text.","fieldErrors":{"note":"The note must be text."}}` |
| nonexistent id | `400` | *byte-identical* |

**Identical.** The validation error describes the *body*, never the *row*, so
it cannot distinguish the two. **Not a defect** — but it is an ordering the
suite does not pin, and a future error message that mentioned the row would
turn it into one silently.

### 6.4 Signed out — everything `401`

| Endpoint | Expected | Actual |
|---|---|---|
| `GET /api/todos` | `401` | **`401`** |
| `POST /api/todos` | `401` | **`401`** |
| `PATCH /api/todos/{id}` | `401` | **`401`** |
| `PATCH /api/todos/{id}/status` | `401` | **`401`** |
| `DELETE /api/todos/{id}` | `401` | **`401`** |
| `GET` / `PATCH` with a **forged** cookie | `401`, not `500` | **`401`** |

### 6.5 A's data intact, and the guard is not simply denying everything

After every attempt by B, re-read as A: title intact, **not** overwritten by
B's `PATCH`, `completed` **not** flipped, second todo **not** deleted, `note`
and `priority` intact. No `500` anywhere.

And A can still operate on A's own rows: `PATCH /status` → `200`, `PATCH`
fields → `200`, `DELETE` → `204`.

**Verdict: NFR-01 / NFR-02 / US-04's isolation clause — Pass, by two
independent methods. No false pass here: every status and body above was
asserted explicitly, and the run was clean only after I fixed my own script's
malformed payloads (§6.3), not by loosening an assertion.**

---

## 7. User stories US-01 → US-11 (task 4)

| Story | Verdict |
|---|---|
| US-01 — Sign up | **Pass** |
| US-02 — Sign in | **Partial** — DEF-17 (copy only; behaviour and security correct) |
| US-03 — Sign out | **Pass** — DEF-13 fixed |
| US-04 — Protected routes | **Pass** — server and client |
| US-05 — Create a todo | **Pass** — behaviour correct; the *criterion* is DEF-18 |
| US-06 — List todos | **Pass** — including all section criteria |
| US-07 — Toggle complete | **Pass** |
| US-08 — Edit a todo | **Pass** |
| US-09 — Delete with confirmation | **Pass** |
| US-10 — Filter by status and priority | **Pass** |
| US-11 — Empty state | **Pass** |
| US-12 — Dated list header | **Absent by design** — not tested, confirmed not present |

### 7.1 US-01 — Sign up — **Pass**

Fields Name/Email/Password + "Create account" + link to `/sign-in` all present.
Empty submit → stays on `/sign-up`, **three** inline `This field is required.`
errors. `not-an-email` → `Enter a valid email address.` 7-char password →
`Use at least 8 characters.` Duplicate email → error shown, **email kept,
password cleared**. Valid sign-up → redirected to `/todos`.
`emailVerified` in the database is **`f`**, and the app is fully usable.

### 7.2 US-02 — Sign in — **Partial (DEF-17)**

Correct credentials → session and redirect to `/todos`. Wrong password and
unknown email both stay on `/sign-in`. `?next=` is honoured: visiting
`/todos?status=active&priority=high` signed out redirects to
`/sign-in?next=%2Ftodos%3Fstatus%3Dactive%26priority%3Dhigh`, and after signing
in the user **lands back on that exact filtered route**. A signed-in visit to
`/sign-in` redirects to `/todos`.

**The security-critical half is correct:** wrong-password and unknown-email
produce the *byte-identical* message, so there is no account-existence oracle.
Only the wording differs from the PRD — **DEF-17**.

### 7.3 US-03 — Sign out — **Pass** (was Partial)

Account menu shows the account email and a `Sign out` item. Signing out
redirects to `/sign-in`, **deletes the session row server-side** (verified in
Postgres: 1 → 0), and **clears the session cookie** (no session cookie remains
in the context). The Back-button criterion now passes — see DEF-13 in §8.

### 7.4 US-04 — Protected routes — **Pass**

Unauthenticated `/todos` → `/sign-in?next=…`, originally requested path
preserved, **no todo data in the response**. Every mutation endpoint with no
session → `401` with no write (§6.4). A foreign todo id → `404` (§6.1). The
client-side gap that made this Partial last pass is DEF-13, now fixed.

### 7.5 US-05 — Create a todo — **Pass** (criterion issue: DEF-18)

Create form has Title, Note, Priority and Due date. Title-only submit stores
`note = null`, `priority = medium`, `completed = false`, `dueAt = null`
(verified in Postgres) and the row appears **without a full page reload**.
Empty title → `Enter a title.` A 201-char title is rejected inline. The form
**resets to its defaults** after a success. Priority and due date are both
visible on the row.

The one thing that does *not* hold is the criterion's own trailing clause —
see **DEF-18**. The app's ordering is right; the sentence is wrong.

### 7.6 US-06 — List todos — **Pass**

**Scope:** only my todos, under every filter (§6).

**Order — all four keys, in one list.** Eight todos seeded in a deliberately
wrong order, with distinct `createdAt`:

```
["A-yesterday-med", "B-today-high", "C-today-low", "G-tie-newer",
 "F-tie-older", "D-nextmonth-high", "E-undated-low", "H-done-overdue"]
```

| Criterion | Result |
|---|---|
| yesterday → today → next week → undated | ✓ |
| same due date: `high` before `low` (`B` before `C`) | ✓ |
| **`low` due today outranks `high` due next month** (`C` before `D`) | ✓ |
| same date + priority: newer first (`G` before `F`) | ✓ |
| completed last, and a completed **overdue** todo does not rejoin the active ones (`H` last) | ✓ |
| order preserved under filter and search | ✓ (§5.2) |

**Sections:** all five render in PRD order; empty sections do not render; a
completed past-due todo appears under `Completed` and creates no `Overdue`
section; the single-section rule holds in both directions (§5.1).

**Accessibility of the sections** — the criterion asks for a level-2 heading
and a list per section:

| Check | Result |
|---|---|
| every section heading is a real `<h2>` | **true** |
| every section has **its own** `<ul>` | **true** |
| no `<h2>` nested inside a `<ul>` (invalid markup) | **false** — correct |
| headings in order | `Overdue`, `Today`, `Upcoming`, `No date`, `Completed` |

**Rows:** title, completion control, priority, due date, and a note indicator
are all present — e.g.
`"Zeta overdue ▼ Priority: Low ⚠ Overdue — Aug 13 ✎ Has a note"`. Priority and
overdue state carry a **glyph as well as colour** (`▼ ▲ ■`, `⚠`), so status is
not conveyed by colour alone. A **skeleton** loading state renders before data
arrives.

### 7.7 US-07 — Toggle — **Pass**

Toggling persists (`completed = t` in Postgres) and survives a reload. Under
the **Active** filter, completing a visible todo removes it from the list.
**Only `completed` changed** — title, note, priority and `dueAt` verified
unchanged in the database. A completed todo returns to its due-date section
when toggled back (§5.2).

### 7.8 US-08 — Edit — **Pass**

Edit form opens **pre-filled** with the current title and note. Clearing the
title and saving → `Enter a title.`, no update. **Cancel (Escape) changes
nothing** — verified in Postgres that the typed-but-cancelled value was never
saved. Clearing the note stores **`NULL`**. Length rules match US-05.
Ownership is scoped by `id` **and** `userId` (§6.1).

### 7.9 US-09 — Delete with confirmation — **Pass**

The dialog names the todo:
`"Delete this todo? “Buy milk” will be permanently deleted. This can't be undone. Cancel Delete"`.
**Escape cancels and nothing is deleted** (row count unchanged). Confirming
deletes exactly one row, it disappears without a full reload, and it stays gone
after a reload. **Focus moves inside the dialog** and **returns to the
triggering control** after it closes (`aria-label` `Delete "Beta soon"`) —
NFR-04 satisfied. Deleting the last todo shows the empty state.

### 7.10 US-10 — Filters and search — **Pass**

Defaults are All / All priorities. `priority=high` shows only high.
Filters **combine with AND**. Filter state is **in the URL and survives a
reload**. A non-matching search shows
`No matches — No todos match “zzzznomatch”.` with a **`Clear search`** control,
and that message is **visually and textually distinct** from the empty state.
Results stay in the default list order and contain only my todos.

### 7.11 US-11 — Empty state — **Pass**

`"Nothing here yet — Add your first todo and it will show up here. [New todo]"`
— a heading, one line of guidance, a CTA, and **no filter chrome**. The CTA
opens the create form and **focuses the Title field** (verified via
`document.activeElement`). Creating the first todo replaces it; deleting the
last todo brings it back. Distinct from the no-results message.

### 7.12 US-12 — **absent by design, not tested**

Confirmed **not present**: no `N due today` / `N overdue` line renders above
the list. Correct for a story marked "not yet built".

---

## 8. Defects

### DEF-13 — **Major** — **FIXED** ✅ (was the previous gate's blocker)

**Status:** **Closed.** Fixed by `dfb302f` (`fix/session-expired-redirect`).
The fix is a `401` handler on the shared axios instance in `src/lib/http.ts`
that assigns `signInPathWithNext(pathname + search)` — the shape suggested in
the last report.

Both reproductions re-tested:

**Reproduction A — sign out, then Back.** Signed in through the UI (so real
history exists — `history.length` 3), signed out, pressed Back.

| | Last pass | **This pass** |
|---|---|---|
| URL after Back | `/todos?…`, dead-end panel | **`/sign-in?next=%2Ftodos`** ✓ |
| Page content | "Couldn't load your todos" + dead `Try again` | **`"Welcome back — Sign in to see your todos."`** ✓ |
| Todo data rendered | none | **none** ✓ |

**Reproduction B — session invalidated server-side mid-session.** Signed in,
deleted the session rows in Postgres, clicked a row's completion checkbox.

| | Last pass | **This pass** |
|---|---|---|
| Result | `401`, toast, **no redirect**, stranded on `/todos` | **redirected to `/sign-in?next=%2Ftodos`** ✓ |
| `?next=` preserved | n/a | **yes** ✓ |
| Anything written | no | **no** — `completed` still `f` ✓ |

**US-03's and US-04's criteria now pass.**

---

### DEF-17 — **Low** — sign-in error copy does not match the string US-02 quotes

**Status:** new.
**Affects:** US-02 (Must) — wording only. **No security impact.**

**Expected** — `docs/PRD.md` US-02, twice:

> "Then I remain on `/sign-in` and see the error **"Invalid email or password"**."

> "Then I see the same message **"Invalid email or password"** (no hint that the
> account does not exist)."

**Actual:** both cases render

> **"Sign in failed — That email and password don't match. Try again."**

**Reproduction:**

1. Sign up any account, then go to `/sign-in`.
2. Enter the correct email with password `wrong-password-9` → submit.
   → `Sign in failed / That email and password don't match. Try again.`
3. Enter a nonexistent email with any password → submit.
   → **the identical string.**

**Why this is Low, not Major.** The criterion's actual *purpose* — stated in
its own parenthesis, "no hint that the account does not exist" — is **fully
satisfied**: I compared the two rendered strings programmatically and they are
**identical**. `SignInForm.tsx` uses one constant
(`INVALID_CREDENTIALS_MESSAGE`) for both branches, with a comment saying so.
There is no account-existence oracle.

**And the PRD is probably the doc that is wrong.** `docs/DESIGN.md` §copy deck
line 1065 specifies exactly the implemented string:

| Bad credentials | `Sign in failed` | `That email and password don't match. Try again.` |

So this is a **PRD-vs-DESIGN divergence**, not an implementation miss. The
implemented copy is friendlier and says the same thing.

**Recommendation:** amend US-02's two criteria to quote the copy deck, rather
than change the code. **Does not block.**

---

### DEF-18 — **Low (documentation)** — US-05's amended criterion contradicts itself and is not executable as written

**Status:** new. This is the "untestable as written" the brief asked me to
watch for. **The application behaviour is correct** — the *criterion* is not.

**The criterion** — `docs/PRD.md` US-05:

> "…and it appears in the list without a full page reload, **in its place under
> the default list order (§2) — for an undated todo, first among the undated
> ones**."

**The contradiction.** The two halves cannot both be true. §2's default order
sequences undated todos by `priority` **descending**, then `createdAt`
descending. A new todo defaults to `priority = medium` (§2's field table). So
whenever a `high`-priority undated todo already exists, §2 requires the new
todo to sit **below** it — which makes "first among the undated ones" false.
"First among the undated ones" is only true when no undated todo of higher
priority exists, which the criterion does not say.

**Reproduction:**

1. Create an undated todo `EXISTING-high-undated` with priority **high**.
2. Create an undated todo `EXISTING-low-undated` with priority **low**.
3. Through the UI, create `NEW-default-undated` — title only, all defaults.

**Actual order rendered:**

```
["EXISTING-high-undated", "NEW-default-undated", "EXISTING-low-undated"]
```

The new todo is at **index 1**, not index 0.

- Against the **first** half of the criterion ("in its place under the default
  list order") → **Pass.** `medium` correctly sorts below `high` and above
  `low`.
- Against the **second** half ("first among the undated ones") → **Fail.**

**I graded US-05 Pass** because §2 is the normative definition, the trailing
clause is an illustrative gloss on it, and the app matches §2 exactly. But a
tester executing the sentence literally, as the PM asked QA to be able to do,
gets a false failure — and the previous phrasing this replaced ("appears at the
top of the list") was wrong for the same reason.

**Recommendation:** delete the trailing clause, or restate it as "for an
undated todo of default priority, among the undated ones and above any of lower
priority". **Does not block.**

---

### Previously-known defects — status this pass

| Defect | Status |
|---|---|
| **DEF-01** (44×44 touch target) | **Still fixed** — not re-measured this pass |
| **DEF-02** (`PressResponder` warning) | **Still open — confirmed, not re-diagnosed.** Present in the Playwright run's `[browser]` output and in every one of my browser probes: `A PressResponder was rendered without a pressable child. Either call the usePress hook, or wrap your DOM node with <Pressable> component.` Console noise only; no functional impact observed |
| **DEF-04** (`GET /api/todos/[id]` not a route) | **Unchanged, informational** — re-observed (§6.1); identical for owner and stranger, leaks nothing |
| **DEF-08** (dark-mode checkbox contrast) | **Not re-tested this pass** |
| **DEF-11** (deleted row stays live until refetch) | **Still fixed** — row disappears immediately on confirm (§7.9) |
| **DEF-12** (pending guard on rapid toggles) | **Not re-tested directly** — covered by the e2e suite's "Undo twice sends exactly one request", which passed |
| **DEF-14** (primary button contrast) | **Not re-tested this pass** — see §10 |
| **DEF-15** (muted count contrast) | **Not re-tested this pass** — see §10 |
| **DEF-16** (search clear button 20×20 at mobile) | **Not re-tested this pass** — see §10 |

---

## 9. Console and network (task 5)

Captured on every page across all browser probes.

### 9.1 Console

| Message | Assessment |
|---|---|
| `A PressResponder was rendered without a pressable child…` | **DEF-02**, known and open. Confirmed present, not re-diagnosed. A React Aria warning; no functional impact seen in any flow I drove |
| `Failed to load resource: … 401 (UNAUTHORIZED)` | **Expected.** The browser logging the deliberate `401`s I provoked — bad sign-in, and the DEF-13 B invalidated session |
| `Failed to load resource: … 422 (UNPROCESSABLE_ENTITY)` | **Expected.** better-auth's response to the duplicate-email sign-up I submitted on purpose |

**No React errors, no hydration warnings, no unhandled rejections, no key
warnings.** Apart from DEF-02 the console is clean.

### 9.2 Network

Every request ≥ 400 across the whole pass, excluding `/_next/*`:

| Request | Why |
|---|---|
| `422 POST /api/auth/sign-up/email` | duplicate-email test (US-01) |
| `401 POST /api/auth/sign-in/email` | wrong-password / unknown-email tests (US-02) |
| `401 PATCH /api/todos/{id}/status` | DEF-13 reproduction B, session deleted on purpose |

**Every non-2xx was one I deliberately caused. No unexplained failures, no
`500`s anywhere in the pass.**

---

## 10. Build quality gate (NFR-10 / release criterion 4) — **Pass**

Not asked for, but PRD §7 makes it a release criterion, so I ran it:

| Command | Result |
|---|---|
| `npx tsc --noEmit` | **clean**, exit 0 |
| `npm run lint` | **clean**, no warnings or errors |
| `npm run build` | **succeeds** — 10 routes compiled, static generation 8/8 |

*(Build run with the test `DATABASE_URL` and a placeholder `BETTER_AUTH_URL` /
`BETTER_AUTH_SECRET`, never production values.)*

---

## 11. Two environment events worth recording

### 11.1 The checkout moved to another branch mid-pass

The working tree was on **`develop` @ `cd0f869`** when this pass started and
when every result below §10 was produced. By the time I wrote this file, the
checkout was on **`fix/deploy-region` @ `32310b7`**. I did not run any
`checkout`, `branch` or `commit` — the reflog shows the move and the commit
came from outside this session:

```
32310b7 HEAD@{0}: commit: fix: run the functions in the same region as the database
cd0f869 HEAD@{1}: checkout: moving from develop to fix/deploy-region
```

**This does not invalidate anything in this report:**

- **`develop` still points at `cd0f869`** — the exact commit I tested.
- `32310b7` touches only **`vercel.json`** and **`docs/STACK.md`**. It changes
  **no** file under `src/`, `e2e/`, `tests/` or `prisma/`, so the application
  and both suites are byte-identical to what I exercised.
- It does not touch this file either, so my edit carries cleanly.

**Action needed from whoever lands this:** this report is an uncommitted change
sitting on `fix/deploy-region`. **It describes the gate for `develop`** and
should be committed there. `docs/QA-REPORT.md` is identical across both
branches, so `git checkout develop` carries the modification over without
conflict. I did not switch branches myself, per the brief.

Worth noting for the release decision: **`32310b7` is not covered by this
gate.** My verdict in §12 is for `develop` @ `cd0f869`. A `vercel.json` adding
a function region is a deployment-topology change that this pass did not
exercise at all.

### 11.2 The local Postgres was stopped mid-pass

**The local Postgres stopped in the middle of this pass**, at `23:01:42 +07`,
between probe runs. Its log records:

```
2026-08-16 23:01:42.233 +07 [66733] LOG:  received smart shutdown request
```

A *smart shutdown request* is a deliberate stop issued from outside — DBngin's
own stop, or a `pg_ctl stop`. **It was not caused by my queries, and I issued
no shutdown**; my session only ever ran `SELECT`s plus the one scripted
`DELETE FROM session` for DEF-13 reproduction B. I restarted the instance with
DBngin's own binary against its own data directory (`pg_ctl … start`), which is
starting a stopped service, not killing one. All data was intact afterwards
(32 users, 65 todos), and the dev server reconnected cleanly — re-verified with
a fresh sign-up before continuing.

Flagging it because **DBngin's UI may still show that instance as stopped**
even though it is running, and because anything running against `:5432` at that
moment would have seen connection errors that had nothing to do with this app.

I stopped **only the dev server I started** (port 3483) at the end of the pass.
Nothing else was killed.

---

## 12. Ship / do not ship

> ## **SHIP.**

**Against PRD §7's release criteria:**

| # | Criterion | Result |
|---|---|---|
| 1 | All **Must** stories pass their acceptance criteria | **Yes** — US-01, US-03, US-04, US-05, US-06, US-07, US-09 all Pass. US-02 is Partial on **wording only**, and its behavioural and security criteria all pass |
| 2 | A test proves User A cannot read, edit, toggle or delete User B's todo via a direct request | **Yes** — the Vitest suite, plus my independent 31-check HTTP baseline (§6) |
| 3 | Unauthenticated access to every protected route redirects to `/sign-in` | **Yes** — server-side and, now that DEF-13 is fixed, client-side too |
| 4 | Build quality gate green | **Yes** (§10) |

**Why this ships and the last pass did not.** The last gate was blocked by one
thing: DEF-13, a Major sitting on US-03's acceptance criteria. **It is fixed,
and I verified the fix by both of its original reproductions rather than by
reading the diff.** Nothing else on the blocking list survived.

**The new feature is sound where it is hardest to be sound.** The timezone
boundary — the one thing that would have been invisible at UTC and wrong for
half the planet — is correct at **+14 and −11**, tested at instants where the
two calendars genuinely disagree, in a real browser. The single-section rule
holds in both directions and under filters and search. The four-key order is
right end to end, including the case the whole change exists for: **a
low-priority todo due today outranks a high-priority one due next month.**

**Why the two new defects do not block.** Both are **Low**, and **neither is a
code defect**:

- **DEF-17** is a wording divergence where `DESIGN.md` and the implementation
  agree with each other and the PRD disagrees with both. The security property
  behind the criterion — no account-existence oracle — I verified holds exactly.
- **DEF-18** is a self-contradictory acceptance criterion. The app matches PRD
  §2, which is normative.

Both are fixed by editing `docs/PRD.md`, not `src/`. Neither should hold a
release.

**What I would do in the next sprint, none of it blocking:**

1. **Amend the two PRD criteria** (DEF-17, DEF-18) so the next tester is not
   re-deriving these conclusions.
2. **Pin the timezone in the tests, not the environment** (§3.4) — set
   `timezoneId` per Playwright project and a fixed instant in the unit tests.
   Today the guarantee lives in one CI env var, and a green local run proves
   less than it appears to.
3. **Fix `.env`** (§2). It has now survived two gates pointing a plain
   `npm run dev` at production. It is the highest-risk item in the repo and it
   is not a product defect, which is exactly why it keeps not getting fixed.
4. **DEF-02**, still open, still cosmetic.
5. **DEF-14 / DEF-15 / DEF-16** — the contrast and tap-target misses from last
   pass, not re-tested here (§13).

---

## 13. Not tested / could not verify

Stated plainly, so nothing here reads as a pass it did not earn.

| Item | Why |
|---|---|
| **DEF-14, DEF-15, DEF-16** (contrast and tap-target defects from last pass) | **Not re-tested.** No contrast measurement or mobile-viewport pass this gate; the brief directed the effort at the due-date feature, isolation, and the story walkthrough. **Their status is unknown, not fixed** |
| **DEF-08** (dark-mode checkbox contrast) | Not re-tested this pass |
| **DEF-01** (44×44 touch target) | Not re-measured this pass |
| **NFR-05 / NFR-06** (responsive, dark mode) | Not systematically re-tested. All UI work this pass was at desktop width in the default theme |
| **DEF-12** (pending guard on rapid toggles) | Not re-tested directly; covered indirectly by a passing e2e spec |
| **US-12** | Not built, not tested, confirmed absent (§7.12) |
| **NFR-09** (200-todo performance, single query, no N+1) | **Not measured.** I did not seed 200 todos or count queries. The `orderBy` uses the documented index and sectioning is client-side, but I did not verify the query plan |
| **US-05 network-failure path** ("typed values remain in the form") | **Not tested.** I did not inject a create-request failure |
| **US-07 toggle-failure revert** | **Not tested** directly this pass; the e2e fault-injection spec covers it and passed |
| **Mutation testing** | Not re-done. Recorded in `docs/REVIEW.md` and independently verified there; re-running it would spend the gate's budget on a settled question |
| **Real multi-device / real-clock midnight** | Simulated with a pinned browser clock (§5.3), not observed on a device left running overnight |
