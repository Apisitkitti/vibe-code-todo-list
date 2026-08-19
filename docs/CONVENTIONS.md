# Code conventions — mandatory

These are set by the team lead. They override any style you infer from
existing code or from your own habits.

## Naming

| Thing | Case | Example |
|---|---|---|
| `interface` | PascalCase | `interface TodoListProps` |
| `enum` | PascalCase (members PascalCase too) | `enum TodoPriority { Low, Medium, High }` |
| Constant | UPPER_SNAKE_CASE | `const TODO_ENDPOINT = "/api/todos"` |
| Component | PascalCase (file name matches) | `TodoItem.tsx` exports `TodoItem` |
| Route segment | kebab-case | `src/app/sign-in/page.tsx`, `/todo-list` |
| Function / variable | camelCase | `getTodoList` |

## Import order

Three groups, in this order, separated by exactly one blank line:

1. **React** — `react`, `react-dom`
2. **Libraries** — everything from `node_modules`: HeroUI, next, zod,
   react-hook-form, axios, dayjs…
3. **Ours** — `@/…` aliases first, then relative `./…` paths

```tsx
import { useEffect, useState } from "react";

import { Button, Card, toast } from "@heroui/react";
import { useRouter } from "next/navigation";

import { ConfirmDialog } from "@/components/ConfirmDialog";
import { getErrorMessage } from "@/lib/getErrorMessage";

import { TodoRow } from "./TodoRow";
```

Type-only imports sit in the group they belong to — a type from a library
goes in the library group, not in a fourth group of its own.

## Component body order

Inside a component, top to bottom:

1. **State** — `useState`, `useRef`, `useOverlayState`, and any other hook
   that holds state. All of it together, at the very top.
2. **Variables** — derived values, destructuring, constants computed from
   props or state.
3. **Functions** — handlers and local helpers.
4. **`useEffect`** — kept next to the early returns and the `return`, at the
   bottom of the body.

```tsx
export const TodoListScreen = ({ filters }: TodoListScreenProps) => {
  // 1. state
  const [todoList, setTodoList] = useState<TodoItemData[]>([]);
  const [isLoading, setIsLoading] = useState(true);

  // 2. variables
  const { status, priority } = filters;
  const hasTodos = todoList.length > 0;

  // 3. functions
  const reload = () => { … };
  const handleDelete = async () => { … };

  // 4. effects, sitting with the returns
  useEffect(() => { … }, [status, priority]);

  if (isLoading) return <TodoListSkeleton />;

  return ( … );
};
```

The point of putting effects last is that an effect is about *what happens
around the render*, so it reads next to the render rather than buried among
the handlers. Everything an effect calls is already defined above it, which
also keeps arrow consts (not hoisted) in a valid order.

## Arrow functions everywhere

**Every function in this app is an arrow function.** No `function` keyword
declarations anywhere in `src/` — not for components, not for route handlers,
not for helpers, not for default exports.

```ts
// yes
export const getTodoList = async (filters: TodoListFilters) => { … };

const TodoRow = ({ todo }: TodoRowProps) => { … };

const TodosPage = async ({ searchParams }: PageProps<"/todos">) => { … };
export default TodosPage;
```

```ts
// no
export function getTodoList() {}
export default async function TodosPage() {}
```

Default exports are a named `const` followed by `export default Name;`, so the
component keeps a real name in stack traces and React DevTools.

Note arrow consts are not hoisted. Define a helper above its first use in the
module rather than relying on hoisting the way a `function` declaration did.

## Folder layout

```
src/
  app/
    <route-in-kebab-case>/
      page.tsx
      components/          # components used ONLY by this route
        TodoFilters.tsx
  components/              # components shared across two or more routes
    AppHeader.tsx
  server/                  # ALL server actions live here, "use server"
    todo.action.ts
    auth.action.ts
  service/                 # client-facing wrappers that call server actions
    todo.service.ts
  lib/                     # framework plumbing: prisma, auth, session
```

