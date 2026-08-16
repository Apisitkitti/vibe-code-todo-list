# QA Report — Personal Todo App (v1) — **Release-gate pass on `develop`**

**Date:** 2026-08-16
**Branch:** `develop` @ `c45c0a3` (working tree clean at start and at end;
this file is the only thing this pass changed)
**Tester:** QA
**Purpose:** release gate. If this pass is clean, `develop` merges to `main`
and deploys to production.

Defect numbering continues from the previous passes. `DEF-01`…`DEF-12` mean
what they meant before. New defects this pass start at **DEF-13**.

---

## 0. Verdict, up front

> ## **DO NOT SHIP — one Major blocks.**

Both test suites are green, the cross-user isolation guarantee holds under an
independent method, and all eleven user stories behave to spec on the happy
paths. The blocker is **DEF-13**: a `401` arriving mid-session dead-ends the
UI instead of returning the user to sign-in — and I found it is not the rare
edge case it was assumed to be. **Signing out and pressing Back reproduces it
every time.**

It is a Major, not a Critical: **no data leaks and nothing writes**. The server
side is airtight. It is a recoverable-state bug, not a security bug. But it
sits on US-03's acceptance criteria, which is a **Must** story, and PRD §7's
release criteria require all Must stories to pass.

Full reasoning in §9.

---

## 1. Test accounts created for this pass

All in the **local `todo_app_test`** database, never production.

| Account | Purpose |
|---|---|
| `qa-a-1786883778@isolation.test` | Isolation baseline, user A (owns the data) |
| `qa-b-1786883778@isolation.test` | Isolation baseline, user B (the attacker) |
| `qa-ui-1786883778@isolation.test` | The US-01…US-11 UI walkthrough |
| `db-probe-1786883772@isolation.test` | One-shot probe proving my dev server wrote to the test DB |
| `gp-1786883792@isolation.test` | One-shot probe of `GET /api/todos/[id]` (DEF-04) |

Password for all: `qa-release-gate-8chars`.

They use the `@isolation.test` domain deliberately, so the Vitest suite's own
`deleteTestUsers` sweep reclaims them on its next run.

### 1.1 Environment note — and a live foot-gun worth naming

I ran the app on **port 3475** as instructed. Auth derives its base URL from
the request in development, so the non-standard port caused no problems.

**The foot-gun:** `.env`'s `DATABASE_URL` points at **Neon production**
(`ep-purple-sea-…aws.neon.tech/neondb`). `npm run dev` with no override
therefore serves the app against **production data**. Playwright is protected
from this — `resolveTestDatabaseUrl` refuses hosted hosts, non-`*_test` names
and the app's own URL, and `playwright.config.ts` injects the safe URL into its
`webServer.env`. **Manual QA has no such guard.**

I overrode it explicitly:

```
DATABASE_URL=postgresql://postgres@127.0.0.1:5432/todo_app_test \
  npm run dev -- --port 3475 --hostname 127.0.0.1
```

and then *proved* the override took, rather than assuming Next's env
precedence:

| Check | Result |
|---|---|
| `todo_app_test` user count before a sign-up probe | 3 |
| `POST /api/auth/sign-up/email` | `200` |
| `todo_app_test` user count after | **4** |

So every row this pass created is local. **I never pointed anything at the Neon
URL, and I never connected to it** — which also means I am not claiming to have
verified production's row counts, only that nothing of mine could have reached
it.

*Recommendation (not a defect):* give the dev script the same guard the test
harness already has, or a `DEV_ALLOW_HOSTED=1` opt-in. The next person doing a
manual pass will not think to check.

---

## 2. The existing suites — **both green** (task 1)

Run first, before anything else, exactly as asked.

### 2.1 Vitest

```
TEST_DATABASE_URL=postgresql://postgres@127.0.0.1:5432/todo_app_test npm run test:run
```

| | |
|---|---|
| Result | **6 files, 143 tests, 143 passed, 0 failed** |
| Vitest-reported duration | **2.42 s** (transform 107 ms, import 1.62 s, tests 470 ms) |
| Wall clock incl. npm start-up | **2.81 s** |

Matches the Senior's sign-off count (143) exactly.

### 2.2 Playwright

```
npm run test:e2e
```

| | |
|---|---|
| Result | **30 passed, 0 failed** (16 `chromium-desktop` + 14 `chromium-mobile`) |
| Playwright-reported duration | **1.1 m** |
| Wall clock | **67.4 s** |

Both projects ran; the Pixel 7 project ran its 14 real specs rather than
skipping. Exit code 0.

**Neither suite is red on `develop`, so nothing here blocks the release** and
the rest of this pass carried its full weight.

### 2.3 What I did *not* re-do

