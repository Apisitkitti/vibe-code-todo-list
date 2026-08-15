# QA Report — Personal Todo App (v1)

Tester: QA engineer
Date: 2026-08-14
Build under test: `npm run dev` on `http://localhost:3000`, Neon Postgres (live DB)
Method: black-box testing through the browser, plus direct API probes issued from
the page context via `fetch` (for auth/ownership checks that the UI cannot reach).

## Test accounts created

| Account | Name | Email | Password |
|---|---|---|---|
| A | Ada | `qa+a1755273000@example.com` | `Password123!` |
| B | Grace | `qa+b1755273000@example.com` | `Password456!` |

Rejected sign-up attempts (no account created): `qa+short1755273000@example.com`
(7-char password, server-rejected), and a duplicate attempt on account A's email.

Todo ids used in the isolation tests (owned by account A):

- `cmst7rhdz000bve2p7u74eaol` — "Water plants"
- `cmst7rh9h0009ve2p5mnwc9gl` — "Ship release v2"
- `cmst7oli50007ve2pvrvegklt` — "Buy milk" (completed)

---

## 1. Verdict summary

| ID | Story | Verdict |
|---|---|---|
| US-01 | Sign up with email + password | **Pass** |
| US-02 | Sign in | **Pass** |
| US-03 | Sign out | **Pass** |
| US-04 | Protected routes | **Pass** |
| US-05 | Create a todo | **Pass** |
| US-06 | List todos | **Pass** |
| US-07 | Toggle complete/incomplete | **Pass** |
| US-08 | Edit a todo | **Pass** |
| US-09 | Delete a todo with confirmation | **Pass** |
| US-10 | Filter by status and priority | **Pass** |
| US-11 | Empty state | **Pass** |

| NFR | Area | Verdict |
|---|---|---|
| NFR-01 | Per-user authorization | **Pass** (verified rigorously — see §2) |
| NFR-02 | Server-side auth checks | **Pass** |
| NFR-03 | Password policy | **Pass** |
| NFR-04 | Keyboard accessibility | **Partial** (DEF-02; one item inconclusive) |
| NFR-05 | Responsive / touch targets | **Partial** (DEF-01) |
| NFR-06 | Dark mode | **Pass** |
| NFR-08 | Validation parity | **Pass** (DEF-03 is a narrow contract gap) |

**No blockers found.** One Major and four Minor defects are listed in §3.

---

## 2. Cross-user data isolation — the critical test

**Result: PASS.** Tested at the API level, not just through the UI.

Setup: account A owned three todos; account B was signed in and owned one
(`Grace private task`). All probes below were issued from the browser with
account B's session cookie against account A's real todo ids.