Rules:

- A component used by more than one route goes in `src/components`.
- A component used by exactly one route goes in that route's own
  `components/` folder. Do not put single-use components in `src/components`.
- Every component file is PascalCase and exports a PascalCase component.

## Server actions — auth only

**Server actions are reserved for auth.** Nothing else uses them.

Everything else (todos, and any future domain) is driven from the client:
a client component calls a service, the service calls an HTTP route handler
with axios, and the route handler talks to Prisma.

```
client component  ->  src/service/*.service.ts  ->  axios  ->  src/app/api/**/route.ts  ->  prisma
```

- Any server action that does exist lives under `src/server/`, first line
  `"use server"`.
- Auth in practice already runs through better-auth's own handler at
  `src/app/api/auth/[...all]/route.ts` via `authClient`, so a separate auth
  action is only added if something genuinely needs one.

### "Runs on the client" does NOT mean the database moves to the browser

This is the part that is easy to get wrong, so it is spelled out:

- Prisma is **never** imported into a client component. Database access
  happens only inside route handlers under `src/app/api/**`.
- `DATABASE_URL` and `BETTER_AUTH_SECRET` are never referenced outside
  server-only code, and never end up in a client bundle.
- The client is untrusted. Moving the *call* to the client does not move the
  *trust boundary* — that boundary is now the route handler.

### Route handlers are the trust boundary

Every route handler under `src/app/api/**` must, in this order:

1. Resolve the session with `requireUser()` (or `getSession()` and return
   `401` when there is no user). Never take a user id from the request body,
   query string, or a header — only from the session.
2. Re-validate the request body with the same zod schema the form uses, and
   return `400` with field errors when it fails.
3. Scope every Prisma query by the session user's id, in the same query.
   Update and delete use `where: { id, userId }` — never fetch-then-check.
   A row belonging to someone else must return `404`, not that row.

A route handler that skips any of these three is a security defect, not a
style problem.

### Splitting an API folder

Each `src/app/api/<resource>/` folder keeps one route per operation, and the
shared code beside them in two files:

```
src/app/api/todos/
  route.ts               # GET (list), POST (create)
  [id]/route.ts          # PATCH (save fields), DELETE
  [id]/status/route.ts   # PATCH (toggle completion)
  util.ts                # row → response body, shared reads, body parsing
  errors.ts              # status responses, field-error mapping
```

- **One route per operation.** Changing a record's status is its own route,
  not a branch inside the update handler. When one handler serves two
  intents it has to guess from the body shape, and a body that half-matches
  gets half-applied — a `200` that looks like a save but silently dropped
  something. Each route also rejects the other's body and names the route
  that wants it.
- **`util.ts`** — the success side: turning a database row into the response
  body, the reads the handlers share, and reading the request body.
- **`errors.ts`** — the error side: `401` / `404` / `400` responses, their
  messages, and the zod-issue → field-error mapping.

There is no per-API model file. Response types are the canonical ones in
`src/lib/<resource>.ts`, which the client already uses — a second declaration
of the same record is only something to keep in sync.

Name the error file `errors.ts`, **not** `error.ts`. Anything called
`error.*` under `app/` is Next's error-boundary convention and the build
fails with "must be a Client Component".

### One error shape for the whole API

`src/lib/apiError.ts` is the single source of truth for error responses.
It owns the body shape, the status per code, and the default message per
code:

```ts
apiError(ApiErrorCode.Unauthorized);
apiError(ApiErrorCode.NotFound, { message: TODO_NOT_FOUND_MESSAGE });
apiError(ApiErrorCode.BadRequest, { message, fieldErrors });
```

```json
{ "code": "UNAUTHORIZED", "message": "Sign in again to continue." }
```

Rules:

- A route handler **never** calls `NextResponse.json` for an error and never
  writes a status code by hand. It picks an `ApiErrorCode`.