I did not re-run the authors' or the Senior's mutation testing. That work is
recorded in `docs/REVIEW.md` and was verified independently there by someone
who wrote their own sabotages. Repeating it would spend the gate's budget
re-proving a settled question. I spent it on §3–§6 instead, per the brief.

---

## 3. Cross-user isolation — **re-proved independently** (task 3)

This is the one guarantee worth proving twice, so I proved it by a **different
method** from the Vitest suite. The suite imports the route-handler functions
and calls them in-process with mocked `next/headers`. I drove the **running dev
server over real HTTP with `curl`**, real `Set-Cookie` session cookies, through
the real proxy and the real Next routing layer.

Script: `isolation.sh` (scratchpad). **26 checks, 26 passed, 0 failed.**

### 3.1 The matrix

Two fresh accounts. A creates two todos; B reaches for them.

| # | Attempt (as B, signed in) | Expected | Actual |
|---|---|---|---|
| 1 | `GET /api/todos` | none of A's | `{"todos":[],"totalCount":0,...}` — **empty** |
| 2 | `GET /api/todos` — A's title present? | no | not present |
| 3 | `GET /api/todos?q=secret` (a term only in A's row) | no match | no match |
| 4 | `PATCH /api/todos/{A1}` | `404` | **`404`** |
| 5 | `PATCH /api/todos/{A1}/status` | `404` | **`404`** |
| 6 | `DELETE /api/todos/{A1}` | `404` | **`404`** |
| 7 | `DELETE /api/todos/{A2}` | `404` | **`404`** |

**On `GET`:** the brief asked for `GET` against A's ids. There is **no
`GET /api/todos/[id]` route in this app** — the `[id]` route exports only
`PATCH` and `DELETE`, so the read path is the collection endpoint. I tested
that instead, both unfiltered and with a search term chosen to match A's row,
which is the read surface that actually exists. `GET /api/todos/{id}` returns
`405` for owner and stranger alike (that is **DEF-04**, already on the books as
informational — re-observed, unchanged, and it leaks nothing: the method is
rejected before any handler runs, identically whether signed in or out).

### 3.2 Not-found must be indistinguishable from not-yours

| Attempt | Status | Body |
|---|---|---|
| `PATCH` a **foreign** id | `404` | `{"code":"NOT_FOUND","message":"That todo no longer exists."}` |
| `PATCH` a **nonexistent** id | `404` | `{"code":"NOT_FOUND","message":"That todo no longer exists."}` |
| `PATCH /status` foreign | `404` | *identical* |
| `DELETE` foreign | `404` | *identical* |

Byte-identical status and body. **No existence oracle.**

### 3.3 Signed out — everything `401`

| Endpoint | Expected | Actual |
|---|---|---|
| `GET /api/todos` | `401` | **`401`** |
| `POST /api/todos` | `401` | **`401`** |
| `PATCH /api/todos/{id}` | `401` | **`401`** |
| `PATCH /api/todos/{id}/status` | `401` | **`401`** |
| `DELETE /api/todos/{id}` | `401` | **`401`** |
| any of the above with a **forged** cookie | `401`, not `500` | **`401`** |

### 3.4 No `500`s, and A's data intact afterwards

Every status above was asserted explicitly; a `500` anywhere would have
registered as a failure. None did.

After every attempt by B, re-read as A:

| Property | Result |
|---|---|
| A's todo still exists with its title | intact |
| Title not overwritten by B's attempted `PATCH` | intact |
| `completed` not flipped by B's `/status` | intact (`false`) |
| A's second todo not deleted | intact |
| `note` = `"A private note"` | intact |
| `priority` = `"high"` | intact |

And the guard is not simply denying everything — A can still operate on A's own
rows: `PATCH /status` → `200`, `PATCH` fields → `200`, `DELETE` → `204`.

**Verdict: NFR-01 / NFR-02 / US-04's isolation clause — Pass, by two
independent methods.**

---

## 4. User stories US-01 → US-11 (task 4)

Walked against the **current** rules, including the changed confirm behaviour.

| Story | Verdict |
|---|---|
| US-01 — Sign up | **Pass** |
| US-02 — Sign in | **Pass** |
| US-03 — Sign out | **Partial** — DEF-13 |
| US-04 — Protected routes | **Pass** (server-side); client-side gap is DEF-13 |
| US-05 — Create a todo | **Pass** |
| US-06 — List todos | **Pass** |
| US-07 — Toggle complete | **Pass** |
| US-08 — Edit a todo | **Pass** |
| US-09 — Delete with confirmation | **Pass** |
| US-10 — Filter by status and priority | **Pass** |
| US-11 — Empty state | **Pass** |

### 4.1 The confirm/Undo rules — verified as the new rule, not the old one

This is the part that changed, so I checked each mutation for **both** halves:
does it confirm, and does its toast carry Undo? Toasts were captured with a
`MutationObserver` so the 4 s expiry could not hide one from me.

| Action | Confirm dialog? | Toast | Undo on toast? | Skeleton? |
|---|---|---|---|---|
| Create | **No** ✓ | `Todo "Buy milk" added` | **Yes** ✓ | yes ✓ |
| Edit | **No** ✓ | `Todo "Buy oat milk" updated` | **Yes** ✓ | **yes** ✓ |
| Toggle | **No** ✓ | `Todo "Buy milk" marked not complete` | **Yes** ✓ | **no** ✓ |
| Delete | **Yes** ✓ | `Todo "Undo me" deleted` | **No** ✓ | **no** ✓ |
| Sign in / sign up | **No** ✓ | — | — | — |

Every cell matches `docs/CONVENTIONS.md` → *Mutation UX — confirm what cannot
be undone*. Notably the delete toast correctly carries **no** Undo, which is
the rule's own consistency check: the one irreversible action is the one that
asks first and does not pretend it can be taken back.

**Skeleton placement is exactly as specified:** it appears on create/edit save
and on filter change, and does **not** appear on toggle or delete. I confirmed
the negative cases by observing `0` skeleton nodes across a toggle and a
delete, and the positive cases by catching 12 skeleton nodes on an edit save
and again on a filter change.

**Per-row pending state exists:** rows carry `aria-busy` (observed `"false"` at
rest). The in-flight `true` window is genuinely short — local round trips were
5–11 ms per the dev server log — so I did not catch it visually; the attribute
and the disabled-control wiring are present, and the e2e suite asserts the
in-flight behaviour. I am recording the attribute as **verified present**, the
in-flight visual as **covered by the suite, not re-observed by me**.

**Deleted row disappears immediately:** confirmed. After confirming a delete the
row was gone from the DOM in the same read that saw the toast, with the count
already decremented (`0 of 1 done`), rather than after the refetch. This is the
DEF-11 fix holding.

### 4.2 US-01 — Sign up — **Pass**

- Form shows Name, Email, Password, "Create account", and a link to `/sign-in`. ✓
- Empty submit → all three fields show `This field is required.` and **no
  request is sent**. ✓
- `not-an-email` → `Enter a valid email address.` ✓
- 5-char password → `Use at least 8 characters.` ✓
- Valid submission → account created, signed in, redirected to `/todos`. ✓

**Copy-deck vs PRD divergence (not a defect).** PRD §3 US-01 quotes
`"Password must be at least 8 characters"` and `"Enter a valid email address"`.
The copy deck (`docs/DESIGN.md` §7.9, lines 1003–1005) specifies
`Use at least 8 characters.` and `Enter a valid email address.`, and
`CONVENTIONS.md` states validation messages come from the copy deck. The app
matches the copy deck. **The PRD's wording is stale, not the app's.** Worth one
edit to the PRD so the next tester does not file it.

### 4.3 US-02 — Sign in — **Pass**

- Wrong password → stays on `/sign-in`, shows `Sign in failed` /
  `That email and password don't match. Try again.` (copy deck line 1001). ✓
- **No existence oracle.** I compared the raw API responses:

  | Input | Response |
  |---|---|
  | real account, wrong password | `401 {"message":"Invalid email or password","code":"INVALID_EMAIL_OR_PASSWORD"}` |
  | account that does not exist | `401 {"message":"Invalid email or password","code":"INVALID_EMAIL_OR_PASSWORD"}` |

  Byte-identical. ✓ (Same PRD-vs-copy-deck wording divergence as above; the
  security property the AC actually protects is intact.)
- **`?next=` is honoured.** Signing in from `/sign-in?next=%2Ftodos` landed on
  `/todos`, not the default. ✓

### 4.4 US-03 — Sign out — **Partial** (DEF-13)

- Account menu shows my email and a `Sign out` item. ✓
- Sign out destroys the session, clears the cookie (`document.cookie` empty
  afterwards) and redirects to `/sign-in`. ✓
- **Back button after sign-out — fails its AC.** See DEF-13. No todo data is
  rendered (the security half holds), but the user is **not** redirected.

### 4.5 US-04 — Protected routes — **Pass** (server side)

- Unauthenticated `/todos` → redirected to
  `/sign-in?next=%2Ftodos`, no todo data in the response. ✓
- Query strings survive: `/todos?status=active&priority=high` →
  `/sign-in?next=%2Ftodos%3Fstatus%3Dactive%26priority%3Dhigh`. ✓
- **Invalid (deleted) session cookie** on a fresh navigation → redirected to
  `/sign-in`, no data. ✓ — this is `requireUser()` doing its job past the
  cookie-presence-only proxy.
- Direct mutation calls with no session → `401`, no write (§3.3). ✓
- Foreign todo id → not-found, nothing exposed or changed (§3.1). ✓

The client-side half of "expired session → back to sign-in" is DEF-13.

### 4.6 US-05 — Create — **Pass**

Created `Buy milk` with everything else untouched; read the record straight
back from the API:

```json
{"title":"Buy milk","note":null,"priority":"medium",
 "completed":false,"dueAt":null}
```

Exactly the AC's required defaults. It appeared at the top of the list with no
full page reload, and the empty state was replaced. ✓

### 4.7 US-06 — List — **Pass**

- Only my own todos (§3). ✓
- Row shows title, completion control, priority chip, due date when set. ✓
- **Completed styling is not colour alone:** the completed title computes
  `text-decoration-line: line-through`. ✓ (NFR-04's "never by colour alone".)
- The priority chip carries a `■` glyph plus the visually-hidden text
  `Priority: Medium`, so priority is not colour-alone either. ✓
- Loading shows a skeleton rather than a blank screen. ✓

### 4.8 US-07 — Toggle — **Pass**

- Toggling flipped `completed`, restyled the row, and updated the accessible
  name from `Mark "Buy oat milk" as complete` to `…as not complete`. ✓
- **Persists across reload** — still complete after a full navigation, and the
  header count read `1 of 1 done`. ✓
- No confirm dialog, Undo offered, no skeleton (§4.1). ✓
- Only `completed` changes — the `/status` route takes a `.strict()` schema of
  exactly `{completed}` and rejects anything else, and §3 confirms title, note,
  priority and due date survived untouched. ✓

### 4.9 US-08 — Edit — **Pass**

- Edit opens **pre-filled** with the row's current values (observed
  `Edit todo` heading with the title populated). ✓
- Saving a changed title updated the row and the toast named the new title. ✓
- Cancel / Escape closes without mutating, and **focus returns to the
  triggering control** (`activeElement` was a `BUTTON` after Escape). ✓
- Scoped by `id` + `userId`; a foreign id is `404` (§3.1). ✓

### 4.10 US-09 — Delete — **Pass**

The confirm dialog meets every requirement in `CONVENTIONS.md` §1:

| Requirement | Observed |
|---|---|
| Opens before anything is deleted | both rows still present while open ✓ |
| Names the specific record | `"Undo me" will be permanently deleted. This can't be undone.` ✓ |
| Not a bare "Are you sure?" | ✓ |
| `Cancel` focused by default | `activeElement` = `BUTTON:Cancel` ✓ |
| Destructive confirm + Cancel present | `["Cancel","Delete"]` ✓ |
| Correct role | `role="alertdialog"` ✓ |
| Escape closes without mutating | ✓ (§4.9) |

Confirming removed the row immediately, decremented the count, closed the
dialog, and raised a toast with **no** Undo. ✓

### 4.11 US-10 — Filters — **Pass**

- Defaults are All / All priorities. ✓
- Selecting `Completed` → URL becomes `/todos?status=completed`, list filters,
  skeleton shows. ✓
- **Filters survive a reload**: navigating directly to
  `/todos?status=active&priority=high` restored `Active` selected
  (`aria-checked="true"`) and the priority control reading `High`. ✓
- Filters combine with AND — that combination matched nothing while todos
  existed, and produced the no-match state (below). ✓
- Results still contain only my own todos (§3.1, search included). ✓

### 4.12 US-11 — Empty states — **Pass**, and all four are distinct

| Situation | Copy shown |
|---|---|
| Zero todos | **`Nothing here yet`** / `Add your first todo and it will show up here.` / `New todo` |
| Filter matches nothing | **`No todos match these filters`** / `Try a different status or priority.` / `Clear filters` |
| `status=completed`, none done | **`Nothing completed yet`** / `Todos you finish will appear here.` |
| `status=active`, none active | `All caught up` / `You have no active todos. Nice.` |

- The zero-todos state is **visually distinct** from the no-match state, as its
  AC requires. ✓
- On the zero-todos state the **filter chrome is absent** (`[role=radio]` count
  0) — "no filter chrome implying missing data". ✓
- Exactly **one** `New todo` button on that screen — the empty state's CTA, with
  the toolbar copy correctly suppressed to avoid two identical CTAs. ✓
- Its CTA opens the create form. ✓
- **Deleting the only remaining todo brought the empty state back**, filter
  chrome disappearing with it. ✓

---

## 5. The tab icon (task 5) — **Pass**

| Check | Result |
|---|---|
| `GET /icon.svg` | **`200`**, `content-type: image/svg+xml` |
| `<link rel="icon">` in `<head>` | `href="/icon.svg?icon.1lb78i28-6hsc.svg" sizes="any" type="image/svg+xml"` ✓ |
| `GET /favicon.ico` | **`404`** — the old default is gone ✓ |
| `favicon.ico` anywhere in source | none ✓ |
| Tab title | `Todos` / `Sign in · Todos` ✓ |

The only `favicon.ico` on disk is a stale build artifact under
`.next/dev/static/media/` — a cache leftover, not served (the live request
`404`s) and not in source control. It will not survive a clean build. **Not a
defect**, noted so nobody re-files it.

The icon itself is sound for its job: a rounded square with a checkmark, colours
as literals rather than theme tokens (correct — a favicon renders outside the
document), drawn for 16 px.

---

## 6. Console and network (task 6)

Watched throughout the whole pass.

### 6.1 DEF-02 — `PressResponder` warning — **still present**

```
[warn] A PressResponder was rendered without a pressable child.
       Either call the usePress hook, or wrap your DOM node with <Pressable>.
```

Confirmed still open, as asked — **not re-diagnosed**; the root cause is
already pinned in the previous pass and in `REVIEW.md`. Observed on essentially
every `/todos` render, in both my browser session (7 occurrences across the
pass) and in the Playwright run's captured browser output. Console noise only:
no functional impact was observed anywhere in this pass.

### 6.2 Everything else

| Category | Finding |
|---|---|
| React errors | **none** |
| Hydration warnings | **none** |
| Unhandled exceptions | **none** |
| Failed requests | only the `401`s I deliberately caused (session deleted, wrong password) |
| Unexpected/duplicate requests | none observed |
| Other noise | React DevTools hint, HMR connect, Vercel Speed Insights debug — all dev-only |

### 6.3 NFR-07 — no secrets in the client bundle — **Pass**

Scanned for the literal `BETTER_AUTH_SECRET` value and the database password:

| Surface | Secret | DB password | Neon host |
|---|---|---|---|
| `/sign-in` HTML | 0 | 0 | 0 |
| `.next/static` (everything client-served) | 0 | 0 | 0 |
| whole `.next` tree | 0 | — | — |

Also: **no client component imports Prisma** (cross-checked every `"use client"`
file against `lib/prisma` / `@prisma/client` — no hits), and the only
`NEXT_PUBLIC_*` references are `NEXT_PUBLIC_APP_URL` and
`NEXT_PUBLIC_API_BASE_URL`, neither of which is set in `.env` and neither of
which carries a secret.

---

## 7. Where the suites are thin — what I found there (task 2)

The four gaps I was pointed at, plus what came out of them.

### 7.1 Keyboard tab-order sweep — **done, and it passes**

No suite covers this. I recorded the real focus sequence with a `focusin`
listener while sending genuine `Tab` keypresses from the top of the document,
on `/todos` with two rows:

```
1. Switch to light theme      6. Mark "Undo me" as complete
2. Account menu               7. Edit "Undo me"
3. New todo                   8. Delete "Undo me"
4. status filter (one stop)   9. Mark "Buy milk" as complete
5. Filter todos by priority  10. Edit "Buy milk"
6. Search todos              11. Delete "Buy milk"
```

then wraps. **The order matches the visual order exactly**, every interactive
control is reachable, and each row's three controls are grouped together and
correctly named with the todo's title. No keyboard traps, no off-screen stops,
no positive `tabindex`. **NFR-04's tab-order clause: Pass.**

**One thing that looked like a defect and is not.** The status filter appears to
"skip" `Active`: Tab visits `All`, then leaves the group. That is the correct
WAI-ARIA radio-group pattern — the group is one tab stop and arrows move inside
it. I verified the inside works: `ArrowRight` from `All` moves focus to
`Active`. It is a `role="radiogroup"` of `role="radio"` children. **Correct, not
a bug** — recording it because it looks alarming in a focus trace and the next
person will otherwise file it.

**Focus indicators** are visible in both themes (confirmed on the `New todo`
button in dark mode and throughout the sweep). **Escape** closes the modal and
**restores focus to the trigger** (§4.9).

### 7.2 Dark mode and visual coverage — **done; two contrast failures found**

No suite covers this either. I measured WCAG 2.1 contrast directly from
computed styles, compositing every translucent layer down to an opaque
backdrop (Tailwind v4 emits `oklch`/`oklab`, and several surfaces are 12 %
tints — naïve sampling gets these badly wrong).

**Dark mode:**

| Element | Ratio | Required | Result |
|---|---|---|---|
| `h1 "Your todos"` | 19.74 | 3 | pass |
| Row title | 17.27 | 4.5 | pass |
| Completed (de-emphasised) title | 6.75 | 4.5 | pass |
| `N of M done` count | 7.72 | 4.5 | pass |
| Status filter, selected | 7.46 | 4.5 | pass |
| Status filter, unselected | 14.52 | 4.5 | pass |
| Priority chip "Medium" | 9.22 | 4.5 | pass |
| Search input text | 17.27 | 4.5 | pass |
| **`New todo` primary button** | **3.59** | 4.5 | **FAIL — DEF-14** |

**Light mode:**

| Element | Ratio | Required | Result |
|---|---|---|---|
| `h1` | 16.25 | 3 | pass |
| Row title | 14.73 | 4.5 | pass |
| Completed title | 4.83 | 4.5 | pass |
| Status filter, selected | 4.68 | 4.5 | pass |
| **`N of M done` count** | **4.43** | 4.5 | **FAIL — DEF-15** |
| **`New todo` primary button** | **3.59** | 4.5 | **FAIL — DEF-14** |

**DEF-08 (the dark-mode checkbox fix) is still in** — the checkbox renders
visibly in dark mode and the row/chip/title figures above are all comfortably
clear. No regression.

A correction against myself, since a false number here would be worse than
none: my first measurement flagged the selected `All` filter at **1.51:1**.
That was **my measurement error**, not the app's — I had treated a 12 %-alpha
background as opaque. Composited properly it is **7.46:1** and passes. The two
failures above survived that correction and were re-measured on the
text-bearing leaf nodes.

### 7.3 Responsive / touch targets — checked at 320, 375 and 1280

| Width | Finding |
|---|---|
| 320 px | `scrollWidth` 320, **no horizontal scroll**, zero overflowing elements ✓ |
| 375 px | checkbox target **44×44** ✓; all row Edit/Delete **44×44** ✓; header buttons **44×44** ✓; status filters 114×44 ✓ |
| 1280 px | checkbox target 36×36 |

**The 36×36 at desktop is intentional, not DEF-01 regressing.** The class is
`min-h-11 min-w-11 sm:min-h-9 sm:min-w-9` — 44 px below the `sm` breakpoint
where touch matters, 36 px above it where the pointer is a mouse. **DEF-01
remains fixed**; I confirmed the 44 px figure at mobile width, which is the
width its AC is about.

One genuine miss at mobile width: the search field's clear button is **20×20**
(**DEF-16**).

### 7.4 The mid-session `401` — **confirmed still broken, and worse than pinned**

See **DEF-13**. It is tracked in `REVIEW.md` as **m-3** and had no QA defect
number; it has one now.

### 7.5 Non-Chromium — **could not verify**

Both Playwright projects are Chromium (`Desktop Chrome`, `Pixel 7`) and the
only browser available to me here is Chromium-based. **No WebKit or Firefox
evidence exists for this release, from the suite or from me.** Stated as an
unknown, not as a pass. Given the app leans on react-aria and HeroUI v3 —
libraries with real cross-engine behavioural differences in focus, press and
overlay handling — this is the largest untested surface remaining after
DEF-13 is fixed.

---

## 8. Defects

Severity: **Critical** = data loss/leak or release-stopping; **Major** = a Must
story's AC fails; **Minor** = real but non-blocking; **Informational** = noted.

### DEF-13 — **Major** — a `401` mid-session dead-ends; sign-out + Back reproduces it

**Status:** new number; previously tracked as `REVIEW.md` **m-3**, confirmed
still open.
**Affects:** US-03 (Must), US-04's expired-session clause, NFR-02's spirit.

**Expected** — `docs/PRD.md` §3 US-03:

> "Given I have signed out, When I press the browser Back button to return to
> `/todos`, Then I am redirected to `/sign-in` and no todo data is rendered."

and US-04:

> "Given my session cookie is expired or invalid, When I request a protected
> route, Then I am treated as unauthenticated and redirected to `/sign-in`."

**Reproduction A — the ordinary one (no special setup):**

1. Sign in; land on `/todos`.
2. Open the account menu → **Sign out**. You arrive at `/sign-in`. ✓
3. Press the browser **Back** button.

**Actual:** the URL returns to `/todos?…` and the app shell renders with an
error panel:

> **Couldn't load your todos** — Sign in again to continue. — `[Try again]`

The user is **not** redirected to `/sign-in`. `Try again` re-fetches, `401`s
again, and returns the same panel — there is no control on the screen that
leads to sign-in. The header still renders the signed-in account avatar.

**Reproduction B — a session invalidated server-side mid-session:**

1. Sign in, sit on `/todos` with a row visible.
2. Invalidate the session server-side:
   `delete from session s using "user" u where u.id = s."userId" and u.email = '<account>';`
3. Click a row's completion checkbox.

**Actual:** `PATCH /api/todos/{id}/status` → `401`. A danger toast reads
`Sign in again to continue.` The checkbox correctly stays unchanged, the stale
list stays on screen, and **no redirect happens**. Still on `/todos`.

**What is *not* wrong, and bounds the severity:**

- **No data leaks.** The Back-button page renders no todo data
  (`/Buy oat milk/` absent from the document).
- **Nothing writes.** The `401` is returned before any database work.
- **No false success.** The checkbox reverts; the failure is reported honestly.
- **A fresh navigation is handled correctly** — reloading that same URL
  redirects to `/sign-in?next=%2Ftodos%3Fstatus%3Dactive%26priority%3Dhigh`,
  query string preserved. The server-side guard is sound; the gap is purely
  client-side.

**Why it blocks:** it was pinned on the assumption that a mid-session expiry is
rare. Reproduction A is not rare — it is sign out, then Back, which users do
constantly, and it is written into US-03's AC verbatim. The user is left on a
dead screen whose only offered action cannot succeed, while the chrome claims
they are signed in.

**Fix shape (not my call, but it is small):** the app has one shared axios
instance at `src/lib/http.ts` with a response interceptor already in place. A
`401` there can redirect to `signInPathWithNext(location.pathname + location.search)`
— the sanitiser it needs already exists in `src/lib/routes.ts` and is already
tested.

---

### DEF-14 — **Minor** — primary button text fails AA in **both** themes

**Affects:** NFR-06.

**Expected** — `docs/PRD.md` §5 NFR-06:

> "Text meets WCAG AA contrast (4.5:1 for body text) in both themes."

**Actual:** the primary button label is `rgb(252,252,252)` on `rgb(4,133,247)`
= **3.59:1** at **14 px** (not large text, so 4.5:1 applies). Identical in light
and dark — it is one accent token, so the theme is irrelevant.

**Reproduction:** load `/todos` in either theme, measure the `New todo` button's
label against its own background. Same token backs the modal's `Add todo` /
`Save changes` submit buttons and the toast's `Undo` action, so the fix is
one token, not four.

**Note:** at 3.59:1 it clears AA for *large* text (3:1) — so darkening the
accent slightly, or bumping the label to 16 px semibold, would each close it.

---

### DEF-15 — **Minor** — muted count text fails AA in light mode

**Affects:** NFR-06.

**Expected:** as DEF-14 — 4.5:1 for body text in both themes.

**Actual:** the `N of M done` count beside the heading is `rgb(113,113,122)` on
`rgb(245,245,245)` = **4.43:1** at 14 px. Marginal, but under.

Dark mode is fine (7.72:1). Same muted token is comfortable elsewhere in light
mode where it sits on white (`rgb(255,255,255)`) rather than the page's
`rgb(245,245,245)`; it is the slightly darker page background that tips it
under.

---

### DEF-16 — **Minor** — search clear button is 20×20 at mobile width

**Affects:** NFR-05.

**Expected** — `docs/PRD.md` §5 NFR-05:

> "Primary tap targets are at least 44x44px."

**Actual:** at 375 px wide, `button.search-field__clear-button` measures
**20×20**. Every other control on the screen is correctly 44×44 at that width
(checkbox, Edit, Delete, header buttons, filters), which is what makes this one
stand out as an oversight rather than a decision.

---

### Previously-filed defects — status this pass

| Defect | Status |
|---|---|
| **DEF-01** (44×44 touch target) | **Still fixed** — 44×44 confirmed at 375 px; the 36×36 at desktop is the intended `sm:` step-down, not a regression |
| **DEF-02** (`PressResponder` warning) | **Still open**, confirmed present, console noise only — not re-diagnosed |
| **DEF-04** (`GET /api/todos/[id]` → `405`) | **Unchanged, informational** — re-observed; identical for owner and stranger, leaks nothing |
| **DEF-08** (dark-mode checkbox contrast) | **Still fixed** — no regression |
| **DEF-11** (deleted row stays live until refetch) | **Fixed** — row now disappears immediately on confirm |
| **DEF-12** (pending guard on rapid toggles) | **Not re-tested by me** — covered by the e2e suite's "Undo twice sends exactly one request", which passed |

---

## 9. Ship / do not ship

> ## **DO NOT SHIP** until DEF-13 is fixed.

### What is genuinely solid

Most of this release is in good shape, and the gate should say so plainly:

- **Both suites green**, first run, no flakes: 143 Vitest in 2.4 s, 30
  Playwright in 1.1 m.
- **Cross-user isolation holds under an independent method** — 26/26 over real
  HTTP with real cookies, `404` everywhere it should be, no `500`s, no
  existence oracle, A's data byte-for-byte intact afterwards. This is the
  guarantee I was most worried about and it is the one I am most confident in.
- **The new confirm/Undo model is implemented correctly and consistently** —
  every cell of the rule's own table checks out, including the negative cases
  (delete offers no Undo; toggle and delete raise no skeleton).
- **Keyboard tab order passes** a sweep nothing had run before.
- **No secrets reach the client.** No console errors. Responsive down to 320 px.
- The tab icon landed and the old favicon is gone.

### Why DEF-13 still blocks

PRD §7 release criterion 1 is "All Must stories pass their acceptance criteria."
US-03 is a **Must**, and its Back-button AC fails by its own words. This is not
me reading the AC uncharitably to find something: the AC anticipated this exact
interaction and wrote down the exact expected behaviour.

What moved it, for me, from "known issue, ship anyway" to "blocker" is
**Reproduction A**. It had been carried as a rare mid-session expiry. It is not
rare — signing out and pressing Back is a completely ordinary thing to do, it
reproduces every time, and it leaves the user on a screen that says "Sign in
again to continue" while offering no way to sign in and still showing a
signed-in header. That is a dead end reachable in two clicks from a normal
sign-out.

I want to be precise about severity, because it would be wrong to inflate it:
**this is not a security defect.** No data leaks, nothing writes, the server
side refuses correctly every time, and a fresh navigation redirects properly
with `?next=` intact. If the call were mine alone and the release were urgent, I
would say the risk of shipping is *reputational and usability*, not *safety*.
But it fails a Must story's stated AC, the fix is small and localised (one
interceptor in `src/lib/http.ts`, using a sanitiser that already exists and is
already tested), and this is a release gate rather than a judgement call about
urgency. So: fix it, re-run both suites, and re-test the two reproductions in
§DEF-13. That is a short loop.

