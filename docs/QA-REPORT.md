# QA Report — Personal Todo App (v1) — **Regression pass on `develop`**

Tester: QA engineer
Date: 2026-08-16
Branch under test: `develop` @ `5f61903` (merge of `fix/review-findings`)
Build under test: `npm run dev` on `http://localhost:3000`, Neon Postgres (live DB)
Method: black-box testing through the browser, plus direct API probes issued from
the page context via `fetch` (for auth/ownership checks the UI cannot reach), plus
client-side fault injection (an `XMLHttpRequest` stub installed from the console)
to force the failure paths that cannot be produced against a healthy server.

This report replaces the 2026-08-14 pass. Defect numbering is carried over so the
two can be compared: `DEF-01`…`DEF-05` are the previous defects, `M-*` / `m-*` are
the Senior's review findings, and `DEF-06` / `DEF-07` are new in this pass.

## Test accounts created

| Account | Name | Email | Password |
|---|---|---|---|
| A | Ada | `qa+a1786851696@example.com` | `Password123!` |
| B | Grace | `qa+b1786851696@example.com` | `Password456!` |

Rejected sign-up attempts (no account created): a duplicate attempt on account A's
email (`422`), and `qa+short1786851696@example.com` with a 7-character password
(server-rejected, `400 PASSWORD_TOO_SHORT`).

Todo ids used in the isolation tests (owned by account A):

- `cmsv9kg0k0001r8vef4iaokio` — "Ship release v3"
- `cmsv9ja1i0000r8veatywlcje` — "Buy milk"

Account B's own todo: `cmsvakhra0000w3venyj2pkci` — "Grace private task" (deleted
at the end of the run to re-verify the empty state).

### Environment notes (please read)

1. **Port 3000 was occupied at the start of this run by an unrelated dev server**
   (`next dev` from `~/Idosoft/TNR/develop/CMS-phase-2-Frontend`, PID 64052). The
   app must run on port 3000 because `BETTER_AUTH_URL` is pinned there — on port
   3001 every auth call fails with `Invalid origin`. A `pkill -f "next dev"` issued
   to free the port **also terminated that other project's dev server**. It was not
   restarted. Flagging it explicitly rather than burying it.
2. The app's own dev server exited once mid-run (after a `POST /api/auth/sign-out`)
   and was restarted; the only visible effect was two failed HMR WebSocket errors in
   the console. Not reproducible on demand, not investigated further.
3. Two harness limitations shaped what could be tested — both are tool problems, not
   app problems, and are called out where they apply:
   - **`Backspace` never deletes text** in this browser-automation harness (verified
     with the full contents of a `textarea` selected). Any test that needed to empty
     a text field through the keyboard is marked blocked.
   - **Below a 768 px viewport the harness enables touch emulation and every click
     times out.** Mobile assertions are therefore made by measurement and hit-testing
     (`getBoundingClientRect`, `elementFromPoint`) rather than by real taps.

---

## 1. Verdict summary

| ID | Story | Verdict | Change vs previous pass |
|---|---|---|---|
| US-01 | Sign up with email + password | **Pass** | — |
| US-02 | Sign in | **Pass** | confirm dialog intentionally removed, verified |
| US-03 | Sign out | **Pass** | — |
| US-04 | Protected routes | **Pass** | `?next=` now safe (M-1) |
| US-05 | Create a todo | **Pass** | failure path now verified, previously untested |
| US-06 | List todos | **Pass** | — |
| US-07 | Toggle complete/incomplete | **Pass** | failure path now verified |
| US-08 | Edit a todo | **Pass** (one sub-check blocked) | DatePicker replaces native input |
| US-09 | Delete a todo with confirmation | **Pass** | — |
| US-10 | Filter by status and priority | **Pass** | search now in scope, verified |
| US-11 | Empty state | **Pass** | toolbar button now hidden at zero todos |

| NFR | Area | Verdict | Change |
|---|---|---|---|
| NFR-01 | Per-user authorization | **Pass** (verified rigorously — see §2) | held |
| NFR-02 | Server-side auth checks | **Pass** | held |
| NFR-03 | Password policy | **Pass** | held |
| NFR-04 | Keyboard accessibility | **Partial** (DEF-02 residual) | tooltips fixed, warning remains |
| NFR-05 | Responsive / touch targets | **Pass** | was Partial — DEF-01 and DEF-05 fixed |
| NFR-06 | Dark mode | **Pass** | held |
| NFR-08 | Validation parity | **Partial** (DEF-07) | optional fields fixed, type errors not |

