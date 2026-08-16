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