- A resource's `errors.ts` may override the *message* to give domain wording
  ("That todo no longer exists" rather than "That item no longer exists").
  It may never change the shape or the status.
- `fieldErrors` is omitted entirely when empty, so its presence always means
  a field-level validation failure.
- A new kind of error means a new `ApiErrorCode` in that one file — not a new
  ad-hoc body somewhere in a handler.

The client depends on this: `getErrorMessage` reads `message` and expects it
on every error response, whatever endpoint it came from.

## Services

- `src/service/` holds the layer the UI calls. A service function does one
  thing: **call the API and return the response.** Nothing else.
- Service functions are `async` and are consumed with `await`.
- Any value shared by more than one function inside a service file is
  declared once as a single UPPER_SNAKE_CASE constant at the top of that
  file and reused — no repeated literals scattered through the file.

### No try/catch in services

A service must not contain `try` / `catch`. It does not swallow errors, does
not translate them into a `{ success: false }` shape, and does not log them.
Errors propagate to the caller. Handling belongs in the UI (or whichever
caller can actually decide what to do about it) — that is the layer that
knows which toast to show and which field to mark invalid.

Keep services free of: retry logic, fallback values, response reshaping,
and validation. A service is a transport call and its return value.

```ts
// src/service/todo.service.ts
const TODO_ENDPOINT = "/todos";

export async function getTodoList(): Promise<TodoResponse[]> {
  const response = await http.get<TodoResponse[]>(TODO_ENDPOINT);
  return response.data;
}
```

```tsx
// caller — this is where try/catch lives
try {
  const todoList = await getTodoList();
  setTodoList(todoList);
} catch (error) {
  toast.danger(getErrorMessage(error));
}
```

Put one shared `getErrorMessage(error: unknown): string` helper in
`src/lib/` so every caller formats axios and server errors the same way.

## Forms — react-hook-form + zod

Installed and pinned by the lead: `react-hook-form` 7.85.0, `zod` 4.4.3,
`@hookform/resolvers` 5.8.0. Do not install them yourself.

Every form uses react-hook-form with a zod schema through `zodResolver`.
No hand-rolled `useState` per field, no ad-hoc validation.

### Folder shape

Forms live under the owning route's `components/form/`. There is no shared
`src/components/form/` directory — the shared thing is `src/components/ui/`,
the `Form*` field components below.

**Each form owns a folder inside `components/form/`, named after the form,
holding the form and everything only that form uses.** The one `index.ts` at
`components/form/` is the barrel, and it is the only public entry point:

```
components/form/
  index.ts                      # barrel — the only path consumers import
  QuickAddForm/
    QuickAddForm.tsx            # PascalCase, name matches the export
    schema.ts                   # only this form parses with it
  TodoForm/
    TodoForm.tsx
    fieldErrors.ts              # reads this form's 400 body
```

A form's folder gets an `index.ts` of its own only if something other than the
barrel imports from it. Nothing does today, so neither has one: the barrel is
the sole reader of those paths, and a second barrel in front of it would
re-export two names for one consumer while giving a name a second place to go
missing from. The outer barrel earns its place for the opposite reason — it is
what lets the rest of the app import from `./form` without knowing any of this
layout, so adding a file to a form changes no consumer.

Smaller routes still hold a single form each — `src/app/sign-in/components/form/`
and `src/app/sign-up/components/form/` are flat, with `SignInForm.tsx` and
`schema.ts` beside their `index.ts`. Give a form a folder when it has files of
its own to gather, not as ceremony.

### Shared form UI lives in `src/components/ui`

The reusable field building blocks are in `src/components/ui`, exported
through its own `index.ts` barrel:

```
src/components/ui/
  index.ts            # the only import path — `@/components/ui`
  FormTextField.tsx
  FormTextArea.tsx
  FormSelect.tsx
  FormDatePicker.tsx
```