### Fixes under test

| Fix | Verdict |
|---|---|
| DEF-01 — checkbox 44×44 tap target | **Verified fixed** |
| DEF-02 — row tooltips + `PressResponder` warning | **Partially fixed** — tooltips verified fixed; the console warning is **still present** (new source, see §3) |
| DEF-03 / M-4 — `note` / `dueAt` optional | **Verified fixed** (residual: wrong-type inputs still leak zod text → DEF-07) |
| DEF-05 — mobile status filter full width | **Verified fixed** |
| M-1 — `?next=` open redirect | **Verified fixed** (all three attack vectors + legitimate round-trip) |
| M-2 — raw axios strings in `getErrorMessage` | **Verified fixed** (create path and toggle path) |
| M-3 — `400` reporting the 404 copy | **Verified fixed** |
| m-1 — `serverFieldErrors` surviving modal close | **Verified fixed** (Escape path and Cancel path separately) |
| m-5 — `PATCH` dispatching on body shape | **Partially fixed** — the specified mixed body is now rejected with `400`; a *complete* form body carrying `completed` is still silently accepted with `200` (DEF-06) |
| DEF-04 — `GET /api/todos/[id]` → `405` | Unchanged, still informational only |

### Behaviour changes

| Change | Verdict |
|---|---|
| Sign-in submits with no confirm dialog; sign-up still confirms | **Verified** |
| "New todo" toolbar button hidden at zero todos, present otherwise | **Verified** (incl. both no-results states) |
| Due date is a HeroUI `DatePicker` with calendar popover | **Verified** (pick, pre-fill, clear, round-trip) |
| Search, combinable with status and priority filters | **Verified** |

**No blockers found.** One Major from the previous pass (DEF-01) is fixed. Open
defects are all Minor: DEF-02 (residual), DEF-04, DEF-06, DEF-07.

---

## 2. Cross-user data isolation — the critical test

**Result: PASS.** Re-run at the API level exactly as before, with two brand-new
accounts created for this pass.

Setup: account A owned two todos; account B was signed in and owned one
(`Grace private task`). Every probe below was issued from the browser with account
B's session cookie against account A's real todo ids.

| Probe (as B) | Expected | Actual | Verdict |
|---|---|---|---|
| `GET /api/todos` | none of A's todos | only `Grace private task` | Pass |
| `PATCH /api/todos/cmsv9kg0k0001r8vef4iaokio` `{"completed":true}` | `404` | `404 {"message":"That todo no longer exists."}` | Pass |
| `PATCH /api/todos/cmsv9ja1i0000r8veatywlcje` `{title:"HACKED BY B",…}` | `404` | `404` same body | Pass |
| `DELETE /api/todos/cmsv9ja1i0000r8veatywlcje` | `404` | `404` same body | Pass |
| `DELETE /api/todos/cmsv9kg0k0001r8vef4iaokio` | `404` | `404` same body | Pass |
| `GET /api/todos/<A's id>` | `404` | `405`, empty body — no `GET` handler (DEF-04) | Pass with note |

**Post-attack integrity check.** Signed back in as A and re-read the list: both
todos **unchanged** — no title rewritten to "HACKED BY B", `Ship release v3` still
`completed: false` with its note intact, `Buy milk` still present. Account A never
saw `Grace private task` under any request.

**No existence oracle.** A real foreign id and `totally-made-up-id-xyz` return
byte-identical responses on every verb: `405` (empty) for `GET`, `404
{"message":"That todo no longer exists."}` for `PATCH` and `DELETE`.

**No leakage under any filter or search.** As B, every combination returned only
B's own data, including searches for account A's exact titles:

```
?status=all|active|completed, ?priority=low|medium|high,
?status=active&priority=high, ?query=milk, ?query=ship, ?query=release
```

`?query=milk`, `?query=ship` and `?query=release` all returned `[]` for account B.

**Unauthenticated access — all `401`, no writes.** With the session cookie cleared,
against A's real ids:

| Endpoint | Actual |
|---|---|
| `GET /api/todos` | `401 {"message":"Sign in again to continue."}` |
| `POST /api/todos` | `401` same body |
| `PATCH /api/todos/<A's id>` | `401` same body |
| `DELETE /api/todos/<A's id>` | `401` same body |
| `GET /api/todos/<A's id>` | `405` (no handler) |

A's data was intact afterwards.