| Probe | Expected | Actual | Verdict |
|---|---|---|---|
| `GET /api/todos` as B | none of A's todos | `{"todos":[],...}` then only B's own todo | Pass |
| `PATCH /api/todos/cmst7rhdz000bve2p7u74eaol` `{"completed":true}` (A's todo, toggle) | `404` | `404 {"message":"That todo no longer exists."}` | Pass |
| `PATCH /api/todos/cmst7rh9h0009ve2p5mnwc9gl` `{title:"HACKED BY B",...}` (A's todo, edit) | `404` | `404 {"message":"That todo no longer exists."}` | Pass |
| `DELETE /api/todos/cmst7oli50007ve2pvrvegklt` (A's todo) | `404` | `404 {"message":"That todo no longer exists."}` | Pass |
| `GET /api/todos/<A's id>` | `404` | `405` — no `GET` handler exists (see DEF-04) | Pass with note |

Post-attack integrity check: signed back in as A and re-read the list. All three
todos were **unchanged** — no title was rewritten to "HACKED BY B", "Buy milk"
still existed and was still `completed: true`, "Water plants" was still
`completed: false`. Account A never saw `Grace private task`.

**No leakage under any filter or search.** As B, every combination returned only
B's own data, including searches for account A's exact titles:

```
?status=all|active|completed, ?priority=low|medium|high,
?status=all&priority=high, ?query=milk, ?query=plants
```

`?query=milk` and `?query=plants` both returned `[]` for account B.

**Unauthenticated access — all `401`, no writes.** With the session cookie
cleared, against A's real ids:

| Endpoint | Actual |
|---|---|
| `GET /api/todos` | `401` |
| `POST /api/todos` | `401` |
| `PATCH /api/todos/<A's id>` | `401 {"message":"Sign in again to continue."}` |
| `DELETE /api/todos/<A's id>` | `401 {"message":"Sign in again to continue."}` |

A's data was intact afterwards.

**No existence oracle.** `GET /api/todos/<real id>` and
`GET /api/todos/totally-made-up-id-xyz` both return exactly `405` with an empty
body, so the missing `GET` handler does not confirm whether an id exists.

**`userId` is not client-controllable.** `POST /api/todos` with an extra
`"userId":"some-other-user-id"` field in the body returned `201` and created the
todo under **the session user** (A), not the supplied id. NFR-01 upheld. (Test
todo `cmst8bau3000hve2ppq8ermie` was deleted afterwards.)

---

## 3. Defects

### DEF-01 — Completion checkbox tap target is 16×16 px, not 44×44 (Major)

**Affects:** NFR-05, `docs/DESIGN.md` §6.3, US-07 on touch devices.

**Steps to reproduce**

1. Sign in and open `/todos` with at least one todo.
2. Set the viewport to a mobile width (tested at 375×812 and 320×700).
3. Attempt to tap the completion checkbox anywhere other than its top-left corner.

**Expected** — `docs/DESIGN.md` §6.3: *"Minimum touch target 44×44 px. […] For the
row's icon-only edit/delete buttons **and the checkbox**, add
`className="min-h-11 min-w-11"` (44px) on mobile"*. NFR-05: *"Primary tap targets
are at least 44x44px."*

**Actual** — The wrapper `div[data-slot="checkbox"]` does measure 44×44 and does
carry `min-h-11 min-w-11`, but it also carries `items-start`, so the only
pressable element — the inner `label[data-slot="checkbox-content"]`, which is the
element react-aria marks `data-react-aria-pressable="true"` — measures **16×16**
and sits in the top-left corner. Hit-testing the 44×44 box confirms the rest is
inert:

| Point inside the 44×44 wrapper | `document.elementFromPoint` resolves to | Inside pressable label? |
|---|---|---|
| top-left (+4,+4) | `<svg data-slot="checkbox-default-indicator--checkmark">` | yes |
| centre | `<div data-slot="checkbox">` | **no** |
| bottom-right (−4,−4) | `<div data-slot="checkbox">` | **no** |

A pointer at the centre of the nominal 44 px target therefore cannot activate the
checkbox. The edit/delete icon buttons and the header buttons *do* measure a real
44×44 (verified), so this is specific to the checkbox.

**Note on evidence:** the finding rests on deterministic hit-testing, which is
what a real pointer follows. Synthetic pointer events could not drive this
react-aria checkbox at all (they failed even on the working top-left region), so
they were not used as evidence either way.

---

### DEF-02 — Row Edit/Delete tooltips never render, and log a React warning on every render (Minor)

**Affects:** `docs/DESIGN.md` §4.4, copy deck §7.4 (`Edit`, `Delete` tooltips).

**Steps to reproduce**

1. Open `/todos` at desktop width with at least one todo.
2. Hover the Edit (or Delete) icon button on a row and wait ~1.2 s.
3. Open the browser console.

**Expected** — §4.4: *"Wrap each in a `Tooltip` (`.Root`, `.Trigger`, `.Content`,
`.Arrow`) on `sm:` and up"*, showing the copy-deck strings `Edit` / `Delete`. No
console warnings.

**Actual** — No tooltip appears. `document.querySelectorAll('[role="tooltip"]')`
returns 0 elements after hovering. The console logs, on **every** `/todos` render
(three occurrences per load with three rows):

```
A PressResponder was rendered without a pressable child.
Either call the usePress hook, or wrap your DOM node with <Pressable> component.
```

Source: `src/app/todos/components/TodoRow.tsx` — `ActionTooltip` renders
`<Tooltip.Trigger>{children}</Tooltip.Trigger>` around a HeroUI `Button`, which
react-aria does not recognise as a pressable child.

**Impact limited to affordance, not accessibility** — the `aria-label`s
(`Edit "{title}"` / `Delete "{title}"`) are present and correct, so the buttons
still have proper accessible names.

---

### DEF-03 — `note` and `dueAt` are required by the API although the PRD defines them as optional (Minor)

**Affects:** `docs/PRD.md` §2 field table, NFR-08.

**Steps to reproduce** (signed in)

```js
fetch('/api/todos', {
  method: 'POST',
  headers: {'Content-Type': 'application/json'},
  body: JSON.stringify({ title: 'Grace private task', priority: 'high' })
})
```

**Expected** — PRD §2: `note` is *"optional, max 2000 chars"* and `dueAt` is
*"optional"*. A body omitting them should be accepted and stored as `null`.

**Actual** — `400` with:

```json
{"message":"Invalid input: expected string, received undefined",
 "fieldErrors":{"note":"Invalid input: expected string, received undefined",
                "dueAt":"Invalid input: expected string, received undefined"}}
```

Cause: `src/app/todos/components/form/schema.ts` declares
`note: z.string().trim().max(...)` and `dueAt: z.string().trim().refine(...)`
with no `.optional()`. Sending `note: ""` and `dueAt: ""` works and correctly
stores `null`.

**Severity Minor** because the UI always sends `""` for both, so no user-facing
flow is broken. The error message is also a raw zod string rather than a
copy-deck string, unlike every other validation message.

---

### DEF-04 — `GET /api/todos/[id]` is not implemented, returns `405` (Minor / informational)

**Steps to reproduce** — `fetch('/api/todos/<any id>')`.

**Expected** — the brief for this review asked for `404` on another user's id.

**Actual** — `405 Method Not Allowed` with an empty body, because
`src/app/api/todos/[id]/route.ts` exports only `PATCH` and `DELETE`.

**Not a security defect and not a PRD violation.** The PRD never specifies a
read-one endpoint (the client reads the list only), and the response is byte-for-byte
identical for a real id, a foreign id and a nonsense id, so nothing is disclosed.
Raised only so the team is aware the endpoint does not exist.

---

### DEF-05 — Mobile status filter is not full-width (Minor, cosmetic)

**Affects:** `docs/DESIGN.md` §4.3 responsive table.

**Steps to reproduce** — open `/todos` at 375×812.

**Expected** — §4.3, Mobile <640: *"Filter bar stacks: toggle group on row 1
(`fullWidth`), search on row 2."*

**Actual** — the All/Active/Completed `ToggleButtonGroup` renders at content
width, horizontally centred, not full-width. The priority filter and the search
field below it *do* span the full width, so the row reads as inconsistent. No
functional impact; no horizontal scrolling.

---

## 4. Detailed results by story

### US-01 — Sign up — **Pass**

- `/sign-up` shows Name, Email, Password, `Create account`, and a `Sign in` link. Copy matches §7.2 exactly (`Create your account`, `It takes about ten seconds.`, `At least 8 characters.`).
- Submitting empty renders `This field is required.` inline on all three fields; no request is sent.
- 7-character password → `Use at least 8 characters.` (§7.9); no account created.
- `not-an-email` → `Enter a valid email address.` (§7.9); no account created.
- Duplicate email → `Sign up failed` / `An account with that email already exists.` (§7.9) in an Alert **and** a danger toast. **Email field kept its value, Password field was cleared** — matches the acceptance criterion exactly.
- Confirm modal appears before the mutation with §7.12 copy: `Create this account?` / `An account will be created for "qa+a1755273000@example.com".` Escape and Cancel both close it without creating an account.
- On confirm: account created, signed in, redirected to `/todos`, success toast `Account created for "qa+a1755273000@example.com"` (§7.12).
- `GET /api/auth/get-session` returns `"emailVerified": false` and the app is fully usable. No password field appears in any response (NFR-03).

*Note:* PRD wording for two errors ("Password must be at least 8 characters", "Enter a valid email address") differs from the `docs/DESIGN.md` copy deck ("Use at least 8 characters.", "Enter a valid email address."). The app follows the copy deck, which `docs/CONVENTIONS.md` designates as the source of exact strings. Not logged as a defect.

### US-02 — Sign in — **Pass**

- `/sign-in` shows Email, Password, `Sign in`, and a `Sign up` link; copy matches §7.1.
- Confirm modal appears with §7.12 copy: `Sign in to your account?` / `You'll be signed in as "…".`
- Correct credentials → session created, success toast `Signed in as "qa+a1755273000@example.com"`, redirected to `/todos`.
- Wrong password → stays on `/sign-in`, Alert `Sign in failed` / `That email and password don't match. Try again.` (§7.9) plus a danger toast.
- Unknown email → **byte-identical** message. Verified at the transport layer too: `POST /api/auth/sign-in/email` returned `401 {"message":"Invalid email or password","code":"INVALID_EMAIL_OR_PASSWORD"}` for *both* the wrong-password and the no-such-account case. **No account enumeration.**
- Arriving from `/sign-in?next=%2Ftodos` and signing in successfully landed on `/todos`.
- Signed in, navigating to `/sign-in` and `/sign-up` both redirect to `/todos` without showing the form.

### US-03 — Sign out — **Pass**

- Account menu shows the signed-in email (`qa+a1755273000@example.com`) and a `Sign out` item (§7.3).
- `Sign out` destroys the session, clears the cookie (`document.cookie === ""`) and redirects to `/sign-in`.
- Returning to `/todos` afterwards redirects to `/sign-in?next=%2Ftodos`, and the response HTML contains none of the todo titles.

### US-04 — Protected routes — **Pass**

- Signed out, `/todos` → `/sign-in?next=%2Ftodos`; the original path is preserved and used after sign-in.
- No todo data is present in the redirected response.
- Every mutation endpoint returns `401` with no session and performs no write (§2 table).
- A foreign todo id returns `404`, never the row (§2).

### US-05 — Create a todo — **Pass**

- `New todo` opens a modal with Title, Note, Priority (default `Medium`) and Due date.
- Title "Buy milk" with everything else untouched created exactly: `note: null`, `priority: "medium"`, `completed: false`, `dueAt: null`, owned by the session user; the row appeared at the top of the list with no page reload.
- Empty title → `Enter a title.` (§7.5); whitespace-only title also rejected.
- 205-char title → `Keep the title under 200 characters.` (§7.5).
- 2005-char note → `Keep the note under 2000 characters.` (§7.11).
- Priority `high` + a due date are stored and rendered on the row (`▲ High`, `Aug 20`).
- Confirm modal precedes the write with §7.11 copy: `Add this todo?` / `"Buy milk" will be added to your list.` Success toast: `Todo "Buy milk" added`.
- Form resets to defaults after a successful create.
- **Not tested:** the create-failure path (typed values retained + error message) — I could not force a server or network failure without modifying the app.

### US-06 — List todos — **Pass**

- Only the session user's todos are listed; account B's brand-new account showed zero todos while account A had four.
- Ordering is correct: active before completed, newest-created first within each group (verified after creating three todos in a known order and toggling one).
- Rows render title, completion checkbox, priority chip, due date, and a note indicator.
- Completed rows use `line-through` **plus** the checked checkbox — not colour alone (§6.4).
- Priority is never colour-alone: chips render the word plus a shape glyph (`▲ High`, `■ Medium`, `▼ Low`), with a visually-hidden `Priority:` prefix.
- Overdue dates render `⚠` plus a visually-hidden `Overdue —` prefix (confirmed in the accessibility tree); the note indicator exposes `Has a note`.
- Loading state: `src/app/todos/loading.tsx` and `TodoListSkeleton` render a four-row skeleton with `aria-busy="true"` and `aria-label="Loading todos"`. Observed in the streamed route payload; the local DB responds too fast to catch it painted, so this criterion is verified by markup rather than by a visible frame.

### US-07 — Toggle complete/incomplete — **Pass**

- Toggling fires immediately with **no confirm modal** — the approved exception in `docs/CONVENTIONS.md`.
- Row shows completed styling instantly; change persists across a full page reload.
- Toggling back returns it to the active group.
- Under the `Active` filter, marking a visible todo complete removes it from the list.
- Toast `Todo "Buy milk" marked complete` with an **`Undo`** action (§7.11, §7.13).
- **Undo verified working:** clicking `Undo` flipped the record back (`completed: false` confirmed in the API response), the count returned to `0 of 1 done`, the checkbox `aria-label` returned to `Mark "Buy milk" as complete`, and the reverse toast `Todo "Buy milk" marked not complete` fired.
- Toggling changes only `completed` — title, note, priority and `dueAt` were byte-identical before and after.

### US-08 — Edit a todo — **Pass**

- Edit opens a modal headed `Edit todo`, pre-filled with the current title, note, priority and due date.
- Saving a new title updates the row and persists across reload.
- Whitespace-only title → `Enter a title.`, no update performed.
- Clearing the note and due date stores both as `null` (verified in the API response) and the row stops rendering them.
- Changing values then pressing Cancel leaves the todo completely unchanged.
- Length rules match US-05.
- Confirm modal precedes the write: `Save these changes?` / `"Ship release v2" will be updated.` Toast: `Todo "Ship release v2" updated` (§7.11).
- Ownership scoping verified in §2 (a foreign id returns `404`).

### US-09 — Delete a todo — **Pass**

- Delete opens an `AlertDialog` naming the todo: `Delete this todo?` / `"Old overdue task" will be permanently deleted. This can't be undone.` with `Cancel` and a destructive `Delete` (§7.6). Nothing is deleted yet.
- **Cancel is the default-focused action** on the destructive confirm, per `docs/CONVENTIONS.md`.
- **Escape closes without mutating** — verified: the dialog closed and the API still returned all four todos.
- **Focus is trapped:** five successive Tab presses kept focus inside the dialog.
- **Focus is restored to the trigger:** after Escape, `document.activeElement` was the button with `aria-label='Delete "Old overdue task"'`.
- Confirming deletes the row without a page reload, it stays gone after reload, and the toast reads `Todo "Old overdue task" deleted` (§7.11).
- Deleting the last todo restores the empty state (verified on account B).
- The whole delete flow was driven **by keyboard alone** (Enter to open, Tab to Delete, Enter to confirm).
- **Not tested:** the delete-failure path (row remains + error toast).

### US-10 — Filters — **Pass**

- Defaults are `All` / `All priorities`.
- `Active` lists only incomplete, `Completed` only complete, `All` both.
- Priority filter isolates `High` / `Medium` / `Low` correctly.
- **Filters combine with AND** and are reflected in the URL:
  `?status=active` → `?status=active&priority=high` listed only the two active high-priority todos.
- **Filter state survives reload:** loading `/todos?status=completed&priority=high` directly re-applied both controls.
- A combination matching nothing shows `No todos match these filters` / `Try a different status or priority.` with a `Clear filters` action (§7.10); clearing restores the full list and resets the URL to `/todos`.
- Under every filter and search combination, results contained only the session user's todos (§2).

### US-11 — Empty state — **Pass**

- A brand-new account (B) sees `Nothing here yet` / `Add your first todo and it will show up here.` with a `New todo` action (§7.7).
- **No filter chrome is rendered** at zero todos — the status filter, priority filter, search field and the `{done} of {total} done` count are all absent, appearing only once the first todo exists. Matches the criterion and §7.3 (`Count (zero todos): render nothing`).
- The empty-state call to action opens the create modal and **focuses the Title field** (`document.activeElement` was `input[name="title"]`).
- Creating the first todo replaces the empty state with the list.
- Deleting the only remaining todo brings the empty state back (verified on account B).
- Visually and textually distinct from the US-10 no-results state (different heading, body and action).

---

## 5. Non-functional results

### NFR-01 / NFR-02 — Authorization — **Pass**

See §2. Every read and write is scoped server-side; `userId` supplied in a request
body is ignored; foreign ids return `404`; no session returns `401` with no write.

### NFR-03 — Password policy — **Pass**

- Client: `Use at least 8 characters.` inline before submit.
- Server, bypassing the client: `POST /api/auth/sign-up/email` with a 7-character
  password returned `400 {"message":"Password too short","code":"PASSWORD_TOO_SHORT"}`
  and created no account.
- No password value appeared in any response body inspected.

### NFR-04 — Keyboard accessibility — **Partial**

Passing: the delete confirmation was operated end-to-end by keyboard (Enter to
open, Tab within, Enter to confirm); focus is trapped in dialogs; Escape closes
without mutating; focus is restored to the triggering control; every input has a
`Label` or a specific `aria-label`; errors are wired through `FieldError` /
`Alert` / toast live regions; status is never conveyed by colour alone.

Reduced to Partial by DEF-02 (a React warning on every `/todos` render from a
malformed `Tooltip.Trigger` composition).

**Inconclusive — not counted as a defect:** I could not confirm whether Enter or
Space activates the `Sign in` submit button. With the button programmatically
focused, a trusted `Enter` keydown was observed reaching the button's own
listener while no `click` or `submit` event followed. However, the same test
harness also failed to deliver Tab reliably on that page (a Tab press left focus
in the email field), and mouse activation of the same button intermittently
failed too — so the harness, not the app, is the more likely cause. This needs
re-testing with a real keyboard before it is treated as a bug.

### NFR-05 — Responsive, mobile-first — **Partial**

- **No horizontal scrolling at 320 px**: `documentElement.scrollWidth === clientWidth === 320`.
- Layout adapts correctly: full-width `New todo`, stacked filter bar, two-line
  todo rows with actions always visible on mobile, single-line rows on desktop
  with actions revealed on hover/focus-within.
- The first todo row stays above the fold at 375×812.
- Edit/Delete icon buttons and header buttons all measure exactly 44×44.
- Reduced to Partial by **DEF-01** (checkbox tap target) and **DEF-05** (filter width).

### NFR-06 — Dark mode — **Pass**

- Follows the OS preference on first load (rendered dark with `data-theme="dark"`
  and `.dark` on `<html>` before any user choice).
- No flash of the wrong theme — an inline script in `<head>` sets the class before
  first paint.
- The toggle switches to light, sets `data-theme="light"`, removes `.dark`, and
  persists the choice in `localStorage` under `heroui-theme`.
- The toggle's `aria-label` flips correctly between `Switch to dark theme` and
  `Switch to light theme` (§7.3).
- Text was legible in both themes across `/sign-in`, `/sign-up` and `/todos`.

### NFR-08 — Validation parity — **Pass**

Every client-side rule was re-verified server-side by posting directly to the API,
and each returned the **same copy-deck string** the form shows, keyed by field:

| Payload | Status | `fieldErrors` |
|---|---|---|
| `title: ""` | 400 | `title: "Enter a title."` |
| `title: "   "` | 400 | `title: "Enter a title."` |
| `title` 201 chars | 400 | `title: "Keep the title under 200 characters."` |
| `note` 2001 chars | 400 | `note: "Keep the note under 2000 characters."` |
| `priority: "urgent"` | 400 | `priority: "Choose a priority."` |
| `dueAt: "not-a-date"` | 400 | `dueAt: "Enter a valid date."` |

DEF-03 is the one gap: omitting `note`/`dueAt` entirely produces a raw zod message
rather than a copy-deck one, and rejects input the PRD calls optional.

---

## 6. Console and network observations

- The only recurring console message during normal use is the react-aria
  `PressResponder` warning of **DEF-02**, logged on every `/todos` render.
- No unhandled promise rejections were observed.
- No unexpected failed requests. Every `4xx` in the network log traces to a
  deliberate probe in this test run (401/404/405/400 from the isolation and
  validation matrices), or to my own malformed sign-out call (`415`, caused by
  omitting `Content-Type`; the app's own sign-out sends it correctly and returns
  `200`).

---

## 7. Not tested / out of scope for this pass

- **Mutation failure paths** — create, edit, toggle and delete all specify a
  revert-plus-error-toast behaviour on failure. I could not force a server or
  network error without modifying application code, which was out of scope.
- **Session expiry / tampered cookie** (US-04, third criterion) — I verified the
  no-cookie case only; I did not forge an expired or invalid session cookie.
- **Double-submit protection** (US-01, US-05) — the pending/disabled state is
  present in the code but the local DB responds too fast to race it by hand.
- **Live skeleton paint** — see US-06.
- **200-todo performance** (NFR-09) and **bundle secret leakage** (NFR-07) — not
  exercised; NFR-07 is better covered by the Senior's code review.
- **Contrast ratio measurement** (NFR-06, WCAG AA 4.5:1) — assessed visually only,
  not measured with a contrast tool.

---

## 8. Recommendation

The release criteria in `docs/PRD.md` §7 are met on the two that matter most:
every Must story passes its acceptance criteria, and there is now direct evidence
that User A cannot read, edit, toggle or delete User B's todos through a direct
request, nor discover whether their ids exist. Unauthenticated access to every
protected route and endpoint is refused.

**DEF-01 should be fixed before release** — a 16×16 completion checkbox on a
mobile-first product makes the primary interaction of the app hard to hit, and
NFR-05 is a Must. DEF-02 through DEF-05 are safe to ship and schedule.