Forms compose these rather than reaching for HeroUI primitives directly, so
field layout, description placement and error presentation stay identical
across every screen. A new field type gets a new `Form*` component here — it
is not hand-assembled inside a feature form.

### Dates

- Due dates use HeroUI's `DatePicker` with `Calendar` in its popover, not a
  native `<input type="date">`. `@internationalized/date` supplies `DateValue`
  and is a direct dependency.
- The wire format stays the `YYYY-MM-DD` string everywhere — schema, API and
  database. `FormDatePicker` is the only place that converts to and from
  `DateValue`, so the widget choice never leaks into the contract.
- **dayjs** does date parsing and formatting (`src/lib/date.ts`,
  `parseDueDate`). Parse with the strict flag so `2026-02-31` is rejected
  rather than rolled over. Do not hand-roll date maths with `Date.UTC`.

### Where a schema lives — `src/lib` vs beside the form

**A zod schema that server code parses with lives in `src/lib/<thing>.schema.ts`.
A schema only its own form uses lives in that form's folder.**

```
src/lib/todo.schema.ts                          ← the route handlers re-parse with it
form/QuickAddForm/schema.ts                     ← only the quick-add bar uses it
src/app/sign-in/components/form/schema.ts       ← better-auth owns the server side
```

The test is not "is it a schema" but **"does server code depend on it".**

`todoFormSchema` is in `src/lib` because the handlers under `src/app/api/todos`
re-parse every request body with the very same schema — that copy is the trusted
one. When it lived in `src/app/todos/components/form/`, the API imported its own
trust boundary out of a screen's presentation folder: the dependency arrow
pointing UI → API backwards, with a security-relevant module sitting three
directories inside a route where nobody looks for one. It was filed as a defect
before quick-add shipped and stayed unfixed for a quarter.

**ESLint now enforces the consequence: nothing under `src/app/api/**` may import
from `@/app/**`.** So this is not a preference — moving a server-parsed schema
back under `src/app/` fails the build, and it should.

`quickAddSchema` is the other side of the same rule. It validates that something
was typed into the bar, and nothing else; the bar parses its line into a todo
payload and posts *that*, so no handler ever sees a `{ text }` body. Nothing on
the server depends on it, so it lives beside the form it belongs to. Sign-in and
sign-up are the same case — better-auth owns their server side and no handler in
this repo re-parses them.

The form barrel re-exports both, so components import everything a form needs
from `./form` regardless of which side of the line a schema fell on. Server code
imports `@/lib/todo.schema` directly.

### Other form rules

- `index.ts` re-exports the forms (and the schemas/types that callers need).
  Consumers import from the route's `./form`, never from a deep file path.
- Each form component is its own PascalCase file, inside its own folder when it
  has neighbours.

### Schema conventions

```ts
// src/lib/todo.schema.ts — the API re-parses with it, so it is not in the form's folder
import { z } from "zod";

const TITLE_MAX_LENGTH = 200;

export const todoFormSchema = z.object({
  title: z.string().min(1, "Title is required").max(TITLE_MAX_LENGTH),
  note: z.string().max(2000).optional(),
  priority: z.enum(["low", "medium", "high"]),
});

export type TodoFormValues = z.infer<typeof todoFormSchema>;
```

- Types are **inferred** from the schema with `z.infer` — never declare a
  parallel interface that can drift from the schema.
- Limits are UPPER_SNAKE_CASE constants, declared once and reused.
- Validation messages come from the copy deck in `docs/DESIGN.md`.

### Wiring

```tsx
const form = useForm<TodoFormValues>({
  resolver: zodResolver(todoFormSchema),
  defaultValues: { title: "", priority: "medium" },
});
```

- `zodResolver` from `@hookform/resolvers/zod` supports zod 4 directly.
- HeroUI v3 inputs are react-aria based and controlled, so bind them with
  RHF's `Controller` (or `useController`) rather than spreading `register`
  onto a HeroUI component.