**`userId` is not client-controllable.** `POST /api/todos` as B with an extra
`"userId":"spoofed-user-id-xyz"` in the body returned `201` and the created todo
appeared in **B's** list (the session user), never under the supplied id. NFR-01
upheld.

**Protected route, signed out.** `/todos` redirects to `/sign-in?next=%2Ftodos`
and the delivered HTML contains none of the todo titles.

---

## 3. Defects

### DEF-01 — Completion checkbox tap target — **VERIFIED FIXED** (was Major)

The 44×44 sizing now sits on `label[data-slot="checkbox-content"]`, the element
react-aria marks `data-react-aria-pressable="true"`. Re-run of the original
hit-test at 375×812 and again at 320×700:

| Point inside the nominal 44×44 target | `document.elementFromPoint` resolves to | Inside pressable label? |
|---|---|---|
| top-left (+4,+4) | `label[data-slot="checkbox-content"]` | **yes** |
| centre | `label[data-slot="checkbox-content"]` | **yes** |
| bottom-right (−4,−4) | `label[data-slot="checkbox-content"]` | **yes** |
| top-right / bottom-left | `label[data-slot="checkbox-content"]` | **yes** |

Measured: wrapper 44×44, pressable content 44×44 (`min-h-11 min-w-11
sm:min-h-9 sm:min-w-9`). A real pointer click at the **centre** of the checkbox
was also exercised at desktop width and toggled the todo (`0 of 2 done` →
`1 of 2 done`, toast + Undo). Real taps at mobile width could not be exercised —
harness limitation (3) above — so the mobile evidence is hit-testing, which is the
same method that found the original defect.

### DEF-02 — Row tooltips and the `PressResponder` warning — **PARTIALLY FIXED** (Minor)

**Tooltips: verified fixed.** Hovering the Edit icon button on `/todos` at desktop
width for ~1.5 s renders `[role="tooltip"]` with the text `Edit`; hovering Delete
adds a second with `Delete`. Both match copy deck §7.4. (Note the tooltip needs the
pointer to *enter* the button — a pointer that is already resting on it from a
previous action does not open one; that is standard react-aria hover-delay
behaviour, not a defect.)

**Console warning: still present.**

```
A PressResponder was rendered without a pressable child.
Either call the usePress hook, or wrap your DOM node with <Pressable> component.
```

**Steps to reproduce** — load `/todos` in a fresh tab and open the console.

**Actual** — 3 warnings per `/todos` load. Crucially the count is now **independent
of the number of rows**: a fresh load of `/todos` logged 3 warnings with 2 todos and
3 warnings with **0 todos** (account B, no rows rendered at all). `/sign-up`, which
renders no todo rows and no app-shell header, logs **1**.

**Likely source** — the count correlates exactly with the number of mounted
`ConfirmDialog` instances (1 on `/sign-up`, 3 on `/todos`).
`src/components/ConfirmDialog.tsx` renders `<AlertDialog>` with no `.Trigger` child,
which is the same class of composition problem the `Tooltip.Trigger` fix addressed.
Offered as a lead, not a proven root cause — I did not instrument the component.

**Impact** — noise only. `aria-label`s on the row buttons are correct
(`Edit "{title}"` / `Delete "{title}"`), dialogs trap focus, close on Escape and
restore focus to the trigger (all re-verified). NFR-04 stays **Partial** solely
because of this warning.

### DEF-03 / M-4 — `note` and `dueAt` optional — **VERIFIED FIXED** (was Minor)

**Steps** (signed in)

```js
fetch('/api/todos', { method:'POST',
  headers:{'Content-Type':'application/json'},
  body: JSON.stringify({ title:'Minimal only', priority:'high' }) })
```

**Expected** — PRD §2: `note` *"optional, max 2000 chars"*, `dueAt` *"optional"*.

**Actual** — `201` with `{"note":null,"dueAt":null,"priority":"high",…}`. The
previous `400 "Invalid input: expected string, received undefined"` is gone.

A residual gap in the same area is filed separately as DEF-07.

### DEF-04 — `GET /api/todos/[id]` returns `405` (Minor / informational) — unchanged

`src/app/api/todos/[id]/route.ts` still exports only `PATCH` and `DELETE`. The
response is byte-identical (`405`, empty body) for a real id, a foreign id and a
nonsense id, so nothing is disclosed. Not a PRD violation — the PRD never specifies
a read-one endpoint. Raised again only so the team knows it still does not exist.

### DEF-05 — Mobile status filter not full-width — **VERIFIED FIXED** (was Minor)