**DEF-14, DEF-15 and DEF-16 do not block.** They are real NFR-06/NFR-05 misses
and should be scheduled, but they are Minor, none of them is a regression, and
NFR-06 is a **Should** in PRD §6. DEF-14 is worth doing soon simply because it
is one design token and it affects every primary button in the app.

### Conditions I would want met before the next gate

1. **DEF-13 fixed**, with both reproductions in §DEF-13 re-tested.
2. Both suites re-run green.
3. **A regression test for DEF-13** — the e2e harness can express this
   directly (sign out, `goBack()`, assert the URL is `/sign-in`), and without
   one this will come back.
4. The **dev-server production-database foot-gun** (§1.1) given the same guard
   the test harness already has.

---

## 10. Not tested / could not verify

Listed explicitly so none of it is mistaken for a pass.

| Item | Why |
|---|---|
| **Space / Enter activation by keyboard** | **Harness fault.** This browser tool delivers key events with `key: ""`, `code: ""`, `keyCode: 0` for activation keys — verified directly with a `keydown` listener. `Tab`, `Escape` and `ArrowRight` arrive correctly and were used. So tab *order*, arrow navigation within the radio group, and Escape are verified; **activating a control via Space/Enter is unverified by me.** The e2e suite exercises real keyboard activation in Chromium. |
| **Non-Chromium browsers** | No WebKit/Firefox available; both Playwright projects are Chromium. Unknown for this release (§7.5). |
| **Undo pressed through the UI end-to-end** | The toast expires in 4 s and my tool round-trip is slower, so I could not reliably click it. I verified the **affordance** — Undo present on create/edit/toggle, absent on delete — via a `MutationObserver` that cannot miss a toast. The e2e suite verifies Undo's *behaviour* with real clicks, including double-press coalescing and a later write disarming an earlier Undo; those 30 specs passed. |
| **`aria-busy="true"` observed in flight** | Local round trips were 5–11 ms. The attribute exists and reads `false` at rest; the in-flight state is asserted by the suite, not re-observed by me. |
| **Flash of wrong theme on first paint (NFR-06)** | The bootstrap script is in `<head>` and applied `dark` from `localStorage` correctly on load, but I could not measure first-paint timing through this harness. Mechanism correct; flash itself unverified. |
| **Production database state** | I never connected to it and never pointed anything at it (§1.1). I therefore assert only that my work could not have reached it — not that I inspected it. |
| **`npm run build` / `tsc --noEmit` / `lint` (NFR-10)** | Not run in this pass. CI runs all three ahead of the tests, and the Senior verified that job end-to-end after the B-1 fix. |
| **DEF-12** | Not re-tested directly (§8). |
| **Mutation testing of the suites** | Deliberately not repeated (§2.3). |

---

*Isolation script and raw captures for this pass are in the session scratchpad
(`isolation.sh`). Working tree clean; `docs/QA-REPORT.md` is the only file this
pass modified. My dev server on port 3475 was stopped at the end of the pass —
by PID, and no other process was touched.*
