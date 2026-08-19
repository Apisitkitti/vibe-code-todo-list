---
name: todo-app-structure
description: The real layout and layering of this todo-app codebase — where every kind of file goes, the client → service → axios → route handler → Prisma chain, where the trust boundary actually sits, naming, forms, copy, and where tests live. Use this BEFORE creating, moving or renaming any file here, and before adding a page or route, an API endpoint, a component, a hook, a service function, a form, a zod schema, a constant, or a test. Use it whenever the question is "where does this go?", "how is this project laid out?", "what's the convention for X?", or "is there already a place for this?" — and use it before starting any change in this repo, not after writing the code. Also read it before trusting `docs/CONVENTIONS.md`, which describes a `src/server/` server-action architecture that has never existed; the corrections are in `references/doc-corrections.md`.
---

# Where things go in this codebase

Read this first, write second. Most of the review findings this project has
collected were not wrong logic — they were code in the wrong layer, or a
comment describing a mechanism that was not there.

Every rule below has a reason. Follow the reason, not the letter: it is the
reason that tells you what to do in the case nobody wrote down.

## The one-line architecture

```
client component → src/service/*.service.ts → axios → src/app/api/**/route.ts → prisma
```

There are **no server actions in this app** and there never have been. There is
no `src/server/` directory. `docs/CONVENTIONS.md` says otherwise in two places,
including the sentence naming the trust boundary — it is wrong, and
`references/doc-corrections.md` lists exactly which sentences.

**The trust boundary is the route handler under `src/app/api/**`.** Nothing in
front of it is trusted. Moving a *call* to the client does not move the
*boundary*: the browser is untrusted whether the code is a form, a hook, or a
`curl`.

## "Where does this go?"

| You are writing | It goes in | Why |
|---|---|---|
| A page for a URL | `src/app/<kebab-route>/page.tsx` | App Router; route segments are kebab-case |
| A component used by exactly one route | `src/app/<route>/components/Name.tsx` | Keeps a screen's parts next to the screen |
| A component used by two or more routes | `src/components/Name.tsx` | Only shared things are shared |
| A reusable form field | `src/components/ui/` + its `index.ts` barrel | Every form composes these, so layout and error slots stay identical |
| A form | `<owner>/components/form/Name.tsx` | One file per form, barrel is the entry point |
| A zod schema **a route handler re-parses** | `src/lib/<thing>.schema.ts` | The API must not import out of a UI folder — see below |
| A zod schema only its own form uses | that form's `components/form/schema.ts` | Sign-in and sign-up live here, correctly |
| An HTTP call the UI makes | `src/service/<resource>.service.ts` | One transport layer, no try/catch |
| A database read or write | `src/app/api/<resource>/**/route.ts` | The only place Prisma is importable |
| Shared response/error shapes for an API folder | `util.ts` and `errors.ts` beside the routes | Success side and error side, split |
| A pure helper over domain data | `src/lib/name.ts` | Testable in Node, no React |
| A stateful hook for one route | `src/app/<route>/hooks/useName.ts` | `useTodoList` is the precedent |
| Copy used by more than one file | `src/app/<route>/constants/` | Single-use copy stays inline |
| Framework plumbing (prisma, auth, session, http) | `src/lib/` | |
| A test of a pure function | `tests/unit/name.test.ts` | |
| A test of an API contract | `tests/api/name.test.ts` | The real handler, real Postgres, real cookie |
| A test of a user journey | `e2e/name.spec.ts` | Real browser |
| A decision you had to argue for | `docs/decisions/` | Dated and immutable; do not edit a spec in place to record an argument |

When two answers look right, prefer the one that puts the module **below** its
consumers rather than beside them. Dependencies point inward: UI → service →
API → lib. Never back out.

## The layering rule, and what each layer is forbidden to do

**Client component.** Owns what a mutation *means*: which toast, which field to
mark invalid, whether to confirm, what to do on failure. This is the only layer
that catches errors, because it is the only one that can decide anything about
them.

**Service (`src/service/`).** Calls the API and returns the response. That is
all. **No try/catch** — enforced by ESLint now. No retries, no fallback values,
no reshaping, no validation. A service that catches has decided something the
UI was the only layer qualified to decide, and the usual result is a failure the
user is never told about. Shared literals in a service file are one
UPPER_SNAKE_CASE constant at the top.

**axios (`src/lib/http.ts`).** One shared instance. Never `fetch` for
application data, never `axios.get` directly. The instance owns `withCredentials`
(sessions are cookies) and the one genuinely cross-cutting concern: a `401`
mid-session redirects to sign-in with the current path preserved, because
`src/proxy.ts` only sees full navigations and a page already open would
otherwise sit on a **Try again** button that can only fail again.