At 375×812 and 320×700 the `All / Active / Completed` group spans the full content
width (at 320: `x = 16`, `width = 288`, i.e. edge-to-edge inside the 16 px page
padding), matching `docs/DESIGN.md` §4.3 *"toggle group on row 1 (`fullWidth`)"*.
`documentElement.scrollWidth === clientWidth === 320` — still no horizontal scroll.

### DEF-06 — `PATCH` still silently drops `completed` from a complete form body (Minor, NEW)

**Affects:** review finding m-5, `src/app/api/todos/[id]/route.ts:27-31`.

The fix made `todoToggleSchema` `.strict()`, so a body that mixes `completed` with
*some* form fields fails the toggle parse and falls through to the form branch. That
covers the case in the brief. But `todoFormSchema` is **not** strict, so a body that
carries every form field *plus* `completed` parses cleanly as a form update and
`completed` is discarded with a `200` — the exact silent no-op m-5 was raised about.

**Steps to reproduce** (signed in, own todo, currently `completed: true`)

```js
fetch('/api/todos/<own id>', { method:'PATCH',
  headers:{'Content-Type':'application/json'},
  body: JSON.stringify({title:'X', note:'', priority:'low', dueAt:'', completed:false}) })
```

**Expected** — per the review's fix for m-5: *"reject a body that mixes toggle and
form fields with a `400`."*

**Actual** — `200`, the title/note/priority/dueAt are written, and the response
still reports `"completed": true`. Re-reading the todo confirms `completed` never
changed. No error, no warning.

Observed results for the full matrix:

| Body | Status | Result |
|---|---|---|
| `{completed:true, title:"Renamed"}` | `400` | rejected — **the case in the brief, fixed** |
| `{completed:true}` | `200` | pure toggle works |
| `{title,note,priority,dueAt}` | `200` | pure form update works |
| `{title,note,priority,dueAt,completed:false}` | `200` | **`completed` silently dropped** |

**Secondary copy problem in the same path.** The `400` for
`{completed:true, title:"Renamed"}` reads:

```json
{"message":"Choose a priority.","fieldErrors":{"priority":"Choose a priority."}}
```

The request was rejected for mixing toggle and form intent, but the user is told to
choose a priority. `docs/DESIGN.md` §7.14 was added in this very batch for exactly
this situation — `That request wasn't valid.` would be the honest message.

**Severity Minor** — no user-facing flow is broken today (the client never sends a
mixed body), same reasoning as the original m-5.

### DEF-07 — Wrong-type field values still surface raw zod English (Minor, NEW)

**Affects:** review finding M-4 (second half), NFR-08,
`src/app/todos/components/form/schema.ts`.

M-4's fix asked for two things: make `note`/`dueAt` optional (done, DEF-03) **and**
*"attach an explicit message to every leaf (`z.string(TITLE_REQUIRED_MESSAGE)`) so
no zod default can ever reach the UI"*. The second half is not done.

**Steps to reproduce** (signed in)

```js
fetch('/api/todos', { method:'POST',
  headers:{'Content-Type':'application/json'},
  body: JSON.stringify({ title: 5, priority: 'low' }) })
```

**Expected** — `docs/DESIGN.md` §7 opens with *"Exact strings. Do not improvise."*
The copy-deck string for this field is `Enter a title.`

**Actual** — `400` with

```json
{"message":"Invalid input: expected string, received number",
 "fieldErrors":{"title":"Invalid input: expected string, received number"}}
```

`readFieldErrors` renders that under the Title field, so a zod internal string is
user-visible. Every other validation failure now returns copy-deck text (§5).

**Severity Minor** — the form can never send a non-string, so this is reachable
only by a direct API call.

---

## 4. Detailed results by story

### US-01 — Sign up — **Pass**

- `/sign-up` shows Name, Email, Password, `Create account` and a `Sign in` link;
  copy matches §7.2 (`Create your account`, `It takes about ten seconds.`,
  `At least 8 characters.`).
- Submitting empty renders `This field is required.` on all three fields; no request
  is sent.
- `not-an-email` → `Enter a valid email address.`; 7-character password →
  `Use at least 8 characters.` (both §7.9, shown inline before submit).
- Duplicate email → `Sign up failed` / `An account with that email already exists.`
  (§7.9). **Email field kept its value, Password field was cleared** — matches the
  acceptance criterion. Transport: `POST /api/auth/sign-up/email` → `422`.
- **Confirm modal still precedes the mutation** with §7.12 copy:
  `Create this account?` / `An account will be created for "…".`
