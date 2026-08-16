# Code review — Todo app v1

Reviewer: Senior engineer
Scope: full `src/` tree against `docs/PRD.md`, `docs/DESIGN.md`,
`docs/CONVENTIONS.md`, `docs/STACK.md`, `prisma/schema.prisma`.
Build gate (`tsc --noEmit`, `lint`, `build`) was already green and was not re-run;
this review covers what those checks cannot see.

---

## 1. Authorization and data scoping — clean

I traced every path into `src/app/api/todos/**` and found no authorization
defect. Recording the trace so it does not have to be repeated:

- `GET /api/todos` (`src/app/api/todos/route.ts:32-72`) — `getSession()` is the
  first statement, `!session?.user` returns `401` before any Prisma call. The
  `where` object is seeded with `{ userId: session.user.id }` at line 42 and the
  status/priority/query filters only add clauses; there is no path that drops
  the owner clause. Both `count()` calls repeat the `userId` filter explicitly
  (lines 61-62) rather than reusing a mutable object that could be widened.
- `POST /api/todos` (`route.ts:74-98`) — session first, `todoFormSchema`
  re-parsed second, `userId: session.user.id` written from the session only
  (line 93). The parsed body is destructured field by field (line 83), so a
  client-supplied `userId` in the JSON is discarded by zod's strip and could not
  reach `data` even if it survived.
- `PATCH /api/todos/[id]` (`[id]/route.ts:31-83`) — session first. Both branches
  write with `updateMany({ where: { id, userId: session.user.id } })`
  (lines 47-50, 61-69), i.e. ownership is in the same statement, not a
  fetch-then-check. `result.count === 0` returns `404`. The response re-read at
  line 76 is itself a `findFirst` through the same `{ id, userId }` filter, so
  the success body cannot carry a foreign row.
- `DELETE /api/todos/[id]` (`[id]/route.ts:85-102`) — session first,
  `deleteMany({ where: { id, userId } })`, `404` on zero rows.
- Foreign-id probing is indistinguishable from a deleted id: `notFoundResponse()`
  (`response.ts:48-50`) returns one fixed string, `404`, for both. No `403`, no
  existence leak.
- **Undo is not a shortcut.** `undoToggle` (`TodoListScreen.tsx:153-165`) calls
  the same `toggleTodo()` service as the original flip
  (`todo.service.ts:44-56`), which is the same `PATCH /api/todos/{id}`. There is
  no separate endpoint, no cached row, no id passed around a check.
- No handler reads a user id from a body, query string or header. `grep` for
  `userId` outside `src/generated` returns only `session.user.id` uses.

User A cannot read, edit, toggle, undo or delete User B's todo through any
route in this codebase.

## 2. Secret and boundary leaks — clean

- `@/lib/prisma` is imported by exactly two route handlers and `src/lib/auth.ts`.
  The only other reference to the generated client from application code is
  `import type { Priority }` in `src/lib/todo.ts:1`, which is type-only and
  erased at compile time. No `"use client"` module reaches Prisma.
- `DATABASE_URL` appears only in `src/lib/prisma.ts:9`; `BETTER_AUTH_SECRET`
  appears nowhere in `src/`. The two `NEXT_PUBLIC_*` reads
  (`http.ts:11`, `auth-client.ts:4`) are a base URL and an app URL — correctly
  public. `.env*` is gitignored and `git ls-files` shows no env file tracked.
- Error bodies are copy-deck strings only (`response.ts`). No Prisma error text,
  stack trace or SQL is forwarded. One caveat about *client-side* error text is
  filed under Major-2 below — it is a copy problem, not a secret leak.

---

## Major

### M-1 — `sanitiseNextPath` does not do what it claims; `?next=/\evil.com` escapes the origin

`src/app/sign-in/page.tsx:15-21`

```ts
/** Only same-origin absolute paths survive, so `?next=` cannot be a redirector. */
function sanitiseNextPath(value: string | string[] | undefined): string {
  if (typeof value !== "string") return TODOS_PATH;
  if (!value.startsWith("/") || value.startsWith("//")) return TODOS_PATH;
  return value;
}
```

The guard rejects `//host` but not `/\host`. Under WHATWG URL parsing — which is
what the browser and Next's router use to resolve an href against the current
location — a backslash after the leading slash is treated as a slash:

```
new URL("/\\evil.com", "https://app.example").href  →  "https://evil.com/"
```

(verified in node 24). The value flows to `SignInForm`'s `nextPath` prop and into
`router.replace(nextPath)` (`SignInForm.tsx:85`), so
`/sign-in?next=/\evil.com` is a candidate open redirect off a page that is
explicitly a phishing target. Even if a given Next router version happens to
normalise it into a 404, the sanitiser's stated invariant is false and the next
person to reuse it will be bitten.