**Route handler (`src/app/api/**`).** The trust boundary. Three steps, in this
order, every time — see `references/api-routes.md` before writing one.

**Prisma.** Importable from route handlers only. `src/lib/auth.ts` is the single
granted exception, for better-auth's adapter. ESLint enforces both halves.

**`src/proxy.ts`** (Next 16's renamed middleware — do not create a
`middleware.ts`) is optimistic redirects only. It reads whether a cookie is
*present*, never whether it is *valid*. It is not authorization and must never
be treated as any.

## The three things a route handler must do

In order, without exception. A handler that skips one is a security defect, not
a style problem.

1. **Resolve the session server-side.** `getSession()`, and return
   `unauthorizedResponse()` when there is no user. Never take a user id from a
   body, query string or header — only from the session.
   Route handlers use `getSession()`, **not** `requireUser()`: `requireUser`
   *redirects*, which is right for a server component and meaningless to an
   axios call that wanted JSON. Server components and layouts use `requireUser()`.
2. **Re-validate the body** with the same zod schema the form used. The client
   already validated; that was UX. This is the copy that is trusted.
3. **Scope every query by the session user's id, in the same statement.**

```ts
// yes — one statement, so another user's row matches zero rows
await prisma.todo.updateMany({ where: { id, userId: session.user.id }, data });

// no — a fetch-then-check has a window, and leaks existence on the way
const todo = await prisma.todo.findUnique({ where: { id } });
if (todo.userId !== session.user.id) return notFoundResponse();
```

A row belonging to someone else returns **404, not 403**. 403 confirms the row
exists, which is the fact being protected. "Missing" and "not yours" must be
byte-identical answers — `tests/api/isolation.test.ts` asserts exactly that.

## Naming

| Thing | Case | Example |
|---|---|---|
| Component (and its file) | PascalCase | `TodoRow.tsx` exports `TodoRow` |
| Route segment | kebab-case | `src/app/sign-in/page.tsx` |
| Function, variable | camelCase | `getTodoList` |
| Constant | UPPER_SNAKE_CASE | `const TODO_ENDPOINT = "/todos"` |
| Interface, enum | PascalCase | `interface TodoListProps` |
| Error module under `app/` | `errors.ts` — **never** `error.ts` | `error.*` is Next's error-boundary convention; the build fails with "must be a Client Component" |

Names say what the thing *is*. If a reader has to trace a variable to learn what
it holds, rename it. No `data`, no `tmp`, no `handleThing2`.

**Every function is an arrow function** — components, route handlers, helpers,
default exports alike. Default exports are a named `const` then
`export default Name`, so the component keeps a real name in stack traces and
DevTools. The reason this is worth a rule: arrow consts are not hoisted, so
"define a helper above its first use" is a real constraint on module order, and
a `function` declaration silently exempts itself from it. ESLint enforces this,
including the `export default function` form that `func-style` alone misses.

**Import order** — three groups, one blank line between:
React, then everything from `node_modules`, then ours (`@/…` first, then `./…`).
Type-only imports sit in the group they belong to, not a fourth group.

**Component body order** — state, then derived variables, then functions, then
`useEffect` last, next to the returns. Effects last because an effect is about
what happens *around* the render, and because everything it calls is then
already defined above it.

## Forms

react-hook-form + zod through `zodResolver`, always. No `useState` per field, no
hand-rolled validation. HeroUI v3 inputs are react-aria based and controlled, so
bind them with `Controller` — never spread `register` onto one.

Forms compose `src/components/ui` (`FormTextField`, `FormTextArea`, `FormSelect`,
`FormDatePicker`), never HeroUI primitives directly. A new field type becomes a
new `Form*` there; it is not hand-assembled inside a feature form.

Types are **inferred** with `z.infer` — never a parallel interface that can
drift from the schema.

Details, including where a schema lives and why, and the date contract:
**read `references/forms.md` before adding or changing a form.**

## Copy

Strings are built from the values they describe:

```ts
const tooLongMessage = (field: string, maxLength: number) =>
  `Keep the ${field} under ${maxLength} characters.`;
```

A hard-coded "under 200 characters" starts lying the moment `TITLE_MAX_LENGTH`
changes, and nothing will tell you. The same applies to a message listing the
priorities, or naming the capture surfaces — derive it from the array.

Wording comes from the copy deck, `docs/DESIGN.md` §7. If a string is missing
there, add it there rather than improvising inline. Copy used in more than one
file goes in the route's `constants/`; single-use copy stays at the point of use.

Colours are `var(--token)` only — no hex, no `rgb()`, no `bg-zinc-900`. A
hard-coded colour does not swap with the theme, which makes it a dark-mode
defect that light-mode review cannot see. Compose a missing shade with
`color-mix()` from an existing token. ESLint enforces this.

## Mutation UX