- On confirm: account created, signed in, redirected to `/todos`, success toast
  `Account created for "qa+a1786851696@example.com"`.
- Server-side password policy re-verified by bypassing the client (§5, NFR-03).

### US-02 — Sign in — **Pass**

- **The confirm dialog is gone.** Clicking `Sign in` submits straight through — no
  `AlertDialog` is mounted at any point. This matches `docs/CONVENTIONS.md`
  ("Sign-in does not [get a confirm modal]. … It submits straight through and still
  reports via toast"), and sign-up still confirms, so the ruling is applied exactly
  as written.
- Correct credentials → session created, toast `Signed in as "…"`, redirect to the
  requested route.
- Wrong password → stays on `/sign-in`, Alert `Sign in failed` /
  `That email and password don't match. Try again.` (§7.9).
- Signed in, `/sign-in` redirects to `/todos` without showing the form.
- `?next=` round-trip and its sanitiser: see M-1 below.

### US-03 — Sign out — **Pass**

- Account menu shows the signed-in email and a `Sign out` item (§7.3).
- `Sign out` destroys the session, clears the cookie (`document.cookie === ""`) and
  redirects to `/sign-in`.
- Returning to `/todos` afterwards redirects to `/sign-in?next=%2Ftodos` with no
  todo data in the response.

### US-04 — Protected routes — **Pass**

- Signed out, `/todos` → `/sign-in?next=%2Ftodos`; the path is preserved and used
  after sign-in (verified with `?next=/todos?status=completed`, which landed on
  `/todos?status=completed`).
- No todo data in the redirected response.
- Every mutation endpoint returns `401` with no session and performs no write (§2).
- A foreign todo id returns `404`, never the row (§2).
- **Not tested:** a forged/expired session cookie (only the no-cookie case was
  exercised). Review finding m-2 (`requireUser()` drops the path on that branch) was
  not in scope for this pass and was not re-tested.

#### M-1 — `?next=` open redirect — **Verified fixed**

All four cases were driven end-to-end: land on `/sign-in?next=<value>` while signed
out, sign in with valid credentials, observe the final URL.

| `?next=` value | Final URL after successful sign-in | Verdict |
|---|---|---|
| `/\evil.com` | `http://localhost:3000/todos` | Pass — never left the origin |
| `//evil.com` | `http://localhost:3000/todos` | Pass |
| `https://evil.com` | `http://localhost:3000/todos` | Pass |
| `/todos?status=completed` (legitimate) | `http://localhost:3000/todos?status=completed` | Pass — round-trips |

`location.origin` was `http://localhost:3000` in every case; no off-site navigation
occurred and the browser never attempted one.

### US-05 — Create a todo — **Pass**

- `New todo` opens a modal with Title, Note, Priority (default `Medium`) and Due
  date; the Title field is focused on open.
- Title "Buy milk" with everything else untouched created exactly `note: null`,
  `priority: "medium"`, `completed: false`, `dueAt: null`, owned by the session
  user; the row appeared at the top of the list with no page reload.
- Priority `high` + a due date picked from the calendar are stored and rendered
  (`▲ High`, `Aug 20`, note indicator).
- Confirm modal precedes the write with §7.11 copy: `Add this todo?` /
  `"Buy milk" will be added to your list.` Success toast `Todo "Buy milk" added`.
- Form resets to defaults after a successful create.
- **Failure path now verified** (was untested last pass). With a forced network
  failure the toast read **`Couldn't add the todo. Try again.`** (§7.11 copy, not
  `Network Error`) and **every typed value stayed in the form** — both halves of the
  acceptance criterion.
- Validation parity with the server re-verified in §5.

### US-06 — List todos — **Pass**

- Only the session user's todos are listed (§2).
- Ordering correct: active before completed, newest-created first within each group
  (verified with three todos, one toggled complete — it moved to the bottom).
- Rows render title, completion control, priority chip, due date and a note
  indicator; priority is never colour-alone (`▲ High`, `■ Medium`, `▼ Low` with a
  visually-hidden `Priority:` prefix), and completed rows use `line-through` plus the
  checked box.
- The note indicator exposes `Has a note` to assistive technology.
- Loading state: `src/app/todos/loading.tsx` + `TodoListSkeleton` render with
  `aria-busy="true"` and `aria-label="Loading todos"`. Verified by markup — the local
  DB still responds too fast to catch a painted frame.

### US-07 — Toggle complete/incomplete — **Pass**

- Toggling fires immediately with **no confirm modal** — the approved exception.
- Row shows completed styling, count updates (`0 of 2 done` → `1 of 2 done`), change
  persists across a full reload; toggling back returns it to the active group.
- Toast `Todo "Buy milk" marked complete` with an **`Undo`** action; the reverse
  toast reads `Todo "Buy milk" marked not complete`.
- **Undo verified working:** clicking `Undo` issued a second scoped `PATCH`
  (confirmed in the network log) and the record flipped back to `completed: false`.
- Toggling changes only `completed` — title, note, priority and `dueAt` were
  identical before and after.
- **Failure path now verified:** with a forced network failure the row reverted (the
  count never moved) and the toast read **`Couldn't update the todo. Try again.`**
  (§7.13 copy).

### US-08 — Edit a todo — **Pass** (one sub-check blocked)

- Edit opens a modal headed `Edit todo`, pre-filled with the current title, note,
  priority and due date.
- **DatePicker pre-fill verified:** a todo with `dueAt = 2026-08-20` opens with
  `8 / 20 / 2026` in the segmented field.
- **Clearing the due date verified:** emptying the segments and saving stored
  `dueAt: null`, and the row stopped rendering the date.
- Saving a new title updated the row and persisted across reload; the confirm modal
  read `Save these changes?` / `"Ship release v3" will be updated.` and the toast
  `Todo "Ship release v3" updated` (§7.11).
- Changing values then pressing Cancel left the todo unchanged.
- Length rules match US-05 (§5).
- Ownership scoping verified in §2 (a foreign id returns `404`).
- **Blocked:** clearing the **note** through the UI. `Backspace` does not delete text
  in this harness (harness limitation 3), so the field could not be emptied by
  keyboard. The equivalent server behaviour *is* verified: a `PATCH` with `note: ""`
  stores `null`. Reported as blocked rather than passed.

### US-09 — Delete a todo — **Pass**

- Delete opens an `AlertDialog` naming the todo: `Delete this todo?` /
  `"X" will be permanently deleted. This can't be undone.` with `Cancel` and a
  destructive `Delete` (§7.6). Nothing is deleted yet.
- **Cancel is the default-focused action** (`document.activeElement` was `Cancel` on
  open).
- **Escape closes without mutating** — the dialog closed and the API still returned
  all three todos.
- **Focus returns to the trigger** — after the close animation finished,
  `document.activeElement` was the button with `aria-label='Delete "X"'`. (Sampled
  immediately after Escape it is still inside the closing dialog; it settles on the
  trigger once the exit animation completes.)
- The whole flow was driven **by keyboard alone** (Enter to open, Tab to `Delete`,
  Enter to confirm) and the row was removed without a page reload; it stayed gone
  after reload.
- Toast `Todo "Grace private task" deleted` (§7.11).
- Deleting the last todo restored the empty state (verified on account B).
- **Not tested:** the delete-failure path (row remains + error toast). The fault
  injector was pointed at `POST` and `PATCH` only.

### US-10 — Filter by status and priority (and search) — **Pass**

- Defaults are `All` / `All priorities`, with an empty `Search todos` field.
- `Active` lists only incomplete, `Completed` only complete, `All` both; the priority
  filter isolates `High` / `Medium` / `Low`.
- **Filters combine with AND and survive reload:** loading
  `/todos?status=completed&priority=high` directly re-applied both controls and
  showed the no-results state.
- A combination matching nothing shows `No todos match these filters` /
  `Try a different status or priority.` with `Clear filters` (§7.10); clearing
  restores the full list.
- **Search verified and now in scope.** Typing `milk` filtered the list to `Buy milk`
  and put `?q=milk` in the URL. Combining search with a status filter
  (`Completed` + `milk`) produced the distinct search empty state
  `No matches` / `No todos match "milk".` with a `Clear search` action; clearing it
  restored the list.
- **The `New todo` toolbar button is present in both no-results states** — as
  specified.
- Under every filter and search combination results contained only the session
  user's todos (§2).

### US-11 — Empty state — **Pass**

- A brand-new account (B) sees `Nothing here yet` /
  `Add your first todo and it will show up here.` with a `New todo` action (§7.7).
- **The toolbar `New todo` button is hidden at zero todos** — enumerating every
  `<button>` on the page at zero todos returns exactly
  `["Switch to light theme", "Account menu", "New todo"]`, i.e. the empty state's own
  button is the only one. After the first todo is created the toolbar button
  reappears.
- No filter chrome at zero todos: status filter, priority filter, search field and
  the `{done} of {total} done` count are all absent.
- The empty-state call to action opens the create modal and **focuses the Title
  field** (`document.activeElement.name === "title"`).
- Creating the first todo replaces the empty state; deleting the only remaining todo
  brings it back (verified on account B).
- Visually and textually distinct from both the filter no-results state and the
  search no-results state.

---

## 5. Non-functional results

### NFR-01 / NFR-02 — Authorization — **Pass**

See §2. Every read and write is scoped server-side; a client-supplied `userId` is
ignored; foreign ids return `404`; no session returns `401` with no write.

### NFR-03 — Password policy — **Pass**

- Client: `Use at least 8 characters.` inline before submit.
- Server, bypassing the client: `POST /api/auth/sign-up/email` with a 7-character
  password returned `400 {"message":"Password too short","code":"PASSWORD_TOO_SHORT"}`
  and created no account.
- No password value appeared in any response body inspected.

### NFR-04 — Keyboard accessibility — **Partial**

Passing: the delete confirmation was operated end-to-end by keyboard; focus is
trapped in dialogs; Escape closes without mutating; focus is restored to the trigger;
the DatePicker is operable by keyboard (segment-by-segment arrow navigation and
`Delete` to clear); every input has a label or specific `aria-label`; status is never
colour-alone.

Reduced to Partial by the residual `PressResponder` warning (DEF-02).

Still inconclusive from the previous pass: whether Enter/Space activates the
`Sign in` submit button by keyboard. The harness could not deliver `Backspace` at
all this run, so keyboard-activation results from it are not trustworthy evidence
either way. Needs a real keyboard.

### NFR-05 — Responsive, mobile-first — **Pass** (was Partial)

- No horizontal scrolling at 320 px: `scrollWidth === clientWidth === 320`.
- Completion checkbox pressable area 44×44 at 320 and 375 (DEF-01 fixed).
- Row Edit/Delete buttons measure exactly 44×44 at mobile widths (36×36 at `sm:` and
  up, which is the designed desktop size).
- Status filter is full-width at 320 and 375 (DEF-05 fixed); priority filter and
  search field span the full width as before.
- `New todo` is full-width at mobile; rows stack to two lines with actions always
  visible.

### NFR-06 — Dark mode — **Pass**

- Follows the OS preference on first load (`data-theme="dark"` and `.dark` on
  `<html>` before any user choice, no stored preference).
- The toggle switches to light, sets `data-theme="light"`, removes `.dark` and
  persists `heroui-theme=light` in `localStorage`; the `aria-label` flips between
  `Switch to dark theme` and `Switch to light theme` (§7.3).
- **Not measured:** WCAG AA contrast ratios (visual assessment only). One thing worth
  a designer's eye: the *unchecked* checkbox border is `rgb(40,40,44)` on the dark row
  background, which is very close to invisible in a screenshot. Not filed as a defect
  — it is unchanged from the previous build and non-text contrast was not in scope.

### NFR-08 — Validation parity — **Partial**

Every client-side rule re-verified server-side by posting directly to the API. All
returned the copy-deck string, keyed by field:

| Payload | Status | `fieldErrors` |
|---|---|---|
| `title: ""` | 400 | `title: "Enter a title."` |
| `title: "   "` | 400 | `title: "Enter a title."` |
| `title` 201 chars | 400 | `title: "Keep the title under 200 characters."` |
| `note` 2001 chars | 400 | `note: "Keep the note under 2000 characters."` |
| `priority: "urgent"` | 400 | `priority: "Choose a priority."` |
| `dueAt: "not-a-date"` | 400 | `dueAt: "Enter a valid date."` |
| `{title, priority}` only | **201** | — (DEF-03 fixed) |
| body is an array / bare string / unparseable JSON / a number | 400 | `{}` + `message: "That request wasn't valid."` (M-3 fixed) |
| `title: 5` | 400 | `title: "Invalid input: expected string, received number"` — **DEF-07** |

Reduced to Partial by DEF-07 alone.

### M-2 — copy-deck failure messages — **Verified fixed**

Forced with a client-side `XMLHttpRequest` stub that fails the request with
`status 0` (the shape axios reports as `Network Error`):

| Path | Message the user saw | Copy deck | Verdict |
|---|---|---|---|
| Create (`POST /api/todos`) | `Couldn't add the todo. Try again.` | §7.11 | Pass |
| Toggle (`PATCH /api/todos/<id>`) | `Couldn't update the todo. Try again.` | §7.13 | Pass |

No raw axios string (`Network Error`, `timeout of 15000ms exceeded`) reached the UI
in either case. A server-supplied `message` is still preferred when one exists —
verified by the `400` injection, which surfaced the server's field message rather
than the fallback.

### m-1 — `serverFieldErrors` cleared on modal close — **Verified fixed**

Both paths tested separately, with a forced `400` carrying
`fieldErrors.title`:

1. **Escape path** — open `New todo`, type a title, confirm, receive the `400`
   (error renders under Title, modal stays open, typed values retained), press
   `Escape`, reopen `New todo` → **fresh empty form, no error under any field**.
2. **Cancel path** — same up to the `400`, then click `Cancel`, reopen `New todo` →
   **fresh empty form, no error under any field**.

### DatePicker (behaviour change) — **Verified**

- The field renders as a segmented `mm / dd / yyyy` control with a calendar icon;
  clicking it opens a month-grid popover with today highlighted.
- Picking `20` in August 2026 filled the field with `8 / 20 / 2026`, and the created
  todo stored `dueAt: "2026-08-20T00:00:00.000Z"` and rendered `Aug 20` on the row —
  a correct round-trip.
- Editing a todo with an existing due date pre-fills the segments.
- Clearing works: pressing `Delete` on each segment empties the field, and saving
  stored `dueAt: null`.
- **Usability observation (not filed as a defect):** clearing takes a per-segment key
  sequence and there is no visible clear affordance on the field. `docs/DESIGN.md`
  does not specify one, so this is a design question rather than a defect.

---

## 6. Console and network observations

- The only recurring console message during normal use is the `PressResponder`
  warning of **DEF-02** — 3 per `/todos` load, 1 per `/sign-up` load, independent of
  how many todos exist.
- One additional react-aria warning appears whenever the priority `Select` popover
  opens: *"A `textValue` prop is required for `<ListBoxItem>` elements with non-plain
  text children in order to support accessibility features such as type to select."*
  This is a real (if small) a11y gap in the priority listbox — type-to-select will not
  work — but it was present before this batch and is not one of the fixes under test,
  so it is recorded here rather than filed as a new defect.
- No unhandled promise rejections.
- Every `4xx` in the network log traces to a deliberate probe in this run
  (`400`/`401`/`404`/`405`/`422`). Two HMR WebSocket errors correspond to the dev
  server restart described in the environment notes.

---

## 7. Not tested / out of scope for this pass

- **Delete-failure path** — fault injection covered create and toggle only.
- **Clearing the note through the UI** (US-08) — blocked by the harness; server
  behaviour verified instead.
- **Real touch activation at mobile widths** — blocked by the harness; mobile
  assertions are measurement + hit-testing.
- **Session expiry / tampered cookie** (US-04) and review finding **m-2** — only the
  no-cookie case was exercised.
- **Review findings m-3, m-4, m-6, m-7** — not listed as fixed in this batch and not
  re-tested. m-4 (single-slot `pendingTodoId`) and m-7 (non-optimistic toggle) are
  still visibly true of the running app.
- **Double-submit protection** — the pending/disabled state is present in the code
  but the local DB responds too fast to race by hand.
- **Live skeleton paint** — verified by markup only.
- **200-todo performance** (NFR-09) and **bundle secret leakage** (NFR-07).
- **Contrast ratio measurement** (NFR-06) — visual assessment only.

---

## 8. Recommendation

**The regression pass is clean on everything that gates release.** The Major defect
from the previous pass (DEF-01, the 16×16 checkbox) is genuinely fixed and verified
by the same hit-test that found it. The security finding M-1 is fixed against all
three attack vectors while the legitimate `?next=` round-trip still works. Most
importantly, **cross-user isolation still holds under direct API attack** — with two
fresh accounts, account B could not read, edit, toggle or delete any of account A's
todos, could not learn whether an id exists, and could not plant a `userId`; every
endpoint refuses an unauthenticated caller with `401` and no write.

Nothing found in this pass should block release. The four open Minors —
DEF-02 (console warning), DEF-04 (`405` on an unimplemented `GET`), DEF-06
(`completed` silently dropped from a complete form body) and DEF-07 (zod text on
wrong-type input) — are all unreachable from the UI or noise-only, and can be
scheduled.

Two of them are worth a moment's thought rather than a straight backlog entry:
DEF-06 leaves m-5's actual failure mode alive one call away from where it was, and
DEF-02's warning turned out to have a second source in the shared `ConfirmDialog`,
so the same composition mistake is now in the component every mutation goes through.
