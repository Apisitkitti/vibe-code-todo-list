# Forms and schemas

Read before adding or changing a form, a field, or a zod schema.

## Where a schema lives — the rule that matters

**A schema a route handler re-parses lives in `src/lib/<thing>.schema.ts`.**
A schema only its own form uses lives in that form's folder.

```
src/lib/todo.schema.ts                                    ← route handlers re-parse with it
src/app/todos/components/form/QuickAddForm/schema.ts      ← only the quick-add bar uses it
src/app/sign-in/components/form/schema.ts                 ← only the sign-in form uses it
src/app/sign-up/components/form/schema.ts                 ← only the sign-up form uses it
```

The todo schema used to live in `src/app/todos/components/form/schema.ts`, which
meant `src/app/api/todos/route.ts` imported its trust boundary out of a screen's
presentation folder — the dependency arrow pointing UI → API backwards. That was
survivable while the form was the only producer of the payload and stopped being
survivable when the quick-add bar became a second one: "the form's schema" and
"the API's contract" were then two ideas sharing one file, three directories
inside a route, where nobody looks for a security-relevant module.

`quickAddSchema` is the same rule read the other way, and it is the case most
likely to be got wrong, because it sits in the *same route* as a schema that
went to `src/lib`. It validates one thing — that something was typed. The bar
then parses that line into a todo payload and posts *that*, re-using
`todoFormSchema` for the title's rules rather than restating them; no route
handler ever sees a `{ text }` body. Nothing on the server depends on it, so it
lives beside `QuickAddForm.tsx` where its only reader is.

Sign-in and sign-up are the same case: better-auth owns their server side, no
route handler in this repo re-parses them, so they stay route-local. The test is
not "is it a schema" but **"does server code depend on it".**

**ESLint enforces the consequence: nothing under `src/app/api/**` may import from
`@/app/**`.** So the split is not a matter of taste. Moving a server-parsed
schema back under `src/app/` fails lint, and the rule is there because the todo
schema *did* live under a screen's `components/` folder, was filed as a defect
before quick-add shipped, and stayed that way for a quarter. If a form's folder
looks incomplete without its schema, that discomfort is the rule working: the
schema is not the form's, it is the API's, and the form borrows it.

The form barrel re-exports both, so components import everything a form needs
from `./form` regardless of which side of the line a schema fell on. Server code
imports `@/lib/todo.schema` directly.

## Folder shape

**Each form owns a folder**, named after the form, holding the form component
and every file only that form uses. One barrel at `components/form/index.ts` is
the public entry point:

```
components/form/
  index.ts                 # barrel — the only public entry point
  QuickAddForm/
    QuickAddForm.tsx       # PascalCase, name matches the export
    schema.ts              # only this form parses with it (see above)
  TodoForm/
    TodoForm.tsx
    fieldErrors.ts         # reads this form's 400 body
```

Consumers import from the barrel, never from a deep file path — `QuickAddBar`,
`TodoFormModal` and `TodoListScreen` all import from `./form` and none of them
knows this layout exists. That is what the barrel is for, and it is why adding a
file to a form changes no consumer.

**The form folders have no barrels of their own.** `components/form/index.ts` is
their only reader, so an inner `index.ts` would re-export two or three names for
exactly one consumer, and give every name a second place to go missing from. Add
one when something other than the barrel needs to import from a form's folder —
not before.

A form that has no files of its own does not need a folder. `src/app/sign-in/`
and `src/app/sign-up/` each hold one form with one schema and are flat, and that
is right: the folder exists to gather a form's parts, not as ceremony.

## Field components

Forms compose `src/components/ui` and never reach for HeroUI primitives
directly:

```
src/components/ui/
  index.ts          # the only import path — `@/components/ui`
  FormTextField.tsx
  FormTextArea.tsx
  FormSelect.tsx
  FormDatePicker.tsx
```

The point is that field layout, description placement and error presentation
stay identical across every screen. A new field type gets a new `Form*`
component here; it is not hand-assembled inside a feature form.

## Wiring

```tsx
// Schema has `.default()` fields, so input and output types differ.
useForm<TodoFormInput, unknown, TodoFormValues>({ resolver: zodResolver(todoFormSchema), … });

// Schema has no defaults, so one type does for both.
useForm<QuickAddValues>({ resolver: zodResolver(quickAddSchema), … });
```

The three-generic form is not decoration. `note` and `dueAt` carry `.default("")`,
so `z.input` allows them absent while `z.output` guarantees them present — pass
one type for both and the resolver's input and output stop lining up.

- `zodResolver` from `@hookform/resolvers/zod` supports zod 4 directly.
- HeroUI v3 inputs are react-aria based and **controlled**, so bind them with
  `Controller` / `useController`. Spreading `register` onto one does not work.
- Every input keeps its `Label`. Field errors render through the HeroUI
  error/description slots.
- Server-reported field errors come back from a `400` body and are read with
  `readFieldErrors`, which matches them against the form's own field list.

## Schema conventions

```ts
export const todoFormSchema = z.object({
  title: z.string("Enter a title.").trim().min(1, "Enter a title.")
    .max(TITLE_MAX_LENGTH, tooLongMessage("title", TITLE_MAX_LENGTH)),
  …
});

export type TodoFormValues = z.infer<typeof todoFormSchema>;
```

- Types are **inferred** with `z.infer` — never a parallel interface that can
  drift from the schema.
- Limits are UPPER_SNAKE_CASE constants in `@/lib/todo`, so the schema, the
  input's `maxLength` and the database rules read the same number.
- **Give every `z.string()` its own message.** The form can only ever send a
  string, but the API is public: without one, a wrong type from a direct call
  renders zod's internal English under the field — "Invalid input: expected
  string, received number".
- Wrong-type and too-long are different mistakes and get different messages.
  Answering `{"note": 5}` with "keep the note under 2000 characters" describes a
  limit the caller never came near.
- Messages are built from the values they describe. A hard-coded "under 200
  characters" starts lying the moment the constant changes.
- Wording comes from the copy deck, `docs/DESIGN.md` §7.

## Dates

- Due dates use HeroUI's `DatePicker`, not `<input type="date">`.
- **The wire format is the `YYYY-MM-DD` string everywhere** — schema, API,
  database. `FormDatePicker` is the only place that converts to and from
  `@internationalized/date`'s `DateValue`, so the widget choice never leaks into
  the contract.
- dayjs does the date work, split across two modules — check which one you want:
  - **`src/lib/todo.ts`** → `parseDueDate`, `toDueDateInputValue`. Parsing the
    wire format, in **strict** mode so `2026-02-31` is rejected rather than
    rolled over.
  - **`src/lib/date.ts`** → `formatDueDate`, `dueDayOffset`. Turning a stored
    instant into what the user reads, and the UTC-day arithmetic the grouping
    sections cut on.

  (`docs/CONVENTIONS.md` places `parseDueDate` in `date.ts`. It is in `todo.ts`.)
  Do not hand-roll date maths with `Date.UTC`.
- `parseDueDate` returns `Date | null | "invalid"` — three distinct answers,
  because "not given" and "given and wrong" are different mistakes. Mirror that
  shape when you write a parser with the same problem; `readCreatedVia` does.
