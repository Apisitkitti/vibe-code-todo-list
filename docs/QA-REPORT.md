# QA Report — Personal Todo App (v1) — **Release-gate pass on `develop`**

Tester: QA engineer
Date: 2026-08-16
Branch under test: `develop` @ `a6e9782` (merge of `fix/qa-regression-findings`)
Build under test: `npx next dev -p 3465` on `http://localhost:3465`, Neon Postgres (live DB)
Method: black-box testing through the browser for the user-visible flows, plus
direct API probes issued with `curl` against real session cookies (for the
auth/ownership checks the UI cannot reach), plus DOM measurement and hit-testing
for the responsive and contrast assertions.

This report replaces the 2026-08-16 regression pass. Defect numbering is carried
over so the passes can be compared: `DEF-01`…`DEF-07` are the previous defects,
`DEF-08`…`DEF-10` are new in this pass. `M-*` / `m-*` refer to the Senior's
review findings — note that **`M-1`…`M-5` in this report mean the findings in the
newest review section** (`fix/qa-regression-findings` → `develop`), not the
same-numbered findings from the first review.

## Test accounts created

| Account | Name | Email | Password |
|---|---|---|---|
| A | Ada | `qa+a1786858394@example.com` | `Password123!` |
| B | Grace | `qa+b1786858394@example.com` | `Password456!` |
| C | Cyd | `qa+ui1786858394@example.com` | `short12Password789!` |

Accounts A and B are the isolation pair, driven entirely through the API.
Account C is the UI walkthrough account, created through `/sign-up` in the
browser.

Todo ids used in the isolation tests (owned by account A):

- `cmsvdcw7o0000vcveg1zurv8h` — "Ship release v3"
- `cmsvdcwch0001vcve1lg0y0em` — "Buy milk"

Account B's own todos: `cmsvdcwgh0002vcve8p2axpqk` ("Grace private task") and
`cmsvde0ci0003vcvengyzz4l9` ("Spoof attempt", created by the `userId`-spoof probe).

### Environment notes (please read)

1. **The port problem from the previous pass is gone.** The app ran on port
   3465 and every auth call worked — sign-up, sign-in and sign-out all
   succeeded, and `?next=` round-tripped. The dev-mode base-URL derivation is
   verified live on a non-3000 port. **No process was killed during this run**;
   the only server started was this app's own, and it is the only one stopped.
2. **Harness limitation — explicit viewport resizes disable pointer and
   keyboard activation.** After any `resize_window` call the preview pane still
   renders, hydrates and runs JavaScript (React mounts, `HMR connected`, console
   warnings fire), but no click or key press reaches a react-aria `onPress`
   handler. Reverting to the pane's native size restores input immediately. This
   was proved by toggling the theme button at native size (works) and at
   1280×800 and 900×700 after a full reload (dead). **I nearly filed this as a
   Blocker ("the New todo button does nothing") and it would have been wrong** —
   flagging it prominently so the next pass does not repeat the mistake.
   Consequence: every interaction test was run at the pane's native viewport of
   **427×351 CSS px**, and the 375 px / 320 px assertions are measurement and
   hit-testing only.
3. **Desktop-width interaction could not be exercised at all.** 427 px is below
   the `sm:` breakpoint, so the app was in its mobile layout throughout, and
   `isDesktop` was false. **The row Edit/Delete tooltips were therefore never
   rendered and are not re-verified in this pass** (they were verified fixed in
   the previous pass). Marked Could not verify, not Pass.
4. Selecting existing text to replace it is unreliable in this harness
   (`cmd+A` did not select inside a password field; `triple_click` did not
   select inside a password field either, though it worked in a text input).
   Where this mattered it is called out.

---

## 1. Verdict summary

| ID | Story | Verdict | Change vs previous pass |
|---|---|---|---|
| US-01 | Sign up with email + password | **Pass** | — |
| US-02 | Sign in | **Pass** | — |
| US-03 | Sign out | **Pass** | — |
| US-04 | Protected routes | **Pass** | — |
| US-05 | Create a todo | **Pass** | — |
| US-06 | List todos | **Fail** | **regression exposed: DEF-08, no visible completion control in dark mode** |
| US-07 | Toggle complete/incomplete | **Partial** | behaviour + Undo pass; the control is invisible in dark mode (DEF-08) |
| US-08 | Edit a todo | **Pass** | — |
| US-09 | Delete a todo with confirmation | **Pass** | — |
| US-10 | Filter by status and priority | **Pass** | — |
| US-11 | Empty state | **Pass** | — |

| NFR | Area | Verdict | Change |
|---|---|---|---|
| NFR-01 | Per-user authorization | **Pass** (re-run in full — see §2) | held, now covers `/status` |
| NFR-02 | Server-side auth checks | **Pass** | held |
| NFR-03 | Password policy | **Pass** | held |
| NFR-04 | Keyboard accessibility | **Partial** | DEF-02 residual; dialogs re-verified good |
| NFR-05 | Responsive / touch targets | **Pass** | held at 320 and 375 |
| NFR-06 | Dark mode | **Fail** | **DEF-08** — was Pass |
| NFR-08 | Validation parity | **Pass** | was Partial — DEF-07 fixed |

### Items under test (from the brief)