**Fix:** reject any second character that is `/` or `\`, and validate by parsing
rather than by prefix:

```ts
if (!/^\/(?![/\\])/.test(value)) return TODOS_PATH;
```

Better still, resolve it and compare origins against a dummy base before
accepting.

### M-2 — `getErrorMessage`'s `fallback` argument is dead for every axios error, so users see raw axios strings instead of the copy deck

`src/lib/getErrorMessage.ts:24-26`

```ts
if (isAxiosError(error)) {
  return readMessageProperty(error.response?.data) ?? error.message ?? fallback;
}
```

`error.message` on an axios error is always a non-empty string, so `?? fallback`
never fires. Any failure that is not a JSON body with a `message` field — a
network drop, the 15 s timeout in `http.ts:12`, a 500 whose body is Next's HTML
error page, a CORS failure — surfaces to the user as
`Network Error`, `timeout of 15000ms exceeded`, or
`Request failed with status code 500`.

Every call site passes a copy-deck fallback that can therefore never be shown:
`CREATE_FAILED_MESSAGE`, `UPDATE_FAILED_MESSAGE`, `DELETE_FAILED_MESSAGE`,
`TOGGLE_FAILED_MESSAGE`, `UNDO_FAILED_MESSAGE`, `SIGN_OUT_FAILED_MESSAGE`,
`LIST_FAILED_BODY` (`TodoListScreen.tsx:113,161,184,200`,
`TodoFormModal.tsx:124-127`, `TodosHeader.tsx:105`). `docs/DESIGN.md` §7 opens
with "Exact strings. Do not improvise" — this improvises on every non-4xx
failure.

**Fix:** only trust a server-supplied message; never `error.message`.

```ts
if (isAxiosError(error)) {
  return readMessageProperty(error.response?.data) ?? fallback;
}
```

### M-3 — a `400` with no field-level issue reports "That todo no longer exists."

`src/app/api/todos/response.ts:52-59`

```ts
export function badRequestResponse(fieldErrors: TodoFieldErrors) {
  const [firstMessage] = Object.values(fieldErrors);
  return NextResponse.json(
    { message: firstMessage ?? TODO_NOT_FOUND_MESSAGE, fieldErrors },
    { status: 400 },
  );
}
```

`toFieldErrors` only records issues whose `path[0]` is a string
(`response.ts:35`). A zod failure at the object root has an empty path — this is
exactly what happens for a malformed body (`readJsonBody` returns `null` on
unparseable JSON, `response.ts:62-64`), a JSON array, or a bare string. The
result is a `400` whose message is the *404* copy, "That todo no longer exists.",
which is both wrong and actively misleading — it tells the user their todo was
deleted when in fact the request was malformed.

**Fix:** give `badRequestResponse` its own fallback constant (a new copy-deck
entry along the lines of "That request wasn't valid.") and stop borrowing
`TODO_NOT_FOUND_MESSAGE`.

### M-4 — missing-field and wrong-type errors surface zod's internal English

`src/app/todos/components/form/schema.ts:26-39`, `response.ts:29-41`

`note` and `dueAt` are declared as plain required strings
(`z.string().trim().max(...)`, `z.string().trim().refine(...)`), so a body that
omits them fails with zod's built-in text —
`Invalid input: expected string, received undefined` — which
`toFieldErrors` copies straight into `fieldErrors.note`, `badRequestResponse`
copies into `message`, and `readFieldErrors` renders under the field
(`fieldErrors.ts:27-33`, `TodoForm.tsx:68-74`). Same for `{"title": 5}`.

Two problems: `docs/PRD.md` §2 lists `note` and `dueAt` as optional, so a body
that omits them is legitimate and is being rejected; and when it is rejected the
user reads a zod stack string instead of the §7.5/§7.11 copy.

**Fix:** make the optional fields optional with defaults —
`note: z.string().trim().max(NOTE_MAX_LENGTH, NOTE_TOO_LONG_MESSAGE).default("")`
and the same for `dueAt` — and attach an explicit message to every leaf
(`z.string(TITLE_REQUIRED_MESSAGE)`) so no zod default can ever reach the UI.

---

## Minor

### m-1 — `serverFieldErrors` survives a modal close and poisons the next create

`src/app/todos/components/TodoFormModal.tsx:79-81, 111-121`

`TodoFormModal` is mounted permanently (it sits outside `<Modal>`), so its
`serverFieldErrors` state outlives the dialog. On a `400`, the code sets the
errors and deliberately leaves the modal open — correct. But if the user then
cancels or presses Escape, `state.close()` unmounts `TodoForm` while
`serverFieldErrors` stays set. Reopening **New todo** does not remount
`TodoFormModal` (the `key` in `TodoListScreen.tsx:340` is
`editingTodo?.id ?? "create"`, unchanged between two creates), so a brand-new
empty form renders with the previous attempt's error already under the field.

**Fix:** clear it when the dialog closes — pass an `onOpenChange` to `Modal`, or
call `setServerFieldErrors(null)` from the Cancel/close handler alongside
`state.close()`.

### m-2 — `requireUser()` loses the requested path

`src/lib/session.ts:16-24`

`redirect("/sign-in")` with no `?next=`. This is the branch that runs whenever
the session cookie is present but expired or invalid — the proxy waves those
through (`proxy.ts:18` only checks cookie *presence*), so `requireUser` is the
one that redirects. `docs/PRD.md` US-04 requires the originally requested path to
be preserved on the redirect to sign-in; here it is dropped and the user always
lands on `/todos` after signing back in.

**Fix:** take the current pathname (`headers()` already awaited in
`getSession`; `next/headers` exposes `x-invoke-path`/the `referer`, or pass the
path in from the caller) and redirect to `/sign-in?next=<path>` the way
`proxy.ts:27` does.

### m-3 — a `401` mid-session shows the wrong error tier and never returns the user to sign-in

`src/app/todos/components/TodoListScreen.tsx:110-114`, `response.ts:43-45`

When the session expires while the list is open, `GET /api/todos` returns `401`
with `SESSION_EXPIRED_MESSAGE` ("Sign in again to continue."). The client renders
it as the body of an Alert titled **"Couldn't load your todos"**
(`TodoListScreen.tsx:260`). `docs/DESIGN.md` §7.9 defines this case as its own
pair — title **"You've been signed out"**, description "Sign in again to
continue." Mutations are worse: a `401` becomes a plain danger toast and the user
is left on a page they are no longer authenticated for, with a **Try again**
button that will fail identically.

**Fix:** branch on `error.response?.status === 401` in one place (an axios
response interceptor in `src/lib/http.ts` is the natural home) and route the
user to `/sign-in?next=/todos` with the §7.9 copy.

### m-4 — `pendingTodoId` is a single slot, so concurrent toggles unlock each other's rows

`src/app/todos/components/TodoListScreen.tsx:92, 168-188`

`setPendingTodoId(todo.id)` / `finally { setPendingTodoId(null) }`. Toggle row A,
then row B before A's request lands: B overwrites the slot, then A's `finally`
clears it, and row B loses its `pointer-events-none opacity-60` guard
(`TodoRow.tsx:101-103`) while its request is still in flight. The row is then
double-clickable, producing a second `PATCH` that can land out of order with the
first and leave the checkbox showing the wrong state until the next reload.

**Fix:** hold a `Set<string>` of pending ids and add/delete per todo, or key the
pending state by id.

### m-5 — `isToggleBody` dispatches on body shape, not on intent

`src/app/api/todos/[id]/route.ts:18-23, 42`

```ts
function isToggleBody(body: unknown): boolean {
  return typeof body === "object" && body !== null && "completed" in body;
}
```

Any `PATCH` body carrying a `completed` key is treated as a toggle and every
other field in it is silently discarded — no error, `200`, and the response looks
like a successful save. It is safe today only because `updateTodo`
(`todo.service.ts:32-42`) happens never to send `completed`. The first person who
adds a "complete from the edit form" checkbox, or who posts the full todo object
back, gets a silent no-op that is painful to debug.

**Fix:** make the intent explicit — a distinct route (`PATCH
/api/todos/[id]/completed`) or a discriminator field — and reject a body that
mixes toggle and form fields with a `400`.

### m-6 — `toFieldErrors` lies about its return type

`src/app/api/todos/response.ts:29-41`

`fieldErrors[field as keyof TodoFieldErrors] = issue.message` casts whatever
string zod reports into the `TodoFieldErrors` key union. The toggle schema's only
field is `completed`, which is not a member of that union, so a failed toggle
parse produces `{ completed: "..." }` typed as `TodoFieldErrors`. Nothing breaks
today because `readFieldErrors` filters to a known field list
(`fieldErrors.ts:6`), but the cast disables the one check that would catch a
future field-name mismatch between server and form.

**Fix:** drop the cast and filter against the same `FIELD_NAMES` list the client
uses, sharing that list from `schema.ts` so the two cannot drift.

### m-7 — the toggle is not optimistic, contrary to `docs/DESIGN.md` §1 and §4.8

`src/app/todos/components/TodoListScreen.tsx:167-188`

The design doc is explicit: "State changes (toggle complete, delete) apply
immediately and report failure via a toast"; §4.8 describes row-level pending as
`opacity-60 pointer-events-none` with "No spinner — these are optimistic". The
implementation awaits the round trip, then calls `reload()` for a *second* round
trip before the checkbox moves. On a slow connection the checkbox visibly lags
the click by two requests. It is functionally correct — US-07's revert-on-failure
criterion is trivially met because nothing ever moved — but it is not what the
design specifies, and the whole `pointer-events-none` row treatment exists to
support a pattern that was not built.

**Fix:** apply the flip to local state immediately, revert it in `catch`, and
drop the `reload()` from the success path (the returned `TodoItemData` is already
the authoritative row) — or get the design decision changed in `docs/DESIGN.md`.

### m-8 — filter changes refetch with no loading state

`src/app/todos/components/TodoListScreen.tsx:100-123`

`isLoading` is set `true` only in the initial state and in `retry()`. Changing
status, priority or the search text re-runs the effect but leaves `isLoading`
false, so the previous result stays on screen for the whole request and then
swaps. Combined with `hasTodos` gating the filter bar
(`TodoListScreen.tsx:311, 332`), the first load also pops the filter row into
existence after data arrives, shifting the list down.

**Fix:** set `isLoading` at the top of the effect, and gate the filter bar on
something that does not flip during loading.

---

## Nit

- **N-1 — dead code.** `isTodoPriority` and `PRIORITY_LABELS` (`src/lib/todo.ts:19-23, 54-59`)
  and `priorityAriaLabel` (`src/app/todos/copy.ts:65-67`) have no callers;
  `PriorityChip` builds the same label from `PRIORITY_FILTER_LABELS` instead.
  `MIN_PASSWORD_LENGTH` is re-exported from `sign-up/components/form/index.ts:2`
  and imported nowhere. `useSession` is re-exported from `auth-client.ts:7` and
  never used. Delete them.
- **N-2 — `parseDueDate`'s `"invalid"` branch is unreachable in the handlers.**
  `route.ts:91` and `[id]/route.ts:67` both guard `parsedDueAt === "invalid"`,
  but `todoFormSchema`'s `dueAt` refine (`schema.ts:35-39`) already rejects those
  values with a `400`, so the guard can never fire. It reads like a defence in
  depth but is really dead code that hides the fact that the schema is the only
  check. Either drop the guard or return `400` from it.
- **N-3 — `CANCEL_LABEL` declared twice.** `src/components/ConfirmDialog.tsx:7`
  defines its own `const CANCEL_LABEL = "Cancel"` while `src/app/todos/copy.ts:88`
  exports one. `docs/DESIGN.md` §7.11 lists "Confirm cancel (all)" as a single
  slot. Import the copy-deck constant.
- **N-4 — repeated literals across route components.** `DESKTOP_MEDIA_QUERY`
  (`TodoListScreen.tsx:58`, `TodoFormModal.tsx:48`), `ICON_BUTTON_SIZING`
  (`TodoRow.tsx:20`, `TodosHeader.tsx:28`) and `TODOS_PATH` (five files) are each
  declared more than once. Hoist them next to the other shared constants.
- **N-5 — two names for the search parameter.** The URL uses `q`
  (`TodoFilters.tsx:37`, `page.tsx:16`) while the API uses `query`
  (`api/todos/route.ts:25`). Nothing is broken, but the mapping is implicit and
  lives in `todo.service.ts`'s `params: filters` spread. Name it once.
- **N-6 — comments describing an architecture that no longer exists.** The
  refactor from server actions to route handlers left three stale doc comments:
  `src/lib/http.ts:6-9` ("application data in this app moves through server
  actions" — it does not, which is why this axios instance exists);
  `src/app/todos/components/form/schema.ts:19-21` (cites
  `src/server/todo.action.ts`, a file that does not exist — the re-parse actually
  happens in `src/app/api/todos/**`); `TodoListScreen.tsx:79` (cites
  "`docs/CONVENTIONS.md` → Server actions — auth only" for a statement about HTTP
  loading). These are the comments a newcomer trusts first.
- **N-7 — `docs/STACK.md` is stale on two dependency versions.** It states Prisma
  6.19; `package.json` pins `prisma`/`@prisma/client` at `^7.9.1`. Worth fixing
  before someone reads the wrong migration guide.
- **N-8 — a docs conflict worth an explicit ruling, not a code change.**
  `docs/PRD.md` §4 lists **Search** as out of scope for v1, while
  `docs/DESIGN.md` §4.3 specifies a `SearchField` and §7.7 supplies its
  empty-state copy. The team built it, following DESIGN. That is the defensible
  reading, but the PRD should be amended so the scope boundary is not
  self-contradictory. (The same section lists "Undo" as out of scope while
  `docs/CONVENTIONS.md` mandates the toggle's Undo toast — same situation.)

---

## Convention compliance

Checked against `docs/CONVENTIONS.md` item by item; this section is largely
clean and the exceptions are already filed above.

- **Naming** — interfaces PascalCase, constants UPPER_SNAKE_CASE, components
  PascalCase with matching filenames, route segments kebab-case (`sign-in`,
  `sign-up`, `todos`). No `enum` is declared in application code; the priority
  union is a `const` tuple in `src/lib/todo.ts:7`, which is the better choice and
  does not conflict with the rule.
- **Folder layout** — `ConfirmDialog` is the only component in `src/components`
  and it is used by three routes; every single-route component sits under that
  route's `components/`. Correct on both halves of the rule.
- **Forms** — all three form folders have `schema.ts` + `index.ts` barrel +
  PascalCase form file; consumers import from the barrel, never a deep path.
  Types are `z.infer`, limits are UPPER_SNAKE constants from `src/lib/todo.ts`,
  every HeroUI input is bound through `Controller`. The extra
  `fieldErrors.ts` in `todos/components/form/` is a helper, not a form, and is
  exported through the barrel — acceptable.
- **No try/catch in `src/service/`** — verified: neither `todo.service.ts` nor
  `auth.service.ts` contains `try`, a retry, a fallback value or a reshape. Both
  are pure transport. `todo.service.ts` declares the one shared value,
  `TODOS_ENDPOINT`, as a single UPPER_SNAKE constant. `getErrorMessage` lives in
  `src/lib/` as required and every caller uses it.
- **Shared axios instance** — `src/lib/http.ts` is the only `axios.create`, and
  every todo service call goes through it. No `fetch` for application data.
  `auth.service.ts` correctly goes through `authClient` instead.
- **Confirm modal before every create/update/delete, plus both auth forms** —
  present, all through the single `ConfirmDialog`: create/update
  (`TodoFormModal.tsx:194-209`), delete (`TodoListScreen.tsx:346-358`), sign-in
  (`SignInForm.tsx:191-200`), sign-up (`SignUpForm.tsx:224-233`). The toggle
  correctly has none. `ConfirmDialog` gets the details right: destructive confirm
  is `variant="danger"` with `autoFocus` on **Cancel**
  (`ConfirmDialog.tsx:55, 61-64`) — note this follows CONVENTIONS over
  `docs/DESIGN.md` §4.6, which asks for `autoFocus` on Delete; CONVENTIONS wins,
  and the juniors resolved the conflict the right way. `isDismissable={false}`,
  Escape enabled except while pending, confirm disabled and showing a `Spinner`
  in flight, body text naming the record.
- **A toast on every mutation outcome, naming the record** — create/update/
  delete/toggle/undo all name the title (`copy.ts:123-139`); auth toasts name the
  email. The only mutation with no success toast is sign-out, which matches the
  copy deck (§7.13 defines a failure string only).

---

## Requirements coverage (`docs/PRD.md`)

| Story | Verdict | Note |
|---|---|---|
| US-01 Sign up | Met | All fields, `@` check, 8-char rule client-side (`sign-up/.../schema.ts:18-22`) and server-side (`auth.ts:13`), duplicate-email path clears password and keeps email (`SignUpForm.tsx:58-65`), double-submit guarded. |
| US-02 Sign in | Met | Identical message for wrong password and unknown account (`SignInForm.tsx:76-81`); `?next=` honoured; signed-in visitors redirected (`sign-in/page.tsx:26-28`). See M-1 on the `next` sanitiser. |
| US-03 Sign out | Met | Account menu shows the email, signs out, replaces to `/sign-in`, and the proxy blocks a Back-button return once the cookie is gone. |
| US-04 Protected routes | Met | Proxy for the optimistic redirect, `requireUser()` in `todos/layout.tsx:11` as the real guard, `401` before any write in every handler. Partial only on the `?next=` preservation in the expired-cookie branch — see m-2. |
| US-05 Create | Met | Defaults land correctly; the form remounts on close so it resets; typed values survive a failure. |
| US-06 List | Met | Order is `[{completed:"asc"},{createdAt:"desc"}]` (`route.ts:59`), matching "Default list order". Note indicator, priority, due date, strikethrough plus checkbox state all present; skeleton on initial load. |
| US-07 Toggle | Met | Only `completed` is written (`[id]/route.ts:47-50`). Not optimistic — see m-7. |
| US-08 Edit | Met | Pre-filled, `null` on cleared note/due date, same length rules, scoped by `{id, userId}`. |
| US-09 Delete | Met | Named confirmation, Escape cancels, scoped delete, empty state reappears. |
| US-10 Filters | Met | Status + priority combine with AND server-side, reflected in the URL, survive reload, distinct no-match state. |
| US-11 Empty state | Met | Three distinct states plus the filter no-match state; filter chrome is hidden at zero todos (`TodoListScreen.tsx:332`); CTA opens the modal with Title autofocused. |

Non-functional: NFR-01/02 verified in §1 above. NFR-03 enforced both sides.
NFR-07 verified in §2. NFR-09 — the list is three queries, no N+1, and uses the
`[userId, completed]` index. NFR-05/06 — the token discipline is followed
strictly: `grep` for hex, `rgb()`, `oklch()` and Tailwind palette classes across
`src/` returns **zero** hits, `globals.css` adds no second `:root`, and the
pre-paint theme script (`layout.tsx:29`) reads the same `heroui-theme` key
`useTheme` writes. NFR-08 is where M-4 bites.

## Accessibility (`docs/DESIGN.md` §6)

Genuinely good, and I could not find a gap worth filing. Specifically verified:
44px targets on every row control with a `sm:` relaxation
(`TodoRow.tsx:20, 110`); specific `aria-label`s naming the title on the checkbox,
edit and delete; priority carried by glyph + word + `sr-only "Priority: "`
(`PriorityChip.tsx:24-28`); overdue carried by `⚠` + `sr-only "Overdue — "`
(`TodoDueDate.tsx:27-34`); completion by checkbox state *and* `line-through`;
row actions revealed via `group-focus-within` rather than `hidden`, with
`motion-reduce:transition-none` (`TodoRow.tsx:144`); no `outline-none` anywhere;
tooltips suppressed on touch while the `aria-label` remains the accessible name
(`TodoRow.tsx:62-80`); skeleton carries `aria-busy` and a label. Focus trap and
restore come free from react-aria and are not overridden.

---

# Code review — `fix/qa-regression-findings` → `develop`

Reviewer: Senior engineer
Date: 2026-08-16
Range: `git diff develop...fix/qa-regression-findings` (`d36b00a`…`26b55ef`, 8 commits)
Gate: `npx tsc --noEmit` clean, `npm run lint` clean, `npm run build` succeeds —
re-run against `26b55ef`. This review covers what those cannot see.

Note: `26b55ef` ("drop the per-api model file") landed mid-review. It removes
`src/app/api/todos/model.ts`, returns response building to `toTodoResponse` /
`toTodoListResponse` in `util.ts` typed as `TodoItemData` / `TodoListResult`,
and updates `docs/CONVENTIONS.md` to match. Findings below are against that
commit. The classes-versus-arrow-functions question is moot — there are no
classes left, and the mapper now returns the same type the client consumes, so
the server↔client contract is compile-checked again. That is the right shape.

## 1. Authorization and data scoping — clean

Traced every handler under `src/app/api/todos/**`:

- `GET /api/todos` (`route.ts:31-66`) — `getSession()` first, `401` before any
  query; `where` seeded `{ userId: session.user.id }` (`:41`); both `count()`
  calls repeat the owner clause (`:59-60`).
- `POST /api/todos` (`route.ts:68-92`) — session first, schema second,
  `userId` written from the session only (`:87`).
- `PATCH /api/todos/[id]` (`[id]/route.ts:38-74`) — session first,
  `updateMany({ where: { id, userId: session.user.id } })` (`:57-58`),
  `count === 0` → `404`, re-read through `findOwnedTodo(id, session.user.id)`.
- `PATCH /api/todos/[id]/status` (new, `[id]/status/route.ts:37-69`) — same
  order, same single-statement scoping (`:57-59`), same `404`. No `userId`
  anywhere in the body schema, query or headers.
- `DELETE /api/todos/[id]` (`[id]/route.ts:77-91`) — `deleteMany` scoped,
  `404` on zero rows, `204` otherwise.

Undo path traced concretely: `TodoListScreen.undoToggle` (`:100-116`) →
`toggleTodo` → `PATCH /api/todos/:id/status` — the identical route with the
identical session check. No privileged shortcut, no id from anywhere but the
row the user already sees. A foreign id returns `404` with
`TODO_NOT_FOUND_MESSAGE`, indistinguishable from a deleted one.

No finding.

## 2. The `completed` split — one gap (see m-3)

`PATCH /api/todos/[id]` rejects any body carrying `completed` (`:46-48`), the
status route rejects anything but `completed` (`:22`, `.strict()`), and neither
rejection can read as a save: both are `400`s with no `fieldErrors`, so
`readFieldErrors` returns `null` and `TodoFormModal` shows a danger toast rather
than re-rendering the form as if it had submitted. `updateTodo` sends exactly
the four form fields; `toggleTodo` sends exactly `{ completed }`.

The third path is `POST /api/todos` — filed as m-3.

## 3. Secret and boundary leaks — clean

`@/lib/prisma` is imported only by the four route handlers and `util.ts`; no
`"use client"` module reaches it (checked by grepping every `"use client"` file
for `lib/prisma`, `lib/auth`, `lib/session` — zero hits). `DATABASE_URL` appears
only in `src/lib/prisma.ts` and generated Prisma doc comments;
`BETTER_AUTH_SECRET` appears nowhere in `src/`. Every error body now goes
through `apiError`, which emits `{ code, message, fieldErrors? }` and nothing
else — no stack, no Prisma text, no SQL. See M-4 for the one hole in that
claim (unhandled 500s).

---

## Blocker

None.

## Major

**M-1 — `src/app/api/todos/[id]/status/route.ts:49-55`: the `badRequestResponse`
branch is unreachable, and every rejection gets the wrong message.**
`toFieldErrors` (`errors.ts:28-41`) keeps only paths that pass
`isTodoFieldName`, and `TODO_FIELD_NAMES` is `title, note, priority, dueAt` —
`completed` is not among them. This schema has exactly one key, `completed`, so
`fieldErrors` is *always* empty and `Object.keys(fieldErrors).length > 0` is
always false. Consequence: `PATCH /status` with `{"completed":"yes"}` — a plain
wrong-type error — answers "This route takes only “completed”; use PATCH
/api/todos/[id] to save the todo's fields.", which is untrue and points the
caller at the route that would reject it too. It also means dead code plus two
imports (`badRequestResponse`, `toFieldErrors`) that do nothing at runtime, and
a doc comment (`:24-28`) that implies field errors are reachable here.
Fix: drop the ternary and the two imports; branch on the issue instead —
`parsed.error.issues.some((issue) => issue.code === "unrecognized_keys")` gets
the "wrong route" wording, anything else gets a message that says `completed`
must be `true` or `false`.

**M-2 — `[id]/route.ts:22-23` and `[id]/status/route.ts:29-30`: developer copy
is shown to users, and it is not in the copy deck.** Both strings name HTTP
methods and route paths (`"Use PATCH /api/todos/[id]/status …"`). They reach
`getErrorMessage` and land verbatim in a `toast.danger`. `docs/CONVENTIONS.md`
→ Mutation UX: "Exact strings come from the copy deck in `docs/DESIGN.md`. If a
string is missing there, add it to that file rather than improvising inline."
Neither string is in `docs/DESIGN.md`, and this branch does not touch that file.
Fix: add user-facing copy to `docs/DESIGN.md` (e.g. "That change couldn't be
saved. Refresh and try again.") and use it; if the API detail is wanted for
developers, put it in the `code` or a separate `detail` field, not `message`.
While there: `“completed”` uses curly quotes and `todo's` a straight
apostrophe in the same sentence — the deck uses typographic quotes throughout.

**M-3 — `src/app/api/todos/route.ts:73-89`: `POST` still accepts and silently
drops `completed`.** `todoFormSchema` is a non-strict object, so
`{"title":"x","completed":true}` parses, `completed` is stripped, and the todo
is created incomplete. It is the same defect class the branch exists to close
(DEF-06), one route over. Milder than DEF-06 because the `201` body reports
`completed:false`, so the answer is at least honest — but the invariant the
branch claims ("`completed` is never accepted where it cannot be applied") is
not held. Fix: hoist `mentionsCompleted` into `util.ts` (or `errors.ts`) and
apply the same guard in `POST` before parsing, with the same message chosen
under M-2.

**M-4 — `src/lib/apiError.ts:14-19`: no code for `500`, so the "every error
response carries `message`" contract is not actually total.** The handlers have
no `try`/`catch`; a Prisma or connection failure becomes Next's own `500`, whose
body has no `message` and no `code`. `getErrorMessage` then falls through to the
caller's fallback string — which works, but `docs/CONVENTIONS.md` (as amended by
this branch) states the client "depends on this: `getErrorMessage` reads
`message` and expects it on every error response". Fix: either add
`ApiErrorCode.Internal` plus a thin wrapper the handlers use, or write the
exclusion into the convention explicitly so the next reader does not trust a
guarantee that does not exist.

**M-5 — `src/lib/auth.ts:23-25`: production pinning depends on an env var
nothing enforces.** The security reasoning in the comment is right and the
implementation of the split is right: `NODE_ENV === "production"` never yields
the dynamic config, so the `Host` header cannot steer the base URL in a Vercel
deploy; development is confined to `allowedHosts: ["localhost:*",
"127.0.0.1:*"]`, which better-auth matches against the validated `host` header
(`resolveDynamicBaseURL`, `matchesHostPattern`), so a non-loopback host throws
rather than being accepted. I checked this against the installed better-auth
(`node_modules/better-auth/dist/utils/url.mjs`) rather than the docs. So: the
change is not wrong, and I would not block on it.
The gap is that if `BETTER_AUTH_URL` is unset in production, `baseURL` is
`undefined` and better-auth falls back to the env vars and then to
`getOrigin(request.url)` — i.e. the very `Host`-derived base URL the comment
says production excludes, silently and with no error. Fix (one line, worth
having):
`if (isProduction && !process.env.BETTER_AUTH_URL) throw new Error("BETTER_AUTH_URL must be set in production");`
before the ternary. Fail at boot, not on the first password-reset link.

## Minor

**m-1 — `src/lib/auth.ts:29`: `trustedOrigins` is a no-op in both branches and
reads as though it does something.** In development, `getTrustedOrigins`
(`better-auth/dist/context/helpers.mjs:60-75`) already derives
`http://localhost:*` and `http://127.0.0.1:*` from the dynamic `allowedHosts`
plus `protocol: "http"`, so `LOCAL_ORIGINS` duplicates them exactly. In
production the value is `[]`, which adds nothing to the origin derived from
`BETTER_AUTH_URL`. It cannot widen production — that part of the brief checks
out — but a reader has to prove that from library source. Fix: delete the
`trustedOrigins` line and `LOCAL_ORIGINS`; if the intent is documentation, say
so in one comment instead of in dead config.

**m-2 — `src/app/todos/components/form/schema.ts:54, 56-60`: two user-facing
strings changed without updating the copy deck.** `docs/DESIGN.md:1062-1063`
specify `Choose a priority.` and `Enter a valid date.`; the code now sends
`Choose a priority: low, medium, high.` and `Enter a valid date (YYYY-MM-DD).`
The new wording is better — but the deck is the source of truth for copy, and
it is now stale. Fix: update `docs/DESIGN.md:1062-1063` in this branch.

**m-3 — `schema.ts:50`: `note`'s type-error message is a length message.**
`z.string(tooLongMessage("note", NOTE_MAX_LENGTH))` means `{"note": 5}` answers
"Keep the note under 2000 characters.", which is not what went wrong. `title`
gets this right (`:45`, "Enter a title."). Fix: give `note` its own type
message ("The note must be text.") and add it to the copy deck.

**m-4 — the two `PATCH` handlers disagree about the no-field-to-blame case.**
`[id]/route.ts:52` hands an empty `fieldErrors` to `badRequestResponse` and
relies on `apiError`'s default ("That request wasn't valid."); `status/route.ts`
20 lines away branches explicitly to `malformedBodyResponse`. Same situation,
two shapes of code, and a garbage body gets a helpful message on one route and a
generic one on the other. Fix: pick one — with M-1 applied, the status route's
ternary disappears and both routes read the same way.

**m-5 — duplicated write-then-reread tail, and a window between the two
statements.** `[id]/route.ts:57-73` and `[id]/status/route.ts:57-68` are the
same six lines: `updateMany` → `count === 0 ? 404` → `findOwnedTodo` →
`!todo ? 404` → `json(toTodoResponse(todo))`. Two round trips, and a concurrent
`DELETE` between them turns a successful write into a `404`. Prisma 7 allows
non-unique filters in `update`'s `where`, so
`prisma.todo.update({ where: { id, userId }, data })` returns the row in one
statement (catch `P2025` → `404`) and removes both the duplication and the
window. At minimum, extract the tail into one helper in `util.ts`.

**m-6 — commit hygiene, `d36b00a`.** It carries the entire 851-line rewrite of
`docs/QA-REPORT.md` alongside three code fixes in three areas.
`docs/WORKFLOW.md` → Commit messages: "One logical change per commit." The QA
report is QA's artifact and belongs in its own `docs:` commit (arguably on
`develop`, not here); bundled like this the code fix is unreviewable in
isolation. Not something to re-write history over now — noting it so it does not
repeat.

**m-7 — `docs/CONVENTIONS.md` is amended by `refactor:` commits.** `d73a708`,
`0588137` and `26b55ef` each add mandatory-convention text that blesses the
structure the same commit introduces. The conventions are the team lead's
document and they override inferred style; a fix branch editing them, inside
commits typed `refactor:`, is the wrong direction of authority even when the
resulting rules are sensible (they are, after `26b55ef`). Fix going forward:
propose convention changes as their own `docs:` commit, ideally its own PR.

**m-8 — `@vercel/speed-insights` is undocumented and out of scope for this
branch.** `package.json:26`, `src/app/layout.tsx:45`. The commit is correctly
typed `chore:` and isolated, and the component is inert outside Vercel — but
`docs/STACK.md` lists the stack and does not mention it, and adding a
third-party beacon to every page is a product decision, not a QA regression fix.
Fix: add a row to `docs/STACK.md`; ideally ship it on its own branch.

## Nit

- `[id]/route.ts:25` — `mentionsCompleted` describes narration, not a
  predicate. `hasCompletedKey` says what it tests.
- `[id]/route.ts:17-21` — the doc block explains the *route's* behaviour but is
  attached to the message constant. It belongs on the guard or on `PATCH`.
- `util.ts` is a generic name and now holds three unrelated things (row
  mapping, a Prisma read, body parsing). `26b55ef` documents it in
  `docs/CONVENTIONS.md`, which is enough to stop the next developer guessing,
  so I am not filing it — but if a fourth kind of helper appears, split it.

## Claims checked against the code

| Claim | Verdict |
|---|---|
| DEF-02 — `PressResponder` warning from `ConfirmDialog` | Closed. `ConfirmDialog.tsx:45` now renders `AlertDialog.Backdrop` directly; `AlertDialogBackdrop` computes its own slots and does not need the root's context, and the root was the `DialogTrigger`/`Pressable` that logged the warning. Controlled props (`isOpen`/`onOpenChange`) are `ModalOverlay` props, so behaviour is unchanged. |
| DEF-06 — mixed PATCH body `200` with fields dropped | Closed for `PATCH /[id]`; see M-3 for `POST`. |
| DEF-07 — raw zod text reaching the user | Closed for the four form fields; see m-3 for `note`'s wording. A root-level type error (body is an array/number) still falls to the generic message, which is correct. |
| Auth base URL derived in dev, pinned in prod | True as implemented; see M-5, m-1. |
| Every API error centralised in `src/lib/apiError.ts` | True for every error the handlers emit; `NextResponse.json` no longer appears in an error path. Unhandled `500`s are outside it — M-4. |
| Validation messages built from their constants | True (`schema.ts:17-24`); deck not updated — m-2. |
| Write routes split; response bodies built in one place | True. After `26b55ef` the mapper returns `TodoItemData`/`TodoListResult`, so client and server share one declaration. |

## Verdict

**Request changes.**

Merge-blocking: **M-1** (unreachable branch, wrong message on a real error
path), **M-2** (developer copy in a user toast, off-deck), **M-3** (`POST`
still drops `completed`). **M-5** is one line and should ride along.
The rest can follow as separate commits.

The authorization work is solid and the `/status` split is the right call — I
found nothing to fault in session handling, ownership scoping or the Undo path.

---

# Engineering proposals

Author: Senior engineer
Date: 2026-08-16
Read against: the working tree of `fix/add-refresh-gap`, `docs/PM-PROPOSAL.md`,
`docs/QA-REPORT.md` §7–§9, `docs/CONVENTIONS.md`, `docs/WORKFLOW.md`, and my own
two reviews above.

The round's question is **how we make this app genuinely more appealing to use.**
Engineering has two answers product cannot give: one about why it feels slow, and
one about why shipping the nice things is currently expensive.

**The recommendation, up front:** the single change that makes this app feel like
a different product is **stop making the user wait for a network round trip to
see the result of their own click.** Every mutation in `TodoListScreen.tsx` today
awaits a `PATCH`, then triggers a *second* full-list `GET` before anything moves
on screen. That is the sluggishness, it is measurable rather than a feeling, and
§2 sets out exactly where the milliseconds go. It is also, not coincidentally,
the review finding (m-7) that has been open longest and been deferred three
times.

**And the thing that has to come with it:** before that lands — and before
backlog #1, #2 or #4 — put automated tests under the two things a human cannot
reliably re-check: **cross-user scoping in `src/app/api/todos/**`, and the list
state machine in `TodoListScreen.tsx`**. Not on principle. Because of one
specific fact: the strongest quality claim in this repo, the isolation matrix in
`docs/QA-REPORT.md` §7, is re-proved **by a person deciding a diff looks safe**.
That decision was made correctly twice. Backlog #4 is the diff where it gets made
wrong. And optimistic updates are precisely the class of change that a
browser-driving human cannot verify — you cannot see a revert-on-failure without
breaking the network on purpose, which `docs/QA-REPORT.md` §8 says QA has no way
to do.

That is the honest engineering answer to "make it nicer": the nicest single
change we can make is also the one we currently have no way to prove is correct.
Two and a half days of test scaffolding is what turns it from a risk into a
routine change — and then keeps doing that for every appealing thing after it.

---

## 1. What worries me, ranked

### 1.1 — The isolation guarantee is verified by human judgement, and the backlog contains the exact diff that defeats it

`docs/QA-REPORT.md` §7 runs the short form on the reasoning "the diff under test
touches exactly two files … no route handler, no session code, no Prisma query
changed." That is sound reasoning and it was the right call both times. Now read
`docs/PM-PROPOSAL.md` #4 — search notes as well as titles. It is **one line** in
`src/app/api/todos/route.ts:56-58`, changing

```ts
where.title = { contains: query, mode: "insensitive" };
```

into an `OR`. A one-line change to a `where` clause is exactly the diff a
reviewer and a tester both classify as small. It is also the only diff in the
whole backlog that can silently remove `{ userId: session.user.id }` from the top
level of the filter. The PM spotted this and asked for "a security-minded review
and a test" — there is nowhere for that test to go.

Everything else on this list is a cost. This one is the only unbounded loss.

### 1.2 — `TodoListScreen.tsx` is a hand-rolled data-fetching library, and the next three backlog items all land in it

417 lines, nine `useState`, a `reloadToken` counter, a render-phase `setState`
guarded by `lastFilterKey` (`:87-90`), a manual `isCurrent` race guard
(`:331-355`), and now two reload variants with a paragraph of prose each
explaining which callers may use which. Every one of those is a re-implementation
of something a query library does: staleness, cancellation, loading state,
invalidation. Each piece is correct — I have checked them all — and each was
added to fix a real bug (m-4, m-8, the refresh gap). That is the tell. It is
accreting invariants that live only in comments.

PM backlog #1, #2 and #3 all edit this file, and #3 (optimistic toggle) adds
local mutation of `result.todos` on top of a refetch token. The PM's own decision
memo says it plainly: "two unreviewed behaviour changes landing in it at once is
exactly how a subtle refetch bug ships." Correct — and sequencing them does not
make the file smaller.

### 1.3 — The API imports its trust boundary from a UI component folder

`src/app/api/todos/route.ts:5` and `[id]/route.ts:3`:

```ts
import { todoFormSchema } from "@/app/todos/components/form";
```

`src/app/api/todos/errors.ts:3-6` does the same for `isTodoFieldName` and
`TodoFieldErrors`. The dependency arrow points server → client-route-UI. Today
that is only ugly. It stops being only ugly the moment a second producer of the
same payload appears — which is backlog #1, quick-add — because then "the form's
schema" and "the API's contract" are no longer the same idea, and the file that
defines the trust boundary sits three directories inside a route's presentation
layer where nobody expects to find a security-relevant module.

`CONVENTIONS.md` → Forms still says "The same zod schema is re-validated inside
the server action", which is a third name for the same object in an architecture
that has no server actions.

### 1.4 — There is no migration history, and the next two features need schema changes

`prisma/` contains `schema.prisma` and nothing else. `package.json` has
`db:push`, no `migrate`. Backlog #2 wants `@@index([userId, dueAt])`; the PM's
success measure #5 wants a `createdVia` column; #7 and #8 want real tables. With
`db push` there is no reviewable artefact for a schema change, no replay, no way
to tell whether Neon matches `schema.prisma`, and an index added by hand in one
environment is invisible in the diff. This is cheap to fix once and expensive to
fix after four undocumented pushes.

### 1.5 — A `401` mid-session is a dead end (m-3, still open)

`src/lib/http.ts:28-31` is an interceptor that does nothing:

```ts
http.interceptors.response.use(
  (response) => response,
  (error) => Promise.reject(error),
);
```

The comment says it is the "single hook point for cross-cutting concerns" — and
the one genuinely cross-cutting concern in the app is sitting unhandled. When a
session expires with the list open, the user gets an Alert titled "Couldn't load
your todos" and a **Try again** button that will fail identically, forever. It is
the only state in the app with no exit.

### 1.6 — Two declared-but-unreachable paths that document guarantees the code does not make

- `ApiErrorCode.Internal` (`src/lib/apiError.ts:19, 51-54`) is never constructed.
  No handler has a `try`/`catch`, so a Neon blip returns Next's HTML 500 with no
  `message` — the exact case `CONVENTIONS.md` → One error shape says cannot
  happen. QA has this as DEF-10, open from inspection only, because QA has no way
  to inject the fault.
- `parseDueDate`'s `"invalid"` sentinel (`src/lib/todo.ts:93-101`) is handled in
  both write handlers as `dueAt: parsedDueAt === "invalid" ? null : parsedDueAt`
  (`route.ts:97`, `[id]/route.ts:54`) — i.e. if it ever *were* reachable, an
  invalid date would silently clear the field instead of returning `400`. The
  schema makes it unreachable today. A `Date | null | "invalid"` return type is
  the shape that invites this; a discriminated result or a thrown error does not.

### 1.7 — Nits still open from review 1 and 2

`isTodoPriority` (`src/lib/todo.ts:64`) has no callers. `src/lib/http.ts:6-9` and
`TodoListScreen.tsx:51-54` still cite server actions for code that uses none.
`docs/STACK.md` still says Prisma 6.19 against `^7.9.1`. None of these will hurt
anyone; they are the comments a newcomer trusts first.

---

## 2. What the app is actually slow at, and why

The lead asked for the real cost rather than a feeling. Here it is, traced.

### 2.1 — Every mutation costs two sequential round trips before anything moves

`handleToggle` (`TodoListScreen.tsx:174-201`): `await toggleTodo(...)` — one
`PATCH` — then `reloadSilently()` bumps `reloadToken`, which re-runs the effect
at `:330-355`, which issues a fresh `GET /api/todos`. The checkbox does not move
until **both** land, because nothing is applied locally. Same shape in
`undoToggle`, `handleDelete` and `TodoFormModal.onSaved`.

Cost per toggle, on Vercel + Neon, in order:

1. `PATCH /api/todos/[id]/status` — `getSession()` (a `session` table read),
   `updateMany`, then a **second** query, `findOwnedTodo`, to build the response
   (`status/route.ts:61-70`). Three DB round trips inside one request.
2. `GET /api/todos` — `getSession()` again, then three queries in parallel
   (`route.ts:60-67`): `findMany`, `count`, `count`.

So one checkbox click is **two HTTP requests, two session lookups and seven
database queries**, and the response body of the first one — the authoritative
updated row — is thrown away. On a good desktop connection that is perhaps
250–400 ms and reads as "fine". On a phone on mobile data, two sequential
round trips to a serverless function plus a Neon connection is comfortably
half a second to a second of a checkbox that does not tick. That is the thing
users describe as "it feels slow", and it is the most-repeated action in the app.

**Yes — this is what makes it feel sluggish.** Not render performance, not bundle
size, not Prisma. Sequential round trips on the interaction that happens most.

### 2.2 — What I would do instead, in the order I would do it

1. **Apply the toggle locally and immediately** (m-7, PM backlog #3). Flip the
   row in `result.todos`, revert in `catch`. The row already has its
   `opacity-60 pointer-events-none` treatment for exactly this
   (`TodoRow.tsx`) — `docs/DESIGN.md` §4.8 specified this pattern and it was
   never wired up. Perceived latency goes from ~500 ms to zero.
2. **Use the response body instead of refetching.** `toggleTodo` and
   `updateTodo` already return the authoritative `TodoItemData`
   (`todo.service.ts:32-44`). Splice it into the list. That deletes the second
   round trip entirely for toggle, undo and edit. Note this is a *narrower*
   claim than the PM's backlog #3, and it agrees with the PM's own later
   correction: a **create** genuinely can change membership and ordering, so
   create keeps its refetch. Delete needs only the counts.
3. **Return the counts from the write routes**, or derive them client-side. The
   only reason a delete refetches at all is the `{completed} of {total} done`
   header. That is arithmetic, not a query.
4. **Collapse the write handlers' two queries into one.** Prisma 7 allows
   non-unique filters in `update`'s `where`, so
   `prisma.todo.update({ where: { id, userId }, data })` returns the row in one
   statement (catch `P2025` → `404`). This is m-5 from review 2, still open. It
   removes a query *and* closes the window where a concurrent delete turns a
   successful write into a `404`.

Items 1–3 are the felt difference. Item 4 is server-side hygiene that rides
along.

### 2.3 — The other real latency, and it is not on this list by accident

The **initial** load of `/todos` is a server-rendered shell that then fetches its
own data from the client (`page.tsx` renders `TodoListScreen`, which `GET`s in an
effect). So first paint is a skeleton, always, even though the server rendering
that page already has a session and a database connection in hand. That is a
waterfall the architecture chose deliberately —
`CONVENTIONS.md` → "Server actions — auth only" mandates it — and unpicking it
means revisiting that rule, which is a bigger conversation than this document.
I am **not** proposing it now. I am recording that it is the second-largest
latency in the app so that nobody re-discovers it as a surprise, and noting that
§2.2 gets the felt win without touching it.

### 2.4 — What is *not* slow, so nobody optimises it

The list query is three queries with no N+1 and hits the `[userId, completed]`
index. Rendering is a flat `<ul>` with no memoisation problems at realistic
sizes. `?query=` search is debounced (`TodoFilters.tsx:80`). Bundle size is
unremarkable. None of these is worth an hour until the app has thousands of rows
per user — and when it does, the first thing to break is the un-indexed `ILIKE`
on notes that backlog #4 adds, not anything that exists today.

---

## 3. What I would build next, ranked — and where I disagree with the PM

I agree with the PM's read of the product. I disagree with the order.

### E-1 — API contract tests, before backlog anything (M, ~2 days)

See §4. Half the headline, and the half that makes E-2 safe to do.

### E-2 — Make the list respond instantly (S–M, 1–2 days) — the other half

§2.2 items 1–3, on top of E-3's hook. This is m-7 plus the PM's backlog #3
narrowed to what the PM's own decision memo still stands behind. It is the
cheapest change in this document that a user can feel, and the only one of my
proposals that is visible from the outside.

It should not ship without E-1, and I want to be explicit about why rather than
hiding behind process: optimistic state has exactly one failure mode — the
revert — and `docs/QA-REPORT.md` §8 records that QA has **no fault injection**.
A human cannot verify revert-on-failure through a browser. Today that is fine
because nothing is optimistic and the row "already shows the truth"
(`TodoListScreen.tsx:194`). The moment we apply changes locally, we have a
correctness property with no verifier. Two tests cover it.

### E-3 — Move the todo schema to `src/lib/todo.schema.ts` (S, half a day)

One file move plus imports. The form imports it, both write handlers import it,
`errors.ts` imports `TODO_FIELD_NAMES` from it. Do it **before** quick-add, not
after, because after means doing it while a second caller is being written.

### E-4 — Extract `useTodoList` from `TodoListScreen` (S–M, 1–2 days)

A hook in `src/app/todos/hooks/useTodoList.ts` owning `result`, `isLoading`,
`loadError`, `reloadToken`, `lastFilterKey`, the effect and the race guard,
returning `{ result, isLoading, error, reload, reloadQuietly, retry }`. The
screen keeps the dialogs, the pending set and the rendering. No new dependency,
no behaviour change, reviewable in one sitting.

I considered proposing TanStack Query instead, which is what this file is
imitating, and I am not proposing it: it is a new dependency with its own
conventions on a fixed stack, and the hook gets 80% of the value for a day. If
the app ever grows a second list screen, revisit.

### E-5 — Swap `db push` for `prisma migrate` (S, half a day) — before backlog #2

`prisma migrate dev` locally, `prisma migrate deploy` in the Vercel build, one
baseline migration generated from the current schema. Do it while the schema is
still the one everybody agrees on.

### E-6 — Backlog #2 (due-date ordering) **before** backlog #1 (quick-add)

This is my one real disagreement, and I want to argue it rather than assert it.

The PM's case for quick-add first is that ordering is worth little while `dueAt`
is mostly null, and quick-add is what populates `dueAt`. That is a good argument
and it may well be right about the product. It is the wrong thing to *start*,
for three engineering reasons:

1. **Quick-add is blocked on a decision that has not been made.** The PM says so
   explicitly: without a `CONVENTIONS.md` exception it should not be built at
   all. Ordering needs no ruling from anybody. Starting the blocked one first is
   how a small team ends up with a branch parked for a week.
2. **Quick-add is the largest new surface in the backlog** — a natural-language
   parser, a new component, a new interaction, plus (for the PM's own falsifying
   measure) a `createdVia` migration on a repo with no migration history. It is
   the worst possible first thing to build on an untested codebase, and the best
   possible second thing once E-1 and E-5 exist. Note that `parseQuickAdd` is
   the one module the PM already wants unit-tested — there will be somewhere to
   put those tests if E-1 goes first.
3. **Ordering is server-side and small.** An `orderBy` change, an index, a
   client-side grouping pass. It is the cheapest change in the backlog that makes
   the screen say something different on a Tuesday morning, and the *Overdue*
   group earns its keep at three overdue todos, not thirty. The PM's own risk
   note — that `Priority` sorts `low, medium, high` so `desc` gives high-first,
   and getting it backwards is silent — is a one-line assertion in E-1's suite.

So: **E-1, then E-3 and E-4, then E-2 and E-5, then backlog #2, then the lead's
ruling, then quick-add.** Roughly a week of engineering before the first product
feature, of which E-2 is the part the user sees and the rest is what makes E-2 —
and everything after it — a routine change rather than a gamble.

To say the disagreement plainly, since the PM was direct about theirs: the PM
ranked "just polish what exists" as a defensible answer they chose not to give,
on the grounds that none of the open defects is visible from the UI. True of m-1
through m-6. Not true of m-7 — a checkbox that lags half a second is the most
visible thing in the app, and it is the one piece of polish the PM's own backlog
#3 already agrees with. I am asking for that one plus the scaffolding, and then
I will build their list in their order.

### E-7 — The `401` interceptor (S, hours)

`http.ts`, one branch: on `401`, redirect to `/sign-in?next=/todos` with the
§7.9 copy. Closes m-3 and gives that dead interceptor a reason to exist.

### E-8 — Delete the two unreachable paths (XS)

Either give the handlers a wrapper that emits `ApiErrorCode.Internal`, or write
the exclusion into `CONVENTIONS.md` so the next reader does not trust a total
guarantee. Same for `parseDueDate` — make it return `400`, or drop the sentinel.

---

## 4. The thing nobody has raised: there is no test suite, and I think that is now the top risk

Not "we should have tests because teams have tests." The specific claim:

**The property this app is proudest of is the only one being verified by
judgement.** `docs/QA-REPORT.md` §7 is a genuinely excellent piece of testing —
two real accounts, every verb, byte-identical `404`s, a check that no existence
oracle leaks. It is also skipped-by-default. It ran in full once, then twice in
short form, each time gated on a human classifying the diff as "not in the
authorization path". Backlog #4 is a one-line `where` change that any reasonable
person classifies as not in the authorization path and that can drop the owner
clause. That is not a hypothetical; it is item four on the agreed backlog.

Second claim: **QA cannot test what QA cannot reach.** §8 lists it plainly —
failure paths, no fault injection; pointer interaction at desktop width, blocked
by the harness; DEF-10 unreachable from the browser. M-2 in review 1 (every
axios error showing `Network Error` instead of the copy deck) is a bug that a
browser-driving human structurally could not have found, because it needs the
network to break. Those are not gaps in QA's skill; they are gaps in the medium.

### What the first tests should be, in order

**Tier 1 — the isolation contract (~20 cases). This is the whole
recommendation; the rest is optional.**
Vitest, calling the exported route handlers directly with a stubbed session, or
over HTTP against a dev server with two real cookies — either is fine, the
former is faster. Seed users A and B. Assert, per verb:

- `GET /api/todos` as B never returns A's rows, under every filter combination
  **including `?query=` matching A's exact title** — this is the case backlog #4
  breaks.
- `PATCH /[id]`, `PATCH /[id]/status`, `DELETE /[id]` against A's id as B → `404`
  with a body byte-identical to a nonexistent id.
- Unauthenticated calls → `401` before any Prisma call.
- `POST` with `userId` in the body → the row belongs to the session user.
- `POST`/`PATCH` carrying `completed` → `400`, not a silent drop (DEF-06's
  regression guard).

This is `docs/QA-REPORT.md` §7 transcribed into code. QA already wrote the test
plan; it just wrote it in prose.

**Tier 2 — pure functions, no infrastructure, minutes each.**
`sanitiseNextPath` (`src/lib/routes.ts:27`) first: it is a security function
whose *previous* implementation carried a docstring stating an invariant it did
not hold (M-1). `parseDueDate`'s strict-mode rejection of `2026-02-31`.
`getErrorMessage`'s axios branch — the M-2 fix is one `??` away from regressing
and nothing would notice. `toFieldErrors` dropping unknown paths (m-6).
`parseQuickAdd` when it exists.

**Tier 3 — one Playwright happy path.** Sign in → create → toggle → undo →
delete → filter. Worth having eventually. I would **not** build it now: it is
the most expensive per assertion, the flakiest, and it duplicates the one thing
human QA is genuinely good at.

**What I would not test at all:** component rendering, HeroUI behaviour, copy
strings. The copy deck changes weekly and snapshot tests of it would be pure
tax.

### Cost, stated honestly

- Vitest + config + a two-user seed + the Tier 1 suite: **~2 days**, then roughly
  15 minutes per new route thereafter.
- Tier 2: **half a day**, and it is the half-day with the best ratio in this
  document.
- CI: there is no `.github/` at all. A 20-line workflow running
  `tsc --noEmit`, `lint`, `build`, `vitest` on every PR into `develop`:
  **~2 hours.** GitHub Actions free minutes cover a suite this size.
- **Database: no new paid service.** Neon's free tier includes branching, so the
  suite runs against a throwaway branch; a local Postgres container works too.
  Nothing here asks for money.
- Playwright, if we ever do Tier 3: another 1–2 days plus ongoing flake
  maintenance. Deferred deliberately.

Total for what I am actually asking for: **two and a half days plus two hours of
CI**, against a backlog the PM budgets at three to four days for its first item
alone.

### The counter-argument, and why I do not buy it here

"A four-person team on a 1,400-line UI does not need a test suite; tests are how
small teams slow themselves down." I would normally agree, and if the property at
risk were "does the filter chip render", I would not be writing this section.
The property at risk is "can user A read user B's data", the app's entire
promise, and the current control for it is a person looking at a diff and
deciding. Test the invariant, not the interface.

---

## 5. What I would stop doing

Direct, as asked.

### 4.1 — Stop confirming creates and updates. Rewrite the rule as "confirm the irreversible."

`CONVENTIONS.md` → Mutation UX mandates a confirm dialog for every create, update
and delete. It already has two exceptions carved into it (toggle, sign-in), the
PM is asking for a third (quick-add), and backlog #5 will ask for a fourth
(reschedule). **A rule with four exceptions is not a rule; it is a list of the
cases nobody has argued about yet.**

The rule the team actually wants is the one the exceptions all share: *confirm
what cannot be undone.* Delete confirms. Bulk delete confirms, with a count.
Sign-up confirms. Creating a todo does not destroy anything, and an update is
reversible by another update. Rewriting it that way costs one paragraph, makes
quick-add need no dispensation at all, and stops the lead being asked to
adjudicate each new feature individually.

This is your document and your call. I am telling you the cost of leaving it as
written is a standing tax on the PM's roadmap, paid one ruling at a time.

### 4.2 — Stop letting `CONVENTIONS.md` describe an architecture that does not exist

The folder-layout block still lists `src/server/todo.action.ts` and
`src/service/` as "client-facing wrappers that call server actions". The Forms
section still says "The same zod schema is re-validated **inside the server
action**." There are no server actions. The trust boundary is the route handler,
and `CONVENTIONS.md` says so correctly two sections later, in direct conflict
with itself.

A style doc that is wrong about naming is an annoyance. A style doc that is wrong
about **where the trust boundary is** is a hazard, because it is the first thing
a new contributor reads and the sentence it gets wrong is the security-relevant
one. `src/lib/http.ts:6-9` repeats the same false claim in the codebase itself.

Related, and already filed as m-7 last review: three `refactor:` commits
(`d73a708`, `0588137`, `26b55ef`) amended this document to bless the structure
they introduced. Convention changes should be their own `docs:` commit, and
ideally yours.

### 4.3 — Stop rewriting the docs wholesale each pass

`docs/` is now roughly 2,500 lines of prose against 1,400 lines of component
code, and one commit (`d36b00a`) carried an 851-line full rewrite of
`QA-REPORT.md` bundled with three code fixes. The content is good — QA's
canvas-compositing contrast measurement is better than most teams' — but a
report that replaces itself every pass loses its own history, and it is being
paid for in review attention that the code is not getting.

Two concrete swaps: QA's contrast methodology should be a **script** in the repo,
not a paragraph re-typed each pass; and the isolation matrix should be §4's Tier
1 suite, not a table. Both are the same information, executable, and diffable.

### 4.4 — Stop treating "tsc + lint + build + Senior review" as the definition of done

`WORKFLOW.md` §Definition of done lists four gates, three of which are type and
syntax checks that, as my own review headers keep noting, "cover what those
checks cannot see". The fourth is me. That is a single point of failure with a
bad night, and it is the reason §4 exists. Add `vitest` as gate 5 once it exists;
until then, at least be explicit that the isolation battery is a **release gate**
QA may not skip on judgement, whatever the diff looks like.

---

## 6. What I am not proposing

- **Not TanStack Query, MSW, or a component-test harness.** New dependencies with
  their own conventions, on a fixed stack, for a team this size. E-3 gets most of
  the first one's value for a day and no new package.
- **Not a rewrite of anything.** Every file in `src/` is legible and most of it
  is better than legible. The authorization work is the best thing in the repo
  and none of the above touches it.
- **Not error tracking / observability tooling.** Sentry's free tier would cover
  this app, but it is a third-party beacon on private todo text and a decision
  for the PM, not a chore. Vercel's own function logs cover E-7's `500` case for
  now.

---

# Code review — `fix/add-refresh-gap` → `develop`

Reviewer: Senior engineer
Date: 2026-08-16
Range: `git diff develop...fix/add-refresh-gap` (`4020b9b`…`f7c1232`, 3 commits)
Gate: `npx tsc --noEmit` clean, `npm run lint` clean — re-run against `f7c1232`.
This review covers what those cannot see.

I proposed the Mutation UX rewrite myself, as did the PM, the designer and QA
independently. That makes me a poor judge of the decision, so this reviews the
implementation only. Nothing below argues about whether the rule should have
changed.

## 1. Undo authorization and payload correctness — clean

Traced both undo paths end to end.

- `undoSave` (`TodoFormModal.tsx:93-107`) calls `updateTodo` / `deleteTodo` from
  `src/service/todo.service.ts:32-48` — the same functions the original write
  calls, through the same axios instance. There is no second route, no
  client-supplied user id, no shortcut. `undoToggle`
  (`TodoListScreen.tsx:166-182`) likewise re-runs `PATCH /api/todos/[id]/status`.
- The endpoints are session-scoped. `PATCH` and `DELETE`
  (`src/app/api/todos/[id]/route.ts:31-81`) both call `getSession()` first and
  return `401` before any read, then scope the write itself with
  `where: { id, userId: session.user.id }` through `updateMany` / `deleteMany`.
  Another user's row matches zero rows and comes back `404`, never as data. An
  undo is exactly as privileged as the write it reverses.
- **`saved.id` is the right id.** `POST /api/todos` returns
  `toTodoResponse(todo)` with `201` (`route.ts:103`); `PATCH` re-reads through
  `findOwnedTodo` and returns `toTodoResponse` (`[id]/route.ts:60-64`);
  `toTodoResponse` (`util.ts:17-27`) always carries `id`. `createTodo` and
  `updateTodo` return `response.data` untouched, so `saved.id` in
  `handleValidSubmit` (`TodoFormModal.tsx:124-126`) is the server's own id for
  the row just written, in both branches.
- **The edit-undo payload round-trips exactly.** `toFormValues`
  (`TodoFormModal.tsx:35-44`) reduces `dueAt` through
  `toDueDateInputValue(iso) = iso.slice(0, 10)`, and the server re-parses with
  `dayjs.utc(value, "YYYY-MM-DD", true)` (`src/lib/todo.ts:93-106`). Every
  `dueAt` in the database was written through that same parser, so an undo
  cannot shift a date by a timezone. `note` round-trips through
  `note === "" ? null : note`. `completed` is not a member of `TodoFormValues`
  and both write routes reject a body that so much as mentions it
  (`util.ts:54-56`, `[id]/route.ts:39`), so an edit-undo cannot flip a
  checkbox — which is correct, since an edit cannot either.
- **Failure is reported, not swallowed.** Both branches `await` before their
  success toast, and the `catch` surfaces `getErrorMessage`. A todo deleted by
  other means first gives `notFoundResponse()` → `404` → axios rejects →
  `Couldn’t undo that. Try again.` Honest.

`previousValues` is also captured from the right object.
`TodoFormModal.tsx:121` reads the `todo` prop before the `await`, and `todo` is
`editingTodo`, set by `openEdit` from the row as last fetched. I checked the
remount question, because the modal is keyed on `editingTodo?.id ?? "create"`
and that key does not change when the same row is edited twice: it does not
matter, because `Modal.Backdrop` is a react-aria `ModalOverlay`, which returns
`null` when closed (`react-aria-components/dist/private/Modal.mjs:96`). `TodoForm`
therefore remounts on every open and picks up fresh `defaultValues`, and
`editingTodo` is replaced by `openEdit` on each click. The *capture* is right.

What is wrong is the *window* it stays live in — M-1 and M-2.

## Blocker

None.

## Major

**M-1 — `TodoFormModal.tsx:134-140` and `TodoListScreen.tsx:195-201`: the Undo
toast is never dismissed when pressed, and neither undo handler guards
re-entry.**
`ToastActionButton`
(`node_modules/@heroui/react/dist/components/toast/toast.js:256-270`) spreads
`actionProps` onto a plain `Button` and does not close the toast; the default
timeout is 4000 ms (`toast/constants.js:13`). So Undo stays live and pressable
for four seconds *after it has already run*. Two consequences, both real:

- **Create-undo pressed twice tells the user it failed when it succeeded.**
  `DELETE` #1 returns `204`; `DELETE` #2 hits `result.count === 0` and returns
  `notFoundResponse()` (`[id]/route.ts:78`), which `undoSave`'s catch turns into
  `toast.danger("Couldn’t undo that. Try again.")` — landing directly under the
  green `Todo removed`. The user is invited to retry an action that already
  worked. This is the inverse of the "silently does nothing while claiming
  success" case, and just as misleading.
- **Toggle-undo pressed twice re-opens m-4.** `pendingTodoIds` is a `Set` of
  ids, not a count (`TodoListScreen.tsx:92-104`). Both presses call
  `markPending(todo.id)` and produce one entry; the first request's
  `finally { clearPending(todo.id) }` (`:180`) then removes it while the second
  PATCH is still in flight, re-enabling the row mid-request. The `Set` fixes two
  *different* rows racing, which is what m-4 described; it cannot represent two
  operations on the *same* row, and the toast is now a second way to start one.

Fix: `toast.success` returns the queue key and `toast.close(key)` exists
(`toast-queue.js:65-67,164`) — capture the key and close it as the first
statement of every Undo `onPress`. That closes both symptoms with one change.
If you also want the row state to be honest under concurrency, make pending a
`Map<string, number>` refcount rather than a `Set`.

**M-2 — `TodoFormModal.tsx:93-107, 121, 136-139`: edit-undo is a blind
overwrite, and a later edit is destroyed while the toast reports success.**
Each success toast closes over the values as of *its own* save, and lives for
four seconds. Edit X from V0 to V1 (toast A holds V0); within four seconds edit
X again from V1 to V2 (toast B holds V1); press toast A's Undo → `PATCH` writes
V0. V2 is gone with no warning and the toast says `Todo “V0” restored`. The
same shape reaches further: create A, edit A, then press the *create* toast's
Undo — the edited todo is deleted.
Nothing on the wire can catch this. `toTodoResponse` (`util.ts:17-27`) does not
expose `updatedAt`, so there is no version token for the PATCH to compare, and
the route's `updateMany` is unconditional last-writer-wins by design.
Why it matters: this is the one place on the branch where the user loses typed
work and is told the opposite. It is also the case the new rule leans on —
"Undo actually puts things back" is the argument in `CONVENTIONS.md`.
Fix: dismiss any outstanding Undo toast for a todo id when a new write targets
that id. A `Map<todoId, toastKey>` held in `TodoListScreen` (which already owns
the ids, and already owns `undoToggle`) is the natural home; lifting undo
ownership out of the modal also removes the oddity of a closed modal running
mutations. M-1's fix does not cover this on its own — that one only stops the
*same* toast firing twice.

**M-3 — `TodoFormModal.tsx:97,100`: the Undo copy is improvised inline, against
the convention this branch rewrote.**
`docs/CONVENTIONS.md` → Mutation UX (unchanged by this branch on that point):
"Exact strings come from the copy deck in `docs/DESIGN.md`. If a string is
missing there, add it to that file rather than improvising inline."
`docs/DESIGN.md` §7.13 covers the *toggle* Undo only (`Undo`, `Couldn’t undo
that. Try again.`); neither `Todo “…” restored` nor `Todo removed` appears
anywhere in the deck, and the +206 lines this branch adds to `DESIGN.md` do not
add them.
`Todo removed` additionally names no record, against the same section's "names
the specific record … not a generic 'Success'" — `undoSave` is not given the
title on the create path.
Fix: add both strings to the deck, and pass the created todo's title into
`undoSave` so the create-undo toast can name it.

**M-4 — five comments now describe a flow that no longer exists.**
`docs/WORKFLOW.md` makes this the primary lens: "a comment restating it goes
stale and starts lying." All five are load-bearing orientation for a reader.

- `TodoFormModal.tsx:30-33` — "once the user confirms, on the confirm dialog's
  own action". There is no confirm dialog in this file.
- `TodoFormModal.tsx:54-58` — the component's own doc comment: "Submitting only
  opens the confirm dialog; the mutation runs after the user confirms." That is
  now the exact opposite of what the component does, and it is the first thing
  anyone reads.
- `form/TodoForm.tsx:38-41` — "hands validated values to the parent, which runs
  the confirm-then-mutate flow".
- `TodoListScreen.tsx:184` — "The one mutation with no confirm dialog". Three
  now have none.
- `TodoRow.tsx:109` — "until the confirmed mutation lands" now reads as a
  reference to the dialog that was removed.

Fix: rewrite all five against the current rule. `TodoForm.tsx` and
`TodoFormModal.tsx:54-58` are the two that actively mislead.

## Minor

**m-1 — `TodoListScreen.tsx:107-115`: `removeTodoLocally` can double-decrement
transiently.**
The *choice* of counts is right, and worth stating because it is not obvious:
`GET /api/todos` computes `totalCount` and `completedCount` over the whole user
(`api/todos/route.ts:65-66`), unfiltered, while `todos` is the filtered list. So
`-1` on a delete is correct whatever filter is active, and `wasCompleted` gates
the second decrement correctly. No permanent drift.
The updater is unconditional, though. If a filter change refetches between the
`DELETE` leaving and its response arriving, the fresh `result` already excludes
the row and its counts already reflect the delete — and then the updater
decrements again. `reloadSilently()` on the next line corrects it one round trip
later, so it is a flicker, not a corruption.
If the following refetch *fails*: `loadError` is set, `hasTodos` (`:375`) goes
false, and the counts are hidden entirely rather than shown wrong. That path is
fine as it stands.
Fix: `const wasPresent = current.todos.some((todo) => todo.id === todoId);` and
return `current` unchanged when it is not.

**m-2 — `TodoListScreen.tsx:375`: `hasTodos` is a variable declared after the
`useEffect`.**
`docs/CONVENTIONS.md` → Component body order is state → variables → functions →
`useEffect` last, and the worked example in that section uses
`const hasTodos = …` as its illustration of group 2. Move it up beside
`filterKey`.

**m-3 — `TodoListScreen.tsx:80,373`: `filterKey` duplicates the effect's
dependency list.**
`` `${status}|${priority}|${query}` `` and `[status, priority, query,
reloadToken]` are two independent statements of "the filters changed". A fifth
filter means remembering both, and forgetting the string is silent — no
skeleton, stale rows — where forgetting the dep array is at least lint-visible.
The adjust-during-render pattern itself is correct and the comment justifying it
(`:82-86`) is exactly the kind of note the workflow asks for; this is only about
the two sources of truth. Fix: build the filter values once and derive both the
key and the deps from it.

**m-4 — `TodoRow.tsx:97-103`: `pointer-events-none` is still on the row while the
new comment explains why it was insufficient.**
DEF-12's fix added `isDisabled` and `aria-busy` but did not remove the class,
and the comment reads as though it had. The next reader will either delete the
class believing the comment or trust the class and skip `isDisabled` on a new
control. It also suppresses the row's hover affordance and the disabled buttons'
tooltips while pending. Fix: drop the class now that every control is
`isDisabled`, or say in the comment that it is kept deliberately as a backstop.

**m-5 — `TodoFormModal.tsx:103`: `onSaved()` runs only when the undo
succeeds.**
If the write commits but the response is lost, the list is never refreshed and
keeps rendering state the server no longer has, while the toast says the undo
failed. Fix: move `onSaved()` into a `finally`.

**m-6 — `TodoFormModal.tsx:114-115` and `SignUpForm.tsx:56`: the double-submit
guard reads state, not a ref.**
`if (isPending) return` reads the render closure, so two submits dispatched
before React re-renders both see `false`. I could not force a double write on
create or edit, and the reason is worth recording: every field in `TodoForm`
carries `isDisabled={isDisabled}` (`TodoForm.tsx:89,106,122,138`) and the submit
button is `isDisabled={isPending}` (`TodoFormModal.tsx:206`), so once the first
render lands there is nothing left to press Enter in. **Double-submit is still
prevented on create and edit** — the confirm dialog was not what was holding it.
Sign-up is guarded by the `if` alone: `SignUpForm.tsx:111-177` leaves all three
fields enabled while the request is in flight, so Enter in the password field
re-enters `onSubmit`. In practice a network round trip has elapsed and the
re-render has landed, so it holds — but it holds by timing, not by construction,
and a duplicate here means a second `USER_ALREADY_EXISTS` toast and a cleared
password after a successful navigation.
Fix: a `useRef` latch set before the first `await` in both, and
`isDisabled={isPending}` on the sign-up fields to match `TodoForm`.

**m-7 — `TodoFormModal.tsx:167-222`: the JSX is mis-indented after the fragment
was removed.**
`Modal.Backdrop` sits two levels in from `Modal` and the closing tags do not
line up with their openers. Prettier is not wired into `npm run lint`, so
nothing caught it, and it makes a 55-line block harder to scan than it was
before the change. Reformat.

## Nit

**n-1 — `TodoListScreen.tsx:133-141`: `reloadSilently` is `requestReload` with a
doc comment and no behaviour.** Two names for one action; a reader has to open
it to confirm the "silent" one really is a pass-through. Either fold the
rationale into the two call sites or keep only `requestReload` and
`reloadWithSkeleton`.

**n-2 — `TodoListScreen.tsx:74`: `lastFilterKey` starts `null`, so the first
render always takes the adjust-during-render branch and re-renders once for
nothing.** `useState(filterKey)` skips it; `isLoading` already defaults to
`true`, so mount behaviour is unchanged.

**n-3 — `TodoFormModal.tsx:93`: `undoSave(savedId, previous)` encodes "this was
a create" as `previous === null`, positionally.** A reader has to trace the call
site to learn what a `null` second argument means. Two functions — `undoCreate`
and `undoEdit` — would say it outright, and each would be four lines.

## Readability — `TodoListScreen.tsx` (WORKFLOW's primary lens)

Plainly: **yes, a new developer can still follow it, and it is at the limit.**
435 lines, nine `useState` calls and sixteen local arrow functions before the
`return`. Nothing in it is obscure — the names say what they hold, no function
needs section comments, nesting is shallow, and the comments explaining
*why* (the `Set`, the render-time flag, the DEF-11 local removal) are the
genuinely good part of this branch. The problem is volume, not clarity.

Two splits I would make, in this order:

1. **`useTodoList(filters)`** — lift `result`, `isLoading`, `loadError`,
   `reloadToken`, `lastFilterKey`, the render-time flag, `removeTodoLocally` and
   the fetching effect into one hook returning
   `{ result, isLoading, loadError, reloadWithSkeleton, reloadSilently,
   removeTodoLocally, retry }`. That is precisely the client state machine this
   branch created, and it is the part that takes real effort to hold in your
   head. Nothing outside it needs to know `reloadToken` exists.
2. **`resolveEmptyState` + `noMatchingFilters`** (`:240-286`, 47 lines) — a pure
   function of `(result, filters)` that touches no state and no handler. It
   belongs beside `TodoEmptyState`, not in the middle of the screen's handlers.

That leaves roughly 250 lines of "render the list, run the mutations", which is
comfortably followable. I am not blocking on it — but the next thing added to
this file should be the split, not another `useState`.

## Claims checked against the code

| Claim | Verdict |
|---|---|
| Skeleton split by mutation; create/edit and filter change show it, toggle/delete do not | True. `reloadWithSkeleton` on `onSaved` (`:416`) and `retry`; `reloadSilently` on toggle, undo-toggle and delete. |
| The filter case raises the flag during render, not in an effect | True (`:87-90`), and correctly so — an effect would render stale rows first and trips `react-hooks/set-state-in-effect`. See m-3 on the duplicated key. |
| `pendingTodoId` became a `Set` so two quick toggles no longer clear each other | True for two *different* rows. Not true for two operations on the *same* row — a `Set` cannot count, and the undismissed Undo toast makes that reachable. See M-1. |
| DEF-11 — the deleted row is removed from local state on success | True (`:228`), and the counts it adjusts are the right ones. One transient double-decrement, m-1. |
| DEF-12 — controls are `isDisabled`, row carries `aria-busy` | True — `aria-busy` at `TodoRow.tsx:101`, and checkbox, edit and delete all disabled at `:107`, `:169`, `:182`. `pointer-events-none` was kept, not replaced — m-4. |
| Mutation UX: delete confirms; create, edit, toggle, sign-in, sign-up do not | True. `ConfirmDialog` survives only on delete (`TodoListScreen.tsx:419-431`, `isDestructive`), and is gone from `SignUpForm` and `TodoFormModal`. Matches the rewritten table in `CONVENTIONS.md`. |
| Undo runs the same endpoints with the same authorization, never a shortcut | True. Verified against every write route — §1. |
| Create-undo deletes by the id the server returned | True, and failure is surfaced. §1. |
| Edit-undo writes back the values held when the form opened | True at the moment of capture. Not true four seconds later — M-2. |
| Double-submit still prevented now the dialog is gone | True on create and edit (fields and button disabled). Guard-only on sign-up — m-6. |
| Conventions: arrow functions, import grouping, naming | Clean throughout the diff. Body order — m-2. |

## Verdict

**Request changes.**

Merge-blocking: **M-1** (Undo stays armed after use — a false failure message on
create-undo, and it reopens the m-4 same-row race the `Set` was meant to close)
and **M-2** (edit-undo destroys a later edit and reports success). Both are
symptoms of the same missing piece: an Undo affordance that outlives the state
it was built for. Closing the toast on press and on any subsequent write to the
same id fixes both, and is a small change.

**M-3** and **M-4** are cheap and should ride along in the same push — M-4
especially, since two of those comments now tell a new reader the opposite of
what the code does, and this branch is the one that made them false.

The rest can follow as separate commits.

The parts I went looking hardest at came back clean: authorization on both undo
paths is exactly the original write's, the ids are the server's own, the edit
payload round-trips without losing a date or a note, and no path leaves a row
permanently disabled — every `markPending` has a matching `clearPending` in a
`finally`, the delete flag clears in one too, and the fetch effect's `isCurrent`
guard (`:348-373`) correctly drops a response that lost its race. The DEF-11
local removal is the right instinct and picked the right counts. The reasoning
comments on the `Set` and the render-time flag are the best documentation in the
file; the problem is the four older ones next to them that nobody updated.

---

# Re-review — `fix/add-refresh-gap` → `develop` (fix commit `dc45f6a`)

Reviewer: Senior engineer
Date: 2026-08-16
Range: `git show dc45f6a`, re-read against `git diff develop...fix/add-refresh-gap`
Gate: `npx tsc --noEmit` clean, `npm run lint` clean, re-run against `dc45f6a`.

I proposed the single-owner restructuring in M-2's fix note, so this pass
deliberately checks the shape I asked for rather than accepting it. Where it
holds I say why; where it does not, it is because I traced it, not because I
went looking for something to find.

## Do M-1 and M-2 close?

**M-2 — yes, for every ordering where the second write has landed.** Traced:

- Edit X (toast A, `previous` = V0) → edit X again (toast B, `previous` = V1).
  Edit 2's `handleSaved` (`TodoListScreen.tsx:217`) calls `showUndoableSuccess`
  → `dismissUndo(saved.id)` (`:127`) before arming B. Toast A is off screen and
  out of the map. Pressing it is not possible. The V2-destroying overwrite is
  gone.
- Create A → edit A → press the *create* toast's Undo. Same mechanism:
  `saved.id` on the edit is the created row's id, so the create toast is
  dismissed. Gone.
- Delete a row with an armed Undo — `handleDelete` dismisses first (`:305`).
- Toggle a row with an armed create/edit Undo — `handleToggle` dismisses first
  (`:277`).

That is the data-loss case, and it is genuinely closed. It was the one thing on
this branch that lost typed work while reporting success.

**M-1 — narrowed, not closed.** See r-1. The window shrinks from a flat 4000 ms
to a view-transition frame, but no guard was added and the same-row concurrency
hole M-1's second bullet described is untouched.

## Minor

**r-1 — `TodoListScreen.tsx:129-137`: dismissal is used as a re-entrancy guard,
but `undo()` runs unconditionally. M-1 residue.**

```
onPress: () => {
  dismissUndo(todoId);
  undo();
},
```

`dismissUndo` (`:113-120`) early-returns when the map has no key — but `undo()`
is outside that guard and fires either way. So the second press still runs the
undo a second time; the only thing stopping it is whether React has unmounted
the button yet.

It usually has, and the timing is worth recording because it is why this is
Minor and not the Major it was. `toast.close` splices the queue array
synchronously, but the subscriber notification that re-renders React is deferred
(`@heroui/react/dist/components/toast/toast-queue.js:29-51`): every update is
appended to a promise chain and run inside `document.startViewTransition`. So:

- No View Transitions API (Firefox, older Safari) — `fn()` runs inline, React
  flushes at the end of the press handler, the button is gone before a second
  press is possible. Unreachable.
- Chrome/Edge, idle chain — the callback runs on the next frame, so the button
  stays live roughly one frame (~16 ms). Not reachable by a human double-click.
- Chrome/Edge, chain busy — `runNext` waits on the previous transition's
  `finished`, not its start. Press Undo while the toast's own *add* transition
  is still animating and the close re-render is deferred by the remainder of it
  (~250 ms default). That is inside double-click range.

The consequences are the ones I described first time and they have not changed:
a second `DELETE` returns `404` → `Couldn’t undo that. Try again.` under the
green `Todo “…” removed`; and both presses call `markPending` on a `Set` that
holds ids, not counts, so the first `finally { clearPending }` (`:253`, `:272`)
re-enables the row while the second request is in flight. Neither `undoSave`
nor `undoToggle` has any re-entrancy guard — `TodoFormModal.handleValidSubmit`
has `if (isPending) return` (`TodoFormModal.tsx:97`), the undo paths have
nothing.

I asked for the `Map<string, number>` refcount as the second half of M-1's fix
and it was not done. That is a defensible call — but it is now the only thing
holding the same-row case, and nothing in the code says so.

Fix, one line, and it is the correct use of a ref (synchronous, unbatched, so
check-and-clear is atomic against a second press in the same frame):

```
onPress: () => {
  if (!undoToastKeys.current.has(todoId)) return;
  dismissUndo(todoId);
  undo();
},
```

**r-2 — the "every write dismisses first" invariant is not true of the save
path, and today it holds only by the modal's z-order.**
`TodoListScreen.tsx:105-107` states it outright — "every write dismisses the
outstanding Undo for its row before starting" — and `docs/DESIGN.md` §7.15 makes
it absolute: "A later write to the same todo dismisses the earlier toast, so an
Undo can never restore a record past a change the user made after it."

Toggle and delete do dismiss before starting (`:277`, `:305`). **Save does not.**
`TodoFormModal.handleValidSubmit` has no `dismissUndo` and no way to reach one;
the dismissal happens in `handleSaved`, which runs only *after* the write
resolves (`TodoFormModal.tsx:106-111`). So for the whole duration of a second
edit's round trip, the first edit's Undo is still armed and still points at V0.
Press it there and V0 races V2 with no version token to arbitrate — the exact
M-2 shape, in a window as wide as the network.

I could not make it fire, and the reason is not in this codebase: while the
modal is open its backdrop is `fixed inset-0 z-50`
(`@heroui/styles/dist/components/modal.css:44-45`) and portals into `body` after
`<Toast.Provider />` (`src/app/layout.tsx`), which is also `z-50`
(`components/toast.css:4-5`). Equal z-index, later in DOM order — the backdrop
paints over the toast, and react-aria traps focus in the dialog so the keyboard
cannot reach the button either.

So the guarantee is real today and rests entirely on a third-party overlay's
stacking. A `placement="top"` toast region, a z-index bump, a non-modal
quick-add (backlog #1) or a HeroUI upgrade all silently reopen it. Fix: pass
`onSaveStart` (or hoist the submit) so the dismissal happens before the write,
the way toggle and delete already do — then the comment and §7.15 are true by
construction. Failing that, soften §7.15, because a doc that overstates a
guarantee is how this becomes a Major again.

**r-3 — `TodoListScreen.tsx:111`: the new `useRef` sits in the middle of the
body, against `docs/CONVENTIONS.md` → Component body order.**
That section is explicit that `useRef` is group 1 and that all of it goes
"together, at the very top". `undoToastKeys` is declared at `:111`, below
`filterKey` (group 2) and the render-time adjust block, interleaved with the
handlers. This is a *new* violation introduced by the fix commit, of the same
rule m-2 is already open against. Move it up with the `useState` calls; the
doc comment can travel with it.

**r-4 — `TodoFormModal.tsx:105-111`: `onSaved` is called inside the `try` that
catches write failures.**
If anything in `handleSaved` → `showUndoableSuccess` → `toast.*` throws, the
modal's `catch` treats it as a failed write: `readFieldErrors` returns null and
it raises `Couldn’t save your changes. Try again.` for a write the server
committed, with no toast and no reload. I traced the toast path and it does not
throw today (`queue.add`/`close` are array ops; `defaultWrapUpdate` guards
`typeof document`), so this is structural, not live. But the modal's `catch` now
covers the list's code as well as its own, which is precisely what moving the
toast out was meant to stop. Move `onSaved` after the `try/catch`, or into the
`finally` alongside the m-5 fix.

**r-5 — `undoSave` reloads silently (`:249`) where `handleSaved` reloads with a
skeleton (`:218`), for the same class of write.**
`reloadWithSkeleton`'s own comment (`:171-177`) gives the rule: a create or an
edit "can move the row, or drop it out of the current filter entirely", so it
gets the skeleton. An edit-undo is an edit — it writes the same fields through
the same endpoint and can move the row exactly as far. A create-undo is a
delete and `reloadSilently` is right for it. So the create branch is correct
and the edit branch contradicts the rule stated eighty lines above it. Pick one
per branch rather than one per function.

**r-6 — M-4 is four of five. `TodoRow.tsx:109` still reads "Stays in its current
state until the confirmed mutation lands."**
The commit message says five comments were removed. Four were:
`TodoFormModal.tsx:30-33` and `:54-58` are rewritten and now accurate,
`form/TodoForm.tsx:38-41` now says "performs the write and reports it", and
`TodoListScreen.tsx:184` is gone. The `TodoRow` one — the checkbox comment,
which is the one sitting on the control the toggle Undo is about — was missed.
`grep -rn confirm src/app/todos src/app/sign-up` finds it in four lines flat.

**m-5 (carried, unfixed, and now in four places) — the reload sits inside the
`try`.**
Originally `TodoFormModal.tsx:103`; the code moved, the shape did not.
`undoSave:249`, `undoToggle:268`, `handleToggle:289` and `handleDelete:318` all
call `reloadSilently()` as the last statement of a `try`. If the write commits
but the response is lost, the list never refetches and keeps rendering state the
server no longer has, while the toast says it failed. `finally` is the right
home for all four.

## Nit

**r-7 — map entries are never removed when a toast expires naturally
(`TodoListScreen.tsx:111`).** `dismissUndo` is the only thing that deletes, so
every toast that simply times out leaves a dead key behind. I checked the two
things that would make this matter and both come back clean: keys are
`'_' + Math.random().toString(36).slice(2)`
(`react-stately/dist/private/toast/useToastState.mjs:60`) — random, never
recycled, so a stale key can never close somebody else's toast; and `close()` on
a missing key finds `index === -1` and skips the splice. The cost is one short
string per todo id ever written to, for the life of the mount, plus one wasted
view transition when a stale key is closed. For a list of this size that is
nothing. Worth a line in the comment so the next reader does not have to
re-derive it. If you want it tidy, `toast`'s options take an `onClose` callback
— `onClose: () => undoToastKeys.current.delete(todoId)` closes it exactly.

Nothing reads the map during render, which is the thing that would have made
`useRef` wrong here. It is read only in press handlers and `dismissUndo`. The
ref is the right choice.

**r-8 — `undoSave` passes `saved.completed` (`:246`), a snapshot from the write;
`handleDelete` passes `pendingDelete.completed` (`:317`), the live row.**
Both are correct today: a created todo is `completed: false`, and toggling it
would have dismissed the create-Undo. So the count is right — but only because
of r-1's dismissal, and the two call sites reach for different freshness of the
same field. Worth a word.

**r-9 — `docs/DESIGN.md` §7.15 is filed before §7.14.** Appended rather than
inserted.

**r-10 — `TodoFormValues` now types the undo payload across a component
boundary (`TodoListScreen.tsx:27`).** It is `import type` off the `./form`
barrel, so nothing is pulled in at runtime, and it is the right shape in
practice — it is what `updateTodo` takes. The cost is that "the previous state
of a record" is now defined by the form's field set: drop a field from
`TodoFormValues` and `undoSave` silently stops restoring it, with no type error
anywhere. Acceptable; note it.

**r-11 — two new signatures exceed 80 columns** (`TodoListScreen.tsx:217, 236`),
so `npx prettier --check` fails on the file. m-7's mis-indentation in
`TodoFormModal.tsx:137-191` is also untouched. Prettier still is not wired into
`npm run lint`, which is why neither was caught.

## Status of the earlier Minors and Nits

| | Status |
|---|---|
| m-1 — `removeTodoLocally` double-decrements transiently | **Open**, untouched (`:157-165`). |
| m-2 — `hasTodos` declared after the `useEffect` | **Open** (`:464`), and r-3 adds a second violation of the same rule. |
| m-3 — `filterKey` duplicates the effect's dep list | **Open** (`:86`, `:462`). |
| m-4 — `pointer-events-none` vs the comment | **Fixed.** `TodoRow.tsx:95-99` now says the class "only stops a mouse" and that the controls are disabled outright — the backstop reading I offered. The class staying is now deliberate and documented. The tooltip/hover suppression I noted stands as a nit only. |
| m-5 — reload runs only on success | **Open**, in four places now. Promoted to Minor above. |
| m-6 — double-submit guard reads state, not a ref | **Open.** `SignUpForm.tsx:56` is still `if (isPending) return` and the three fields are still enabled while the request is in flight (only the button at `:179` is disabled). Unchanged by this commit. |
| m-7 — `TodoFormModal` JSX mis-indented | **Open** (`:137-191`). Folded into r-11. |
| n-1 — `reloadSilently` is `requestReload` with a doc comment | **Withdrawn.** There are now five call sites split across the two policies and r-5 turns on exactly that distinction. The named pair earns its keep; I was wrong to want it folded away. |
| n-2 — `lastFilterKey` starts `null` | **Open** (`:80`). |
| n-3 — `undoSave` encodes "this was a create" positionally | **Open** (`:236`), though `handleSaved` naming `isEdit` (`:220`) makes the call site readable now. Downgrade in urgency, not withdrawn. |

## What the restructuring got right

Saying this because I proposed it and should be equally concrete about the parts
that came back clean:

- The ownership move is correct and the comment at `:98-110` explains *why* in
  the register `docs/WORKFLOW.md` asks for. `TodoFormModal` no longer runs a
  mutation after it has closed, which was the oddity underneath M-2.
- `showUndoableSuccess` dismissing before it arms means the map holds at most
  one live key per row by construction, not by discipline at the call sites.
  That is the property that closes M-2, and it is enforced in one place.
- `useRef` is right: no render reads it, and check-and-clear on a ref is exactly
  what r-1 needs to be atomic. A `useState` map here would have been the bug.
- Ordering in `handleValidSubmit` is sound. `closeForm()` and `onSaved()` are
  both after the `await` and both synchronous; the toast is an imperative global
  queue, not React state, so batching cannot drop it and the modal closing
  cannot race it. No path reaches `onSaved` without a resolved `saved`.
- Failure paths stayed where they belong: field errors keep the form open in the
  modal, generic write failures toast from the modal while it is still on
  screen, undo failures toast from the list. Nothing reports from a component
  that is gone.
- Every `markPending` still has a matching `clearPending` in a `finally`
  (`:253`, `:272`), including both undo paths. No row can be left permanently
  disabled.
- M-3 is closed properly — §7.15 carries all six strings and `Todo “{title}”
  removed` now names its record.
- No stale closure: `saved` and `previous` are arguments captured at
  toast-creation time, which is what an undo needs, and `removeTodoLocally` /
  `markPending` / `clearPending` all use functional `setState`, so a handler
  captured from an older render still computes off current state.
- No race between `reloadWithSkeleton` and the toast. Both reloads bump the same
  `reloadToken`, and the effect's `isCurrent` guard (`:459-461`) drops the
  loser. I looked for a case where the Undo lands mid-skeleton and the row gets
  no pending affordance; `pendingTodoIds` survives the reload, so the row shows
  pending as soon as it renders.

## Verdict

**Approve with comments.**

M-2 is closed — the data-loss case, where the user lost typed work and was told
the opposite, does not reproduce in any ordering I could reach. M-3 is closed.
M-4 is four of five. Nothing here is merge-blocking.

The one I would want in before this merges is **r-1**, because it is a single
line, because the design premise of the whole restructuring is that dismissal
guards re-entry and right now it does not, and because I cannot rule out the
~250 ms window when the close transition queues behind the toast's own entry
animation. **r-6** is a four-line grep and finishes M-4. **r-3** should not
survive its own commit.

**r-2** is the one to think about rather than patch reflexively. The invariant
is true today and false by construction — it holds because a third-party modal
backdrop happens to occlude the toast region at equal z-index. Either make the
save path dismiss before it writes, like toggle and delete already do, or stop
claiming the absolute in `DESIGN.md` §7.15. I would do the former; it is the
same two lines that would have made this uniform in the first place.

Everything else can follow. The accumulating count is what I would actually
watch: m-1, m-2, m-3, m-5, m-6, m-7, n-2 and n-3 are all still open, all in the
same two files, and this pass added five more. The `useTodoList` split I
described last time is now overdue — `TodoListScreen.tsx` is 523 lines and the
undo ownership is the third state machine living in it.

---

# Test review — `test/isolation-suite` and `test/e2e-harness` → `develop`

**2026-08-16.** Reviewed by the engineer who argued the missing test suite was
this project's largest risk. That makes me the wrong person to judge whether
these were worth writing and the right person to judge whether they work, so
this review does only the second thing. The standard is the one I set: **a suite
that cannot fail is worse than none**, because it converts an unknown into a
false assurance and spends review attention doing it.

## Verdicts, up front

| Branch | Verdict |
|---|---|
| `test/isolation-suite` | **Request changes** — B-1 |
| `test/e2e-harness` | **Request changes** — B-2, B-3 |

Neither verdict is about the value of the work. Both suites are better than
anything this repo has had, both are written by people who understood the
difference between an assertion and a decoration, and both authors ran their
own sabotage checks and reported real findings. Both also contain a defect of
exactly the kind their own sabotage checks were designed to find.

## How I reviewed

I did not re-run the authors' mutations. I picked my own, applied them to the
source, ran the suites, recorded which tests fired, and reverted. Both working
trees are clean and the local `todo_app_test` database holds no rows this review
created. I then re-ran the two mutations each author reported, to check the
findings are real and the fixes hold.

**Vitest (`test/isolation-suite`, worktree `todo-app-tests`, local Postgres).**
Baseline 126/126 in 1.9 s; the 20 isolation cases genuinely round-trip a real
Postgres through the real Prisma client and the real better-auth session lookup.

| # | Mutation | Tests that fired |
|---|---|---|
| M1 | Drop the session guard from `DELETE /api/todos/[id]` | 1 |
| M2 | `/status` writes and re-reads unscoped — returns A's row instead of a 404 | 3 |
| M3 | Remove the backslash guard from `sanitiseNextPath` | 2 |
| M4 | Remove `.strict()` from the status schema | **0** |
| M5 | `totalCount` counts every user's rows | 1 |
| M6 | `mentionsCompleted` always returns `false` | **0** |
| M7 | `findOwnedTodo` drops its `userId` scope | **0** |
| M8 | 400 naming the other account (an existence oracle) | 3 |
| M9 | *(author's own)* `/status` write unscoped, re-read still scoped | 1 |
| M10 | `getSession` memoises globally | 7 |
| M11 | The list/search `where` loses its user scope | 4 |

**Playwright (`test/e2e-harness`, main checkout).** I ran it against **local**
Postgres via a `DATABASE_URL` override, not against Neon — see B-3. All 16 pass
in 37 s.

| # | Mutation | Caught? |
|---|---|---|
| E1 | A failed toggle *also* raises its success toast | **No** |
| E2 | `handleDelete` removes the row before the server confirms | Yes |
| E3 | *(author's own)* Undo re-entrancy guard removed | Yes |
| E4 | *(author's own)* `showUndoableSuccess` no longer dismisses the prior Undo | Yes |

---

## Blocker

### B-1 — `ci.yml` never reaches the test step. The suite cannot fail in CI. (`test/isolation-suite`)

The workflow orders the steps `db push → lint → build → typecheck → test`. The
**build step fails**, so `npm run test:run` is never executed. I verified this
by hiding `.env` and running `npm run build` with exactly the environment the
workflow provides:

```
Error: Failed to collect page data for /
  [cause]: Error: BETTER_AUTH_URL must be set in production —
           auth would otherwise derive its origin from the request Host header.
      at src/lib/auth.ts:33:11
```

`next build` runs with `NODE_ENV=production`, `src/lib/auth.ts` throws at module
evaluation when `BETTER_AUTH_URL` is unset, and `.env` is gitignored
(`.gitignore:34`), so CI has none. `BETTER_AUTH_SECRET` is likewise unset.

This is the precise failure mode I said I was worried about, arriving in the one
artifact whose entire job is to make the suite unskippable. The author's note
that they could not verify a real run is exactly right, and the run would have
been red. Fix is two lines in the `env:` block —
`BETTER_AUTH_URL: http://127.0.0.1:3000` and a throwaway `BETTER_AUTH_SECRET`
(the same shape `vitest.config.ts` already uses). **I want a green run link on
the PR before this merges**; a first CI that has never executed is a claim, not
a control.

### B-2 — The "no false success" assertions in `fault-injection.spec.ts` cannot fail. (`test/e2e-harness`)

The spec's header states its own two-part contract: copy-deck wording, and *"no
false success — a failed write must not report as done"*. The second half is
unenforceable as written.

Every false-success guard has the shape
`await expect(todos.toasts.filter({ hasText: <successToast> })).toHaveCount(0)`.
`toHaveCount` **retries** for the 15 s expect timeout, and HeroUI toasts
self-expire after 4 s (`DEFAULT_TOAST_TIMEOUT`, `@heroui/react/dist/components/toast/constants.js:13`).
A success toast that *was* raised disappears on its own well inside the window,
and the assertion then passes.

Demonstrated (E1): I made `handleToggle`'s catch block raise
`toast.success(toggledMessage(...))` alongside the failure toast — the app now
tells the user a failed toggle succeeded — and *"500 on toggle leaves the
checkbox unchecked"* **passed**. Its runtime went from 2.3 s to 6.5 s: it sat
there watching the false success expire, then reported green. That is the same
defect the author found in `undo-semantics.spec.ts` and correctly fixed there
by switching to a point-in-time `count()`; the fix was not carried across to
this file.

Affected: `fault-injection.spec.ts` lines 75, 117–118, 144–145, 172, 205,
231–232, and `undo-semantics.spec.ts:159–161` (`toHaveCount(1)` has the same
hole — two toasts retried down to one is a pass). The row-based assertions in
the same tests are sound, because rows do not expire (E2 caught the unconditional
optimistic delete). The fix is mechanical: read the count once, immediately after
the error toast becomes visible, in the same style already used at
`undo-semantics.spec.ts:196` and `:241`.

Until this is fixed, the fault-injection spec proves that a failure is *reported*,
not that a success is *not*. Half its stated contract is decoration.

### B-3 — The E2E suite's default target is the production database, and nothing stops it. (`test/e2e-harness`)

Asked plainly whether I would run it: **not against Neon, and I did not.** I ran
it against local Postgres with a `DATABASE_URL` override and all 16 specs passed
in 37 s — which is the finding. **Production is not required, it is merely the
default.** That makes this a one-line fix, not an architectural argument.

The delete-side guard in `e2e/support/database.ts` is genuinely good work, and I
want to be clear about that: full-string equality in a parameterised query, no
`LIKE`, no interpolation, an id resolved first, both predicates on the final
`DELETE`, and `.invalid` as an RFC 2606 outer bound. I tested the pattern
offline — `e2e-x-1@e2e.invalid.evil.com`, `E2E.INVALID`, `e2e--1@…` and a real
address are all refused. A crash mid-teardown is safe: the deletes are wrapped
in `BEGIN`/`COMMIT` with `ROLLBACK`. A `RUN_ID` collision needs two runs in the
same millisecond *and* the same 4 random base36 characters; the consequence
would be a flaky cross-delete, not data loss. All of that is fine.

The problem is upstream of the guard. **The guard bounds what the suite deletes.
Nothing bounds what it connects to.** The suite signs up real accounts, writes
real todos and issues real sessions into the database holding production data,
and it does so on `npm run test:e2e` with no argument and no prompt. Compare the
sibling branch, which refuses to start against a hosted host or a database whose
name does not end in `_test` — and which I verified refuses both. The E2E side
has no equivalent, so:

- **Interrupted runs leak accounts into production.** Fixture teardown does not
  run on SIGINT or a worker crash, and there is no sweep job for stale
  `@e2e.invalid` rows. My local run tore down cleanly, including for the tests I
  made fail — but Ctrl-C during a debugging session does not.
- **`reuseExistingServer: !process.env.CI`** will adopt whatever dev server is
  already on 3117. The app's `DATABASE_URL` then comes from that process while
  teardown's comes from `.env` — a mismatch deletes from one database rows that
  were created in another.
- **"Running it against production by accident" is not a failure mode here.** It
  is the documented behaviour. The file's own header says so.

Asked for: port `resolveTestDatabaseUrl`'s host/name check into
`loadDatabaseUrl`, or add a `E2E_ALLOW_HOSTED=1` opt-in that the npm script does
not set. Either makes the accidental case impossible and costs a developer
nothing, because the suite already works locally.

---

## Major

### MA-1 — Both authors' central claims are true; one is overstated. (`test/isolation-suite`)

I reproduced M9 exactly as reported. Breaking the `where` on `/status` returns a
clean `404 NOT_FOUND` **while toggling the other user's row**, and the failure is
on line 143 — the database re-read — with the status and error-code assertions
both passing. That is a real finding and the fix holds. This is the most valuable
thing on either branch and it should be said plainly.

The claim that *"every negative case re-reads the row from the database"* is
**not accurate**, and M9 proves it: only one of the four tests exercising that
path failed. The three `foreign id is indistinguishable from a nonexistent one`
tests and `no refusal is ever a 500` compare statuses and bodies only, and all
four passed against a handler that was writing to another user's row. They are
paired with a re-reading test on the same endpoint, so the matrix as a whole is
sound — but the comment at the top of `isolation.test.ts` promises a property the
file does not have, and the next person to add an endpoint will trust it. Either
add the re-read or reword the comment.

The search claim is "5 tests fired"; M11 fires **4**. The fifth,
*"a term inside A's note matches nothing"*, passes because the handler never
searches notes at all — it is a forward-looking test for the pending change and
currently proves nothing about scope. Worth keeping, worth labelling.

### MA-2 — The 400 contract is untested, and it is the newest code on the branch. (`test/isolation-suite`)

Both authors flagged this; my mutations confirm it is a hole with no floor under
it. **M4** (drop `.strict()` from the status schema) and **M6**
(`mentionsCompleted` always false) each fired **zero tests out of 126**. Those
two guards are the entire implementation of review m-5 / QA DEF-06 — the defect
where a mixed body looked like a successful save — and nothing on this branch
would notice their removal.

Four tests close it: `completed` in a `POST` body → 400 with
`completionNotHereResponse`'s wording; the same on `PATCH /api/todos/[id]`;
`{ completed: true, title: "x" }` on `/status` → 400 with
`STATUS_BODY_ONLY_MESSAGE`; `{ completed: "yes" }` → 400 with
`COMPLETED_TYPE_MESSAGE`. The two-message branch in
`hasUnrecognisedKey` is a discrimination the code goes out of its way to make and
no test asserts either side of it.

### MA-3 — Toast expiry makes several E2E tests time-dependent under `retries: 0`. (`test/e2e-harness`)

Separate from B-2, and it cuts the other way: the 4 s window that lets false
positives through also makes true positives flaky. `happy-path.spec.ts` asserts
the "marked complete" toast, then calls `pressUndo()`; on a cold `next dev`
compile — which is exactly what CI is — the Undo can expire before the click
lands, and the failure surfaces as a 20 s action timeout on an unrelated line.
`undo-semantics.spec.ts:196` reads the armed-Undo count after two full
modal round-trips; if those take more than four seconds the correct answer
becomes 0, not 1.

The point-in-time reads are the *right* call for the contract, so I am not asking
for them to be softened. I am asking for the window to stop being implicit:
pass an explicit `timeout` to the undoable toasts in `TodoListScreen` (see
FIND-4), or have the suite assert against a value it controls. With `retries: 0`
and one worker, the first flake in CI will be read as a product failure.

### MA-4 — `getSession`'s `cache()` reasoning is correct, and I verified it. (`test/isolation-suite`)

The author's concern was right to raise. I simulated a leaking cache (M10 — a
module-level memo around `getSession`) and **7 tests failed**, including
*"the spoofed-to user's list is unaffected"*, which is the intra-test case: it
POSTs as B, switches to A, and re-reads the list. That test is doing the work the
author says it is. React's `cache()` is a no-op outside a render, which the green
baseline already demonstrates, but the suite would catch it if that ever changed.
No action; recorded because the reasoning was asked about and it holds.

---

## Minor

- **MI-1 (isolation).** The hosted-host list is a denylist of four vendors. I
  confirmed a hosted database at an unlisted host with a `_test` name passes the
  guard. The `_test` suffix is the real bound and it is a good one; the vendor
  list should be described as a convenience, not a control.
- **MI-2 (isolation).** The author's own note is right — `readAppDatabaseUrl`
  reads `.env` files but not `process.env`. I checked the consequence and it is
  smaller than feared: Vitest's `test.env` **overrides** an exported
  `DATABASE_URL` (verified — the suite still hit the local database with a bogus
  one exported), and the host/name checks apply to the value actually used. The
  gap only opens if the app's own database is un-hosted *and* named `*_test`.
  Worth a comment, not a change.
- **MI-3 (isolation).** QA §7's matrix has 8 probes; the suite covers 7 and adds
  five §7 never had (case-insensitive search, note-term search, forged cookie,
  spoofed `userId`, the search control). The missing one is
  `GET /api/todos/<A id>` → `405` (DEF-04). It is a superset minus one, not a
  convenient subset — the answer to my own question is that this is real
  coverage. Add the 405 so the matrix is closed.
- **MI-4 (isolation).** Also uncovered and load-bearing: `apiError`'s
  status/shape mapping, `toFieldErrors` dropping non-form paths (the guard added
  for review m-6), `proxy.ts` entirely — `sanitiseNextPath` is well tested but
  its only production caller is not — and `requireUser()`'s redirect. The GET
  filter combinations (`?status=`, `?priority=`) are exercised for scope but not
  for correctness.
- **MI-5 (isolation).** M7 fired nothing, and on inspection that is correct
  rather than a gap: after `updateMany({ where: { id, userId } })` reports
  `count > 0`, an unscoped re-read can only return the caller's own row. The
  `userId` in `findOwnedTodo` is defence in depth that no test can distinguish.
  Leave it; note it, so nobody "simplifies" it later on the grounds that removing
  it breaks nothing.
- **MI-6 (e2e).** `expectNoTransportLeak` passes vacuously on an empty locator —
  `"".not.toMatch(...)` is true. It is always preceded by a `toBeVisible()` that
  anchors it, so it works today, but one assertion of the form
  `expect(texts.length).toBeGreaterThan(0)` would make it self-checking.
- **MI-7 (e2e).** The suite captures no console messages, so DEF-02 goes
  unpinned even though the warning fires on every single page load — I watched
  it stream past in my own run. A `page.on("console")` collector and one
  `expect(warnings).toEqual([])` per spec would convert a known-open defect from
  prose into a gate. That is the cheapest coverage available on this branch.
- **MI-8 (both).** `chromium-desktop` only. QA §8's "real touch activation at
  mobile widths" stays unverified, which is fine to defer but should not be
  described as closed.
- **MI-9 (both).** Both branches edit `package.json` and `package-lock.json`;
  whichever merges second conflicts. Trivial, but note that `ci.yml` lives on the
  isolation branch and runs `npm run test:run` only — **merging the E2E branch
  does not put Playwright in CI.** Someone should say out loud whether that is
  intended.

## Nit

- **N-1 (e2e).** `happy-path.spec.ts:106`,
  `expect(account.email).toContain("@e2e.invalid")` — true by construction of
  `createAccountDetails`. It asserts the test's own fixture. Delete it.
- **N-2 (e2e).** The comment at `undo-semantics.spec.ts:57–60` says
  `route.fallback()` does not forward; `fault-injection.spec.ts` relies on
  `fallback()` forwarding when no lower handler matches. Both behaviours are
  right in context, but the comment reads as a general claim and will mislead.
- **N-3 (isolation).** `vitest.config.ts` and `tests/setup/testDatabaseUrl.ts`
  emit a Vite CJS/ESM warning on every run. Cosmetic, but it is the first thing
  anyone sees.
- **N-4 (isolation).** `isolation.test.ts` depends on a module-global header
  store and `fileParallelism: false`. Correct today; a single `test.concurrent`
  breaks it silently. One line of comment at the `asUser` helper.

---

## The app findings these suites surfaced — confirmed and ranked

All five confirmed. This is the payoff, and it is worth more than either suite's
green checkmark.

1. **The mid-session 401 dead-ends.** Confirmed. `grep` finds no
   `"You've been signed out"` anywhere in `src/`, so `DESIGN.md` §7.9's
   session-expired state is specified and implemented nowhere. The only client
   code that inspects a response status is
   `form/fieldErrors.ts:13`, and only for `400`. A 401 is rendered as an ordinary
   red toast; the app stays on `/todos` offering mutations that can only fail,
   and only a full navigation escapes — via `proxy.ts`, not via anything in the
   client. **Ranked first: it is the only one a user hits, and it strands them.**
   The spec that pins it is the right thing to have written.
2. **A 404 can mask a completed write.** Confirmed by M9. Latent today — both
   statements are correctly scoped — but the shape is the hazard: the write and
   the 404-deciding re-read are separate queries, so a one-line slip in either is
   invisible to any status-code test. Second, because it is the failure this
   project's review process is structurally worst at seeing.
3. **`Alert` carries no ARIA role.** Confirmed — no `role` anywhere in
   `@heroui/react/dist/components/alert/alert.js`; only `data-slot="alert-root"`.
   The list-load error is announced to nobody, and the same applies to
   `todos/error.tsx`. Third: a real accessibility defect, one prop to fix.
4. **The Undo window is HeroUI's undocumented 4 s default.** Confirmed:
   `DEFAULT_TOAST_TIMEOUT = 4000`, `showUndoableSuccess` passes no `timeout`, and
   the number appears nowhere in `DESIGN.md`, `CONVENTIONS.md` or `PRD.md`. It is
   ranked fourth as a product issue and would be second as a testing one — it is
   the direct cause of B-2 and MA-3. A user-facing affordance whose lifetime is a
   third-party default that nobody chose should be made explicit whatever else
   happens here.
5. **`PressResponder` warnings persist.** Confirmed — one per page load in every
   one of my 16 runs, unchanged by DEF-02. Last: console noise, already known,
   and now cheap to gate (MI-7).

---

## Verdicts

### `test/isolation-suite` — **Request changes**

The matrix is real. It runs against a real Postgres through the real Prisma
client and a real better-auth session lookup; the negative cases mostly re-read
the database; the search control test exists, which is the mark of someone who
has thought about vacuous passes; and the guard on the test database is the
best-designed thing on either branch. Nine of my eleven mutations were caught,
and the two that were not are a documented gap and a behaviourally unreachable
line. **This is the work I asked for and it does the job.**

It is blocked on **B-1** alone, and B-1 is two environment variables. But it is
genuinely blocking: a suite that a broken build prevents from ever executing is
the exact thing I said was worse than having none, and it would have shipped
green-looking and mute. Fix the workflow, attach a passing run, and I will
approve. **MA-2** (the four 400-contract tests) I would like in the same PR
since it is the newest and least-exercised code on the branch; **MA-1**'s comment
correction is a two-line edit and should not survive its own commit.

### `test/e2e-harness` — **Request changes**

The hard parts are right, and several of them are things I would not have got
right first time. The double-press test defeats CDP round-trip granularity by
dispatching both press sequences in one browser task, and I confirmed it fails
with the guard removed. The stale-Undo test's point-in-time `count()` returns
exactly the 3 the author reported. The fault injectors correctly distinguish a
contract-speaking 500 from an opaque one, which is a real distinction in
`getErrorMessage` that nothing else tests. The locators are role- and copy-based
and traced to the deck. The 401 spec is a defect record written to fail the day
the defect is fixed, which is the correct way to encode known-broken behaviour.

It is blocked on **B-2** and **B-3**. B-2 matters most: the author diagnosed the
retrying-assertion trap precisely, fixed it where they found it, and left seven
instances of it in the other file — including the one I broke the app under and
watched pass. Half of that spec's stated contract does not currently hold.
B-3 is a one-line change that the author's own local run proves is sufficient,
and it converts "this writes to production by design" into "this writes to
production only if you ask".

Fix those two, carry **MA-3** or make the toast timeout explicit, and this is an
approve. I would take **MI-7** at the same time — the `PressResponder` gate is
four lines and closes a defect that has now survived two reviews on the strength
of being merely noisy.

Both branches can merge independently once their own blockers clear. Neither
should merge on the strength of being green, which is the whole reason I ran the
mutations rather than the suites.

---

# Sign-off pass — both branches re-reviewed after fixes

Narrow pass: confirm the three blockers per branch are closed and that nothing
new broke. I did not re-review the suites.

## `test/isolation-suite` — **Approve**

**B-1 (CI never reached the tests).** Closed, and I verified it the hard way
rather than taking the run on trust. I wrote my own runner that parses
`.github/workflows/ci.yml` with PyYAML and executes the `verify` job's `run:`
steps in order under the job's own `env:`, with `.env` moved aside.

- *Negative control first.* With `BETTER_AUTH_URL` / `BETTER_AUTH_SECRET`
  dropped from the job env, the Build step dies exactly as diagnosed:
  `Failed to collect page data for /api/auth/[...all]`, caused by
  `BETTER_AUTH_URL must be set in production` at `src/lib/auth.ts:33`. So the
  blocker was real and the fix is load-bearing, not decorative.
- *With the committed env.* All steps pass: db push, lint, build, typecheck,
  and `test:run` — **6 files, 143 tests, all green.** (I skipped `npm ci` and
  used the existing `node_modules`; it is the one step whose behaviour I did
  not independently exercise.)

The placeholder values are the right call. Nothing in CI serves traffic, the
suite overrides the secret from `vitest.config.ts`, and a real secret would be
a real secret in a public build log. The comment says so.

**B-2 (two surviving mutations).** Both now die, at exactly the counts
reported — I re-ran them myself:

| Mutation | Result |
| --- | --- |
| `.strict()` removed from `todoStatusSchema` | **3 failed**, 140 passed |
| `mentionsCompleted` → `return false` | **6 failed**, 137 passed |

`writeContract.test.ts` checks each rejection by its *effect* as well as its
status, which is the property that matters: a 400 that still wrote half the
body is the original DEF-06 bug wearing a different number.

**B-3 (indistinguishability tests were status-only).** The re-reads fire. I
dropped `userId` from each write's scope in turn:

| Sabotage | Failures |
| --- | --- |
| `/status` `updateMany` scope | **2** — incl. `PATCH …/status answers identically` |
| `PATCH [id]` `updateMany` scope | **2** — incl. `PATCH …/[id] answers identically` |
| `DELETE [id]` `deleteMany` scope | **3** — incl. `DELETE …/[id] answers identically` |

Previously each was 1. The added `readTodo` assertions are what catch it: the
404 comes from the scoped re-read that runs *after* the write, so the status
codes agree perfectly while the row is being rewritten. The corrected header
comment now names the two groups that deliberately assert less, and says why.
The count concession (4, not 5) matches what I measured.

**Nothing broke.** `git diff origin/develop -- src/` is empty. Full suite green.

## `test/e2e-harness` — **Approve**

**B-1 (false-success sites).** Closed, and it was eight, not seven — I count
eight `expectNoFalseSuccess` call sites, all in `fault-injection.spec.ts`. I
did not reuse the author's sabotage; I wrote my own, adding the success toast
to the `catch` of `handleToggle` and `handleDelete` in `TodoListScreen.tsx` —
the app lying to the user about a mutation that failed.

- *Before:* 16 desktop specs green in 41.4s.
- *Under my sabotage:* **both sabotaged specs fail, in 1.5s and 1.7s**, with
  the intended message — `a failed mutation reported success: "Todo "…" marked
  complete"` / `"… deleted"`. The other 8 stayed green, so the assertion is
  discriminating rather than merely loud.

Fast failure is the point. The old retrying form sat and watched the toast
self-expire and then reported a pass at 6.5s. Reading once, after the failure
and the durable state are already asserted, is the correct fix, and the
docstring on `expectNoFalseSuccess` explains why so the next person does not
"tidy" it back into a retrying assertion.

**B-2 (defaulted to production).** Closed, and stronger than claimed. I probed
`resolveTestDatabaseUrl` directly:

| Input | Result |
| --- | --- |
| nothing set | resolves `postgresql://postgres@127.0.0.1:5432/todo_app_test` |
| the app's real `DATABASE_URL` | **refused** — same as the app's URL |
| same, one char changed | **refused** — hosted host (`neon.tech`) |
| local but named `todo_app` | **refused** — not `*_test` |

Note the second and third rows: aiming at production is refused twice over, by
independent rules, so defeating the identity check alone does not get you
there. `playwright.config.ts` resolves this at config load and hands it to the
dev server via `webServer.env`, which is the half a teardown-side guard cannot
cover. **Production verified untouched after all my runs: 17 users, 23 todos,
and zero accounts matching any test-shaped address.**

**B-3 (desktop only).** The Pixel 7 project runs **14 real specs, all passing**
— 16 minus the 2 pointer specs it deliberately ignores. It is not silently
skipping. 16 + 14 = 30. The exclusion is correct and the comment justifies it:
the pointer specs assert hover affordances that by design do not exist at that
breakpoint, and Pixel 7 emulates touch.

**`globalSetup` verifying instead of pushing.** I agree with the judgement, and
would have asked for it if they had not. A test run should not reshape a
database as a side effect of starting, and `db push` is destructive with a
blast radius that depends entirely on where it is pointed. Verifying the five
tables and failing with the exact `createdb` / `db push` commands to run is
strictly better. This is the one change that was not asked for and it improves
the branch.

**Nothing broke.** `git diff origin/develop -- src/` is empty. Both projects
green.

## The shared-database hazard — **not a blocker; document it**

The Playwright author was right to flag it and wrong about the direction. I
checked it two ways.

*By reading.* Every destructive statement on either side is scoped, and the two
namespaces are disjoint:

- Vitest deletes `user WHERE email ENDS WITH '@isolation.test'` /
  `'@contract.test'`, and todos by `userId`. It does not truncate.
- Playwright deletes one account at a time by **full string equality** on an
  address matching `/^e2e-[a-z0-9]+-\d+@e2e\.invalid$/`, resolved to a single
  `user.id` first. `.invalid` is RFC 2606 reserved.

Neither suite can match the other's rows. The word "truncate" in the Vitest
guard's prose oversells what `deleteTestUsers` does.

*By running.* I ran the full Playwright desktop suite and six back-to-back
Vitest runs against the same `todo_app_test` **simultaneously**: 16 specs
passed, and 143/143 passed six times over. No interference in either direction.
Both suites also tore down cleanly — the only rows left in the test database
predate this session by eleven hours.

So: a documented constraint, not a fix. One line in the README is enough. When
both branches land, the two `testDatabaseUrl.ts` twins should be merged into a
single shared module — the Playwright file's own header already says so, which
is the right instinct.

## Verdicts

**`test/isolation-suite` — approve.**
**`test/e2e-harness` — approve.**

All six blockers are closed, each verified independently rather than by
re-reading the authors' reports, and every claim I checked matched what was
stated — including the two corrections the authors volunteered against their
own earlier numbers. Neither branch touches `src/`. Both are clean.

Carried forward, not blocking: **MI-9** still stands — `ci.yml` lives on the
isolation branch and runs `npm run test:run` only, so **merging the E2E branch
does not put Playwright in CI.** That should be a deliberate decision, said out
loud, not a thing everyone discovers in a month. Both branches touch
`package.json` / `package-lock.json`, so whichever merges second conflicts
trivially.

---

# Senior review — three branches → `develop`

`feature/list-spacing` (`0af975f`), `fix/session-expired-redirect` (`e788781`),
`fix/e2e-ci-failures` (`6cc55a0`). They merge independently, so each gets its
own verdict. Also settled below: the fate of `fix/undo-window`, and the ranking
of the product defect the CI diagnosis surfaced.

## Verdicts, up front

| Branch | Verdict |
|---|---|
| `feature/list-spacing` | **Changes requested** — one real regression (B-1), one open designer question I have now measured |
| `fix/session-expired-redirect` | **Blocked** — merging it turns CI red (B-2), and it contradicts an unamended spec |
| `fix/e2e-ci-failures` | **Changes requested** — the diagnosis is right and I confirmed it from source; the constant is measurably off by one (B-3) |
| `fix/undo-window` | **Do not drop it. Re-land it as a product change**, with the CI justification removed |

The diagnosis on `fix/e2e-ci-failures` is the best piece of work in this batch
and most of my notes on it are refinements of a correct argument. The two
`fix/…` branches both need work before they land; `feature/list-spacing` needs
one file it forgot.

## How I reviewed

Read-only from the main checkout; the two worktrees were read, never checked
out. Nothing was committed or merged.

Three things I ran rather than reasoned about, because reasoning was not going
to settle them:

1. **The contrast measurement the designer asked for and nobody had done.**
   Computed from the real token graph in
   `node_modules/@heroui/styles/dist/themes/default/variables.css` — oklch to
   sRGB, `color-mix(in oklab, …)` evaluated properly, WCAG relative luminance.
   Numbers in B-1/M-1.
2. **The HeroUI toast mechanism.** Read
   `node_modules/@heroui/react/dist/components/toast/toast-queue.js` and
   `@heroui/styles/dist/components/toast.css` directly.
3. **The view-transition frame gap.** Reproduced HeroUI's `defaultWrapUpdate`
   chaining verbatim on a static page in the project's own bundled Chromium and
   sampled `document.getAnimations()` every frame. This is what produced B-3.

`npx tsc --noEmit` is clean on `fix/session-expired-redirect`.

---

## Blocker

**B-1 — `feature/list-spacing`: `TodoListSkeleton` was not updated, and its own
comment now lies.**
`src/app/todos/components/TodoListSkeleton.tsx` still renders
`<ul className="divide-y divide-border-secondary">` with `py-3` rows and no
`p-2`, under a comment that reads *"Row geometry matches `TodoRow` so nothing
shifts on swap (§4.8)."* After this branch it does not match on any axis:
`divide-y` vs `gap-1.5`, no wrapper padding vs `p-2`, `py-3` vs `py-3.5`. Over
the four skeleton rows that is roughly 50px of height appearing at the moment
the real list swaps in — a visible jump on every load and every
`reloadWithSkeleton()`, which fires after each create and each edit.

It is also self-defeating: the skeleton is the first thing a user sees on
`/todos`, and it still renders the ruled-table look this branch exists to
remove. The fix is three tokens in one file and belongs in the same commit.

**B-2 — `fix/session-expired-redirect`: merging this turns CI red.**
`e2e/fault-injection.spec.ts` → *"a mid-session 401 dead-ends: a toast, no
redirect, no session-expired copy"* pins the current behaviour deliberately and
asserts, among other things:

```ts
await expect(todos.toasts.filter({ hasText: UNAUTHORIZED_MESSAGE })).toBeVisible();
await expect(page).toHaveURL(/\/todos$/);
await expect(page.getByRole("heading", { name: "Your todos" })).toBeVisible();
```

All three fail once the interceptor lands. The spec's own header says so — *"the
day it is fixed, this test fails and gets rewritten"* — and the commit message
acknowledges it. It just was not done. The rewrite is the branch's proof of
work, not a follow-up: it is the only evidence that the redirect fires at all,
and it is cheap, because `page.context().clearCookies()` already produces a real
server-issued 401 without any mocking. **This branch should not merge without
that spec flipped and green.**

While flipping it, assert the `?next=` round trip too — that the user lands on
`/sign-in?next=%2Ftodos` and that signing in returns them to `/todos`. That is
US-04 and nothing currently covers it from the client path.

**B-3 — `fix/e2e-ci-failures`: `QUIET_FRAMES = 2` is exactly the width of the
gap it is meant to bridge. It needs to be 3.**

This is the one finding that changes the branch. The reasoning behind two
frames is sound — the chain does release the DOM between links, and a single
idle sample can land in that release — but the measured gap is **two frames,
not one**, so requiring two consecutive quiet frames is satisfied *by the gap
itself*.

I reproduced `defaultWrapUpdate` verbatim on a static page and sampled every
frame through a `close` + `add` pair dispatched in one task, the shape
`showUndoableSuccess` produces:

```
runs: quiet×1, BUSY×30, quiet×2, BUSY×30, quiet×236
interior quiet gap: 2 frames   (4/4 runs, stable)
```

Then I ran the helper under review against that same chain:

```
QUIET_FRAMES=2  ->  returns at frame ~33; next 4 frames all BUSY   4/4 trials
QUIET_FRAMES=3  ->  returns at frame ~67; next 4 frames all quiet  0/4 trials
QUIET_FRAMES=4  ->  same as 3
QUIET_FRAMES=5  ->  same as 3
```

At `2` the helper returns **inside the dead zone between the close and the
add**, and the add transition starts on the very next frame — which is the
precise condition the branch identifies as the bug. It does not settle the
chain; it finds the seam in it. At `3` it waits out the whole chain, every time.

So: two quiet frames is **load-bearing, not superstition — and off by one.**
The author reasoned their way to the right shape of fix and then picked the one
value that does not work. Change `QUIET_FRAMES` to `3` and record the measured
2-frame gap in the comment, so the number has a reason attached instead of a
story.

Two honest caveats. My probe is a synthetic page, not the app, so the constant
should be confirmed against a real run before this is called closed — though the
gap is a property of the chaining pattern and Chromium's transition lifecycle,
not of the page content, so I expect it to carry. And `3` is empirical too; see
M-5 for the state-based wait that would make the constant unnecessary.

---

## Major

**M-1 — `feature/list-spacing`: the measurement the designer asked for, done.
It does not clear the branch; it hands the designer a decision.**

DESIGN §8.6 asked for `--surface-hover` to be re-measured against `--surface`
once `divide-y` went, since DEF-08's light-mode headroom was already thin at
3.25:1. Nobody had done it. Here it is.

First, provenance of the 3.25:1, because it was undocumented anywhere outside
that one sentence: it is the **checkbox control border against the hovered row
background in light mode** — `TodoRow`'s
`border-[color-mix(in_srgb,var(--foreground)_50%,transparent)]` composited over
`--surface-hover`. I get **3.233:1**, which is the figure. Against the 3:1 that
WCAG 1.4.11 asks of a control boundary that is 0.23 of headroom, and it is the
weakest thing on the screen.

**That number is unchanged by this branch** — no colour is touched. Good; it is
not a regression. Recording it so the next person does not have to derive it
again:

| Measurement | Light | Dark | Floor |
|---|---|---|---|
| Checkbox border vs hovered row surround | **3.23:1** | 4.77:1 | 3:1 (1.4.11) |
| Checkbox border vs resting row surround | 3.38:1 | 5.14:1 | 3:1 |
| `--surface-hover` vs `--surface` — **the row boundary** | **1.20:1** | **1.19:1** | — |
| `--border-secondary` vs `--surface` — the `divide-y` rule this removes | 1.71:1 | 1.78:1 | — |
| Row title vs `--surface-hover` | 14.72:1 | 14.57:1 | 4.5:1 |

Two things follow, and the second is the one that matters.

*The hover is not a boundary.* At 1.20:1 it is roughly a third of the strength
of the hairline it replaces, and nothing like the 3:1 a boundary that carries
meaning would need. It reads as a tint, not an edge.

*In the resting state there is now no boundary at all.* This is the part I do
not think anyone has said out loud. `TodoRow` has no background of its own — the
rows sit on `<Card><Card.Content className="p-0">`, which is `--surface`. With
`divide-y` gone, `gap-1.5` is six pixels of the *same colour as the row*
between two rows of that colour. Not a weak separator: not a separator. And the
designer's framing — *"hover and focus become the only row boundary"* — is
optimistic on both counts. There is no row-level focus style at all; the `<li>`
is not focusable and `group-focus-within` only reveals the action buttons, at
`lg:` only. And **hover does not exist on touch**, so on a phone the resting
state is the only state and the list has no row separation whatsoever.

To be clear about scope: this is what the designer asked for in §8.4.1 — drop
`divide-y`, `p-2`, keep the rounded hover — so the branch implemented the
instruction faithfully and the numbers are the answer to §8.6's question, not a
finding against the author. But the answer is *no, this does not hold up*, and
it should go back before it merges. It is not a WCAG failure (the `<li>` is not
itself an interactive component, so 1.4.11 does not bite) — it is a legibility
regression, and it is worse on the majority platform.

The cheapest thing that keeps the pills and restores an edge is to give the row
its own fill so the gap has something to separate — `--surface-secondary` on the
row against `--surface` on the card. That is only 1.15:1, so it is a shape cue
rather than a contrast one, but it is a real edge at every row in every state
including touch. For reference, if the intent is a hover that genuinely reads as
a state, `--surface-hover` would have to move from `92%/8%` to about **`55%/45%`**
to clear 3:1 (3.31:1 light, 3.83:1 dark) — which is far too loud for a list
hover, and is the honest reason a hover cannot be asked to carry this job alone.
**Designer's call. It should be made before merge, not after.**

**M-2 — `fix/session-expired-redirect`: it does not fix the reproduction QA
actually described.**
DEF-13's stated path is sign out, press Back — bfcache. A bfcache restore
replays no requests. Nothing in the app listens for `pageshow`
(`grep` for `pageshow`/`visibilitychange` across `src/` returns nothing), and
this interceptor only fires on an actual 401 *response*. So the restored page
still shows a signed-in header over a stale list, and stays that way until the
user tries something. The branch converts "stranded forever" into "stranded
until you touch it, then bounced" — a real improvement, and not what the ticket
says. Either add a `pageshow`/`persisted` re-check, or amend the ticket to say
what is actually fixed. Do not let it close DEF-13 silently.

**M-3 — `fix/session-expired-redirect`: a present-but-invalid cookie reads as an
infinite redirect loop, and this branch is what makes that path reachable.**
The early return guards a 401 raised *on* `/sign-in`. It does not guard the
other loop, which runs through the proxy:

1. 401 → `window.location.assign("/sign-in?next=/todos")`
2. `src/proxy.ts`: `getSessionCookie()` checks **presence, never validity** — the
   cookie is still in the jar, `isAuthPath` is true → redirect to `/todos`
3. `/todos`: cookie present, protected path → falls through
4. `requireUser()` in `src/app/todos/layout.tsx`: session invalid →
   `redirect(signInPathWithNext(...))` → back to step 2

That is a loop, and `requireUser`'s own comment names the exact state that
enters it: *"the cookie is present but expired or invalid — the proxy waves
those through."*

Being fair about attribution: **this branch does not create the loop.** It is
already reachable today by any full navigation in that state. What the branch
does is route the ordinary client 401 into it, turning a latent bug into the
default outcome of an expired session. QA never hit it because their repro signs
out, which clears the cookie — which is also why the existing spec's
`page.reload()` assertion passes.

I could not prove it fires: producing a present-but-invalid session cookie needs
the harness this branch says it does not have. **It is the single highest-value
thing to test before this ships** — forge a garbage value into the session
cookie and load `/todos`. If it loops, the fix belongs in the proxy or in
`redirectToSignIn` (clear the cookie before assigning), not in another special
case.

**M-4 — `fix/session-expired-redirect`: a 401 on a write silently destroys the
user's typed text.**
`fault-injection.spec.ts` pins the current contract on a failed create: *"the
modal stays open holding the typed values so the work is not lost."* A full-page
assignment discards it — modal, form state, everything — with no warning and no
explanation on the far side, since `?next=` carries no reason. The user typed a
todo, pressed Add, and arrived at a sign-in screen with their text gone.

**On the assignment-vs-router question you asked: assignment is right, and I
would keep it.** A `router.push` re-renders inside a React tree whose every
cached value is stale, above a server-rendered layout that still believes there
is a user; you would be trusting the thing you just learned is wrong. The full
document load is what guarantees the proxy and `requireUser` both get a fresh
look. The cost is exactly this data loss, and it is worth paying — but it has to
be paid deliberately:

- carry a reason (`?reason=expired`) and render DESIGN §7.9's copy —
  `You've been signed out` / `Sign in again to continue.` — on the sign-in page,
  so the user knows why they are there;
- amend §7.9, which currently specifies an in-page session-expired state and
  **not** a redirect. Right now the branch and the spec disagree and the spec is
  the one on record. Whichever way it is settled, one of them has to move.

**M-5 — `fix/e2e-ci-failures`: the wait is on a frame count, not on the queue's
state, and that is why it needs a magic number at all.**
Two consequences beyond B-3.

*The bound is in frames, not time.* `MAX_FRAMES = 300` is described as "~5s at
60fps", which holds only while `requestAnimationFrame` is firing. rAF stalls in
a page the compositor is not rendering. In that state `page.evaluate` does not
hit its bound at all — it hangs until Playwright's action timeout, which is the
outcome the comment says it exists to prevent. A `performance.now()` deadline
alongside the frame counter costs one line and makes the stated guarantee true.
The silent return on exhaustion is fine and correctly argued — the click that
follows fails as the assertion it was always going to be.

*The helper cannot see a link that has not started.* `document.getAnimations()`
reports transitions that exist. It says nothing about a `runNext` still sitting
in `transitionChain` waiting on a microtask. Any consecutive-quiet-frames
threshold is a guess about how long that takes — a guess B-3 shows was wrong
once, and that will be wrong again on a runner slow enough to stretch the gap
past three frames, which is precisely the machine that produced the original
failure. The durable fix is to observe the chain: an `addInitScript` that wraps
`document.startViewTransition` and keeps an in-flight counter, then wait on the
counter reaching zero. It removes the constant, removes the guess, and removes
this whole class of question. Worth doing while the mechanism is fresh in
someone's head.

**M-6 — `fix/e2e-ci-failures`: only `pressUndo` is protected, and it is not the
only exposure.**
The `::view-transition` layer covers the viewport, so *every* pointer
interaction that can occur while a toast is animating is subject to the same
trap — not just the one that happened to go red. Concretely, in this suite:

- `fixtures.ts` → `openEdit` and `openDelete` both call
  `rowByText(title).hover()`, and `editTodo` chains straight from a write that
  raised a toast. `undo-semantics.spec.ts` runs two `editTodo` calls
  back-to-back for exactly that reason.
- `pointer.spec.ts` → *"row actions are hidden until hover"* does
  `createTodo` (toast, transition) then `row.hover()` and asserts
  `toHaveCSS("opacity", "1")`. If the hover lands on the snapshot layer the row
  never enters `:hover`, and the retrying CSS assertion sits watching an element
  that will never change. Same bug, different symptom, and it would read as an
  unrelated flake.

Not a defect in what this branch does — the diagnosis names the general
mechanism correctly. But shipping the guard on one helper leaves the others
armed. Once the wait is state-based (M-5) it is cheap enough to put in
`openEdit`, `openDelete` and `toggle` too.

---

## Minor

**m-1 — `feature/list-spacing`: `rounded-2xl` survived on the exact line the
designer flagged.**
DESIGN §8.4.1 says, in the same paragraph that asks for `divide-y` to go:
*"`rounded-2xl` is a literal forbidden by §2.3 — it must be
`rounded-[var(--radius)]`."* §2.3 confirms it. The branch edits that class
string, reorders it, and leaves the literal in place. Half of a one-sentence
instruction.

**m-2 — `feature/list-spacing`: DESIGN still documents the removed markup.**
`docs/DESIGN.md:387` and `:712` both still show
`<ul className="divide-y divide-[var(--border-secondary)]">`, and §8.4.1 asks
for §4.3 and §4.4 to be amended. The docs now describe a list the app does not
render. Whoever resolves M-1 should land the doc change with it.

**m-3 — `fix/session-expired-redirect`: concurrent 401s each call `assign`.**
`redirectToSignIn` has no re-entry guard, and the `pathname === SIGN_IN_PATH`
check cannot catch a second call because the navigation has not committed yet.
A toggle plus its `reloadSilently()` refetch can both 401. In practice benign —
same URL, and Chromium replaces the pending navigation — but it is one
module-scoped boolean to make it explicitly once-only, and it forecloses the
version of this where two callers compute different `next` values.

**m-4 — `fix/e2e-ci-failures`: a stale comment in the spec it exonerates.**
`undo-semantics.spec.ts` says of `await undo.hover()`: *"Waits for the toast to
stop animating into its stacked position before anything reads or touches it."*
The diagnosis establishes that it does no such thing — Playwright's stability
check compares bounding boxes across two frames, and during a view transition
the live element's box does not move because the snapshot layer is what
animates. That comment is the belief that produced the bug. It should be
corrected in the commit that documents why.

---

## Nit

**n-1 — `feature/list-spacing`.** `gap-1.5` (6px) is off the 4/8 rhythm the rest
of the screen uses. `gap-2` if the boundary work in M-1 does not replace it
anyway.

**n-2 — `fix/session-expired-redirect`.** The commit deletes the note explaining
*why* `src/lib/http.ts` exists at all when application data moves through server
actions. It is the answer to the first question a reader has about the file, and
`todo.service.ts` is currently its only consumer. Keep it.

**n-3 — `fix/e2e-ci-failures`.** `settleToastTransitions` is defined above
`createTodosScreen` but used once inside it; it reads as a general utility. Fine
either way, but if M-6 is taken it becomes one, and the doc comment should stop
being about Undo specifically.

---

## The claim about `undo-semantics.spec.ts:30` — correct, and stronger than stated

Line 30 is *"pressing Undo twice quickly sends exactly one request"*. The claim
is that it is immune only because it dispatches synthetic events, and therefore
could never have caught this class of bug. Both halves check out.

The test does its two presses inside `page.evaluate`, via
`document.querySelector(...)` then `button.dispatchEvent(new PointerEvent(...))`.
`dispatchEvent` delivers to the node it is called on. There is no hit-test, so
the `::view-transition` layer is not merely survived — it is never consulted.
The test is *structurally* blind to it, which is a stronger statement than
"happened not to hit it": no amount of CI slowness could make this test fail
this way.

And it should stay that way. Its own comment explains that the synthetic
dispatch is the entire point — it is what races React's unmount, and the
friendlier API demonstrably passes with the guard removed. That is a
well-designed test defending a real invariant. It is simply not, and should not
become, coverage of the press path. **The gap it leaves is real and belongs to
someone else**: nothing in the suite presses Undo through a genuine pointer
sequence and asserts the request went out — which is precisely how this defect
lived in the product unnoticed. If the fix branch wants one more thing, that is
the test I would ask for.

---

## `fix/undo-window` — do not drop it

**Agreed that the diagnosis kills the stated reason.** A press landing 170ms
into a 4000ms window was never going to be fixed by making the window 12000ms,
and the branch's own commit is admirably honest that it could not reproduce the
failure and that the traces should still be read. As a fix for CI it is refuted.

**Keep the change anyway, re-landed as a deliberate product change.** The
argument does not depend on CI and never did:

- 4s is not a decision anyone made. It is `DEFAULT_TOAST_TIMEOUT = 4000` in
  `@heroui/react/dist/components/toast/constants.js`, inherited by silence.
  Nothing in DESIGN or PRD chose it.
- The designer and I both flagged it as too short and undocumented *before* CI
  went red, independently. The CI theory arrived late and attached itself to a
  conclusion that already stood.
- The distinction in the commit message is the right one and is worth keeping
  verbatim: 4s is a reasonable life for *"here is what happened"* and a poor one
  for *"you have this long to change your mind."* An Undo window that can expire
  mid-sentence is not a window.
- Splitting the two — 12s for action toasts, HeroUI's default for outcome
  toasts — is exactly right and is the part that shows the thinking.
- The DESIGN §7.15 paragraph is the most valuable thing on the branch. Whatever
  happens to the code, that paragraph should land: it converts an accident into
  a decision with a reason attached.

Three conditions on the re-land:

1. **Strip the CI paragraph from the commit message.** It is now known to be
   wrong, and a wrong causal claim in the history is worse than no claim.
   Likewise the `UNDO_WINDOW_MS` doc comment in `TodoListScreen.tsx`, whose
   second half — *"CI made that visible before a user had to"* — is the refuted
   theory restated as fact. Keep the first half; it is the real argument.
2. **Update `undo-semantics.spec.ts`.** Its header and two inline comments are
   built on the 4s default (*"well inside the four-second toast life"*,
   *"toasts expire on their own after four seconds"*). The tests stay valid —
   their point-in-time reads get *safer* with a longer window, not weaker — but
   the reasoning written beside them becomes wrong.
3. **Sanity-check the stack.** Three toasts are visible at once by default; at
   12s a burst of writes will hold a taller stack for longer. Worth one look at
   1280×800 and at 320px before it lands. I do not expect a problem.

It should go to PM as a product change, not merge as a fix.

---

## The product defect — **next sprint, not ship-blocking**

The diagnosis surfaced a genuine user-facing bug: for the first stretch of its
life the Undo button is rendered, focusable and completely inert to pointer
input. Ranking it, with three corrections to the framing that change the
severity:

**It is pointer-only.** react-aria's `usePress` handles keyboard activation
through key events on the focused element, which never touch hit-testing. Tab
to Undo and press Enter and it works during the transition. Only mouse and
touch are swallowed — which is still nearly everyone, but it is not an
accessibility blocker and it does not fail a WCAG criterion.

**The window is ~400ms, doubling only sometimes.** `toast.css` gives the toast
transitions `350ms`. `showUndoableSuccess` calls `dismissUndo` first, but
`dismissUndo` returns early when there is no outstanding key for that todo — so
the close-then-add doubling happens on a *repeat* write to the same todo, not on
every write. First write: ~400ms. Replacement: ~750ms plus the 2-frame gap.
"The app doubles it on every write" overstates it.

**The failure is silent but harmless and recoverable.** No wrong write, no false
success, no data loss — the press does nothing and the button is still sitting
there. With `fix/undo-window` the user has 12 seconds to press it again, which
takes the inert fraction from ~10% of the window to ~3%.

Weighed against a release blocker (DEF-13) that leaves users unable to reach
sign-in, this is not in the same class. **Ship it. Fix it next sprint.**

What I would actually do, in order:

1. **Record it in `docs/QA-REPORT.md` as a known defect with the measured
   numbers.** It has been invisible for the entire project; the expensive part
   was finding it, and that is done. Losing it now would be the real waste.
2. **Halve it ourselves, next sprint.** The claim that `TodoListScreen` cannot
   fix this is true of the 400ms and false of the doubling. Close-then-add is
   *our* pattern, not HeroUI's — updating the existing toast in place instead of
   dismissing and re-adding removes one entire transition from the replacement
   path. That is our code and it is the cheaper half of the problem.
3. **File upstream, with the repro that already exists.** The author's
   controlled experiment — start a view transition between `mouse.down()` and
   `mouse.up()`, press swallowed 3/3; same gesture without one, undo runs 3/3 —
   is a better bug report than most projects receive. It should go to HeroUI
   more or less as written. The real ask is that an interactive toast not be
   press-inert while it animates.
4. **Do not attempt a local override of the transition wrapper.** I checked the
   seam: `ToastQueue`'s constructor accepts `options.wrapUpdate`, so in principle
   the view transition is opt-out — but `toast` is created from a module-level
   `new ToastQueue({ maxVisibleToasts })` singleton in `toast-queue.js` and
   exported already bound. There is no supported way to inject `wrapUpdate` into
   the instance the app uses. Anything that reaches it would be a monkey-patch on
   library internals to work around a cosmetic animation, and that trade is not
   worth it. Upstream is genuinely the lever here.

---

## Verdicts

**`feature/list-spacing` — changes requested.** Fix the skeleton (B-1); it is
three tokens and the branch is incoherent without it. Take m-1 and m-2 while you
are in there. Then M-1 goes back to the designer with the numbers above — the
measurement they asked for has now been done, and the answer is that the resting
state has no row boundary at all and touch never gets a hover. That is a design
decision, not mine to make, but it should be made before this merges rather than
discovered on a phone afterwards. The intent of the change is right and the list
does read better; it needs one more idea to hold together.

**`fix/session-expired-redirect` — blocked.** The code itself is good: small,
correctly placed at the one shared seam, honest about its reasoning, and right
about the full assignment. What blocks it is everything around it — it turns CI
red (B-2), it does not address the reproduction the ticket describes (M-2), it
contradicts DESIGN §7.9 which still specifies an in-page state (M-4), and it
routes every expired session into a proxy loop that has been latent since the
proxy was written (M-3).

Evidence I want before this ships, in priority order:

1. The pinned spec rewritten and green, asserting the redirect and the `?next=`
   round trip (B-2).
2. A test with a **present-but-invalid** session cookie proving no redirect
   loop (M-3). This is the one that would take the release down, and it is the
   one nobody has looked at.
3. A decision, written down, on what happens to an open modal's typed text and
   on §7.9's copy (M-4).
4. The bfcache path either handled or explicitly scoped out of DEF-13 (M-2).

The author was right that their harness could not drive an HttpOnly cookie or
bfcache, and right to say so in the commit. But (1) and (2) need neither:
`clearCookies()` and a forged cookie value are both plain Playwright, and the
suite already does the first one.

**`fix/e2e-ci-failures` — changes requested, and read it before you review
anything else this week.** The mechanism is real and I confirmed it from source:
`defaultWrapUpdate` in `toast-queue.js` wraps every add and close in
`document.startViewTransition` and serialises them through
`transitionChain = transitionChain.then(runNext, runNext)`, exactly as
described. "A toast is visible when its transition *starts*, so every visibility
wait in the suite was satisfied while the toast was inert" is the correct
diagnosis and explains both failures without appealing to timing luck. Waiting
on the animation state — no sleep, no retry, no weakened assertion — is the
right shape of fix, and the controlled experiment is properly designed: it
isolates the mechanism and runs a negative control.

It needs `QUIET_FRAMES = 3` (B-3), a wall-clock bound (M-5), and — separately,
not necessarily here — the same guard on the other pointer helpers (M-6). The
constant is the only thing standing between this branch and correct, and it is a
one-character change.

Last note, and it is the reason M-5's state-based wait is worth the extra hour:
settling the chain *before* the press does not guarantee no transition starts
*during* it, and the branch's own experiment is what proves that gap exists —
a transition begun between `down` and `up` swallows the press. A toast expiring
on its 4s timer mid-press starts a close transition and would do exactly that.
Rare, but it is the residual flake, and it is worth knowing about before someone
spends another day on it. `fix/undo-window` incidentally reduces it, which is
the only true thing that branch ever said about CI — and not a reason to keep
it. Keep it for the product reason.