- Field errors render through the HeroUI error/description slots specified
  in `docs/DESIGN.md`, and every input keeps its `Label`.
- **The same zod schema is re-validated inside the server action.** Client
  validation is UX; the server action is the trust boundary and must not
  assume the client validated anything.

## Mutation UX — confirm what cannot be undone

**Confirm destructive and irreversible actions. Everything else fires
immediately and offers Undo.**

This replaces the earlier rule, which asked for a confirm modal on every
create, update and delete. That rule collected an exception every time it met
a real screen — sign-in, then the completion toggle, with two more queued —
and a rule with four exceptions is not a rule. What every exception had in
common was that the action was trivially reversible. So that is the rule now.

The result is an app that is *more* recoverable, not looser: a dialog asks you
to re-read what you just typed, while Undo actually puts things back.

| Action | Confirm? | Why |
|---|---|---|
| Delete a todo | **Yes** | Nothing restores it |
| Create a todo | No | The row is on screen; deleting it is one press |
| Edit a todo | No | Undo restores the previous values |
| Toggle complete | No | Undo flips it back |
| Sign in | No | Signing out undoes it |
| Sign up | No | Creates an account, but nothing is lost by it |

Every mutation still reports through a toast — that part was never the
problem and is not optional.

### 1. Confirm modal — destructive actions only

A destructive action opens a confirmation modal first, and only mutates after
the user confirms. A reversible one does not: it fires on submit and reports
with a toast carrying **Undo**.

Before adding a confirm to something new, answer one question: *if this is
wrong, can the user put it back without losing anything?* If yes, build the
Undo instead of the dialog.

Use HeroUI `AlertDialog` (verified sub-components:
`.Root .Trigger .Backdrop .Container .Dialog .Header .Heading .Icon .Body
.Footer .CloseTrigger`). Build one reusable
`src/components/ConfirmDialog.tsx` and use it everywhere — do not hand-roll
a separate dialog per screen.

Requirements:

- The confirm button is visually destructive, and Cancel is focused by
  default. `Escape` closes without mutating.
- The body text names the specific record, e.g. the todo title — never a
  bare "Are you sure?".
- While the mutation is in flight, the confirm button is disabled and shows
  a pending state so it cannot be double-submitted.

### 2. Notification after the mutation resolves

Every mutation reports its outcome with a toast.

- `Toast.Provider` is mounted once in the root layout.
- Success: `toast.success(...)`. Failure: `toast.danger(...)`.
- The message says what happened to what, e.g. `Todo "Buy milk" deleted`,
  not a generic "Success".
- A failed mutation must surface the server's error message, never fail
  silently.
- **A reversible mutation's success toast carries an Undo action.** Undo is
  a normal mutation: it goes through the same endpoint with the same
  authorization, never a privileged shortcut. If a mutation cannot offer a
  working Undo, that is the signal it needed a confirm dialog instead.
- **With one exception, and it is about what the Undo itself does.** An Undo
  that *destroys* a record is not a reversal, whatever the button says — it is
  a second unconfirmed destructive action, sitting in a stack of buttons that
  all read `Undo` and all look alike. A create's Undo was exactly that, so it
  is gone: `Todo “{title}” added` is a receipt with no action
  (`docs/DESIGN.md` §7.15, §6.8). The test is not "is this mutation
  reversible" but "does the reversal put something back". Where it does not,
  and the user has a plainer route to the same outcome — here, deleting the
  row they can see, behind the confirm dialog — the toast reports and stops.

Exact strings come from the copy deck in `docs/DESIGN.md`. If a string is
missing there, add it to that file rather than improvising inline.

## HTTP

- Use **axios** for HTTP requests. Do not use `fetch` for application data.
- A shared axios instance lives at `src/lib/http.ts` with the base URL and
  interceptors configured once; services import that instance rather than
  calling `axios.get` directly.
- Server actions invoked directly from a client component do not need axios —
  axios is for actual HTTP endpoints (route handlers).
