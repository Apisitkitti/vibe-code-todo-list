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

A form lives in a `components/form/` folder, either under
`src/components/form/` when shared, or under the route's own
`components/form/` when used by exactly one route:

```
components/form/
  schema.ts        # zod schemas + inferred types for this folder's forms
  index.ts         # barrel — the only public entry point
  SignInForm.tsx   # one file per form, PascalCase, name matches the export
  SignUpForm.tsx
```

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

### Other form rules

- `schema.ts` holds the zod schemas and their inferred types.
- `index.ts` re-exports the forms (and the schemas/types that callers need).
  Consumers import from `@/components/form`, never from a deep file path.
- Each form component is its own PascalCase file.

### Schema conventions

```ts
// components/form/schema.ts
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

## Mutation UX — applies to EVERY create, update and delete

Two things are mandatory around every mutation.

**Ruled by the team lead:**

- **Sign-up** gets a confirm modal — it creates an account, so the rule is
  applied literally there.
- **Sign-in does not.** It creates nothing and is undone by signing out, so a
  confirmation step would only add a click to the most-repeated action in the
  app. It submits straight through and still reports via toast.
- Toggling a todo complete/incomplete is the **one exception**: no confirm
  modal. It fires immediately and reports with a toast carrying an **Undo**
  action that flips it back. Ten checkboxes must not mean ten dialogs.
  The toast notification is still mandatory.

### 1. Confirm modal before the mutation runs

Every create, update and delete must open a confirmation modal first. The
mutation only fires after the user confirms.

Use HeroUI `AlertDialog` (verified sub-components:
`.Root .Trigger .Backdrop .Container .Dialog .Header .Heading .Icon .Body
.Footer .CloseTrigger`). Build one reusable
`src/components/ConfirmDialog.tsx` and use it everywhere — do not hand-roll
a separate dialog per screen.

Requirements:

- The confirm button for a delete is visually destructive; for create and
  update it is the normal primary action.
- Cancel must be the default focused action on destructive confirms, and
  `Escape` must close without mutating.
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

Exact strings come from the copy deck in `docs/DESIGN.md`. If a string is
missing there, add it to that file rather than improvising inline.

## HTTP

- Use **axios** for HTTP requests. Do not use `fetch` for application data.
- A shared axios instance lives at `src/lib/http.ts` with the base URL and
  interceptors configured once; services import that instance rather than
  calling `axios.get` directly.
- Server actions invoked directly from a client component do not need axios —
  axios is for actual HTTP endpoints (route handlers).