| # | Item | Verdict |
|---|---|---|
| 1 | The user-visible app still works (US-01…US-11) | **Verified**, with DEF-08 against US-06/US-07 |
| 2 | DEF-02 — `PressResponder` gone from `/todos` and `/sign-up` | **Still broken** on `/todos` (1 per load); **Verified** on `/sign-up` (0) |
| 2 | Confirm dialogs open, close on Escape and Cancel, trap focus, Cancel focused first on destructive | **Verified** |
| 3 | Split routes at the API level (all 7 probes) | **Verified** |
| 3 | Every error body carries `code` and `message`; no message names a method or route | **Verified** |
| 4 | Validation messages, no raw zod English | **Verified** (one wording bug, DEF-09) |
| 5 | Cross-user data isolation, re-run in full incl. `/status` | **Verified** |
| 6 | Console and network — rejections, failed requests, 500s | **Verified** (only DEF-02 warning) |
| — | Dark mode spot-check | **Still broken** — DEF-08 |
| — | Mobile 375 px + 44 px checkbox (DEF-01) | **Verified** |

### Senior review findings M-1…M-5 (newest section) claimed closed by `5b78310`

| Finding | Verdict |
|---|---|
| M-1 — status route's unreachable branch, wrong message on a wrong-type body | **Verified fixed** — two distinct, accurate messages (§3 item 3) |
| M-2 — developer copy (HTTP methods, route paths) in user-facing messages | **Verified fixed** — no message names a method or a path |
| M-3 — `POST /api/todos` still accepted and dropped `completed` | **Verified fixed** — now `400` |
| M-4 — no `500` code, so "every error carries `message`" was not total | **Partially fixed / could not verify** — see DEF-10 |
| M-5 — `BETTER_AUTH_URL` unset in production | **Verified by code inspection only** — cannot boot a production build here |

### Previous fixes, re-checked

| Fix | Verdict |
|---|---|
| DEF-01 — checkbox 44×44 tap target | **Verified fixed** (held at 320 and 375) |
| DEF-02 — `PressResponder` warning | **Partially fixed** — `ConfirmDialog` cleared; one source remains on `/todos` |
| DEF-03 / M-4(old) — `note` / `dueAt` optional | **Verified fixed** |
| DEF-04 — `GET /api/todos/[id]` → `405` | Unchanged, still informational only |
| DEF-05 — mobile status filter full width | **Verified fixed** |
| DEF-06 — `PATCH` silently dropping `completed` | **Verified fixed** |
| DEF-07 — raw zod English on wrong-type input | **Verified fixed** |

**One Major found (DEF-08).** DEF-06 and DEF-07 are genuinely closed, the route
split is correct, and cross-user isolation holds under every probe including the
new `/status` route.

---

## 2. Cross-user data isolation — the critical test

**Result: PASS.** Re-run in full at the API level with two brand-new accounts,
now including the `/status` route that did not exist at the last isolation pass.

Setup: account A owned two todos; account B was signed in and owned one. Every
probe below was issued with account B's session cookie against account A's real
todo ids.

| Probe (as B) | Expected | Actual | Verdict |
|---|---|---|---|
| `GET /api/todos` | none of A's todos | only B's own todo | Pass |
| `PATCH /api/todos/cmsvdcw7o0000vcveg1zurv8h` `{title:"HACKED BY B",note:"pwned",…}` | `404` | `404 {"code":"NOT_FOUND","message":"That todo no longer exists."}` | Pass |
| **`PATCH /api/todos/cmsvdcw7o0000vcveg1zurv8h/status`** `{"completed":false}` | `404` | `404` same body | **Pass — new route covered** |
| **`PATCH /api/todos/cmsvdcwch0001vcve1lg0y0em/status`** `{"completed":true}` | `404` | `404` same body | **Pass** |
| `DELETE /api/todos/cmsvdcw7o0000vcveg1zurv8h` | `404` | `404` same body | Pass |
| `DELETE /api/todos/cmsvdcwch0001vcve1lg0y0em` | `404` | `404` same body | Pass |
| `GET /api/todos/<A's id>` | `404` | `405`, empty body — no `GET` handler (DEF-04) | Pass with note |

No probe returned A's data and **no probe returned a `500`**.

**No existence oracle.** A real foreign id and `totally-made-up-id-xyz` return
byte-identical responses on every verb — `404 {"code":"NOT_FOUND","message":"That
todo no longer exists."}` for `PATCH`, `PATCH /status` and `DELETE`, and `405`
(empty) for `GET`. Verified side by side in the same run.

**Post-attack integrity check.** Re-read as A at the end of the run: both todos
**unchanged** — no title rewritten to "HACKED BY B", `Ship release v3` kept its
note "cut the tag" and its due date, `Buy milk` still present. Account A never saw
any of B's rows.