**Confirm what cannot be undone. Everything else fires immediately and offers
Undo.** Delete confirms. Create, edit and toggle do not.

Before adding a confirm to something new, ask: *if this is wrong, can the user
put it back without losing anything?* If yes, build the Undo instead of the
dialog. A dialog asks you to re-read what you just typed; Undo actually puts
things back.

One exception, and it is about what the Undo *does*: an Undo that **destroys** a
record is not a reversal, whatever the button says. A create's Undo was a
`DELETE` sitting in a stack of buttons that all read "Undo" and all look alike —
it is gone, and `Todo "…" added` is a receipt with no action. The test is not
"is this reversible" but "does the reversal put something back".

Every mutation reports through a toast, naming what happened to what. A failed
mutation surfaces the server's message and never fails silently.
`Toast.Provider` is mounted once, in the root layout.

Use the shared `src/components/ConfirmDialog.tsx`; do not hand-roll a dialog per
screen. **Every dialog in this app is controlled and has no trigger inside it**,
because the same modal is opened from a page button and from every row. So
render `AlertDialog.Backdrop` / `Modal.Backdrop` directly with `isOpen` and
`onOpenChange` — **never** the `.Root`. The root is react-aria's
`DialogTrigger`, which wraps its children in a `PressResponder` unconditionally
so a `.Trigger` beneath it can register; with no trigger, it warns on every
mount. Two components reached that independently (DEF-02). `Backdrop` is a
`ModalOverlay`, which builds its own overlay state from those props and
publishes the context that `Escape`, the backdrop dismiss and `CloseTrigger`
all read, so nothing is lost by dropping the root.

## Errors

`src/lib/apiError.ts` is the single source of truth for error responses: one
body shape, one status per code, one default message per code. A route handler
picks an `ApiErrorCode` and **never** writes a status or a JSON error shape by
hand. A resource's `errors.ts` may override the *message* for domain wording,
never the shape or the status.

On the client, `getErrorMessage(error, fallback)` is the one place a thrown
value becomes copy. It deliberately prefers the fallback over axios's own
wording — "Request failed with status code 500" is not user-facing copy.

## Tests

Three suites, three jobs. Put a test at the lowest layer that can actually fail
for the reason you care about.

- `tests/unit/` — pure functions, no database. Fast, and where a correctness
  property belongs if it can live here.
- `tests/api/` — the route handler called directly with a real `NextRequest`,
  against real Postgres and a real better-auth cookie. Contract, authorization,
  ordering, and anything where the answer depends on the database rather than on
  our arithmetic. Not over a socket: the network, Next's routing and
  `src/proxy.ts` are not exercised here.
- `e2e/` — Playwright, real browser. Journeys, focus, and anything that is only
  true once the DOM exists.

**Read `references/testing.md` before writing one** — it covers the isolation
model, the timezone that makes the date tests discriminate rather than merely
run, and the two hazards that have each cost a night.

## Things this team learned the hard way

- **A green suite is not evidence until you have watched it fail.** A first CI
  that ordered the test step after a failing gate never ran the tests at all,
  and reported success. When you add a check, break the thing it checks and
  watch it go red before you trust it.
- **Never read a command's verdict through a pipe.** A `| tail` reports the
  exit code of `tail`, and truncates the line that mattered. This has produced
  four separate false conclusions. Send output to a file, record `$?` on its own
  line, and read both back.
- **Comments explain why, not what.** The what is already in the code; a comment
  restating it goes stale and starts lying. If a comment claims a mechanism,
  make sure the mechanism exists — comments asserting behaviour the code did not
  have are this project's single most common review finding, in both directions.
- **A rule with four exceptions is not a rule.** When reality keeps disagreeing,
  rewrite the rule rather than granting exception five. That is how the
  confirm-dialog rule became "confirm what cannot be undone".
- **Record a decision where it will be found.** Arguments go in `docs/decisions/`,
  dated. Do not edit a spec in place to record why it changed — the next reader
  gets the conclusion with none of the reasoning, and the reasoning is the part
  that keeps going missing.

## Reference files

Read the one that matches what you are about to write:

- `references/api-routes.md` — before adding or changing anything under
  `src/app/api/**`: the three-step checklist in full, the one-route-per-operation
  rule, what belongs in `util.ts` vs `errors.ts`, and the `ApiErrorCode` set.
- `references/forms.md` — before adding or changing a form or a zod schema:
  the schema-location rule, the field components, and the date contract.
- `references/testing.md` — before writing a test or touching CI: the three
  suites, isolation, the two worktree hazards, and how to run them.
- `references/doc-corrections.md` — **read this before believing
  `docs/CONVENTIONS.md` or `docs/DESIGN.md` on any structural question.** It
  lists, sentence by sentence, what those documents assert that the code does
  not do.