**`userId` is not client-controllable.** `POST /api/todos` as B with
`"userId":"u0aJWgnCfL5Zj4Xuc6R1OwYjtuQ962nt"` (account A's real id) in the body
returned `201`, and the created todo appeared in **B's** list — the session user —
never under A. A's `totalCount` stayed at 2. NFR-01 upheld.

**No leakage under search.** As B, `?query=milk`, `?query=ship` and
`?query=release` — account A's exact titles — each returned `{"todos":[]}`.

**Unauthenticated access — all `401`, no writes.** With no cookie at all:

| Endpoint | Actual |
|---|---|
| `GET /api/todos` | `401 {"code":"UNAUTHORIZED","message":"Sign in again to continue."}` |
| `POST /api/todos` | `401` same body |
| `PATCH /api/todos/<A's id>` | `401` same body |
| `PATCH /api/todos/<A's id>/status` | `401` same body |
| `DELETE /api/todos/<A's id>` | `401` same body |
| `GET /api/todos/<A's id>` | `405` (no handler) |

A forged cookie (`better-auth.session_token=forged.deadbeef`) against
`PATCH /status` also returned `401`. A's data was intact afterwards.

**Protected route, signed out.** `/todos` redirects to `/sign-in?next=%2Ftodos`
and the delivered HTML contains none of the todo titles (checked against the full
`documentElement.innerHTML`).

---

## 3. Defects

### DEF-08 — The completion checkbox is invisible in dark mode (Major, NEW)

**Affects:** US-06, US-07, NFR-06, NFR-04.

In dark mode the completion control renders with **no fill distinguishable from
its background, no border and no ring**. It occupies its 44×44 hit area and is
fully operable — it just cannot be seen. In light mode the same control renders
correctly as a white circle with a visible ring.

**Steps to reproduce**

1. Sign in and open `/todos` with at least one todo.
2. Put the app in dark mode (the OS default here, or the header toggle).
3. Look at the left edge of any todo row.

**Expected** — `docs/PRD.md` US-06: *"Given a todo row, When I look at it, Then I
see its title, **a completion control**, its priority, its due date if set…"*
NFR-06 requires the app to support light and dark themes.

**Actual** — nothing is drawn where the control is. Measured on a clean dark-mode
page load (no JS theme manipulation):

```
[data-slot=checkbox-control]  16×16 at (48,186)
  background-color : rgb(24, 24, 27)      ← same as the row/card background
  border           : 0px rgba(0, 0, 0, 0) ← no border
  box-shadow       : all layers rgba(0, 0, 0, 0)
  opacity          : 1
```

Contrast against its own background is effectively **1:1** (WCAG 1.4.11 requires
3:1 for non-text UI components). The equivalent light-mode measurement is
`background-color: lab(100 0 0)` (white) plus a real drop-shadow ring, on a white
card — visible, as the screenshots show.

The control is still there: a click at its centre toggled the todo and produced
the `Todo "Buy milk" marked complete` toast, and `Tab` reaches it. So this is a
visibility defect, not a functional one — but a user in dark mode has no visual
affordance for the primary action of the app, and cannot see which todos are
complete except by the strikethrough.

**Severity Major.** It breaks a stated US-06 acceptance criterion, it is on the
default theme (the app follows the OS preference and this machine prefers dark),
and it affects every row on the main screen.

**Note on history.** The previous pass observed this area and explicitly chose not
to file it: *"the unchecked checkbox border is `rgb(40,40,44)` on the dark row
background, which is very close to invisible… not filed as a defect."* That call
was too generous — the border is not merely low-contrast, it is `0px` wide, so
there is nothing to see at all. It is filed properly this time. It is **not** a
regression introduced by this batch.

### DEF-02 — `PressResponder` console warning — **STILL PRESENT on `/todos`** (Minor)

The brief asked for this to be *gone, not merely reduced*. It is reduced, not gone.

```
A PressResponder was rendered without a pressable child.
Either call the usePress hook, or wrap your DOM node with <Pressable> component.
```

**Steps to reproduce** — load `/todos` in a fresh tab with the console open.

**Actual, measured across the whole run:**

| Page | Previous pass | This pass |
|---|---|---|
| `/sign-up` | 1 per load | **0** |
| `/sign-in` | — | **0** |
| `/todos` | 3 per load | **1 per load** |

Counted on repeated fresh full loads, and cross-checked against the dev server's
own captured browser output. The count is independent of the number of rows: 1
warning with zero todos (empty state, no rows rendered at all) and 1 warning with
two todos.

**The `ConfirmDialog` fix is genuinely correct** — `/sign-up` mounts a
`ConfirmDialog` and now logs nothing, which it did not manage before. That half of
DEF-02 is closed.

**Likely remaining source** — the count correlates with the app shell rather than
the list: `/sign-up` and `/sign-in` have no header and log 0; `/todos` has exactly
one header and logs exactly 1. The header's only trigger-shaped component is the
account-menu `Dropdown` (`src/app/todos/components/TodosHeader.tsx:122-133`),
whose `Dropdown.Trigger` is documented in that file as "the bare react-aria
Button". Offered as a lead, **not a proven root cause** — I did not instrument the
component.

**Impact** — noise only. Confirm dialogs were re-verified in full this pass (see
below) and the account menu opens and signs out correctly. NFR-04 stays
**Partial** solely because of this warning.

#### Confirm dialogs — re-verified, all good

| Check | Result |
|---|---|
| Create confirm opens, names the record | `Add this todo?` / `"Buy milk" will be added to your list.` |
| Update confirm opens, names the record | `Save these changes?` / `"Ship release v3 RC2" will be updated.` |
| Delete confirm opens, names the record | `Delete this todo?` / `"Water plants" will be permanently deleted. This can't be undone.` |
| Sign-up confirm opens, names the record | `Create this account?` / `An account will be created for "qa+ui…@example.com".` |
| Sign-in has **no** confirm dialog | Verified — submits straight through, no `alertdialog` mounted at any point |
| **Cancel focused first on the destructive one** | Verified — `document.activeElement` was `Cancel` on open of the delete dialog |
| Confirm focused first on non-destructive | Verified — `Create account` / `Save changes` focused on open |
| Focus trapped | Verified — 4× `Tab` inside the delete dialog left focus still inside it |
| Escape closes without mutating | Verified — dialog closed, and a follow-up `GET /api/todos` still returned all three todos |
| Focus returns to the trigger | Verified — after Escape, `document.activeElement` was the button with `aria-label='Delete "Water plants"'` |
| Cancel closes without mutating | Verified on the create path |

### DEF-09 — `note`'s wrong-type message is a length message (Minor, NEW)

**Affects:** review finding m-3 in the newest section, `src/app/todos/components/form/schema.ts:50`.

`note` is declared `z.string(tooLongMessage("note", NOTE_MAX_LENGTH))`, so the
*type* error and the *length* error share one string.

**Steps to reproduce** (signed in)

```
POST /api/todos  {"title":"ok","note":5,"priority":"low"}
```

**Actual**

```json
{"code":"BAD_REQUEST","message":"Keep the note under 2000 characters.",
 "fieldErrors":{"note":"Keep the note under 2000 characters."}}
```

**Expected** — a message describing what actually went wrong. `title` gets this
right (`{"title":5}` → `Enter a title.`); `note` does not. `docs/DESIGN.md` §7
opens with *"Exact strings. Do not improvise."* and there is no deck entry for
this case.

**Severity Minor** — reachable only by a direct API call; the form can never send
a non-string. Noted by the Senior as m-3 and not closed.

### DEF-10 — `INTERNAL` is declared but never reachable, so the "every error carries `message`" contract is still not total (Minor, NEW)

**Affects:** review finding M-4 in the newest section, `src/lib/apiError.ts:19,51`.

`ApiErrorCode.Internal` and its `500` definition were added, which is half of what
M-4 asked for. But **no handler ever emits it**: `grep` for `Internal` across
`src/` returns only the two lines in `apiError.ts` that declare it, and there is
no `try`/`catch` in any route handler under `src/app/api/todos/**` (the only
`catch` in that tree is `readJsonBody`'s JSON guard). A thrown Prisma or driver
error therefore still becomes Next's own `500`, whose body has no `code` and no
`message` — exactly the hole M-4 described.

`docs/CONVENTIONS.md` (as amended by this batch) states the client *"depends on
this: `getErrorMessage` reads `message` and expects it on every error response"*.
That guarantee is still not true.

**Could not verify at runtime.** Forcing a genuine `500` would mean breaking the
live database connection mid-run, which I judged out of scope for a release gate
against a shared Neon instance. **This finding is from code inspection only** and
is reported as such. No `500` occurred naturally during the entire run.

**Severity Minor** — `getErrorMessage`'s copy-deck fallback covers the user
experience, so nothing user-visible is broken today.

### DEF-04 — `GET /api/todos/[id]` returns `405` (Minor / informational) — unchanged

`src/app/api/todos/[id]/route.ts` still exports only `PATCH` and `DELETE`. The
response is byte-identical (`405`, empty body) for a real id, a foreign id and a
nonsense id, so nothing is disclosed. Not a PRD violation — the PRD never
specifies a read-one endpoint. Raised again only so the team knows it still does
not exist.

### DEF-01, DEF-03, DEF-05, DEF-06, DEF-07 — verified fixed

**DEF-01 — checkbox tap target.** At 375×812 and again at 320×700 the pressable
label measures **44×44**, and `document.elementFromPoint` at all five sampled
points (four inset corners and the centre) resolves to an element inside that
label. A real pointer click at the centre toggled the todo. Held.

**DEF-03 — `note` / `dueAt` optional.** `POST {"title":"Buy milk","priority":"medium"}`
→ `201` with `note:null, dueAt:null`. Held.

**DEF-05 — mobile status filter full width.** At 375: `x=16, width=343`. At 320:
`x=16, width=288` — edge to edge inside the 16 px page padding. No horizontal
scroll at either width (`scrollWidth === clientWidth`). Held.

**DEF-06 — `PATCH` silently dropping `completed`.** Closed. The exact body that
failed last pass is now rejected:

| Body to `PATCH /api/todos/<own id>` | Previous pass | This pass |
|---|---|---|
| `{title,note,priority,dueAt,completed:false}` | `200`, `completed` dropped | **`400`** `"Completion is changed by the checkbox, not by saving the todo."` |
| `{completed:true,title:"X"}` | `400` with the wrong copy | **`400`** with accurate copy |
| `{completed:true}` alone | `200` (toggle branch) | **`400`** — correctly redirected to `/status` |
| `{title,note,priority,dueAt}` | `200` | `200` |

The secondary copy problem from last pass ("the user is told to choose a
priority") is gone with it.

**DEF-07 — raw zod English.** Closed. No zod internal string reached any response
across the full validation matrix in §5.

---

## 4. Detailed results by story

### US-01 — Sign up — **Pass**

- `/sign-up` shows Name, Email, Password, `Create account` and a `Sign in` link;
  copy matches the deck (`Create your account`, `It takes about ten seconds.`,
  `At least 8 characters.`).
- Submitting empty renders `This field is required.` on all three fields and
  sends no request.
- `not-an-email` → `Enter a valid email address.`; a 7-character password →
  `Use at least 8 characters.` Both inline, before submit, no request sent.
- **Confirm modal precedes the mutation**: `Create this account?` /
  `An account will be created for "qa+ui1786858394@example.com".` Escape closed it
  with the typed values retained and no account created.
- On confirm: account created, signed in, redirected to `/todos`, success toast
  `Account created for "qa+ui1786858394@example.com"`.
- Server-side password policy re-verified in §5 (NFR-03).
- **Not re-tested this pass:** the duplicate-email path (verified Pass in the
  previous run; not re-run here).

### US-02 — Sign in — **Pass**

- **No confirm dialog.** Clicking `Sign in` submitted straight through; no
  `alertdialog` was mounted at any point. Matches `docs/CONVENTIONS.md`
  ("Sign-in does not… It submits straight through and still reports via toast"),
  while sign-up still confirms — the ruling is applied exactly as written.
- Correct credentials → session created, redirected to `/todos` with the list
  rendered.
- Signed in, `/sign-in` redirects to `/todos` without showing the form.
- `?next=` sanitiser re-checked: landing on `/sign-in?next=/\evil.com` and signing
  in successfully ended on `http://localhost:3465/todos`, `location.origin`
  unchanged, no off-site navigation attempted. (First review's M-1 still fixed.)
- **Not re-tested this pass:** the wrong-password error copy (Pass previously).

### US-03 — Sign out — **Pass**

- Account menu shows the signed-in email (`qa+ui1786858394@example.com`) and a
  `Sign out` item.
- `Sign out` destroyed the session, cleared the cookie (`document.cookie === ""`)
  and redirected to `/sign-in`.
- Returning to `/todos` afterwards redirected to `/sign-in?next=%2Ftodos`.

### US-04 — Protected routes — **Pass**

- Signed out, `/todos` → `/sign-in?next=%2Ftodos`; the response HTML contains none
  of the todo titles.
- The preserved path is used after sign-in (verified via the `?next=` round trip).
- Every mutation endpoint returns `401` with no session and performs no write (§2).
- A foreign todo id returns `404` on every verb, including the new `/status` (§2).
- A forged session cookie returns `401`.
- **Not tested:** an *expired* (rather than forged or absent) session cookie, and
  review finding m-2 from the first review — not in scope for this batch.

### US-05 — Create a todo — **Pass**

- The empty state's `New todo` opens a modal with Title, Note, Priority
  (default `Medium`) and Due date; **the Title field is focused on open**
  (`document.activeElement.name === "title"`).
- Title "Buy milk" with everything else untouched created exactly `note: null`,
  `priority: "medium"`, `completed: false`, `dueAt: null`, owned by the session
  user; the row appeared without a page reload.
- Priority `high` + `dueAt: 2026-08-20` are stored and rendered (`▲ High`,
  `Aug 20`, note indicator).
- Confirm modal precedes the write; success toast `Todo "Buy milk" added`.
- Validation parity with the server verified in §5.
- **Not tested this pass:** the create-failure path (typed values retained + copy
  deck error toast). It was verified in the previous pass; no fault injection was
  performed this run.

### US-06 — List todos — **Fail**

Everything below passes **except the completion control's visibility**, which is a
stated acceptance criterion of this story.

- Only the session user's todos are listed (§2).
- Ordering correct: newest-created first within the active group, and a toggled
  todo moved out of the active group.
- Rows render title, priority chip, due date and a note indicator. Priority is
  never colour-alone: `▲ Priority: Low` / `■ Priority: Medium` / `▲ Priority: High`
  with a visually-hidden `Priority:` prefix. The note indicator exposes
  `Has a note`.
- `aria-label`s are correct and name the record: `Mark "Buy milk" as complete`,
  `Edit "Buy milk"`, `Delete "Buy milk"`.
- **Fails on:** *"Then I see its title, **a completion control**, …"* — in dark
  mode there is no visible completion control (DEF-08).
- **Not verified:** the loading skeleton — the local DB responds too fast to catch
  a painted frame, and no markup-level check was made this pass.

### US-07 — Toggle complete/incomplete — **Partial**

Behaviour is correct; the control is invisible in dark mode (DEF-08).

- Toggling fires immediately with **no confirm modal** — the approved exception.
  (The `[role=alertdialog]` node that appears is the toast itself, which HeroUI
  renders with that role; confirmed by reading its text.)
- Count updated `0 of 1 done` → `1 of 1 done`; the change persisted across a full
  sign-out / sign-in cycle (`1 of 2 done` on return).
- Toast `Todo "Buy milk" marked complete` with an **`Undo`** action; the reverse
  toast reads `Todo "Buy milk" marked not complete`.
- **Undo verified working:** clicking `Undo` issued a second
  `PATCH /api/todos/<id>/status` — confirmed in the network log, the same scoped
  route as the original flip, no shortcut — and the count returned to `0 of 1 done`.
- With the `Active` filter applied, marking a visible todo complete removed it
  from the filtered list.
- Toggling changes only `completed`: title, note, priority and `dueAt` were
  identical before and after (API-level check).
- **Not tested this pass:** the toggle-failure path (revert + error toast),
  verified in the previous pass.

### US-08 — Edit a todo — **Pass**

- Edit opens a modal headed `Edit todo`, pre-filled — verified by reading the
  input values: `title: "Ship release v3"`, `note: "cut the tag"`,
  `dueAt: "2026-08-20"`.
- Saving a new title updated the row (`Ship release v3 RC2`) and the confirm modal
  read `Save these changes?` / `"Ship release v3 RC2" will be updated.` with toast
  `Todo "Ship release v3 RC2" updated`.
- Length rules match US-05 (§5).
- Ownership scoping verified in §2 (a foreign id returns `404`).
- **Not tested this pass:** clearing the note and clearing the due date through
  the UI (the harness cannot reliably empty a field), and the Cancel-leaves-todo-
  unchanged path. The equivalent server behaviour is verified: `PATCH` with
  `note: ""` / `dueAt: ""` stores `null`.

### US-09 — Delete a todo — **Pass**

- Delete opens an `AlertDialog` naming the todo: `Delete this todo?` /
  `"Water plants" will be permanently deleted. This can't be undone.` with
  `Cancel` and a destructive `Delete`. Nothing is deleted yet.
- **Cancel is the default-focused action.**
- **Escape closes without mutating** — re-read after Escape still returned all
  three todos — and **focus returned to the triggering button**.
- **Focus is trapped** inside the dialog.
- Confirming removed the row without a page reload; count went `0 of 3 done` →
  `0 of 2 done`; toast `Todo "Water plants" deleted`.
- Deleting the last todo restoring the empty state was verified in the previous
  pass and is implied by US-11's empty state here, but **was not re-run this pass**.
- **Not tested:** the delete-failure path.

### US-10 — Filter by status and priority (and search) — **Pass**

- Defaults are `All` / `All priorities` with an empty `Search todos` field.
- `Active` lists only incomplete todos; toggling one complete removed it live.
- **Filters combine and survive reload:** loading
  `/todos?status=completed&priority=high` directly re-applied both controls (the
  priority control read `High`) and showed the no-results state
  `No todos match these filters` / `Try a different status or priority.` with
  `Clear filters`.
- **Search verified.** `/todos?q=milk` filtered the list to `Buy milk`.
  Combining search with a status filter (`?q=milk&status=completed`) produced the
  distinct search empty state `No matches` / `No todos match "milk".` with a
  `Clear search` action.
- **The `New todo` toolbar button is present in both no-results states** — as
  specified.
- Under every filter and search combination results contained only the session
  user's todos (§2).

### US-11 — Empty state — **Pass**

- A brand-new account (C) sees `Nothing here yet` /
  `Add your first todo and it will show up here.` with a `New todo` action.
- **The toolbar `New todo` button is hidden at zero todos** — enumerating every
  `<button>` on the page at zero todos returns exactly
  `["Switch to dark theme", "Account menu", "New todo"]`, i.e. the empty state's
  own button is the only one. After the first todo was created the toolbar button
  reappeared (and the filter chrome with it).
- No filter chrome at zero todos: status filter, priority filter, search field and
  the `{done} of {total} done` count are all absent.
- The empty-state call to action opens the create modal and **focuses the Title
  field**.
- Creating the first todo replaced the empty state.
- Visually and textually distinct from both the filter no-results state and the
  search no-results state.

---

## 5. Non-functional and API-level results

### Item 3 — the split write routes — **Verified**

Every probe below was issued with account A's session cookie against A's own todo.

| Probe | Expected | Actual | Verdict |
|---|---|---|---|
| `PATCH /api/todos/<id>/status` `{"completed":true}` | `200` | `200` + the updated row, `completed:true` | Pass |
| `PATCH /api/todos/<id>/status` `{"completed":"yes"}` | `400`, value must be true or false | `400 {"code":"BAD_REQUEST","message":"Completion must be true or false."}` | Pass |
| `PATCH /api/todos/<id>/status` `{"completed":true,"title":"X"}` | `400`, **different** message about only completion being changeable | `400 {"code":"BAD_REQUEST","message":"Only completion can be changed here. Save the todo's other fields separately."}` | **Pass — distinct and accurate** |
| `PATCH /api/todos/<id>` valid form body | `200` | `200` + the updated row | Pass |
| `PATCH /api/todos/<id>` with `completed` | `400` | `400 {"code":"BAD_REQUEST","message":"Completion is changed by the checkbox, not by saving the todo."}` | Pass |
| `POST /api/todos` with `completed` | `400` | same `400` body | Pass |
| `DELETE /api/todos/<id>` | `204` | `204`, empty body | Pass |

Extra probes on the status route: `{"title":"X"}` alone → the "only completion"
message (correct — it is an unrecognised key); `{}` → the "true or false" message
(correct — `completed` is missing).

**Every error body carries both `code` and `message`.** Checked on every `400`,
`401` and `404` produced in this run — all four codes observed
(`UNAUTHORIZED`, `NOT_FOUND`, `BAD_REQUEST`), each with a `message`.
`fieldErrors` is present only on field-level validation failures, absent
otherwise, as specified. `INTERNAL` was never observed — see DEF-10.

**No message names an HTTP method or a route path.** Read every distinct message
string emitted across the run; none contains `PATCH`, `POST`, `DELETE`,
`/api/`, or a bracketed route segment. M-2 closed.

### Item 4 — validation messages — **Verified**

Every rule enforced server-side by posting directly to the API. All returned
copy-deck-shaped text keyed by field, and **no raw zod English appeared anywhere**:

| Payload | Status | Message / `fieldErrors` |
|---|---|---|
| `title: ""` | 400 | `title: "Enter a title."` |
| `title: "   "` | 400 | `title: "Enter a title."` |
| `title` 201 chars | 400 | `title: "Keep the title under 200 characters."` |
| `note` 2001 chars | 400 | `note: "Keep the note under 2000 characters."` |
| `priority: "urgent"` | 400 | `priority: "Choose a priority: low, medium, high."` |
| `dueAt: "not-a-date"` | 400 | `dueAt: "Enter a valid date (YYYY-MM-DD)."` |
| `dueAt: "2026-02-31"` | 400 | `dueAt: "Enter a valid date (YYYY-MM-DD)."` (strict parsing — no rollover) |
| **`title: 5`** | 400 | `title: "Enter a title."` — **DEF-07 fixed** |
| **`priority: 5`** | 400 | `priority: "Choose a priority: low, medium, high."` |
| **`dueAt: 5`** | 400 | `dueAt: "Enter a valid date (YYYY-MM-DD)."` |
| `note: 5` | 400 | `note: "Keep the note under 2000 characters."` — **DEF-09** |
| `priority` omitted | 400 | `priority: "Choose a priority: low, medium, high."` |
| `{title, priority}` only | **201** | — (`note`/`dueAt` optional) |
| body is an array / bare string / a number / unparseable JSON | 400 | no `fieldErrors`, `message: "That request wasn’t valid."` |

The limits and the priority list in the messages are built from the constants, as
claimed. Note the deck drift the Senior raised as m-2 (`Choose a priority: low,
medium, high.` and `Enter a valid date (YYYY-MM-DD).` are not what
`docs/DESIGN.md` says) is **still open** — the code is better than the deck, but
the deck was not updated. Not filed as a defect; it is a docs task.

### NFR-03 — Password policy — **Pass**

- Client: `Use at least 8 characters.` inline before submit, no request sent.
- Server: sign-up succeeded only with an 8+ character password; the
  better-auth handler is configured `minPasswordLength: 8`.
- No password value appeared in any response body inspected.
- **Not re-run this pass:** the direct server-side bypass probe with a
  7-character password (verified `400 PASSWORD_TOO_SHORT` in the previous pass).

### NFR-04 — Keyboard accessibility — **Partial**

Passing: dialogs trap focus, close on Escape without mutating, and restore focus
to the trigger (all re-verified this pass); tab order is logical (3 tabs from the
top of `/todos` reaches `New todo`); every input has a label or a specific
`aria-label`; row controls name the record; status is never colour-alone.

Reduced to Partial by the residual `PressResponder` warning (DEF-02).

DEF-08 is also an accessibility concern (non-text contrast) but is filed against
NFR-06 to avoid double-counting.

### NFR-05 — Responsive, mobile-first — **Pass**

| Width | Horizontal scroll | Checkbox target | Row Edit/Delete | Status filter |
|---|---|---|---|---|
| 320 | none (`scrollWidth === clientWidth === 320`) | 44×44 | — | `x=16, w=288` (full width) |
| 375 | none (`=== 375`) | 44×44, all 5 hit-test points inside | 44×44 | `x=16, w=343` (full width) |
| 427 | none | 44×44 | 44×44 | full width |

`New todo` is full-width at mobile; rows stack with actions always visible.

### NFR-06 — Dark mode — **Fail**

- Follows the OS preference on first load (`data-theme="dark"` and `.dark` on
  `<html>` before any user choice) and applies it pre-paint.
- The header toggle switches themes, sets `data-theme`, adds/removes `.dark` and
  persists `heroui-theme` in `localStorage`; the `aria-label` flips between
  `Switch to dark theme` and `Switch to light theme`.
- **Fails on DEF-08** — the completion checkbox has no visible rendering in dark
  mode.
- **Not measured:** WCAG AA text contrast ratios (visual assessment only). The
  non-text contrast failure in DEF-08 *was* measured.

### NFR-08 — Validation parity — **Pass** (was Partial)

Every client-side rule is enforced server-side with a matching, user-safe message
(table above). DEF-07 is closed, which was the sole reason for the previous
Partial. DEF-09 is a wording accuracy bug, not a parity gap.

### M-5 — production base URL — **Verified by code inspection only**

`src/lib/auth.ts:32-36` now throws at boot when `NODE_ENV === "production"` and
`BETTER_AUTH_URL` is unset, which is what M-5 asked for. Development returns
`{ allowedHosts: ["localhost:*", "127.0.0.1:*"], protocol: "http" }`.

**Verified live:** the whole auth surface worked on port **3465** — sign-up,
sign-in, sign-out, session cookies and `?next=` round-trips — with no
`Invalid origin` error. The port-3000 pin that forced the previous tester to kill
another project's server is genuinely gone.

**Not verified:** the production branch itself. Booting a production build with
`BETTER_AUTH_URL` unset was not attempted.

---

## 6. Console and network observations

- **The only recurring console message during normal use is the `PressResponder`
  warning of DEF-02** — 1 per `/todos` load, 0 on `/sign-in` and `/sign-up`.
- **No unhandled promise rejections.**
- **No `500`s.** The dev server log across the entire run contains no error, no
  stack trace and no 5xx response.
- Every `4xx` in the logs traces to a deliberate probe in this run
  (`400`/`401`/`404`/`405`).
- The Vercel Speed Insights beacon logs one informational line per page load
  (`Debug mode is enabled by default in development. No requests will be sent`)
  and issued no network requests. Inert in dev, as the Senior noted.
- The `textValue` / `ListBoxItem` react-aria warning reported in the previous pass
  did not appear this run — the priority `Select` popover was not opened, so this
  is **not evidence that it is fixed**.

---

## 7. Not tested / out of scope for this pass

- **Desktop-width interaction and the row tooltips** — blocked by harness
  limitation (2)/(3). Everything was exercised at 427 px, below the `sm:`
  breakpoint.
- **Real touch activation at mobile widths** — mobile assertions are measurement
  and hit-testing.
- **Failure paths** for create, toggle and delete — no fault injection was
  performed this run (create and toggle were verified in the previous pass).
- **Clearing the note / due date through the UI**, and the edit-Cancel path —
  harness cannot reliably empty a field; server behaviour verified instead.
- **A real `500`** — see DEF-10; not forced against the live database.
- **Production boot** with `BETTER_AUTH_URL` unset (M-5).
- **Expired session cookie** (only absent and forged cookies were exercised) and
  first-review finding m-2.
- **Duplicate-email sign-up, wrong-password sign-in, server-side short-password
  bypass** — all Pass in the previous pass, not re-run.
- **Loading skeleton paint**, **double-submit racing**, **200-todo performance**
  (NFR-09), **bundle secret leakage** (NFR-07), **WCAG text contrast measurement**.
- Review findings **m-1, m-2, m-4…m-8** of the newest section — not claimed as
  fixed by this batch and not re-tested.

---

## 8. Recommendation

## **DO NOT SHIP — not yet.** One Major (DEF-08) should be fixed first. It is a small fix.

**What is genuinely good, and I want it on the record:**

- **Cross-user isolation holds completely.** Re-run in full with two fresh
  accounts and now covering the new `/status` route, account B could not read,
  edit, toggle, undo or delete any of account A's todos; could not learn whether
  an id exists; could not plant a `userId`; and every endpoint refuses an
  unauthenticated or forged caller with `401` and no write. A's data was
  byte-for-byte intact afterwards. **No probe produced a `500`.** This is the
  release criterion that matters most and it passes without reservation.
- **The route split is right and the fixes are real.** DEF-06 and DEF-07 — the
  two substantive defects from the last pass — are genuinely closed, not
  papered over. The status route's two error messages are distinct and both
  accurate, which is exactly what M-1 asked for. No user-facing message names an
  HTTP method or a route path (M-2). `POST` now rejects `completed` (M-3). Every
  error body carries `code` and `message`.
- **The port pinning is fixed.** The whole app ran on 3465. No unrelated process
  was touched this time.

**Why I am still not signing off:**

**DEF-08 (Major) — the completion checkbox is invisible in dark mode.** Dark is
the default theme here because the app follows the OS preference. A new user
signing up on this machine lands on a list where the primary control of the
entire product cannot be seen. It breaks a literal US-06 acceptance criterion
(*"Then I see its title, a completion control, …"*) and measures ~1:1 non-text
contrast against WCAG's 3:1. The control works and the hit target is a correct
44×44 — this is purely a visual token problem and should be a small, low-risk
fix, which is precisely why it is worth doing before the release rather than
after.

I want to be straight about one thing: **DEF-08 is not a regression from this
batch.** It was present before, and the previous pass saw the symptom and chose
not to file it. That earlier call was too lenient, and the release gate is the
right place to correct it rather than inherit it.

**The remaining open defects do not block:** DEF-02 (console noise only, and the
`ConfirmDialog` half is genuinely fixed), DEF-04 (an endpoint that was never
specified), DEF-09 (wrong message on a wrong-type `note`, unreachable from the
UI) and DEF-10 (`INTERNAL` declared but unreachable — a documentation-versus-code
mismatch with no user-visible effect today). All four can be scheduled.

**My recommendation: fix DEF-08, then ship.** If the team judges dark-mode
visibility acceptable for this release, the decision should be made explicitly by
the Product Owner and recorded — not passed through on a QA sign-off, because the
app's main control being invisible on the default theme is the kind of thing users
report as "the app is broken" rather than "the styling is off".

**One caveat on the strength of this pass.** Harness limitations (2) and (3) meant
no test ran at desktop width and no failure paths were injected. The API surface,
the isolation baseline and the mobile layout were tested thoroughly; the desktop
presentation and the error-recovery UX were carried over from the previous pass
rather than re-proved. If the team wants a full-confidence gate, those two areas
deserve a short manual pass on a real browser before release.
