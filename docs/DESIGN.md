# DESIGN.md — UX/UI specification

Audience: the developer building the screens. Every component, prop value,
token and string below was verified against the installed packages
(`@heroui/react@3.2.4`, `@heroui/styles`). **Do not substitute HeroUI v2 API.**

Everything is imported from the single barrel `@heroui/react`
(verified: `node_modules/@heroui/react/dist/index.d.ts` re-exports
`./components`, `./hooks`, `./utils/dom`, plus `tv`, `cn`, `VariantProps`).
There are no per-component import paths.

---

## 1. Design principles

- **Calm surface, loud content.** One accent colour only (`--accent`). Chrome is
  neutral; the only saturated pixels on `/todos` are the priority indicator and a
  single primary button. No gradients, no shadow stacking beyond the HeroUI
  defaults. *"A single primary button" is counted, not assumed:*
  `e2e/empty-state-accent.spec.ts` walks every element on the empty screen,
  resolves each painted background, and asserts that **exactly one** — the
  quick-add `Add`, by role and name — is `--accent`. Exactly one rather than at
  most one: zero would satisfy the rule while meaning the accent had left the
  screen.
- **Content-first density.** The todo list is the product. Header, filters and
  padding must never push the first todo row below the fold on a 375×667 phone.
- **Scannable in one pass.** Every row uses the same left-to-right rhythm:
  checkbox → title → priority → due date → actions. Nothing reflows between
  rows; a row with no due date leaves the slot empty rather than shifting.
- **Keyboard-first.** Every action reachable by Tab in visual order, every
  destructive action confirmable with Enter and cancellable with Escape. HeroUI
  v3 sits on react-aria-components, so focus management is free — do not
  override it with custom `onKeyDown` or `tabIndex`.
- **Optimistic and quiet.** State changes (toggle complete, delete) apply
  immediately and report failure via a toast, not a blocking dialog. Never show a
  spinner for an action that finishes in under 300 ms.

---

## 2. Design tokens

All colours come from `node_modules/@heroui/styles/dist/themes/default/variables.css`.
Reference them in Tailwind v4 arbitrary-value syntax, e.g.
`className="bg-[var(--surface)] text-[var(--muted)]"`.

### 2.1 Colour tokens to use

| Role | Variable | Notes |
|---|---|---|
| Page background | `--background` | Set on `<body>`. |
| Card / panel surface | `--surface` | Cards, the todo list container. |
| Nested / inset surface | `--surface-secondary` | Filter bar background. |
| Surface hover | `--surface-hover` | Todo row hover. |
| Primary text | `--foreground` | Default body text. |
| Text on a surface | `--surface-foreground` | Inside `Card`. |
| Muted / secondary text | `--muted` | Due dates, helper copy, empty-state body. |
| Border | `--border` | Card and input borders. |
| Softer border | `--border-secondary` | The todo row's outline (§4.4). Measured 1.71:1 light / 1.78:1 dark against `--surface`. |
| Divider line | `--separator` | Used by `Separator`. |
| Accent (brand) | `--accent` | Primary buttons, links, active filter. |
| Text on accent | `--accent-foreground` | |
| Accent tint | `--accent-soft` / `--accent-soft-foreground` | Selected filter chip. |
| Danger | `--danger` / `--danger-foreground` | Delete confirm button. |
| Danger tint | `--danger-soft` / `--danger-soft-foreground` | High-priority chip, error text. |
| Warning tint | `--warning-soft` / `--warning-soft-foreground` | Overdue date. **No longer the medium-priority chip**, which no longer exists at all — see §4.4. |
| Success tint | `--success-soft` / `--success-soft-foreground` | Completed-state affordances. |
| Neutral tint | `--default-soft` / `--default-soft-foreground` | Unused since §4.4 took the low/medium chips to `tertiary`, which has no fill. |
| Overlay (modal/menu) | `--overlay` / `--overlay-foreground` | Handled by HeroUI. |
| Backdrop | `--backdrop` | Handled by `Modal.Backdrop`. |
| Focus ring | `--focus` | Aliased to `--accent`. Do not restyle. |

Also available and already wired into HeroUI components — **do not redefine**:
`--radius` (`0.5rem`), `--field-radius` (`calc(var(--radius) * 1.5)`),
`--spacing` (`0.25rem`), `--border-width` (`1px`), `--ring-offset-width` (`2px`),
`--disabled-opacity` (`0.5`), `--surface-shadow`, `--overlay-shadow`,
`--field-shadow`.

### 2.2 Spacing scale

Tailwind v4 default scale, which is driven by the same `--spacing: 0.25rem`.
Use **only these steps** — no arbitrary pixel values:

| Purpose | Utility |
|---|---|
| Icon ↔ label gap | `gap-2` (8px) |
| Inside a form field group | `gap-1.5` (6px) |
| Between form fields | `gap-4` (16px) |
| Todo row internal padding | `px-4 py-3` |
| Card padding | HeroUI's built-in `Card.Content` padding; do not add your own |
| Between page sections | `gap-6` (24px) |
| Page vertical padding | `py-8` desktop, `py-6` mobile |

Page gutters: `px-4` mobile, `sm:px-6`, `lg:px-8`.
Content max width: `max-w-2xl mx-auto` for `/todos`; `max-w-sm` for auth cards.

### 2.3 Radius conventions

- Cards, modals, popovers: HeroUI default (`--radius`). Add nothing.
- Form fields: HeroUI default (`--field-radius`). Add nothing.
- Anything you hand-roll (the priority dot, an icon button wrapper):
  `rounded-[var(--radius)]`, or `rounded-full` for circular dots and avatars.
- **Never** write `rounded-lg`, `rounded-xl` etc. on a HeroUI component — it
  desynchronises from the theme.

### 2.4 Type scale

Use `Typography` rather than raw heading tags where possible
(verified: `node_modules/@heroui/react/dist/components/typography/typography.d.ts`).

- `Typography.Heading` accepts `level={1|2|3|4|5|6}`.
- `Typography.Paragraph` accepts `size={"base"|"sm"|"xs"}`.
- `Typography` (root) accepts `type` (`"body" | "body-sm" | "body-xs" | "code" | "h1"…"h6"`),
  `color` (`"default" | "muted"`), `weight` (`"normal" | "medium" | "semibold" | "bold"`),
  `align` (`"start" | "center" | "end" | "justify"`), `truncate` (boolean).

Assignments:

| Element | Component |
|---|---|
| Auth card title | `Card.Title` (renders `h3` by default) |
| `/todos` page title | `<Typography.Heading level={1}>` |
| Todo title | `<Typography type="body" weight="medium" truncate>` |
| Due date, counts, helper | `<Typography type="body-sm" color="muted">` |
| Empty-state body | `<Typography type="body-sm" color="muted">` |

---

## 3. Dark mode

- Toggling is **class-based**: the string `dark` on the `<html>` element.
  `src/app/globals.css` already declares
  `@custom-variant dark (&:where(.dark, .dark *));`, and
  `variables.css` scopes the dark palette to `.dark, [data-theme="dark"]`.
- Use the shipped hook **`useTheme`** from `@heroui/react`
  (verified: `node_modules/@heroui/react/dist/hooks/use-theme.d.ts`).
  It returns `{ theme, resolvedTheme, setTheme }`; `setTheme` accepts
  `"light"`, `"dark"`, or `"system"` (default). It applies the class to the DOM
  for you — do not write your own `classList.add("dark")`.
- `resolvedTheme` is `undefined` during SSR. The theme toggle button must render
  a stable, theme-neutral icon slot until `resolvedTheme` is defined, otherwise
  it hydration-mismatches. Guard with `useIsHydrated` or `useMounted` (both
  exported from `@heroui/react`, verified in `dist/hooks/index.d.ts`).
- **Hard rule: no hex, `rgb()`, `hsl()`, `oklch()` or Tailwind palette colour
  anywhere in application code.** No `bg-zinc-900`, no `text-gray-500`, no
  `#1e1e1e`. Every colour is `var(--token)` from §2.1. A `dark:` variant in a
  component is a code smell — the token already swaps. The only legitimate
  `dark:` uses are non-colour properties (e.g. `dark:shadow-none`).
- Do not add a second `:root` block or override HeroUI variables in
  `globals.css`. If a colour is missing, compose it with `color-mix` from an
  existing token, matching the pattern `variables.css` uses.

  **One exception, and the only one: a token whose shipped value fails a WCAG
  floor.** A contrast failure is not a palette preference, and it cannot be
  composed around — every consumer of the token is affected, so correcting it
  anywhere but the token means correcting it in a dozen places and missing the
  thirteenth. Such an override must:

  - **(a)** change only the failing channel, keeping HeroUI's hue and chroma;
  - **(b)** name the defect, the measured before/after, and the surfaces it was
    measured on, in a comment beside the value;
  - **(c)** be scoped to exactly the themes that were failing — guarded when
    one theme already passed, unguarded when neither did — and in **either**
    case the themes it does *not* correct must be measured too, and stated, so
    "left alone" is a finding rather than an assumption.

  Two instances today, one of each shape (`src/app/globals.css`):

  | Token | Defect | Themes failing | Scope |
  |---|---|---|---|
  | `--muted` | DEF-15 | light only (4.43:1; dark 7.72:1) | `:root:not(.dark):not([data-theme="dark"])` |
  | `--accent` | DEF-14 | both (3.59:1 in each) | bare `:root` |

  **Why the scopes differ, and why (c) is not boilerplate.** HeroUI scopes its
  dark palette to `.dark, [data-theme="dark"]`, which has the **same
  specificity** as a bare `:root` — so an unguarded `:root { --muted: … }`
  comes later in the cascade and silently overwrites the dark value as well.
  Measured, that mutation drops dark's muted text from 7.72:1 to 3.62:1.
  `--accent` needs no guard for the mirror-image reason: HeroUI's dark block
  never defines it, both themes read the one value, and both measured 3.59:1 —
  so guarding it to light would have fixed half the defect and left no trace of
  the other half.

  A token that fails in both themes is the case a "protect the passing theme"
  rule does not describe at all, which is why (c) is written as *scope to what
  is failing* rather than as *always guard*. Test both themes either way.

---

## 4. Screen inventory

### 4.0 Root layout additions

`src/app/layout.tsx` must gain, inside `<body>`:

```tsx
<Toast.Provider placement="bottom" />
```

`Toast.Provider` accepts `placement` (`"top" | "bottom"`), `gap`,
`maxVisibleToasts`, `width`, `scaleFactor`, `queue`
(verified: `dist/components/toast/index.d.ts`). Fire toasts imperatively with
`toast.success(msg)`, `toast.danger(msg)`, `toast.info(msg)`,
`toast.warning(msg)` — all verified on the same file. There is **no**
`useToast()` hook and **no** `addToast()` function in v3.

`<body>` classes: `min-h-full flex flex-col bg-[var(--background)] text-[var(--foreground)]`.

---

### 4.1 `/sign-in`

**Layout.** Single centred card, vertically centred in the viewport.

```
<main className="flex-1 grid place-items-center px-4 py-8">
  <Card className="w-full max-w-sm">
    <Card.Header>
      <Card.Title>Welcome back</Card.Title>
      <Card.Description>Sign in to see your todos.</Card.Description>
    </Card.Header>
    <Card.Content>
      <Form> … </Form>
    </Card.Content>
    <Card.Footer> … </Card.Footer>
  </Card>
</main>
```

**Components.**

- `Card` with `Card.Header`, `Card.Title`, `Card.Description`, `Card.Content`,
  `Card.Footer`. `Card` also accepts `variant`:
  `"default" | "secondary" | "tertiary" | "transparent"` — use the default.
- `Form` wraps the fields. It is the react-aria-components `Form`, so it accepts
  `validationErrors` (a `Record<string, string | string[]>`) for server-returned
  errors. Use that instead of rendering error strings yourself.
- Each field is a `TextField` group, in this exact composition:

```tsx
<TextField name="email" type="email" isRequired autoComplete="email" className="flex flex-col gap-1.5">
  <Label>Email</Label>
  <Input placeholder="you@example.com" />
  <FieldError />
</TextField>
```

  `TextField` accepts `variant={"primary" | "secondary"}` and `fullWidth`, plus
  all RAC TextField props (`name`, `type`, `value`, `defaultValue`, `onChange`,
  `isRequired`, `isInvalid`, `isDisabled`, `validationBehavior`).
  `Input` accepts `variant={"primary" | "secondary"}`, `fullWidth`, and all
  native input attributes.
- Password field: identical, `type="password"`, `autoComplete="current-password"`,
  no placeholder.
- Form-level error (bad credentials) renders **above** the fields as:

```tsx
<Alert status="danger">
  <Alert.Indicator />
  <Alert.Content>
    <Alert.Title>Sign in failed</Alert.Title>
    <Alert.Description>{message}</Alert.Description>
  </Alert.Content>
</Alert>
```

  `Alert` `status`: `"default" | "accent" | "success" | "warning" | "danger"`.
- Submit: `<Button type="submit" variant="primary" fullWidth isDisabled={isPending}>`.
  `Button` `variant`: `"primary" | "secondary" | "tertiary" | "ghost" | "outline" | "danger" | "danger-soft"`.
  `size`: `"sm" | "md" | "lg"`. Booleans: `fullWidth`, `isIconOnly`, `isDisabled`.
  While pending, the label is replaced by `<Spinner size="sm" color="current" />`
  plus the pending text — see the copy deck.
- Footer: `<Typography type="body-sm" color="muted">` containing a `Link`
  (`<Link href="/sign-up">`).

**Responsive.** Mobile (<640): card is `w-full max-w-sm`, page `px-4`.
Tablet (≥640) and desktop (≥1024): identical — the card never grows past
`max-w-sm`. Do not add a marketing column.

---

### 4.2 `/sign-up`

Identical structure to `/sign-in`. Differences only:

- Fields, in order: Name (`type="text"`, `autoComplete="name"`),
  Email, Password (`autoComplete="new-password"`).
- Password field carries a `Description` for the rule:

```tsx
<TextField name="password" type="password" isRequired autoComplete="new-password" className="flex flex-col gap-1.5">
  <Label>Password</Label>
  <Input />
  <Description>At least 8 characters.</Description>
  <FieldError />
</TextField>
```

  `Description` and `FieldError` are separate top-level components
  (verified: `dist/components/description/index.d.ts`,
  `dist/components/field-error/index.d.ts`). Both take only `children` and
  `className`. `FieldError` renders nothing when the field is valid.
- Footer link points to `/sign-in`.

---

### 4.3 `/todos`

**Page skeleton.**

```
<Header>                         ← app bar, full-bleed, sticky
<main className="flex-1 w-full max-w-2xl mx-auto px-4 sm:px-6 lg:px-8 py-6 lg:py-8 flex flex-col gap-6">
  ├─ Heading block (flex flex-col gap-1)   ← one statement, §7.19
  │    ├─ Page heading + count
  │    └─ Dated header line     ← US-12, §7.19; plain text, always present
  ├─ Quick-add bar              ← §7.17; always present, never gated on hasTodos
  ├─ Filter bar                 ← only once the account has todos
  └─ Card (the list, cut into urgency sections — §7.16)
</main>
```

*Amended three times while it was being worked in: the "Add-todo affordance" row
is the quick-add bar of §7.17, not the retired `New todo` button; the list
inside the Card is the sectioned list of §7.16 rather than one flat `<ul>`; and
the heading and the dated line are now one block rather than two of `main`'s
sections. The first two were already true in the code and this diagram had not
been told; the third is the change that made it true.*

**The heading block.** `Your todos` and `Wednesday, 20 August · 3 due today ·
1 overdue` are one statement — what this page is, and what day it is — and as
two direct children of `main` they sat `gap-6` apart, the same 24px as the
quick-add bar from the Card. Four peers, and nothing in the layout said which
belonged with which. `flex flex-col gap-1` wraps the pair; `main`'s `gap-6` then
separates the block from the bar, so §2.2's section rhythm is unchanged.

`src/lib/styles.ts` owns the class string as `PAGE_HEADING_BLOCK`, because
`loading.tsx` renders the same two elements and wrapping one without the other
moves the heading when the route settles — the swap shift §4.8 is about.
`error.tsx` renders neither a heading nor a dated line, so it takes no wrapper;
it shares `TODOS_PAGE_SHELL` with the other two, which is the part all three
actually have in common. Pinned in `e2e/list-header.spec.ts`, which measures
both gaps rather than one: a wrapper that pulled the block tight against the bar
as well would look closer in a screenshot and would have spent §2.2 to do it.

**App bar.** Use `Header` — note it is **not** compound: the exported `Header`
has no `.Root`, `.Title` etc. It is a single element that renders RAC's
`<header>` (verified: `dist/components/header/index.d.ts`, `header.d.ts`).

```tsx
<Header className="sticky top-0 z-20 border-b border-[var(--border)] bg-[var(--background)]/80 backdrop-blur">
  <div className="w-full max-w-2xl mx-auto px-4 sm:px-6 lg:px-8 h-14 flex items-center justify-between">
    <span className="font-semibold">Todos</span>
    <div className="flex items-center gap-2">
      {/* theme ToggleButton */}
      {/* user Dropdown */}
    </div>
  </div>
</Header>
```

**Theme toggle.** `<ToggleButton variant="ghost" isIconOnly size="sm" aria-label="Switch to dark theme">`.
`ToggleButton` `variant`: `"default" | "ghost"`; `size`: `"sm" | "md" | "lg"`;
`isIconOnly` boolean (verified: `dist/components/toggle-button/toggle-button.d.ts`).

**User menu.** `Dropdown`, whose real sub-components are
`Dropdown.Root`, `.Trigger`, `.Popover`, `.Menu`, `.Section`, `.Item`,
`.ItemIndicator`, `.SubmenuIndicator`, `.SubmenuTrigger`
(verified: `dist/components/dropdown/index.d.ts`).

```tsx
<Dropdown>
  {/* Dropdown.Trigger is the bare react-aria Button: it accepts neither
      `variant` nor `isIconOnly`. Style it with className instead. */}
  <Dropdown.Trigger aria-label="Account menu" className="inline-flex items-center justify-center rounded-[var(--radius)]">
    <Avatar size="sm">
      <Avatar.Fallback>{initials}</Avatar.Fallback>
    </Avatar>
  </Dropdown.Trigger>
  <Dropdown.Popover placement="bottom end">
    <Dropdown.Menu>
      <Dropdown.Section>
        <Dropdown.Item isDisabled>{user.email}</Dropdown.Item>
      </Dropdown.Section>
      <Dropdown.Item variant="danger" onAction={handleSignOut}>Sign out</Dropdown.Item>
    </Dropdown.Menu>
  </Dropdown.Popover>
</Dropdown>
```

`Dropdown.Item` `variant`: `"default" | "danger"` (verified:
`@heroui/styles/dist/components/menu-item/menu-item.styles.d.ts`).
`Avatar` sub-components: `.Root`, `.Image`, `.Fallback`;
`size`: `"sm" | "md" | "lg"`; `variant`: `"default" | "soft"`;
`color`: `"default" | "accent" | "success" | "warning" | "danger"`.

**Page heading row.**

```tsx
<div className="flex items-baseline justify-between gap-4">
  <Typography.Heading level={1}>Your todos</Typography.Heading>
  <Typography type="body-sm" color="muted">{n} of {total} done</Typography>
</div>
```

**Add-todo affordance — the quick-add bar.** *Amended for backlog #1; this
replaces the `New todo` button that used to sit here.* A persistent
single-line `TextField`/`Input` with a primary `Add` submit beside it, sitting
above the filter bar. Enter creates; the input clears and **keeps focus**, so
several todos can be entered in a row without touching the pointer. It is
always rendered — including while the list is empty, loading or filtered to
nothing — because a capture bar that comes and goes is not a capture bar.

```tsx
<Form id="quick-add-form" className="flex flex-col gap-2">
  <div className="flex flex-col gap-2 sm:flex-row sm:items-start">
    <div className="flex-1"><FormTextField … /></div>
    <Button type="submit" variant="primary" className="min-h-11 w-full sm:w-auto">Add</Button>
  </div>
  {/* parsed-token chips + `More options`, §7.17 */}
</Form>
```

Trailing **lowercase** words naming a day or a priority are lifted out of the
title and shown as `Chip`-styled buttons beneath the input before anything is
saved, and announced through a visually-hidden `role="status"` live region
beside them. Pressing one — or `Esc`, which does all of them at once — puts
its words back in the title. There is **no `New todo` button**: the modal
(§4.5) is reached from `More options`, which carries the typed text into it,
and from every row's Edit button.

A create through the bar **does not blank the list to a skeleton**. Nothing
closed over the list, the toast is already on screen saying what happened, and
under a filter that hides the new row the flash would return an identical
list — during burst capture it would fire on every Enter. The refetch still
happens, quietly, and the row arrives in its §2 place when the data lands. The
modal keeps its skeleton, because a dialog closing over an unchanged list is
the gap that argument was made about (§4.8, review m-8).

The chips are the reason this parse is allowed to exist at all. See §7.17.

**Filter bar.** Two controls in one row.

1. Status filter — `ToggleButtonGroup` (sub-components: `.Root`, `.Separator`;
   props `fullWidth`, `isDetached`, `isDisabled`, `orientation`, `size`, plus RAC
   `selectionMode` / `selectedKeys` / `onSelectionChange`), containing
   `ToggleButton` children keyed `all` / `active` / `completed`.
   Use `selectionMode="single"` and always keep exactly one selected.
2. Search — `SearchField`, sub-components `.Root`, `.Group`, `.Input`,
   `.SearchIcon`, `.ClearButton` (verified: `dist/components/search-field/index.d.ts`).

```tsx
<div className="flex flex-col sm:flex-row sm:items-center gap-3">
  <ToggleButtonGroup selectionMode="single" selectedKeys={[filter]} onSelectionChange={…} size="sm">
    <ToggleButton id="all">All</ToggleButton>
    <ToggleButton id="active">Active</ToggleButton>
    <ToggleButton id="completed">Completed</ToggleButton>
  </ToggleButtonGroup>
  <SearchField aria-label="Search todos" className="sm:ml-auto sm:max-w-64" value={q} onChange={setQ}>
    <SearchField.Group>
      <SearchField.SearchIcon />
      <SearchField.Input placeholder="Search todos" />
      <SearchField.ClearButton />
    </SearchField.Group>
  </SearchField>
</div>
```

**The list.** A single `Card` containing a `<ul>`; each todo is an `<li>` drawn
as an outlined pill, spaced by `gap-1.5` — **not** separated by `Separator`
components and **not** by `divide-y` (see §4.4 for why the outline moved onto
the row, and §8.7 for the measurements). One element per row is cheaper and
avoids a stray element in the a11y tree.

```tsx
<Card>
  <Card.Content className="p-0">
    <ul className="flex flex-col gap-1.5 p-2">
      {todos.map(t => <TodoRow key={t.id} todo={t} />)}
    </ul>
  </Card.Content>
</Card>
```

The `p-2` on the `<ul>` is what keeps the outermost pills off the Card's own
edge; without it the first and last row's outline sits on top of the Card
border.

**Responsive.**

| Breakpoint | Behaviour |
|---|---|
| Mobile <640 | Page gutter `px-4`. Add button full-width. Filter bar stacks: toggle group on row 1 (`fullWidth`), search on row 2. Todo row: two lines (see §4.4). Row actions always visible. |
| Tablet 640–1023 | Gutter `sm:px-6`. Add button shrinks to content width, left aligned. Filter bar becomes one row, search pushed right with `sm:ml-auto`. Todo row: single line. |
| Desktop ≥1024 | Gutter `lg:px-8`, `py-8`. Content still capped at `max-w-2xl` — do **not** widen. Row actions fade in on hover/focus-within (`opacity-0 group-hover:opacity-100 group-focus-within:opacity-100`), but remain in the tab order at all times. |

---

### 4.4 Todo item row

Fixed left-to-right order: **checkbox → title (+ note) → priority → due date →
reschedule → edit → delete.** Reschedule sits first in the actions cluster
because it belongs with the due date it changes, and Delete stays last because
it is the destructive one.

**Below 457px the actions cluster takes a line of its own** — which is every
phone width the app supports. See *Three targets and 320px* below: this is a
layout decision taken to keep three 44×44 targets, not a fallback.

**The row is an outlined pill.** `rounded-2xl border border-border-secondary
px-4 py-3.5`, with `hover:bg-surface-hover` as a hover *state* layered on top —
not as the boundary. The outline is what separates one row from the next; the
`gap-1.5` on the `<ul>` only keeps two outlines from touching. Both are needed:
drop the outline and the list has no boundary at all at rest, because the rows
and the Card behind them are the same `--surface`. §8.7 has the measurements and
the reasoning; the short version is that the outline is 1.71:1 light / 1.78:1
dark, and no surface token can beat 1.20:1.

```tsx
<li className="group flex items-start gap-3 rounded-2xl border border-border-secondary px-4 py-3.5 hover:bg-surface-hover">
  <Checkbox
    isSelected={todo.completed}
    onChange={onToggle}
    aria-label={`Mark "${todo.title}" as complete`}
    className="mt-0.5"
  >
    <Checkbox.Content>
      <Checkbox.Control>
        <Checkbox.Indicator />
      </Checkbox.Control>
    </Checkbox.Content>
  </Checkbox>

  <div className="min-w-0 flex-1 flex flex-col gap-1 sm:flex-row sm:items-center sm:gap-3">
    {/* `sm:min-w-0 sm:flex-1` is what reserves the metadata column — see below. */}
    <Typography type="body" weight="medium" truncate
      className={todo.completed ? "sm:min-w-0 sm:flex-1 line-through text-[var(--muted)]" : "sm:min-w-0 sm:flex-1"}>
      {todo.title}
    </Typography>
    <div className="flex items-center gap-2 shrink-0">
      {/* priority chip */}
      {/* due date */}
    </div>
  </div>

  <div className="flex items-center gap-1 shrink-0 lg:opacity-0 lg:group-hover:opacity-100 lg:group-focus-within:opacity-100 transition-opacity">
    {/* edit + delete icon buttons */}
  </div>
</li>
```

`Checkbox` sub-components are `.Root`, `.Content`, `.Control`, `.Indicator`
(verified: `dist/components/checkbox/index.d.ts`). `variant`:
`"primary" | "secondary"`. When the checkbox has no visible label you **must**
pass `aria-label`.

**Priority indicator.** A `Chip` — never colour alone (see §6).
`Chip` sub-components: `.Root`, `.Label`.
`color`: `"default" | "accent" | "success" | "warning" | "danger"`.
`variant`: `"primary" | "secondary" | "tertiary" | "soft"`.
`size`: `"sm" | "md" | "lg"`.

| `priority` | Chip props | Glyph prefix | Label |
|---|---|---|---|
| `high` | `color="danger" variant="soft" size="sm"` | `▲` | `High` |
| `medium` | *no chip* — `sr-only` `Priority: Medium` only | — | *(announced, not drawn)* |
| `low` | `color="default" variant="tertiary" size="sm"` | `▼` | `Low` |

```tsx
<Chip color="danger" variant="soft" size="sm">
  <Chip.Label><span aria-hidden="true" className="mr-1">▲</span>High</Chip.Label>
</Chip>
```

The glyph is decorative (`aria-hidden`); the word carries the meaning for
screen readers and for colour-blind sighted users alike.

**Only `High` is loud** (§8.4.2, taken). This table used to give all three
`variant="soft"`, and `medium` is the schema default, so a real list was a
column of near-identical warning-tinted chips with nothing for `High` to stand
out against. `low` and `medium` went to `tertiary`.

`medium` loses `color="warning"` along with the variant, and that is forced by
the CSS rather than chosen: `chip--tertiary` sets only
`--chip-bg: transparent` (`@heroui/styles/dist/components/chip.css`) while
`--chip-fg` still comes from the *colour* class, so
`variant="tertiary" color="warning"` is orange text with the fill taken away —
louder against a quiet row, not quieter. `default` is the pairing that makes
the chip recede.

**And then the default level loses the chip entirely — §8.4.2 finished.**
Taking `medium` to `tertiary` made it quiet; it did not stop it taking up room.
`medium` is not a level anyone chose, it is the level a todo has when nobody has
triaged it, and a twenty-row list still drew twenty chips of which most said
`■ Medium`. The chip was the **widest** element in the metadata cluster and what
it reported was an absence of information. Todoist's P4 is the reference and
makes the same argument: the default priority renders no flag, so only the
levels somebody actually set occupy a row.

`low` keeps `tertiary` rather than going with it, because a deliberate
down-rank *is* information — somebody looked at the todo and said it could wait.

**The trade, written down rather than left to be discovered.** Removing the chip
removes the word `Medium` and the `■` glyph from the screen, and §6.4 asks for
both. So the row keeps the accessible wording exactly as it was: the chip is
replaced by a `sr-only` `Priority: Medium`, byte-for-byte the accessible content
the chip published, and only the drawn chip goes.

That asymmetry is the decision, not a side effect of it. A sighted user infers
`Medium` from absence, exactly as a Todoist user infers P4 from an absent flag —
the information is still on screen, carried by the two levels that *do* draw. A
screen-reader user meets the row's metadata as a sequence of announcements and
cannot perceive absence the same way: a row that simply stopped mentioning
priority would be indistinguishable from a row whose priority failed to render.
The two audiences therefore get the same information through different carriers,
rather than the visual saving being taken out of the accessible tree.

`sr-only` is `position: absolute`, so it contributes no width and no `gap-2`
step to the cluster — the metadata column's right edge is unmoved, which is §1's
reflow promise and is measured in `e2e/row-layout.spec.ts` across rows with and
without a chip.

**§6.4 is amended rather than reinterpreted** — see the note there. It still
requires the word plus the shape glyph wherever a priority is *drawn*; it now
records that the default level is not drawn and is announced instead. No token
is overridden, so §3's exception is not engaged. Measured through the browser's
parser, label against the composited backdrop, for the levels that still draw:

| Level | Light, before → after | Dark, before → after |
|---|---|---|
| `high` | 5.49 : 1 → **5.49 : 1** (unchanged) | 5.51 : 1 → **5.51 : 1** (unchanged) |
| `medium` | 5.16 : 1 → **17.72 : 1** → *(no chip to measure)* | 9.21 : 1 → **17.27 : 1** → *(no chip to measure)* |
| `low` | 16.25 : 1 → **17.72 : 1** | 15.86 : 1 → **17.27 : 1** |

Contrast rose on both levels that moved to `tertiary`, because a tertiary chip's
label is `--default-foreground` on the row rather than a soft-tint foreground on
a soft fill. `medium` then stopped drawing, so it has no ratio of its own any
more — its row's accessible content is what is pinned instead.

`e2e/a11y-contrast.spec.ts` measures the two drawn levels in both themes,
asserts the fill on each of them, and asserts that `medium` renders no chip
while the row still carries `Priority: Medium`. A ratio alone would have passed
just as happily on the column of identical soft chips this change exists to
break up, and a chip-count alone would pass just as happily on a row that had
silently dropped the level altogether.

**Due date.** `<Typography type="body-sm" color="muted">` inside a `<time>`:

```tsx
<time dateTime={todo.dueAt.toISOString()}>
  <Typography type="body-sm" color="muted">{formatted}</Typography>
</time>
```

Format: `Today`, `Tomorrow`, `Yesterday`, otherwise `MMM d` (same year) or
`MMM d, yyyy`. **Overdue:** prefix with `⚠` (aria-hidden) and
use `className="text-[var(--warning-soft-foreground)]"` on the `Typography`,
plus a visually-hidden `Overdue —` before the date. If `dueAt` is null render
nothing — no "No due date" placeholder, which is noise.

**A completed row goes quiet: no priority chip and no due date** (§8.5, taken,
and widened from the chip to the date). `src/lib/todoGroups.ts` already argues
the date half — *"a completed todo is done, so its date has nothing left to
say"* — and the row rendered it anyway, so a finished task sat under
`Completed` announcing `Aug 12`. The priority goes for the same reason: once a
todo is done its level is history and it is competing for attention with the
active rows above it.

The overdue treatment therefore no longer needs a "and not completed" clause,
and `TodoDueDate` no longer takes a `completed` prop: a date that is not drawn
cannot be drawn as overdue, and keeping the prop would leave a second, weaker
answer to the same question in the code.

**Kept, deliberately:** the checkbox, the struck-through muted title, the `✎`
note marker (a note is still there to read) and both actions. §6.4 is
unaffected — completion is carried by `aria-checked` and `line-through`, never
by the chip or the date, so nothing that carried meaning was removed. Pinned in
`e2e/grouping.spec.ts`, which asserts the absences *and* every one of the
retentions.

**Actions.** Three icon-only buttons — reschedule, edit, delete. HeroUI ships
no pencil or trash icon
(the icon set is `IconChevronDown/Up/Left/Right`, `IconPlus`, `IconMinus`,
`IconSearch`, `IconCalendar`, `CloseIcon`, `InfoIcon`, `WarningIcon`,
`DangerIcon`, `SuccessIcon`, `CircleDashedIcon`, `ExternalLinkIcon` —
verified in `dist/components/icons.d.ts`). Use inline `<svg>` with
`stroke="currentColor"`, `width={16} height={16}`, `aria-hidden="true"`.

```tsx
<Button variant="ghost" size="sm" isIconOnly aria-label={`Reschedule "${todo.title}"`}>…</Button>
<Button variant="ghost" size="sm" isIconOnly aria-label={`Edit "${todo.title}"`} onPress={…}>…</Button>
<Button variant="ghost" size="sm" isIconOnly aria-label={`Delete "${todo.title}"`} onPress={…}>…</Button>
```

Wrap each in a `Tooltip` (`.Root`, `.Trigger`, `.Content`, `.Arrow`) on
`sm:` and up only; tooltips are useless on touch. The `aria-label` is the
accessible name regardless.

**The metadata column is reserved, at `sm:` and up.** The title carries
`sm:min-w-0 sm:flex-1`, so it takes the slack and the chip/date/note cluster is
pushed to a consistent right edge. Without it the title was sized by its own
content and the cluster hugged the end of each title, landing somewhere
different on every row — which is §1's *"Nothing reflows between rows; a row
with no due date leaves the slot empty rather than shifting"* not being
delivered by the code that quotes it.

`min-w-0` is not decoration alongside `flex-1`: without it the flex item
refuses to shrink below its content width and `truncate` never fires. The cost
is that long titles truncate sooner, which is the trade §1 already made.

`sm:` only. Below that the row is `flex-col`, where `flex-1` would stretch the
title down the row and there is no column to reserve.

Pinned in `e2e/row-layout.spec.ts`, which drives both viewport widths itself
rather than relying on the project's own: the claim is about a breakpoint, so a
test that sees one side of it checks half of it. It measures the cluster's
**right** edge — with the title taking the slack, that is the fixed edge, and a
row carrying less metadata is legitimately narrower on the left.

The cluster uses `gap-2`, not `gap-1`. §6.3 asks for ≥8px between adjacent
targets and this cluster shipped with 4px — survivable while it held two
controls, and the thing that makes a mis-tap likely once it holds three.

**Reschedule — the third action.** An icon-only `Button` opening a `Dropdown`,
so the most common single edit does not cost the modal (`docs/PM-PROPOSAL.md`
§3 #5, `docs/PRD.md` US-13). Five items in two sections:

| Item | Effect |
|---|---|
| `Today` | `dueAt` = the viewer's today |
| `Tomorrow` | the viewer's today + 1 day |
| `Next week` | the viewer's today + **7** days |
| `Pick a date…` | opens the existing edit modal (§4.5) — not a second picker |
| `Clear due date` | `dueAt` = `null`; **disabled** when the todo has no date |

The three quick days render their resolved date beside the label — `Next week`
`Aug 26` — so the reading is visible at the moment of the decision rather than
discoverable after it. §7.19 has the copy and §2 of `docs/PRD.md` has why
`Next week` is `+7` rather than "the start of next week".

Two implementation constraints, both learned the hard way on this branch:

- **The trigger is a plain `Button`, not `Dropdown.Trigger`.** `Dropdown.Trigger`
  is the bare react-aria `Button` with none of the `button--ghost` /
  `button--icon-only` styling, so it cannot match the two controls beside it
  without hand-rebuilding them. `Dropdown`'s root is react-aria's `MenuTrigger`,
  which publishes its trigger props through a `PressResponder` exactly as
  `Tooltip` does, so a `Button` anywhere beneath it registers — and nested
  `PressResponder`s merge, so the `Tooltip` in between is harmless and DEF-02's
  warning does not return.
- **The date preview must not be a `Typography`.** react-aria's `MenuItem`
  publishes a `TextContext` whose `label` slot carries the id its
  `aria-labelledby` points at, and `Typography` consumes it — so the preview
  became the item's *entire* accessible name and `Today` was announced as
  `Aug 19`. Use a plain `<span>`; the name is then the item's full text.

**Three targets and 320px — the decision.** Three 44×44 buttons, a 44×44
checkbox and a readable title do not fit on one line at 320px:
`32 (px-4) + 44 + 12 + 148 (3×44 + 2×gap-2) + 12 = 248`, leaving 72px for a
title, a priority chip and a date. Shrinking the targets was not available —
§6.3's 44×44 is a defect the team has already fixed once — and hiding an action
behind a "more" menu would demote Edit or Delete to pay for Reschedule.

So the row is `flex-wrap` and the content column carries `min-w-32`: the title
may be squeezed to 128px and no further, and flexbox breaks the line rather
than going below it. The actions cluster then takes a line of its own,
right-aligned by `ml-auto`, and the row is one line taller.

**Nothing in the CSS names a width**, and the threshold is a consequence of the
floors rather than a breakpoint to keep in step with this document:

```
surrounding padding = 32 (main px-4) + 32 (Card px-4) + 16 (list p-2) + 32 (row px-4)
                    = 112                     ← measured, not assumed
row content         = viewport − 112
needed              = 44 (checkbox) + 12 + 128 (title floor) + 12 + 148 (3×44 + 2×8)
                    = 344
```

so the line breaks below **457px** (`112 + 344 = 456`, and 456 wraps while 458
does not). Swept at 2px steps from 440 to 476, and at 320 / 360 / 390 / 412 /
480 / 560 / 639 / 640 / 768: no horizontal overflow at any width, and the title
never below 128px — at 458 it is exactly 128px, which is `min-w-32` binding as
designed.

**The `Card`'s own `px-4` is the term that is easy to miss** — `Card.Content`
is `p-0` here, which reads like the Card contributes nothing, but the padding
sits on the `.card` root. An earlier draft of this section omitted it and
published 424px, a number 33px wrong that no test could contradict because
both user-facing claims below it happened to survive. If this arithmetic is
edited, re-measure rather than re-derive.

**That means the actions wrap on every phone, and that is the outcome, not a
regression.** The alternative — a lower title floor, so a 412px phone keeps one
line — buys a shorter row by handing the title about 84px, roughly nine
characters before the ellipsis. A feature whose entire purpose is to stop due
dates going stale should not pay for itself by making the todo unreadable.
Above 640px the targets relax to 36px and the question does not arise.

Pinned by `e2e/reschedule.spec.ts`, which at a 320px viewport measures all
three targets, the gaps between them, `document.scrollWidth` against
`clientWidth`, and the rendered width of the title — because a layout that
fits by crushing the title to nothing is not a layout that fits.

**Responsive.** Mobile: the title and the priority/date cluster stack (`flex-col`),
the actions cluster wraps below them once the row is too narrow to hold it
(below 457px, so on every phone), always at full opacity. Tablet+: one line
(`sm:flex-row sm:items-center`), with the reserved column above and targets relaxed to 36px. Desktop: actions hidden
until hover/focus-within.

---

### 4.5 Create / edit todo — **modal**

**Decision: a modal, not an inline form.** Justification:

1. The form has four inputs (title, note, priority, due date). Inline, that
   either doubles the height of every row in edit mode — destroying the scan
   rhythm this design is built on — or requires a second inline surface for
   create that duplicates the edit layout.
2. Create and edit share one component. A modal gives one code path with a
   `mode` prop; inline create + inline edit is two layouts.
3. `Modal` is built on react-aria-components: focus trap, focus restore to the
   trigger, Escape to dismiss, and `aria-modal` come free. Reproducing focus
   restore on an inline editor is manual work with no user-visible gain.
4. On mobile the modal is placed at the bottom and takes full width, which reads
   as a sheet — the expected mobile pattern.

**Composition.** `Modal` sub-components (verified: `dist/components/modal/index.d.ts`):
`.Root`, `.Trigger`, `.Backdrop`, `.Container`, `.Dialog`, `.Header`, `.Icon`,
`.Heading`, `.Body`, `.Footer`, `.CloseTrigger`.

Control it with `useOverlayState()` from `@heroui/react`
(verified: `dist/hooks/use-overlay-state.d.ts`; returns
`{ isOpen, setOpen, open, close, toggle }`).
Do **not** use `Modal.Trigger` here — the same modal is opened from the page
button and from every row's edit button.

> **DEF-02, settled. There is no `Modal` root in this composition, and that
> follows from the `Modal.Trigger` rule above rather than contradicting it.**
>
> This section used to open the tree with `<Modal state={state}>` and hand the
> state to the root. `Modal`'s root *is* react-aria's `DialogTrigger`
> (`@heroui/react/dist/components/modal/modal.js` → `ModalRoot`), which wraps
> its children in a `PressResponder` unconditionally so that a `Modal.Trigger`
> beneath it can register as the pressable that opens the dialog. Since this
> modal correctly has no trigger, nothing ever registered, and the root logged
> `A PressResponder was rendered without a pressable child` once per mount —
> in every console log this project produced.
>
> The state goes on `Modal.Backdrop` instead. `Backdrop` is a `ModalOverlay`,
> which builds its own overlay state from `isOpen` / `onOpenChange` and
> publishes it as the `OverlayTriggerStateContext` that `Modal.Dialog`,
> `Escape`, the backdrop dismiss and `Modal.CloseTrigger`'s `slot="close"` all
> read — so this drops the trigger plumbing and nothing else. It also computes
> the full slot set itself rather than inheriting it from the root, so the
> styling is unchanged. `ConfirmDialog` (§4.6) reached the same conclusion for
> `AlertDialog` first; this is the same shape and the same fix.
>
> Pinned by `e2e/console-clean.spec.ts`, which fails on any console output.

```tsx
const state = useOverlayState();

<Modal.Backdrop variant="blur" isOpen={state.isOpen} onOpenChange={state.setOpen}>
  <Modal.Container size="md" placement="center" className="sm:placement-center">
    <Modal.Dialog>
      <Modal.Header>
        <Modal.Heading>{mode === "create" ? "New todo" : "Edit todo"}</Modal.Heading>
        <Modal.CloseTrigger aria-label="Close" />
      </Modal.Header>
      <Modal.Body>
        <Form id="todo-form" onSubmit={…} className="flex flex-col gap-4">
          …fields…
        </Form>
      </Modal.Body>
      <Modal.Footer>
        <Button variant="tertiary" onPress={state.close}>Cancel</Button>
        <Button type="submit" form="todo-form" variant="primary" isDisabled={isPending}>
          {mode === "create" ? "Add todo" : "Save changes"}
        </Button>
      </Modal.Footer>
    </Modal.Dialog>
  </Modal.Container>
</Modal.Backdrop>
```

`Modal.Backdrop` `variant`: `"blur" | "opaque" | "transparent"`; also
`isDismissable` (default `true`).
`Modal.Container` `size`: `"xs" | "sm" | "md" | "lg" | "full" | "cover"`;
`placement`: `"auto" | "top" | "center" | "bottom"`; plus `scroll`.

**Fields, in order.**

1. **Title** — required, autofocused.
   ```tsx
   <TextField name="title" isRequired autoFocus className="flex flex-col gap-1.5">
     <Label>Title</Label>
     <Input placeholder="What needs doing?" />
     <FieldError />
   </TextField>
   ```
2. **Note** — optional, multi-line. The export is **`TextArea`** (capital `A` —
   `Textarea` is not exported and fails the build). It is a **standalone input
   element** (props: `variant`, `fullWidth`, plus native textarea attrs —
   verified: `dist/components/textarea/index.d.ts`), so it composes inside
   `TextField` exactly where `Input` would go:
   ```tsx
   <TextField name="note" className="flex flex-col gap-1.5">
     <Label>Note</Label>
     <TextArea rows={3} placeholder="Optional details" />
   </TextField>
   ```
3. **Priority** — `Select`. Sub-components: `.Root`, `.Trigger`, `.Value`,
   `.Indicator`, `.Popover` (verified: `dist/components/select/index.d.ts`).
   Options are `ListBox` + `ListBox.Item` inside `Select.Popover`.
   `Select` `variant`: `"primary" | "secondary"`; also `fullWidth`, `items`,
   and RAC props `selectedKey` / `defaultSelectedKey` / `onSelectionChange`.
   ```tsx
   <Select name="priority" defaultSelectedKey={todo?.priority ?? "medium"} className="flex flex-col gap-1.5">
     <Label>Priority</Label>
     <Select.Trigger>
       <Select.Value />
       <Select.Indicator />
     </Select.Trigger>
     <Select.Popover>
       <ListBox>
         <ListBox.Item id="low">Low</ListBox.Item>
         <ListBox.Item id="medium">Medium</ListBox.Item>
         <ListBox.Item id="high">High</ListBox.Item>
       </ListBox>
     </Select.Popover>
   </Select>
   ```
   Keys must be exactly `low` / `medium` / `high` to match the Prisma
   `Priority` enum.
4. **Due date** — use a native date input inside a `TextField`:
   ```tsx
   <TextField name="dueAt" type="date" className="flex flex-col gap-1.5">
     <Label>Due date</Label>
     <Input />
     <Description>Optional.</Description>
   </TextField>
   ```
   **Why not `DatePicker`:** the component exists and is verified
   (`dist/components/date-picker/index.d.ts` → `.Root`, `.Trigger`,
   `.TriggerIndicator`, `.Popover`), but its value type is `DateValue` from
   `@internationalized/date`, which is only a transitive dependency (present at
   `node_modules/@internationalized/date@3.12.3`, **not** listed in
   `package.json`), and `DatePicker.Popover` requires a full `Calendar` subtree
   (`Calendar.Root/.Header/.Heading/.NavButton/.Grid/.GridHeader/.GridBody/
   .HeaderCell/.Cell/.CellIndicator` + year-picker parts). That is a large,
   fragile surface for one optional field. If the team later adds
   `@internationalized/date` as a direct dependency, upgrading this field to
   `DatePicker` is an isolated change.

**Responsive.** Mobile: `Modal.Container` gets `placement="bottom"` and
`size="full"` via a media-query-driven prop (use `useMediaQuery("(min-width: 640px)")`
from `@heroui/react`, verified in `dist/hooks/index.d.ts`); footer buttons stack
full width, primary on top. Tablet/desktop: `placement="center"`, `size="md"`,
footer buttons inline, right-aligned, Cancel then primary.

---

### 4.6 Delete confirmation

Use **`AlertDialog`**, not `Modal` — it is the semantically correct role for a
destructive confirmation and it is not dismissable by outside click by default
configuration you should set explicitly.

Sub-components (verified: `dist/components/alert-dialog/index.d.ts`):
`.Root`, `.Trigger`, `.Backdrop`, `.Container`, `.Dialog`, `.Header`,
`.Heading`, `.Body`, `.Footer`, `.Icon`, `.CloseTrigger`.
`AlertDialog.Icon` takes a `status` prop. `AlertDialog.Backdrop` takes
`isDismissable` and `isKeyboardDismissDisabled`.
`AlertDialog.Container` takes `placement` and `size`.

```tsx
<AlertDialog isOpen={!!pendingDelete} onOpenChange={…}>
  <AlertDialog.Backdrop isDismissable={false}>
    <AlertDialog.Container size="sm" placement="center">
      <AlertDialog.Dialog>
        <AlertDialog.Header>
          <AlertDialog.Icon status="danger" />
          <AlertDialog.Heading>Delete this todo?</AlertDialog.Heading>
        </AlertDialog.Header>
        <AlertDialog.Body>
          “{pendingDelete?.title}” will be permanently deleted. This can’t be undone.
        </AlertDialog.Body>
        <AlertDialog.Footer>
          <Button variant="tertiary" onPress={cancel}>Cancel</Button>
          <Button variant="danger" onPress={confirm} autoFocus>Delete</Button>
        </AlertDialog.Footer>
      </AlertDialog.Dialog>
    </AlertDialog.Container>
  </AlertDialog.Backdrop>
</AlertDialog>
```

Escape must still cancel (leave `isKeyboardDismissDisabled` unset). The
**Delete** button is `autoFocus` so Enter confirms; Cancel is first in DOM order
so Shift+Tab from Delete reaches it.

---

### 4.7 Empty state

`EmptyState` **is not compound.** The exported `EmptyState` has only `.Root`
and takes `children` + `className` — no `.Title`, `.Description`, `.Icon`,
`.Actions` (verified: `dist/components/empty-state/index.d.ts` and
`empty-state.d.ts`; `emptyStateVariants` has no variants at all). It is a bare
styled container. **Compose the inside yourself:**

```tsx
<EmptyState className="flex flex-col items-center text-center gap-3 py-12 px-6">
  <div aria-hidden="true" className="text-[var(--muted)]">{/* inline svg, 32px */}</div>
  <Typography type="h4" weight="semibold">Nothing here yet</Typography>
  <Typography type="body-sm" color="muted">Add your first todo and it will show up here.</Typography>
  <Button variant="primary" size="sm" onPress={createModal.open}>New todo</Button>
</EmptyState>
```

Render it **inside** the list `Card` (replacing the `<ul>`), so the page layout
does not jump when the first todo is added.

**The action is `variant="secondary"`, not `primary`** — §1 allows the empty
`/todos` screen *one* primary button, and it shipped with two about 150px apart:
the quick-add `Add`, and this one, whose entire job is to move focus to that
one. The button that performs the capture keeps the accent; the button that
points at it does not. The snippet above still shows `primary` because it is the
§4.7 sketch of the component; this paragraph is the specification.

`secondary` rather than `tertiary`, **and the reason first given for that was
wrong.** The case made was that a fill-less button becomes a text link wearing
button spacing — true of `ghost` and `outline`, and measurably not true of
`tertiary`: `button--secondary` and `button--tertiary` both set
`--button-bg: var(--default)` and paint the identical fill. What separates them
is `--button-fg`; `secondary` takes `--accent-soft-foreground`, so its label is
accent-tinted and reads as the call to action. The conclusion stands on the
corrected reason.

Measured through the browser's parser, on the empty screen, both themes:

| | Light | Dark |
|---|---|---|
| Action label, on its own composited fill | 6.25:1 | 5.05:1 |
| Action fill vs the Card | 1.19:1 | 1.19:1 |
| Quick-add `Add` fill vs the page (unchanged) | 4.37:1 | 4.25:1 |
| Elements painting `--accent` | 2 → **1** | 2 → **1** |

**The 1.19:1 is stated rather than buried, and it is not a regression this
change introduced.** SC 1.4.11's 3:1 covers the visual information required to
*identify* a component, and this button is identified by the words
`Add a todo` at 6.25:1 / 5.05:1. No variant in this design system except the
ones carrying `--accent` or `--danger` clears 3:1 against a surface —
`More options` measures 1.09:1 light / 1.36:1 dark and always has — so a
blanket boundary floor here would condemn every `Try again`, `Cancel` and
parsed chip the app ships. What `e2e/empty-state-accent.spec.ts` pins instead is
that the fill **resolves and is distinct from the surface**, which is the
property that separates a button from a text link and is the one this decision
actually turns on; a `ghost` variant reads 1.00 there and fails.

Three distinct empty states — do not reuse one string for all:

| Condition | Heading | Body | Action |
|---|---|---|---|
| No todos at all | `Nothing here yet` | `Add your first todo and it will show up here.` | `New todo` button |
| Filter `active`, none active | `All caught up` | `You have no active todos. Nice.` | none |
| Filter `completed`, none completed | `Nothing completed yet` | `Todos you finish will appear here.` | none |
| Search returns nothing | `No matches` | `No todos match “{query}”.` | `Clear search` (`variant="tertiary" size="sm"`) |

---

### 4.8 Loading states

**Initial list load — skeleton, not a spinner.** `Skeleton` has only `.Root`
and takes `animationType`: `"shimmer" | "pulse" | "none"` (default from
`--skeleton-animation`, which is `shimmer`).

```tsx
<ul className="flex flex-col gap-1.5 p-2" aria-busy="true" aria-label="Loading todos">
  {Array.from({ length: 4 }).map((_, i) => (
    <li key={i} className="flex items-center gap-3 rounded-2xl border border-border-secondary px-4 py-3.5">
      <Skeleton className="size-5 rounded-[var(--radius)]" />
      <Skeleton className="h-4 flex-1 rounded-[var(--radius)]" />
      <Skeleton className="h-5 w-16 rounded-[var(--radius)]" />
    </li>
  ))}
</ul>
```

Match the skeleton row geometry to the real row (`px-4 py-3.5`, `gap-3`, and
the 1px outline) so nothing shifts on swap. The border counts: leaving it off
the skeleton moves every row by 2px when the real list arrives.

**In-button pending.** `Spinner` — only `.Root`; `size`:
`"sm" | "md" | "lg" | "xl"`; `color`: `"current" | "accent" | "success" | "warning" | "danger"`.
Inside a button always use `color="current"` so it inherits the button
foreground. Keep the button width stable: render
`<Spinner size="sm" color="current" />` plus the pending label, and set
`isDisabled` rather than swapping the element.

**Row-level pending** (delete only): apply `pointer-events-none` to the `<li>`.
No spinner, and **no `opacity-60` on the row in any state**.

> **MI-6 — settled. §8.3.2 is the design; this paragraph was the half that was
> wrong, and it is corrected here.**
>
> This section used to say `opacity-60 pointer-events-none` on *both* the
> toggle and the delete, while §8.3.2 said the treatment should apply to the
> delete alone. §8.3.2 wins, for the reason it gave — a toggle is optimistic,
> so the row already shows its outcome and dimming it is visible latency for
> its own sake.
>
> The measurement then went further than either paragraph did, so the dimming
> is gone entirely rather than merely narrowed. `opacity` is a **group**
> multiplier: it dims the row's own paint *and every descendant's*, the title
> included. A completing row carries `text-muted line-through` from the moment
> of the press, so the dim landed on the muted token and the title measured
> **2.32:1** — below even the 3:1 large-text floor, on 16px text, for the
> length of the round trip (QA §A4). Deleting an *already-completed* row
> reaches the identical 2.32:1 by the identical route, so keeping the dim for
> the delete alone would not have been enough: it is the group opacity that is
> the defect, not which mutation raised it.
>
> Nothing is lost. The row still announces itself with `aria-busy`, and its
> controls still read as unavailable because they are genuinely disabled and
> HeroUI dims a disabled control itself through `--disabled-opacity`. SC 1.4.11
> exempts an inactive component from its contrast floor; a dimmed *title* has
> no such exemption. Measured after the change: **4.83:1 light / 6.75:1 dark**,
> the token's ordinary value on the Card.
>
> Pinned by `e2e/a11y-contrast.spec.ts`, which measures both mutation paths in
> both themes.

**Route transitions.** `/todos` gets a `loading.tsx` rendering the same header
plus the skeleton list.

### 4.9 Error states

Three tiers, and each error belongs to exactly one:

1. **Field validation** → `FieldError` inside its `TextField`. Prefer feeding
   server errors through `Form`'s `validationErrors` prop so react-aria wires
   `aria-describedby` and `aria-invalid` for you.
2. **Form/page-scoped failure** (bad credentials, list failed to load) → `Alert`
   with `status="danger"`, rendered in the flow above the content, inside a
   container with `role="alert"` semantics already provided by HeroUI's Alert.
   For a failed list load, render the Alert in place of the `<ul>` with a
   `Try again` button (`variant="secondary" size="sm"`).
3. **Transient action failure** (toggle/delete/save failed) → `toast.danger(msg)`.
   Never a dialog; the user's action already reverted visually.

An unexpected exception is caught by an `error.tsx` boundary showing the
page-scoped Alert plus `Try again` (calls `reset()`).

---

### 4.10 Toast actions — the first moments are dead

**Constraint, not a bug we introduced.** Design in-toast affordances around it.

HeroUI runs *every* toast queue update — each add and each close — inside
`document.startViewTransition` (`dist/components/toast/toast-queue.js`, the
default `wrapUpdate`). While a view transition is running, the browser paints
the `::view-transition` snapshot layer over the page, and **that layer takes the
hit-testing**. The real toast underneath is mounted, painted and focusable, but
a pointer press lands on the snapshot and never reaches the button.

So for roughly the **first 350–400ms of a toast's life its action button is
visible and completely inert.** The 350ms is the slide animation in
`styles/dist/components/toast.css`; the rest is frame overhead.

Three things follow, and each of them is a design constraint:

- **It is pointer-only.** Keyboard activation does not hit-test, so a user who
  tabs to Undo and presses Enter is unaffected. The failure is invisible to
  keyboard testing and to unit tests that call `onPress` directly — it only
  reproduces with a real pointer inside the window.
- **A repeat write to the same todo doubles the window.** We dismiss a row's
  outstanding Undo before raising the new one, and the queue *serialises*
  transitions in a promise chain — one at a time, by design, because the View
  Transitions API aborts a transition that starts while another is live. The
  close animates, then the add animates, so the second toast's Undo is dead for
  roughly twice as long.
- **The dead window has no visual tell.** The button looks armed the whole
  time. A user who presses immediately gets nothing, and the only feedback
  available to them is pressing again.

**What this means for design.** Do not put a *time-critical* action in a toast
and expect the first press to land — the affordance the user reaches for
fastest is the one most likely to be swallowed. Our Undo survives this only
because its timeout is generous relative to the dead window; a short-lived toast
with an action would be substantially worse. If a future affordance needs to be
live on the first frame, the escape hatch is a `ToastQueue` constructed with an
explicit `wrapUpdate: fn => fn()` (the option is public), which trades the slide
animation for a correct hit target. **That trade is worth making the moment an
action matters more than the animation** — and I would take it now if the Undo
timeout were ever shortened.

Related, and the same shape of problem: `toast.close()` does not unmount
immediately for the same reason, which is why `TodoListScreen` guards
double-presses on the *key* rather than on the toast's presence.

---

### 4.11 `/todos` — board view

The same todos as §4.3, laid out as five columns instead of five stacked
sections (`docs/PRD.md` US-14). Chosen with a `ToggleButtonGroup` above the
list, matching the status filter beside it, and remembered in the URL as
`view=board`.

| Part | Treatment |
|---|---|
| Container | `max-w-7xl` instead of §2.2's `max-w-2xl`, and only for this view — five columns inside 672px would be 130px each |
| Grid | `grid-cols-5`, equal columns, `gap-2`, `items-start` |
| Column | `<section>` with an `<h2>` and its own `<ul>` — the same structure §7.16 gives the list's sections, so switching views does not reshape the heading tree |
| Column heading | The §7.16 heading and its `aria-hidden` count, at `--foreground`. **No colour, no fill, no per-column accent** — the columns are structure, and §3's one-saturated-element budget is not spent on decoration |
| Empty column | One muted line (§7.20), never hidden — an empty column is a drop target |
| Card | `TodoCard`: checkbox and title on the first line, chip / date / note marker and the three actions on the second. `rounded-2xl border border-border-secondary`, the row's own §8.7 outline |
| Card title | Wraps to at most three lines, where the row truncates. A row truncates because it is scanned against its neighbours down a shared right edge (§1); a card has no such column to keep |
| Card actions | Always visible, where the row hides them until hover at `lg:`. A card is a discrete object with room around it |
| Drag affordance | The carried card and the column that would take it are outlined `--accent` with an 8–12% tint. Both are **transient** — present only while a drag is in progress — and the moved card's settle ring lasts 2.5s. Nothing on this screen is accent-tinted at rest |
| Loading | Five skeleton columns, two card outlines each (§4.8) |
| Empty account / filter | The §4.7 empty state, not five empty columns — five columns saying "nothing" say nothing, and would push the call to action off the bottom |
| Error | One §4.9 alert above the columns. One `GET` backs all five, so five identical alerts would be five lies about five failures |

**On the accent budget.** §3 allows one saturated element at rest, and `/todos`
is already over it (§8.4). This view adds nothing at rest: the column headings
inherit §7.16's `--foreground` weight-plus-count treatment exactly, the cards
carry the same `--border-secondary` outline the rows do, and every accent use
above appears only while the user is holding a card or for a moment after they
let go. The view toggle is a second `ToggleButtonGroup` beside the status
filter — the same control with the same selected treatment, not a new one — and
it is gated on `hasTodos`, so it never appears on the empty screen where the
existing over-spend lives.

**This view requires `(min-width: 1024px) and (pointer: fine)`; anything else
renders the list.** Five columns do not fit below `lg`, and HTML5 drag does not
fire from touch at all — so both halves are in the query, not just the width. A
tablet in landscape clears the width and fails the pointer, and used to be
handed a board whose cards could not be dragged: pulling one scrolled the page,
nothing happened, and nothing said why. The primary pointer is what is asked
about rather than `any-pointer`, which is true of a stylus in a drawer.

The fallback is the same five groups stacked, with the same reschedule menu,
which is the whole of the board's write vocabulary. The toggle is hidden there rather than shown inert: a control
reporting `Board` while the list is on screen is a control lying about the state
it shows. The URL keeps `view=board`, so widening the window restores it.

---

## 5. Component usage table

Import path is `@heroui/react` for every row (single barrel, verified at
`node_modules/@heroui/react/dist/index.d.ts`). All `.d.ts` paths below are
relative to `node_modules/@heroui/react/dist/components/`.

| Screen | HeroUI component | Import path | Verified |
|---|---|---|---|
| sign-in, sign-up, todos | `Button` (`.Root`) | `@heroui/react` | yes — `button/index.d.ts`, `button/button.d.ts` |
| sign-in, sign-up, todos | `Card` (`.Root .Header .Title .Description .Content .Footer`) | `@heroui/react` | yes — `card/index.d.ts`, `card/card.d.ts` |
| sign-in, sign-up, modal | `Form` (`.Root`) | `@heroui/react` | yes — `form/index.d.ts`, `form/form.d.ts` |
| sign-in, sign-up, modal | `TextField` (`.Root`) | `@heroui/react` | yes — `textfield/index.d.ts`, `textfield/textfield.d.ts` |
| sign-in, sign-up, modal | `Input` (`.Root`) | `@heroui/react` | yes — `input/index.d.ts`, `input/input.d.ts` |
| sign-in, sign-up, modal | `Label` (`.Root`) | `@heroui/react` | yes — `label/index.d.ts` |
| sign-in, sign-up, modal | `Description` (`.Root`) | `@heroui/react` | yes — `description/index.d.ts` |
| sign-in, sign-up, modal | `FieldError` (`.Root`) | `@heroui/react` | yes — `field-error/index.d.ts` |
| sign-in, sign-up, todos | `Alert` (`.Root .Indicator .Content .Title .Description`) | `@heroui/react` | yes — `alert/index.d.ts`, `alert/alert.d.ts` |
| sign-in, sign-up | `Link` (`.Root .Icon`) | `@heroui/react` | yes — `link/index.d.ts`, `link/link.d.ts` |
| all | `Typography` (`.Root .Heading .Paragraph .Code .Prose`) | `@heroui/react` | yes — `typography/index.d.ts`, `typography/typography.d.ts` |
| todos header | `Header` (no sub-components) | `@heroui/react` | yes — `header/index.d.ts`, `header/header.d.ts` |
| todos header | `Dropdown` (`.Root .Trigger .Popover .Menu .Section .Item .ItemIndicator .SubmenuTrigger .SubmenuIndicator`) | `@heroui/react` | yes — `dropdown/index.d.ts`, `dropdown/dropdown.d.ts` |
| todos header | `Avatar` (`.Root .Image .Fallback`) | `@heroui/react` | yes — `avatar/index.d.ts`, `avatar/avatar.d.ts` |
| todos header | `ToggleButton` (`.Root`) | `@heroui/react` | yes — `toggle-button/index.d.ts`, `toggle-button/toggle-button.d.ts` |
| todos filters | `ToggleButtonGroup` (`.Root .Separator`) | `@heroui/react` | yes — `toggle-button-group/index.d.ts`, `toggle-button-group/toggle-button-group.d.ts` |
| todos filters | `SearchField` (`.Root .Group .Input .SearchIcon .ClearButton`) | `@heroui/react` | yes — `search-field/index.d.ts`, `search-field/search-field.d.ts` |
| todo row | `Checkbox` (`.Root .Content .Control .Indicator`) | `@heroui/react` | yes — `checkbox/index.d.ts`, `checkbox/checkbox.d.ts` |
| todo row | `Chip` (`.Root .Label`) | `@heroui/react` | yes — `chip/index.d.ts`, `chip/chip.d.ts` |
| todo row | `Tooltip` (`.Root .Trigger .Content .Arrow`) | `@heroui/react` | yes — `tooltip/index.d.ts` |
| todo row | `Dropdown` (`.Root .Trigger .Popover .Menu .Section .Item`) — the reschedule menu, §4.4 | `@heroui/react` | yes — `dropdown/index.d.ts`, `dropdown/dropdown.d.ts` |
| create/edit | `Modal` (`.Root .Trigger .Backdrop .Container .Dialog .Header .Icon .Heading .Body .Footer .CloseTrigger`) | `@heroui/react` | yes — `modal/index.d.ts`, `modal/modal.d.ts` |
| create/edit | `TextArea` (`.Root`) | `@heroui/react` | yes — `textarea/index.d.ts`, `textarea/textarea.d.ts` |
| create/edit | `Select` (`.Root .Trigger .Value .Indicator .Popover`) | `@heroui/react` | yes — `select/index.d.ts`, `select/select.d.ts` |
| create/edit | `ListBox` (`.Root`) + `ListBox.Item` | `@heroui/react` | yes — `list-box/index.d.ts`, `list-box-item/index.d.ts` |
| delete | `AlertDialog` (`.Root .Trigger .Backdrop .Container .Dialog .Header .Heading .Body .Footer .Icon .CloseTrigger`) | `@heroui/react` | yes — `alert-dialog/index.d.ts` |
| empty | `EmptyState` (`.Root` **only**) | `@heroui/react` | yes — `empty-state/index.d.ts`, `empty-state/empty-state.d.ts` |
| loading | `Skeleton` (`.Root`) | `@heroui/react` | yes — `skeleton/index.d.ts`, `skeleton/skeleton.d.ts` |
| loading | `Spinner` (`.Root`) | `@heroui/react` | yes — `spinner/index.d.ts`, `spinner/spinner.d.ts` |
| errors, feedback | `Toast` (`.Provider .Content .Indicator .Title .Description .ActionButton .CloseButton .Queue .toast`) + `toast` | `@heroui/react` | yes — `toast/index.d.ts` |
| modal close | `CloseButton` (`.Root`) | `@heroui/react` | yes — `close-button/index.d.ts` |
| dividers (if needed) | `Separator` (`.Root`) | `@heroui/react` | yes — `separator/index.d.ts`, `separator/separator.d.ts` |
| icons | `IconPlus`, `IconSearch`, `IconCalendar`, `IconChevronDown/Up/Left/Right`, `IconMinus`, `CloseIcon`, `InfoIcon`, `WarningIcon`, `DangerIcon`, `SuccessIcon`, `CircleDashedIcon`, `ExternalLinkIcon` | `@heroui/react` | yes — `components/icons.d.ts`, re-exported by `components/index.d.ts:83` |
| hooks | `useTheme`, `useOverlayState`, `useMediaQuery`, `useIsHydrated`, `useMounted` | `@heroui/react` | yes — `dist/hooks/index.d.ts` and the matching `use-*.d.ts` |

**Verified to exist but deliberately NOT used in v1:**
`DatePicker` + `Calendar` (reason in §4.5), `Tabs`, `RadioGroup`/`Radio`,
`CheckboxGroup`, `Surface`, `Drawer`, `Table`, `Pagination`, `Popover`,
`Accordion`, `Disclosure`, `Badge`, `Meter`, `ProgressBar`, `ProgressCircle`,
`Kbd`, `Toolbar`, `ScrollShadow`, `InputGroup`, `Fieldset`, `Menu`,
`Breadcrumbs`, `Autocomplete`, `ComboBox`, `Tag`/`TagGroup`, `Switch`,
`Slider`, `NumberField`, `InputOTP`, `TimeField`.
Do not introduce them without updating this document.

---

## 6. Accessibility rules

1. **Focus visibility.** HeroUI's `--focus` ring (2px offset via
   `--ring-offset-width`) is applied by every interactive component. Never write
   `outline-none`, `focus:outline-none`, or `focus-visible:ring-0`. If a wrapper
   needs a focus style, use `focus-within:` and the `--focus` token.
2. **Every input has a `Label`.** No exceptions. Where a visible label would be
   redundant — the row checkbox, the search field, icon-only buttons — supply
   `aria-label` instead, and make it specific:
   `aria-label={`Delete "${todo.title}"`}`, not `aria-label="Delete"`.
   Placeholders are never labels.
3. **Minimum touch target 44×44 px.** `Button size="sm"` is smaller than that.
   For the row's icon-only edit/delete buttons and the checkbox, add
   `className="min-h-11 min-w-11"` (44px) on mobile and allow it to relax to
   `sm:min-h-9 sm:min-w-9` on pointer devices. Adjacent targets keep ≥8px
   (`gap-2`) between them.
4. **Colour is never the only carrier of meaning.**
   - Priority: wherever a priority is **drawn**, the `Chip` renders the **word**
     (`High`/`Low`) plus a distinct shape glyph (`▲`/`▼`). A user in greyscale
     must still be able to rank them.

     **`medium` is not drawn** (§4.4). It is the schema default rather than a
     level anyone chose, so the row publishes it as a `sr-only`
     `Priority: Medium` and draws nothing — byte-for-byte the accessible content
     the chip used to carry. This clause used to read "always renders", and the
     word was load-bearing enough that changing it is an amendment and not a
     reading: a sighted user now infers the default from absence, and a
     screen-reader user, who cannot perceive absence the same way, still hears
     the level. §4.4 carries the argument for the asymmetry.
   - Overdue: `⚠` glyph plus a visually-hidden `Overdue —` prefix, not just a
     warning-tinted colour.
   - Completed: the checkbox's checked state **and** `line-through` on the
     title, not just muted text.
   - Errors: `Alert.Indicator` icon plus the word "failed"/"error" in the copy,
     not just red text.
5. **Announced errors.**
   - Field errors go through `FieldError`, which react-aria links via
     `aria-describedby` and sets `aria-invalid` — do not render your own `<p>`.
   - Server-side form errors go through `Form`'s `validationErrors` prop so the
     same wiring applies.
   - Page-level errors use `Alert`, which carries the live-region semantics.
   - Toasts announce automatically via `Toast.Provider`'s live region.
6. **Contrast.** All token pairs in §2.1 are pre-paired
   (`--x` with `--x-foreground`). Never mix a foreground from one pair with a
   background from another. `--muted` is for secondary text on `--background` or
   `--surface` only; never on `--accent`.
7. **Heading order.** `h1` on `/todos` (`Typography.Heading level={1}`), `h3` for
   `Card.Title`, modal headings via `Modal.Heading` /
   `AlertDialog.Heading` (which set the dialog's accessible name). Never skip a
   level to get a size — use `type` instead.
8. **Keyboard.** Tab order follows the visual order in every screen. Desktop's
   hover-revealed row actions use `group-focus-within:opacity-100` so they become
   visible when tabbed to — hiding them with `hidden` or `display:none` is a bug.
   Escape closes both dialogs; Enter submits the todo form and confirms deletion.

   **When a mutation destroys the control that had focus, focus is moved —
   first back into the list, then onto the action of the toast *that mutation
   raised*.** Which toast is not a detail: the region holds several at once,
   their action buttons are identical in shape, and at the time this was
   written an `added` toast's `Undo` was a `DELETE` (it no longer carries one —
   see the hazard below). Selecting one by stack position rather than by identity cost
   a user an unrelated todo to a single keypress (`docs/QA-REPORT.md` DEF-25),
   and cost focus altogether when react-aria re-homed it off the doomed toast
   the position had named (DEF-26). The implementation carries a per-toast
   token for exactly this reason; see `src/lib/rowFocus.ts`. This is a
   deliberate exception to "never move focus without the user asking", taken
   because the alternative measured worse: a keyboard toggle under a status
   filter removes the row (US-07), focus fell to `<body>`, and the Undo that is
   the *only* route back sat behind every remaining row at three tab stops
   each, against a 12s timeout. QA measured it unreachable at 19 todos at any
   human pace (`docs/QA-REPORT.md` §A3).

   **The order.** Step 2 is what satisfies the reachability criterion; on the
   happy path it catches focus whether or not step 1 ran. Step 1 is there for
   the paths step 2 *cannot* take — a refused write raises no toast to move to,
   and the rescue stands down once the user has moved focus themselves. Doing
   it first makes it a fallback rather than a cleanup: focus is somewhere
   useful from the first frame regardless of what step 2 does. Both halves are
   pinned in `e2e/undo-focus.spec.ts`, the second by failing the status write.

   **The cost, stated honestly: it is one surprise per toggle, and there is no
   cheap way out of it.** After each qualifying toggle focus sits on `Undo`, so
   the next `Space` activates Undo and restores the row rather than toggling
   the next one. Burst-completing a list from the keyboard is a real pattern
   here, and under a status filter it now costs a detour on every row.

   Measured from focus-on-`Undo`, because an earlier draft of this section
   named a workaround that does not exist. Re-measured after DEF-25, with one
   toast on screen and focus on the **frontmost** toast — which is now the only
   toast the rescue can land on:

   | Keys | Where focus lands |
   |---|---|
   | `Shift+Tab` | the toast **container** (it is focusable) — still in the region |
   | `Shift+Tab` ×2 | **back into the list**, on the last row's `Delete` |
   | `F6` / `Shift+F6` / `Escape` | nothing moves; still on `Undo` |
   | `Tab` | the toast's `Close` button |
   | `Tab` ×2 | out of the document |
   | `Tab` ×3 onward | round through the top of the page (theme toggle) → `Account menu` → the quick-add input |

   So **`Shift+Tab` does work**, and this table used to say it did not.
   `Escape` and `F6` still do nothing. Backwards is now the cheap route: two
   presses to the list against six or more forward.

   **Why the earlier readings disagreed, and QA's differed again.** Only the
   *frontmost* toast's container is in the tab order — HeroUI sets
   `tabIndex = -1` on every other one — so `Shift+Tab` from a **non**-frontmost
   toast's `Undo` skips that container and lands on the toast in front of it,
   which is the `Undo`↔`Close` cycle QA reported (`docs/QA-REPORT.md` DEF-27).
   That was measured from the state DEF-25 put focus in. It is no longer
   reachable through the rescue.

   **The forward counts are dev-mode readings.** `next dev` renders a
   `NEXTJS-PORTAL` element that takes a tab stop of its own, and it does not
   take one on every run — it is the entire difference between this table and
   QA's, which otherwise agree stop for stop. So the *order* of stops above is
   the contract and the absolute counts are not; expect production to differ by
   one. Nothing here is trapped either way.

   **One cost the count used to hide, and how it was paid.** With a stack of
   toasts on screen — the ordinary case, since `UNDO_WINDOW_MS` is 12s —
   `Tab` ×2 from the toggle's `Undo` is the *next toast's* `Undo`. When an
   `added` toast still carried one, that next `Undo` was a `DELETE`: the stack
   put a destructive, unconfirmed mutation two deliberate presses from a
   control the app itself had moved focus to. The rescue had already stopped
   putting it under the *first* keypress (DEF-25); two forward presses still
   reached it, and that distance is a property of stacking Undos in a
   tab-ordered region rather than of the rescue.

   **`added` toasts no longer offer Undo, and that is what closed it** (§7.15).
   The receipt stays — a create still reports itself, and §7.17's
   `hidden by your filters` sentence is still the only thing that explains a
   row the filter swallowed — but the action is gone, so there is no
   destructive target in the region for two presses to arrive at. The Undos
   that remain — the toggle's (§7.13) and the edit's (§7.15), which are the
   only two the app has ever raised — are unchanged: same accessible names,
   same 12s window. Every one of them now writes a value back rather than
   removing a record, so `Tab` ×2 reaches a reversal whatever it lands on.

   **Why this rather than a roving tabindex.** Roving was the other candidate,
   and it addresses the count: it collapses the whole region to one tab stop,
   so a neighbour's action is no longer two presses away. What it leaves
   behind is the ambiguity, because the control is still there and still has
   to be understood — `Undo — Todo “x” added` asks the user to work out that
   undoing an add is a delete, and it asks that of them at the moment they are
   deciding whether to press. Removing the control removes the target
   outright, which is a smaller thing to reason about than a new focus model
   for the toast region.

   **And it was the least valuable Undo in the app.** What it reverses is a
   row that was created seconds ago and is on screen; deleting it from the row
   is one press, behind the confirm dialog §7.6 already requires, with its own
   receipt. The Undo it replaced offered the same outcome with no confirm and
   no way back. The two remaining Undos have no such equivalent — a toggle's
   previous state and an edit's previous values are both things the user
   cannot reconstruct from what is in front of them — which is why they stay.
   (A delete has never carried an Undo at all: it is the one mutation that
   confirms first, precisely because nothing restores it.)

   **Each remaining Undo is still named for what it reverses** (§7.13): the
   accessible name is `Undo — {toast title}`, so a screen-reader user hears
   which write a button belongs to rather than "Undo, button" three times.
   That naming was filed as the half of the hazard a name could carry while
   the structural question was open; it is still worth having with the hazard
   closed, because a stack of toggle and edit Undos is still a stack of
   identical visible words.

   Two consequences worth knowing before touching this:

   - **A toast with focus on it does not expire.** react-aria pauses the
     timeout while focus is inside the region, so parking on `Undo` keeps the
     toast alive indefinitely rather than handing focus back after 12s.
   - The affordance's own exit is `Enter` — which undoes the toggle. That is
     the right behaviour for Undo and the wrong one for "let me carry on", so
     it is not an escape route.

   We take the trade because the alternative is an Undo that cannot be reached
   at all, and because the row just completed is the one most likely to need
   undoing. But it is a real cost, not a rounding error, and it is the first
   thing to revisit if burst capture becomes a complaint — the shape of a fix
   would be a route back to the list from the toast, not a retreat on the
   rescue.

   **A reschedule restores focus instead of redirecting it, and that is a
   different answer to a different question** (`docs/PRD.md` US-13,
   `src/lib/rowFocus.ts` → `restoreRescheduleFocus`). Changing a due date moves
   the row between sections, and sections are separate `<section>` subtrees, so
   React rebuilds the row rather than moving the DOM node — the trigger the user
   pressed is destroyed and rebuilt a few pixels away, and focus falls to
   `<body>` with nothing on screen to show for it. The rescue above does not
   apply: the row is still on screen and still theirs, so moving them into the
   toast would arm an Undo under their next `Space` and charge them the surprise
   above for nothing. Focus goes back onto the same row's own trigger, found by
   the todo's id (`data-reschedule-for`) rather than by position — position is
   exactly what a reschedule changes. It fires only when focus is already on
   `<body>`, so a row that did not change section is left alone and a user who
   has moved focus themselves keeps it. Same modality gate, same reasoning.
   Pinned in `e2e/reschedule.spec.ts` and `tests/unit/rowFocus.test.ts`.

   **Keyboard only.** react-aria does not focus a control on pointer press, and
   a mouse user who has a row focused from earlier must not have Undo armed
   under a Space press they meant for that row. Gate on modality
   (`useFocusVisible`), not on whether focus happens to be in the list.

   **An emptied list still gets the rescue.** Toggling the only row leaves step
   1 with nowhere to land, so the guard on step 2 admits focus on `<body>` as
   well as focus on the row step 1 chose. Requiring an element would make the
   rescue decline in the one state where nothing else can catch focus.
   Implementation and the frame-timing trap are in `src/lib/rowFocus.ts`.

   **The guard names the row, not the kind of thing a row is
   (`docs/QA-REPORT.md` DEF-28).** It asked whether the active element was *a*
   row checkbox, which every row on screen satisfies — so a user who tabbed
   from the rescued row to the row beside it, during a write slow enough to
   leave time for it, read as a user who had not moved and had focus taken off
   the row they had chosen. Their next `Space` then reverted the completion
   they had just made instead of making the one they were standing on. It
   compares against the element step 1 actually focused, which is the same
   correction DEF-25 forced one level up: identity, not a category that happens
   to contain the right answer. Focus that leaves the list was always declined
   correctly, which is why the suite was green through it.
9. **Motion.** The only animations are HeroUI's own (skeleton shimmer, dialog
   entry, toast slide). Add `motion-reduce:transition-none` to the row action
   opacity transition.
10. **Language.** `<html lang="en">` is already set. Keep it.

---

## 7. Copy deck

Exact strings. Do not improvise, do not add exclamation marks, do not add emoji.
Sentence case for everything except proper nouns. No terminal period on button
labels, headings, or field labels; full sentences in descriptions and errors get
a period.

### 7.1 `/sign-in`

| Slot | String |
|---|---|
| Page `<title>` | `Sign in · Todos` |
| Card title | `Welcome back` |
| Card description | `Sign in to see your todos.` |
| Email label | `Email` |
| Email placeholder | `you@example.com` |
| Password label | `Password` |
| Submit (idle) | `Sign in` |
| Submit (pending) | `Signing in…` |
| Footer text | `Don't have an account?` |
| Footer link | `Sign up` |

### 7.2 `/sign-up`

| Slot | String |
|---|---|
| Page `<title>` | `Sign up · Todos` |
| Card title | `Create your account` |
| Card description | `It takes about ten seconds.` |
| Name label | `Name` |
| Name placeholder | `Ada Lovelace` |
| Email label | `Email` |
| Email placeholder | `you@example.com` |
| Password label | `Password` |
| Password description | `At least 8 characters.` |
| Submit (idle) | `Create account` |
| Submit (pending) | `Creating account…` |
| Footer text | `Already have an account?` |
| Footer link | `Sign in` |

### 7.3 `/todos`

| Slot | String |
|---|---|
| Page `<title>` | `Todos` |
| App bar wordmark | `Todos` |
| Theme toggle `aria-label` (light active) | `Switch to dark theme` |
| Theme toggle `aria-label` (dark active) | `Switch to light theme` |
| Account trigger `aria-label` | `Account menu` |
| Menu item (sign out) | `Sign out` |
| Page heading | `Your todos` |
| Count | `{done} of {total} done` |
| Count (zero todos) | *(render nothing)* |
| Dated header line | see §7.19 |
| ~~Add button~~ | ~~`New todo`~~ — **struck.** There is no such button; §7.17's quick-add bar replaced it and §7.18 renamed the empty state's action. |
| Filter: all | `All` |
| Filter: active | `Active` |
| Filter: completed | `Completed` |
| Filter group `aria-label` | `Filter todos by status` |
| Search `aria-label` | `Search todos` |
| Search placeholder | `Search todos` |

### 7.4 Todo row

| Slot | String |
|---|---|
| Checkbox `aria-label` (incomplete) | `Mark "{title}" as complete` |
| Checkbox `aria-label` (complete) | `Mark "{title}" as not complete` |
| Priority chip: high | `High` |
| Priority chip: medium | `Medium` |
| Priority chip: low | `Low` |
| Priority chip wrapper `aria-label` | `Priority: {High\|Medium\|Low}` |
| Due today | `Today` |
| Due tomorrow | `Tomorrow` |
| Due yesterday | `Yesterday` |
| Due other (this year) | `MMM d` e.g. `Mar 4` |
| Due other (other year) | `MMM d, yyyy` e.g. `Mar 4, 2027` |
| Overdue visually-hidden prefix | `Overdue — ` |
| Note indicator visually-hidden label | `Has a note` |
| Edit button `aria-label` | `Edit "{title}"` |
| Edit tooltip | `Edit` |
| Delete button `aria-label` | `Delete "{title}"` |
| Delete tooltip | `Delete` |
| Reschedule button `aria-label` | `Reschedule "{title}"` |
| Reschedule tooltip | `Reschedule` |

### 7.5 Create / edit modal

| Slot | String (create) | String (edit) |
|---|---|---|
| Heading | `New todo` | `Edit todo` |
| Close `aria-label` | `Close` | `Close` |
| Title label | `Title` | `Title` |
| Title placeholder | `What needs doing?` | `What needs doing?` |
| Title required error | `Enter a title.` | `Enter a title.` |
| Title too long error | `Keep the title under 200 characters.` | same |
| Note label | `Note` | `Note` |
| Note placeholder | `Optional details` | `Optional details` |
| Priority label | `Priority` | `Priority` |
| Priority options | `Low` / `Medium` / `High` | same |
| Due date label | `Due date` | `Due date` |
| Due date description | `Optional.` | `Optional.` |
| Cancel | `Cancel` | `Cancel` |
| Submit (idle) | `Add todo` | `Save changes` |
| Submit (pending) | `Adding…` | `Saving…` |
| Success toast | `Todo added` | `Changes saved` |
| Failure toast | `Couldn't add the todo. Try again.` | `Couldn't save your changes. Try again.` |

### 7.6 Delete confirmation

| Slot | String |
|---|---|
| Heading | `Delete this todo?` |
| Body | `"{title}" will be permanently deleted. This can't be undone.` |
| Cancel | `Cancel` |
| Confirm | `Delete` |
| Confirm (pending) | `Deleting…` |
| Success toast | `Todo deleted` |
| Failure toast | `Couldn't delete the todo. Try again.` |

### 7.7 Empty states

| Case | Heading | Body | Action |
|---|---|---|---|
| No todos | `Nothing here yet` | `Add your first todo and it will show up here.` **plus §7.18's teaching line** | `Add a todo` (§7.18) |
| Filter=active, none | `All caught up` | `You have no active todos. Nice.` | — |
| Filter=completed, none | `Nothing completed yet` | `Todos you finish will appear here.` | — |
| Search, no match | `No matches` | `No todos match "{query}".` | `Clear search` |

**The `No todos` action is `Add a todo`, not `New todo`.** The `New todo`
string this row carried until now described a modal, and the empty state's
button has focused the quick-add bar since §7.17 landed; §7.18 is where that
label lives and this row defers to it. Nothing here opens the modal any more,
and the deck should not have gone on saying it did. (§4.7's code sample still
shows `New todo` and `variant="primary"`; both are §4's to correct, and the
second is the ui-designer's call, not a copy change.)

**Only the never-used state teaches.** `Nothing here yet` is the one empty
state a user can reach without having typed anything, so it is the one that
gets §7.18's line. The other three are reached *by* filtering or searching —
their reader has already used the bar, and a syntax lesson on the way back
from a search that missed is a lesson delivered at the one moment it cannot
be acted on.

### 7.8 Loading

| Slot | String |
|---|---|
| Skeleton list `aria-label` | `Loading todos` |
| Generic pending button suffix | `…` (ellipsis character U+2026, never three dots) |

### 7.9 Errors

| Case | Title | Description |
|---|---|---|
| Bad credentials | `Sign in failed` | `That email and password don't match. Try again.` |
| Email already registered | `Sign up failed` | `An account with that email already exists.` |
| Email format invalid (field) | — | `Enter a valid email address.` |
| Password too short (field) | — | `Use at least 8 characters.` |
| Required field (field) | — | `This field is required.` |
| List failed to load | `Couldn't load your todos` | `Something went wrong on our end.` |
| List retry button | — | `Try again` |
| Toggle complete failed (toast) | — | `Couldn't update the todo. Try again.` |
| Session expired | `You've been signed out` | `Sign in again to continue.` |
| Unexpected error boundary | `Something went wrong` | `An unexpected error occurred. Try again.` |
| Error boundary button | — | `Try again` |

### 7.10 Priority filter and combined-filter empty state

Added for `docs/PRD.md` US-10, which requires a priority filter alongside the
status filter and a distinct no-results message when a filter combination
matches nothing.

| Slot | String |
|---|---|
| Priority filter `aria-label` | `Filter todos by priority` |
| Priority filter label (visually hidden) | `Priority` |
| Priority filter: all | `All priorities` |
| Priority filter: low | `Low` |
| Priority filter: medium | `Medium` |
| Priority filter: high | `High` |
| No filter matches heading | `No todos match these filters` |
| No filter matches body | `Try a different status or priority.` |
| Clear filters action | `Clear filters` |

### 7.11 Mutation confirmations and outcome toasts

Added for the "Mutation UX" section of `docs/CONVENTIONS.md`, when every
create, update, toggle and delete was confirmed first. **That is no longer the
rule** — the delete alone confirms (§7.6) — but every mutation still reports
its outcome in a toast that names the record, and those strings are what this
section is now for. They supersede the generic ones in §7.5 and §7.6.

Any toast here that carries an action (the Undo toasts, §7.13 and §7.15) is
subject to §4.10: **the action does not respond to a pointer for the first
~400ms.** Read §4.10 before adding another one.

**Not every toast in this table carries one.** `Todo “{title}” added` is a
receipt and nothing else — it has no action at all (§7.15), and neither do the
toasts an Undo raises when it succeeds. Only the toggle and the edit offer
Undo.

**The confirm rows of this section are struck.** The Mutation UX rule became
"confirm what cannot be undone", and the only mutation that cannot is the
delete — which confirms with §7.6's strings, from the one `ConfirmDialog` the
app still mounts (`TodoListScreen.tsx`). Create, update and toggle have had no
confirm dialog for some time; the copy for them sat here regardless, which is
the failure mode this deck is most prone to and the one that does the most
damage, because someone builds from it. The toasts below the strike are live
and unchanged.

| Slot | String |
|---|---|
| ~~Confirm cancel (all)~~ | ~~`Cancel`~~ — **struck.** §7.6 carries the delete's `Cancel`, and it is the only confirm left. |
| ~~Create confirm heading~~ | ~~`Add this todo?`~~ — **struck.** No create confirm exists. |
| ~~Create confirm body~~ | ~~`“{title}” will be added to your list.`~~ — **struck.** |
| ~~Create confirm action~~ | ~~`Add todo`~~ — **struck.** |
| ~~Create confirm pending~~ | ~~`Adding…`~~ — **struck.** The bar's own pending label is §7.17's. |
| ~~Update confirm heading~~ | ~~`Save these changes?`~~ — **struck.** No update confirm exists. |
| ~~Update confirm body~~ | ~~`“{title}” will be updated.`~~ — **struck.** |
| ~~Update confirm action~~ | ~~`Save changes`~~ — **struck.** It is the modal's submit, and §7.5 has it. |
| ~~Update confirm pending~~ | ~~`Saving…`~~ — **struck.** §7.5 has it. |
| ~~Complete confirm heading~~ | ~~`Mark this todo complete?`~~ — **struck.** The checkbox fires immediately and reverses from its toast (§7.13). |
| ~~Complete confirm body~~ | ~~`“{title}” will be marked complete.`~~ — **struck.** |
| ~~Complete confirm action~~ | ~~`Mark complete`~~ — **struck.** |
| ~~Reopen confirm heading~~ | ~~`Mark this todo not complete?`~~ — **struck.** |
| ~~Reopen confirm body~~ | ~~`“{title}” will be moved back to active.`~~ — **struck.** |
| ~~Reopen confirm action~~ | ~~`Mark not complete`~~ — **struck.** |
| ~~Toggle confirm pending~~ | ~~`Updating…`~~ — **struck.** |
| Create success toast | `Todo “{title}” added` |
| Update success toast | `Todo “{title}” updated` |
| Delete success toast | `Todo “{title}” deleted` |
| Complete success toast | `Todo “{title}” marked complete` |
| Reopen success toast | `Todo “{title}” marked not complete` |
| Note too long error (field) | `Keep the note under 2000 characters.` |
| Priority invalid error (field) | `Choose a priority.` |
| Due date invalid error (field) | `Enter a valid date.` |
| Todo no longer exists (toast) | `That todo no longer exists.` |

### 7.12 Auth confirmations and outcome toasts

Added for a ruling recorded in `docs/CONVENTIONS.md` → Mutation UX that the
confirm-modal rule applied literally to both auth forms. **The confirm half of
that is gone** — neither form mounts a `ConfirmDialog`, and neither should: a
sign-in is not a mutation of the user's data and confirming it made the
cheapest, most repeated action on the app cost two presses.

**The toasts are not gone**, and were reported as dead along with the
dialogs. They ship: `SignInForm.tsx` and `SignUpForm.tsx` raise both the
success and the failure toast on every attempt. Do not delete these four
rows.

| Slot | String |
|---|---|
| ~~Sign in confirm heading~~ | ~~`Sign in to your account?`~~ — **struck.** No such dialog. |
| ~~Sign in confirm body~~ | ~~`You’ll be signed in as “{email}”.`~~ — **struck.** |
| ~~Sign in confirm action~~ | ~~`Sign in`~~ — **struck.** §7.1 has the form's own submit. |
| ~~Sign in confirm pending~~ | ~~`Signing in…`~~ — **struck.** §7.1 has it. |
| Sign in success toast | `Signed in as “{email}”` |
| Sign in failure toast | *(the same message shown in the `Sign in failed` Alert)* |
| ~~Sign up confirm heading~~ | ~~`Create this account?`~~ — **struck.** No such dialog. |
| ~~Sign up confirm body~~ | ~~`An account will be created for “{email}”.`~~ — **struck.** |
| ~~Sign up confirm action~~ | ~~`Create account`~~ — **struck.** §7.2 has the form's own submit. |
| ~~Sign up confirm pending~~ | ~~`Creating account…`~~ — **struck.** §7.2 has it. |
| Sign up success toast | `Account created for “{email}”` |
| Sign up failure toast | *(the same message shown in the `Sign up failed` Alert)* |

The failure toasts deliberately reuse the Alert's message rather than adding
a second wording, so the server's own reason is what the user reads in both
places (`docs/CONVENTIONS.md`: "A failed mutation must surface the server's
error message").

### 7.13 Toggle Undo and sign out

Added for the team lead's later ruling in `docs/CONVENTIONS.md` → Mutation UX:
the completion checkbox is the one mutation with no confirm modal, so its
toast carries the reversal. Undo re-runs the same scoped toggle action and
reports its own outcome with the §7.11 toast for the flipped state.

| Slot | String |
|---|---|
| Toggle toast action | `Undo` |
| Toast action `aria-label` (all Undo toasts) | `Undo — {toast title}` |
| Undo failure toast | `Couldn’t undo that. Try again.` |
| Sign out failure toast | `Couldn’t sign you out. Try again.` |

**Why the action has an `aria-label` at all, when its visible word is already
its name.** `UNDO_WINDOW_MS` is 12s so that several Undo toasts stand at once,
and every one of their buttons reads `Undo`. A sighted user tabbing forward
sees which toast they are in; a screen-reader user hears "Undo, button" for
every one of them with no way to tell a completion-revert from an edit-revert
(`docs/QA-REPORT.md` §8, written when the worst case in that stack was an
`added` toast's `Undo`, which was a `DELETE`). The name is built from the
toast's own title — `Undo — Todo “keepme” updated` — so the subject is the
record and the action is the one §7.11 already names, rather than a second
wording that could drift from it. The visible word stays `Undo`; `aria-label`
overrides the child text for assistive technology only.

The `Tab` ×2 hazard this was first written against is now closed, by dropping
the `added` toast's Undo rather than by naming it (§6.8, §7.15). **The naming
stays**, and not out of sentiment: the remaining Undos still stack, still read
`Undo` on every button, and a name is still the only thing separating them.
What changed is that none of the things a name has to describe is destructive
any more.

**Proposed, and agreed with the ui-designer: one armed toast at a time.**
`dismissUndo` is keyed per todo id, so it disarms a *repeat write to the same
row* and nothing else — two rows toggled inside 12s leave two live Undos in
one tab-ordered region, both reading `Undo`. Generalise the key to a single
slot: raising any action-bearing toast dismisses whatever action-bearing toast
is standing. Three consequences for this section, and all three are copy
consequences rather than mechanism:

- The `aria-label` naming above **stays**, and stops being load-bearing. It
  was written because a name was the only thing separating stacked Undos; with
  one slot it becomes confirmation of what you already reached, which is what
  an accessible name should be.
- **Receipts are not capped.** An `added` toast carries no action (§7.15), so
  it is outside this rule — including §7.17's
  `Todo “{title}” added — hidden by your filters`, which is the only account
  the user ever gets of a row a filter swallowed and must not be closed by the
  next write.
- **What it costs, stated:** a second write inside 12s takes the first Undo
  away. For a toggle that is nearly free — the checkbox that made the change
  reverses it, on screen, in one press. For a **reschedule** it is not free:
  the previous date is not on the row any more and not in any toast, so the
  older reschedule becomes genuinely unrecoverable rather than merely
  inconvenient. I accept that. It is two reschedules in twelve seconds
  followed by regret about the first, against an ambiguous `Undo` in every
  ordinary session — and the fix for the rare case is `Pick a date…`, not a
  second armed button. No copy change: putting the old date in the toast
  (`Todo “x” moved from Aug 22 to Aug 26`) buys that case and lengthens every
  other one.

**And it is not separable from §4.10's `wrapUpdate` escape hatch.** §4.10 says
the trade is worth making "the moment an action matters more than the
animation"; capping at one is what makes that moment arrive. Today a close
followed by an add is the *repeat-write* case, and §4.10 records that it
doubles the dead window to roughly 700–800ms. Under a single slot,
close-then-add becomes the **ordinary** path — every action toast now closes
one — so the app's only armed control would be inert for the better part of a
second, every time, with no visual tell. The cap without `wrapUpdate` makes
the stack tidier and the one remaining button less reliable, which is a worse
trade than doing neither. Take both or take neither; I would take both. What
`wrapUpdate: fn => fn()` costs is the queue's 350ms slide, which is the
ui-designer's to price — a toast can still animate itself; what goes is the
view-transition cross-fade of the reflow.

This is a behaviour change, so it is mine, and it is recorded here rather than
built.

### 7.15 Edit Undo, and why the create has none

Added when the Mutation UX rule became "confirm what cannot be undone": create
and edit lost their confirm dialogs, so their toasts carried the reversal
instead. **The create's half of that has since been withdrawn.** An edit still
offers Undo, which writes the record back to the values it held when the form
opened, through the same scoped endpoint as the write it reverses. A create
reports itself and stops there.

Every string names the record. `Todo removed` on its own was rejected in
review (M-3) for naming nothing.

| Slot | String |
|---|---|
| Create toast | `Todo “{title}” added` — **receipt only, no action** |
| Edit toast | `Todo “{title}” updated` |
| Toast action (edit only) | `Undo` |
| Toast action `aria-label` | `Undo — {toast title}` (shared with §7.13) |
| Edit Undo succeeded | `Todo “{title}” restored` |
| Undo failure | `Couldn’t undo that. Try again.` (shared with §7.13) |

**Why the create's Undo went.** It was a `DELETE` wearing the same word, and
the same shape, as three reversals that put things back. `UNDO_WINDOW_MS` is
12s precisely so several of these toasts stand at once, in one tab-ordered
region — so two forward `Tab`s from the toast the app had just moved focus to
reached a neighbour's Undo, and if that neighbour was an `added` toast the
press destroyed a record with no confirm and nothing behind it (§6.8, and QA's
§8 against DEF-25). Naming the buttons made the destination audible on arrival
but left the distance at two.

The alternative fix was a roving tabindex over the toast region. It shortens
the walk, and leaves the control — and the control is the part that has to be
understood: `Undo — Todo “x” added` still asks the reader to infer that
undoing an add is a delete. Removing it removes the target instead of moving
it further away, and it costs the user least here of anywhere: the row an
`added` Undo would delete was created seconds ago and is on screen, so
deleting it from the row is one press, behind §7.6's confirm, with its own
receipt. That is a better version of the same escape hatch than the toast was.

Nothing else changed. The toggle's Undo (§7.13) and the edit's keep their
action, their accessible names and their 12s window — and they are the only
two, since a delete confirms instead of offering one (§7.6). The distinction
that decided this is what the action *does*: those two write a value back,
where the create's removed a record.

An Undo is offered for one write only. A later write to the same todo dismisses
the earlier toast, so an Undo can never restore a record past a change the user
made after it. A toggle and a delete dismiss before they start; a save dismisses
when its write resolves, since it runs behind a modal that covers the toast.
An `added` receipt is not part of that bookkeeping: it arms nothing, so there
is nothing about it that can outlive the write it describes.

### 7.14 Malformed request

Added for review finding M-3: a `400` whose zod failure sits at the root of the
body (unparseable JSON, an array, a bare string, a body mixing toggle and form
fields) has no field to attach a message to. It must not borrow the *404* copy,
which would tell the user their todo was deleted.

| Slot | String |
|---|---|
| Malformed request body | `That request wasn’t valid.` |

### 7.16 List section headings

Added for backlog #2 (`docs/PM-PROPOSAL.md` §7.1): the list is ordered by
urgency and cut into sections, so each section needs a name. Rendered as a real
`<h2>` (`Typography.Heading level={2}`) at the `body-sm` size, per §8.4.3 —
navigable structure, not styled text.

Two rules govern when these appear, and both are requirements rather than
polish:

- **An empty section renders nothing** — no heading standing over no rows.
- **A lone section renders no heading either.** A user who has never set a due
  date has one section, `No date`, and a heading there would name the whole
  list after the one thing it lacks. Headings appear only once there are two or
  more sections to tell apart.

| Slot | String |
|---|---|
| Section heading: past due | `Overdue` |
| Section heading: due today | `Today` |
| Section heading: due later | `Upcoming` |
| Section heading: no due date | `No date` |
| Section heading: completed | `Completed` |
| Section heading, rendered | `{heading} · {count}` — e.g. `Overdue · 3`, `Completed · 214` |

**The heading has a voice and a count.** It keeps the `<h2>` and the `body-sm`
size, and drops `color="muted"`, so it sits at `--foreground` with
`typography--h2`'s semibold weight. It had to: at `body-sm` *and* `--muted` it
was the same size and the same token as the due dates in the rows beneath it —
measured identical, pixel for pixel, at **5.60:1 light / 6.75:1 dark** on the
Card — so a section name was indistinguishable from row metadata. After:
**17.72:1 light / 17.27:1 dark**. Contrast rises, so nothing in §6.6 is at
risk; it is measured in `e2e/a11y-contrast.spec.ts` anyway, and measured
*against the due date* rather than against a floor, because a floor would have
passed on the defect too.

(4.83:1 is the figure §8.4 and §4.8 quote for this token. It is stale: DEF-15's
`--muted` correction moved light to 5.60:1. Nothing about the argument changes —
the two were equal, which was the whole complaint.)

The count uses `·`, per §7.18's punctuation note, and is rendered
**`aria-hidden`, so the accessible name stays exactly the bare string above**.
The `<ul>` under each heading already reports its own size to assistive
technology — "list, 3 items" — natively and more precisely than a numeral
behind a middle dot, which a screen reader may voice as punctuation or swallow
depending on verbosity. Putting it in the name buys a duplicate of something AT
already has and pays for it in heading-to-heading navigation noise. The count
is a sighted scanning aid; the list semantics are the AT answer, and the two
cannot drift because both are read from the same array.

Both halves are pinned in `e2e/grouping.spec.ts` — the visible text *and* the
accessible name — because either assertion alone passes on the wrong markup.

### 7.17 Quick-add bar

Added for backlog #1 (`docs/PM-PROPOSAL.md` §2): a persistent single-line
input at the top of `/todos` that creates a todo on Enter. It **replaces** the
toolbar `New todo` button of §7.3 as the primary capture path, and the empty
state's call to action now focuses it rather than opening the modal (§7.7).

The modal is not retired — it is reached from `More options`, which carries
whatever is already typed into it, and from every row's Edit button. Two
capture paths, not three: the bar for a title, a day and a priority; the modal
for a note or a date the vocabulary cannot say.

**`More options` is a handoff, not a commit, and the bar is emptied by the
save.** Opening the modal copies the reading into it and changes nothing else;
if the user then dismisses that modal — `Cancel`, `Escape`, or the close `×`,
all three the same — the bar still holds every character, chips and all, ready
to submit as it stands. Only a modal that actually saves clears it. This is the
same guarantee the bar already makes on a 500, a 502 and a field error, and it
matters more here, not less: a server error is bad luck, while backing out of a
dialog is a decision the user made about something that had not happened yet.
Nothing was created, so there is no mutation and no Undo to recover with — the
text is the only copy, and it is not the bar's to spend.

**The chips are not decoration.** They are the whole mitigation for a parser
that reads a word the user meant literally, so each one is a *control*: a
button that puts its words back in the title. `Esc` does the same for every
chip at once, from the keyboard, without leaving the input — **every chip, and
nothing that is not a chip.** A word rule 2 declined to lift was never offered,
so it is not `Esc`'s to refuse; refusing it anyway would record the refusal
against a longer reading than the one on screen, and the user's own title would
then be able to revoke it (QA DEF-24).

**A parse the user cannot see and cannot refuse** is the thing this feature must
never ship — which is why the reading is also **announced through a polite live
region**, not merely drawn. The chips are buttons a screen-reader user only meets by tabbing
to them, so without the announcement the guarantee in this paragraph would
hold for sighted users only.

**Refusing one chip never costs the other.** Releasing the date leaves the
priority read and its chip on screen; the released words go back into the
title and the reading carries on past them.

**A refusal belongs to the reading it was made against — not to the exact
string, and not to a wider reading than the chips showed.** Only trailing
words are ever read, and whitespace is not a word, so an edit the parser
cannot see must not be able to withdraw a refusal of what it read. Correcting
a typo at the start of the line, inserting a word there, or typing one
trailing space all leave the refusal standing — and so does correcting a word
of the title on a line made entirely of vocabulary, such as the `3` in
`in 3 days high`, where the only chip is the priority and `in 3 days` is
title. Changing a trailing word ends it, because that is a different reading:
the chips come back, visibly, and are refusable again.

**And a refusal that has ended does not return.** Retyping the line reaches
the same last word eventually, and on the text alone that would look like the
refusal all over again — chips gone, date silently applied, nothing on screen
to say so. So the refusal ends at the first edit that leaves the reading, and
retyping a line means passing through such an edit. This is what keeps a
refusal from outliving the text it was made against, which matters more than
the reverse: an unwanted chip is on screen and costs one keystroke, while a
silently disabled parser is invisible.

*Residual, stated because it is real:* a single edit that replaces the whole
line without ever passing through anything else — a paste, a text drop,
autofill, or a coalesced undo — keeps a refusal whose words the new line
happens to end in. Two texts cannot be told apart by the path that produced
them, and a replacement made in one edit has no path. Submitting clears the
refusal outright, so it never reaches the next todo.

**A capital letter switches the parser off for that word,** which is a
stronger guarantee than any chip: nothing fires, so there is nothing to notice
and nothing to undo. `friday` is a day, `Friday` is part of a name — which is
what keeps `Casual Friday`, `Black Friday`, `Cyber Monday`, `Palm Sunday` and
`Ash Wednesday` whole.

| Slot | String |
|---|---|
| Field label (visually hidden) | `Add a todo` |
| Field placeholder | `Add a todo — try "pay rent friday high"` |
| Submit button | `Add` |
| Submit button (pending) | `Adding…` |
| More options button | `More options` |
| Parsed-chip group `aria-label` | `Read from your text` |
| Parsed chip: due date | `Due {Today\|Tomorrow\|Mar 4\|Mar 4, 2027}` |
| Parsed chip: priority | `{High\|Medium\|Low} priority` |
| Parsed chip `aria-label` | `{chip label} — keep "{words}" in the title` |
| Parsed-chip hint | `Press Esc to keep your text exactly as typed.` |
| Live-region announcement | `Read from your text: {chip labels, comma separated}. Press Esc to keep your text exactly as typed.` |
| Live-region announcement (nothing read) | *(render nothing)* |
| Empty title error (field) | `Enter a title.` |
| Title too long error (field) | `Keep the title under 200 characters.` |
| Failure toast | `Couldn't add the todo. Try again.` |

The due-date chip reuses §7.4's day wording rather than inventing a second
vocabulary for the same day, exactly as §7.16's `Today` heading does.

**When the new todo does not match the current filter or search.** It is not
inserted, and no filter is cleared on the user's behalf — a filtered list must
always match what a reload of the same URL would show (`docs/PRD.md` US-10).
The receipt says so instead. Like every other `added` toast it carries no
action (§7.15) — it is the sentence that explains the absence, not a control
for correcting it:

| Slot | String |
|---|---|
| Create success toast (visible) | `Todo “{title}” added` |
| Create success toast (hidden by filters) | `Todo “{title}” added — hidden by your filters` |

### 7.18 Empty-state call to action, and the line that teaches the bar

The `No todos` empty state's action no longer opens the modal; it moves focus
to the quick-add bar. Its label changes with it, because `New todo` described
a modal that is no longer what the button does. This row supersedes the
`No todos` action in §7.7.

| Slot | String |
|---|---|
| Empty state action (no todos) | `Add a todo` |
| Empty state teaching line (no todos only) | `A day and a priority at the end are read — “pay rent friday high” becomes “pay rent”, due Friday, High priority.` |

Rendered as `<Typography type="body-sm" color="muted">`, below the body and
above the action, and **only in the `Nothing here yet` state** (§7.7). It is
one line and it carries one example, deliberately.

**Why the line exists, and what it is answering.** A tester on a phone read
the bar's placeholder — `Add a todo — try "pay rent friday high"` — and said
in as many words that they had no idea what `high` meant, could not tell
whether it was the priority or part of some syntax, and were not going to
spend their four minutes reverse-engineering a hint. That is the correct
response to that placeholder. A placeholder can show a line that works; it
cannot say *why* it works, because it vanishes at the first keystroke and
because a hint the user has to test by typing is a hint that costs a todo to
read. So the explanation moves to the one surface that is standing still, is
never in the way, and is only ever seen by somebody who has not used the
feature yet.

**One example, and it is the placeholder's.** The line quotes
`pay rent friday high` because the bar quotes it. Two examples would be two
vocabularies for one parser, and a reader who met `pay rent friday high` on
the empty state and something else in the field would reasonably conclude
there was a list of magic phrases somewhere and that they had been shown two
of them. There is no list, which is the point — so the line shows the *shape*
(`title`, then a day, then a priority) once, and lets the chips do the rest.
If a second example ever seems necessary, that is a signal the vocabulary has
outgrown a one-line explanation and needs a real surface, not that this line
needs a second sentence.

**No list of tokens.** `today`, `tonight`, `tomorrow`, the seven weekday
names, `next week`, `in N days` and `YYYY-MM-DD` are eight forms, and a
muted line enumerating eight forms is a reference card in an empty state —
the thing a parent with four minutes skips on sight. What the line teaches is
the *offer*: that the last words of a line can set a day and a priority, and
that they leave the title when they do. Everything past that is discoverable
by trying, and trying is safe here, because the chips show what was read and
one press puts any of it back (§7.17).

**What the line is careful not to promise.**

- **"at the end"** is rule 1 stated in three words. It is the single most
  useful fact about this parser and the one the placeholder cannot convey:
  `high priority handover` keeps every word, and a user who does not know
  that reading is right-to-left has no model for why.
- It says **"a day"**, not "any way of writing a day". `next friday` is
  deliberately not vocabulary and lands in the title silently (§7.17, rule 4),
  and no one-line summary can carry that exception without becoming the token
  list this line refuses to be. The mitigation is not in this copy: it is that
  a word which was not read stays visibly in the title, where the user can see
  it. This line's job is to get the user to look at the chips at all.
- **`becomes`** describes the whole transaction — the words leave the title
  and turn into a date and a priority — which is precisely the part the
  tester could not see. `sets` or `adds` would leave them expecting a todo
  still called `pay rent friday high`.
- **`High priority`** is the priority chip's exact string (§7.17), so the
  words the line uses are the words the user will meet two seconds later.

*One drift accepted, and stated:* `due Friday` is plain English, not a string
the app renders. The chip and the row both go through `formatDueDate`, which
says `Today` or `Tomorrow` and otherwise a date — so a Friday three days out
chips as `Due Aug 24`, not `Due Friday`. The line is teaching the offer, not
quoting the chip, and "due Friday" is what actually becomes true of the todo.
Moving the shared example to `tomorrow` would close the gap exactly, and I am
not proposing it: a weekday is the example that teaches there is a vocabulary
rather than two magic words, and rent is monthly.

*Open, and addressed to the ui-designer:* I would rather this line **replaced**
`Add your first todo and it will show up here.` than sat under it. That body
says nothing the heading and the button do not already say, and three stacked
lines above a button is a paragraph in a place designed to be read at a
glance. The additive version is specified above because the slot was
specified additive and the dev should not be blocked on this; it is one
string either way.

`Today` is deliberately the same word the row's own due-date label uses (§7.4).
A row reading `Today` inside a section headed `Today` is a repetition, not a
contradiction, and the alternative — inventing a second word for the same day —
is worse.

### 7.19 The dated header line

> **There are two §7.19s in this deck** — this one and *Reschedule from the
> row* below. Both numbers are cited from `src/` and `e2e/`, so renumbering is
> a code change and not a doc change; until someone takes it, cite them by
> title. `src/lib/listHeaderLine.ts`, `src/lib/styles.ts` and
> `e2e/list-header.spec.ts` mean *this* section; `src/lib/date.ts`,
> `TodoActions.tsx`, `TodoBoard.tsx` and the `due` route mean the other.

Added for `docs/PRD.md` US-12: one plain-text line above the list and below the
app bar, telling the user what day it is and how much is due before they read a
single row.

| Slot | String |
|---|---|
| Date | `dddd, D MMMM` — e.g. `Saturday, 16 August` |
| Due-today clause | ` · {n} due today` |
| Overdue clause | ` · {n} overdue` |
| Both, in order | `Saturday, 16 August · 3 due today · 1 overdue` |
| A clause whose count is zero | *(omitted entirely — never `0 due today`)* |
| Loading, load failure, or nothing due | *(the date alone)* |

Separator is `·` per §7.18's punctuation note. One wording for one and for
many: `1 due today`, `3 due today` — no plural switch, and nothing that could
produce `1 todos`.

**Not a heading and not a control.** It summarises the sections, and the
sections (§7.16, US-06) remain the place overdue work is actually conveyed.
Rendered as `<Typography type="body-sm" color="muted">`, which is the same
token and surface as the `{done} of {total} done` counter beside the page
heading and is measured with it in `e2e/a11y-contrast.spec.ts`.

**The counts are the sizes of the `Today` and `Overdue` sections, read from the
sections themselves.** `TodoListScreen` calls `groupTodos` once per render and
hands the one array to `TodoGroupedList` and to `formatListHeaderLine`
(`src/lib/listHeaderLine.ts`). US-12 requires that the line and the list can
never disagree, and one array shared by both is what makes that a property of
the structure rather than something a test has to keep catching. A second pass
over `todos` would be a second answer, and two answers computed from one input
at two moments can differ — over a midnight boundary, or across an optimistic
write that moved a row between the calls.

Three things fall out of that rather than needing rules of their own:

- **Completed todos are never counted.** `todoGroupId` puts completion first,
  so a finished todo is in `Completed` whatever its date reads.
- **A filter or a search is simply a shorter array** by the time it reaches
  here, so the counts describe what is on screen with no filter logic in this
  file at all.
- **"Today" is decided once.** `groupTodos` goes through `dueDayOffset`
  (`src/lib/date.ts`), the single place a UTC-midnight `dueAt` is reconciled
  against the viewer's local calendar day. CI runs with `TZ=Pacific/Kiritimati`
  to catch a second answer.

**The date is shown alone while the list is loading and while a load has
failed** — `groups` is `null` in both — so the counts never render as zero, or
as the previous filter's numbers, and then change under the user. The loading
case has teeth only on a *filter change*: `useTodoList` keeps the previous
filter's rows in `result` until the new ones land, so a first load would look
correct with no gate at all. `e2e/list-header.spec.ts` holds the filter
change's `GET` open and asserts the line against exactly that window.

Punctuation notes: use the typographic apostrophe (`'`) in contractions
(`don't`, `can't`, `Couldn't`) and curly double quotes around interpolated
titles in prose. Use the ellipsis character `…`.

---

### 7.19 Reschedule from the row

> The second §7.19 — see the note under *The dated header line* above.

Added for backlog #5 (`docs/PM-PROPOSAL.md` §3, `docs/PRD.md` US-13). The row
gets a third action: a `Dropdown` that moves the due date without opening the
modal. A due date is trivially reversible, so it fires immediately and reports
with an Undo toast — no confirm dialog (`docs/CONVENTIONS.md` → Mutation UX).

| Slot | String |
|---|---|
| Trigger `aria-label` | `Reschedule "{title}"` |
| Trigger tooltip (`sm:` and up) | `Reschedule` |
| Menu `aria-label` | `Reschedule "{title}"` — the trigger's name, reused |
| Item 1 | `Today` |
| Item 2 | `Tomorrow` |
| Item 3 | `Next week` |
| Quick-day date preview | the resolved day, `MMM d` (`MMM d, yyyy` in another year) |
| Item 4 | `Pick a date…` |
| Item 5 | `Clear due date` |
| Success toast (a date was set) | `Todo “{title}” due {Today\|Tomorrow\|MMM d\|MMM d, yyyy}` |
| Success toast (the date was cleared) | `Todo “{title}” due date cleared` |
| Toast action | `Undo` |
| Toast action `aria-label` | `Undo — {toast title}` (shared with §7.13) |
| Undo succeeded | the same two toasts above, for the value it restored |
| Failure toast | `Couldn’t change the due date. Try again.` |
| Undo failure | `Couldn’t undo that. Try again.` (shared with §7.13) |

**The day words are the row's own.** The toast reads its label out of
`formatDueDate` — the same function that writes the date on the row — so a
reschedule to today says `due Today` in both places and cannot drift into
saying one thing in the toast and another two lines above it. It also means
`Today` is the *viewer's* today in the toast for the same reason it is on the
row (`src/lib/date.ts`).

**Why the menu shows a date next to three of the items.** `Today` and
`Tomorrow` need no gloss. `Next week` does: it means the same weekday seven days
on, and nothing about the words says so. Printing `Next week` `Aug 26` states
the decision where the decision is made, which is cheaper than a tooltip and
truer than a convention nobody was told. The preview is decoration for the two
obvious items and load-bearing for the third, so all three carry it — an option
list where one row looks different reads as one row *meaning* something
different.

The preview is a plain `<span>`, never a `Typography`: react-aria's `MenuItem`
labels itself from the `TextContext` `label` slot, `Typography` claims that
slot, and the effect was that `Today` announced itself to a screen reader as
`Aug 19`. §4.4 has the mechanism.

**Both accessible names carry the todo's title**, the trigger's and the menu's.
This is the lesson §7.13 records about Undo, applied before it could be
re-learned: a screen of twenty rows is a screen of twenty `Reschedule` buttons,
and `Reschedule, button` twenty times over is not a list a user can navigate.
The menu borrows the trigger's name rather than inventing a second one.

**`Pick a date…` opens the edit modal, and it stays that way.** A tester
called it "backwards from what I expected", and they are describing something
real: a menu item ending in `…` promises a surface for specifying *this*
thing, and what arrives is the whole record editor. The ruling is that it
stays, because the alternative is a second date surface — its own popover, its
own focus and dismissal behaviour, its own small-screen story, its own
contrast measurements — built to set a field the app already has a screen for.
That is a large amount of new surface bought with the one accent this app has
decided not to spend, and it would leave two places to change a date that must
never disagree.

**What is wrong is not the destination; it is where the caret lands.** The
form autofocuses `Title` (`TodoForm.tsx`), so a user who asked for a date
arrives looking at a text field holding words they did not come to change —
which is exactly the "backwards" the tester reported, and it is one line to
fix. **When the modal is opened from `Pick a date…`, focus goes to
`Due date`.** The surface is then bigger than expected but open *on* the thing
that was asked for, which reads as the app taking the request seriously rather
than ignoring it. Opened from the row's `Edit` button it still focuses
`Title`, unchanged.

**No copy change, and the wording was the first thing tried.** Every honest
rename either lied about the destination or lost the intent: `Edit…` drops
the date the user came for, `Edit due date…` and `Another date…` promise the
same date-only surface `Pick a date…` already promises, and anything naming
the modal (`Pick a date in the editor…`) is a sentence in an option list where
the other four items are two words. A menu item cannot carry a caveat about
its own destination; landing on the right field says it in one frame and costs
nothing to read.

**The reschedule's Undo restores the value the row held before the press**,
read off the row at the moment of the press and never recomputed. That is the
same rule §7.15 states for an edit, and the reason is the same: a reversal that
derives what to put back is guessing, and "the date it used to have" is exactly
the kind of thing that can be derived wrongly. A later write to the same todo
dismisses the toast (`dismissUndo`, keyed per todo id) so an Undo can never
reach past a change the user made after it.

### 7.20 Board view

`docs/PRD.md` US-14. The column headings are §7.16's, unchanged — the board is
the list's own sections laid out sideways, and a second set of names for the
same five groups would be the first sign it had become a second opinion about
where a todo belongs.

| Slot | String |
|---|---|
| View toggle `aria-label` | `Choose a view` |
| Toggle option 1 | `List` |
| Toggle option 2 | `Board` |
| Column headings | §7.16's five, with §7.16's `aria-hidden` count |
| Empty `Overdue` | `Nothing overdue.` |
| Empty `Today` | `Nothing due today.` |
| Empty `Upcoming` | `Nothing scheduled ahead.` |
| Empty `No date` | `Every todo has a date.` |
| Empty `Completed` | `Nothing completed yet.` |
| Order note, under the columns | `Cards are ordered by due date within each column. Dropping a card chooses its column, not its place in it.` |
| Drag picked up | `Picked up “{title}”. Drop it on {columns, comma-separated}.` |
| Drag picked up, nowhere to go | `Picked up “{title}”. There is nowhere to move it.` |
| Drag dropped | `Dropped “{title}” on {column}.` |
| Drag abandoned | `Move cancelled.` |
| Anything written | §7.19's and §7.13's toasts, unchanged |

**Two empty columns are good news and are worded as such.** `Nothing overdue.`
and `Nothing due today.` are not the same kind of statement as
`Every todo has a date.`, and five identical "Nothing here" lines would say
nothing at all.

**The drag messages describe the gesture; the toasts describe the write.** They
are split that way so nothing is announced twice: a keyboard user never drags —
their equivalent is the card's reschedule menu — and only ever hears the toast,
while a pointer user with a screen reader hears the pick-up and the drop, which
no toast covers, because a drag that is picked up and put down again writes
nothing at all.

---

## 8. Design note: drag-and-drop and the completion control

*2026-08-16 — UX/UI. Opened as an answer to "should the completion checkbox be
replaced by drag and drop?", rewritten after the lead reframed the question to
"how do we make this application genuinely more appealing to use?". §8.1
disposes of the original question; everything after it answers the real one.
Several proposals below revise things I specified in this document myself, and
each says so.*

### 8.1 Drag and drop — no, and it was never the question

Replacing the checkbox with a drag gesture would trade a labelled,
keyboard-operable, screen-reader-announced binary control for a spatial gesture
with no accessible equivalent: it breaks §6.3 (there is no element left to
measure, which retires the 44×44 target QA verified twice — `docs/QA-REPORT.md`
§2.5, DEF-01), §6.8 (react-aria's keyboard drag mode moves items to positions,
it cannot express "this sets a boolean"), §6.9 (a gesture has no
`motion-reduce` variant), and it collides head-on with vertical touch scrolling
— the disambiguating long-press would make the app's most repeated action its
slowest. Separately, *reordering* is a different feature wearing the same
costume: `prisma/schema.prisma` has no ordering column, `docs/PRD.md` §4 lists
drag-and-drop reordering as out of scope for v1, HeroUI v3 ships no `GridList`
(the collection components are `list-box`, `menu`, `table`, `tag-group`), and a
handle cannot fit beside three 44 px targets in a 343 px content column at
375 px — so it would be pointer-only with a separate mobile path forever. If PM
ever wants reordering, it is a schema migration plus a scoped endpoint plus a
second ordering system competing with the priority filter, and it should be
argued on those terms. **The checkbox stays. Nothing below depends on this.**

### 8.2 Why the app feels plain — the actual diagnosis

The app is not plain because it lacks ornament. It is plain because **it asks
permission constantly and answers slowly**, and no amount of visual polish
fixes that.

Adding a todo today is: press `New todo` → a modal opens → fill four fields →
press `Add todo` → **a second modal** asks `Add this todo?` → confirm → the
entire list is replaced by a skeleton → the list returns. Two modals, three
confirmations of the same intent, and a full-screen loading state, to write the
words "Buy milk". Checking a todo off is worse in a subtler way: the checkbox
does not move until the server answers (`TodoRow.tsx`: *"Stays in its current
state until the confirmed mutation lands"*), so the single most satisfying
micro-interaction in any todo app — the tick landing under your finger — is
instead a short dead pause.

Both of those contradict **§1 of this document, which I wrote**: *"Optimistic
and quiet. State changes apply immediately… Never show a spinner for an action
that finishes in under 300 ms."* The implementation is neither optimistic nor
quiet, and the confirm-modal convention in `docs/CONVENTIONS.md` is what pushed
it there. That is the gap to close. Appeal, in an app you touch fifty times a
day, is mostly **latency and ceremony**; hierarchy and colour are second-order
and are handled in §8.4.

### 8.3 The first move — and I would take only this one if forced

**Delete the confirmation modal on create and on edit. Make the toggle
optimistic. Never blank the list after a mutation.** One ruling, three changes,
and the app changes character.

**8.3.1 Confirms on create and edit — remove.**
`docs/CONVENTIONS.md` → Mutation UX makes a confirm modal mandatory for every
create and update, and §7.11/§7.12 of this document encode the strings, so this
is a lead ruling and I am arguing against it directly rather than around it.
The rule's purpose — do not commit something by accident — is already served
for create and edit by the form itself: the user typed the content and pressed
a labelled button that says exactly what it will do. The confirm shows them
nothing the previous screen did not. The lead has already reasoned this way
once, about sign-in (§7.12: *"It creates nothing and is undone by signing
out"*), and create and edit are **more** reversible than sign-in — both are
undone by editing or deleting, and both already report by toast.

Keep the confirm for **delete** only: destructive, irreversible, correctly
specified in §4.6, and verified by QA (`docs/QA-REPORT.md` §6 — Cancel focused
first, Escape cancels, focus returns to the trigger).

*Accessibility:* this **removes** a focus trap rather than adding one, and
removes a second dialog whose heading duplicated the first. No rule in §6 is
touched. §7.11's `Create confirm …` / `Update confirm …` rows and §7.12 in full
would be struck; the success toasts stay exactly as they are.

**8.3.2 The toggle must move on press.**
Flip `completed` in local state immediately, render the row's completed styling
at once, and revert on failure with the existing `Couldn't update the todo. Try
again.` toast. The `Undo` action in the success toast (§7.13) is unchanged and
still re-runs the scoped endpoint. This is what §1 already promised. The row's
current `opacity-60 pointer-events-none` pending treatment should then apply
only to *delete*, where the row is about to vanish and a stable, dimmed row is
honest; on a toggle it is now visible latency for its own sake.

> **MI-6, settled: this paragraph is the design, and §4.8 has been corrected to
> match it.** One amendment, from measurement rather than from taste: the
> `opacity-60` is dropped for the delete too, and only `pointer-events-none`
> remains. A row-level `opacity` dims the title with everything else, and on an
> already-completed row — whose title is `text-muted line-through` — that lands
> at **2.32:1**, the same number the toggle produced. "A stable, dimmed row is
> honest" survives as intent; the disabled controls and `aria-busy` carry it,
> and the title keeps its contrast. See §4.8 for the full reasoning.

*Accessibility:* `aria-checked` flips with the visual state instead of lagging
behind it, which is strictly more correct for a screen reader. §6.4's "checkbox
state **and** `line-through`" pairing is unchanged.

**8.3.3 Stop replacing the list with a skeleton.**
`TodoListScreen` calls `reloadWithSkeleton()` after a create or an edit, which
blanks every row on screen to report a change to one of them. The skeleton
earns its place exactly once — the first load, where there is nothing to
preserve (§4.8). After a mutation, refetch underneath the rendered list and let
the row change in place. A create can prepend the new row optimistically; an
edit already knows the new values. Nothing flashes, scroll position survives,
and the app stops re-introducing itself every time you use it.

**Together these three remove one modal, one dead pause and one full-page flash
from the single most common path in the product.** That is the strongest first
move available, and it costs nothing in §6.

### 8.4 Then, in order: the visual work

Ranked. Each is small, and none costs an accessibility rule.

**1 — The row contradicts itself, and that is what looks unfinished.**
`TodoRow.tsx` gives each `<li>` `rounded-2xl hover:bg-surface-hover`, while
`TodoListScreen.tsx` wraps them in `divide-y divide-border-secondary`: a
rounded hover pill drawn inside a hard-ruled table. **§4.3, which I wrote,
specifies the dividers and is the half that is wrong.** Take the pills: drop
`divide-y`, put `p-2` on the `<ul>`, keep the rounded hover, and separate rows
by space instead of rules. A list of soft rows with breathing room reads as
designed; a ruled table with rounded hover reads as two people editing. Also
`rounded-2xl` is a literal forbidden by §2.3 — it must be
`rounded-[var(--radius)]`. Amend §4.3 and §4.4 to match.

> **Done, with one correction and one addition — see §8.7.** The correction:
> `rounded-2xl` is **not** a forbidden literal. HeroUI redefines Tailwind's
> radius scale in terms of the theme
> (`--radius-2xl: calc(var(--radius) * 2)`, `themes/shared/theme.css`), so
> `rounded-2xl` already resolves to a token and rescales with `--radius`.
> Changing it to `rounded-[var(--radius)]` would make the pill *less*
> token-driven and a quarter of the radius. I was wrong; it stays.
> The addition: dropping `divide-y` on its own left the list with no boundary
> at rest, so the row now carries its own outline. §8.7 has the numbers.

**2 — Every row wears a chip, so no row stands out.**
`PriorityChip` renders `variant="soft"` for all three levels and `medium` is the
schema default, so a typical list is a column of near-identical warning-tinted
chips and `High` has nothing to be loud against. Render `low` and `medium` as
`variant="tertiary"` and keep `high` at `variant="soft" color="danger"`. The
word and the shape glyph (`▲`/`■`/`▼`) are untouched, so **§6.4 holds exactly as
written** — this changes only how loud the tint is. Cheapest single change that
makes the list look considered, and it is the direct fix for "everything looks
the same".

> **Done — §4.4 is the spec, with one correction this note could not have
> known.** `medium` had to give up `color="warning"` as well as the variant.
> `chip--tertiary` sets only `--chip-bg: transparent`; the colour class still
> supplies `--chip-fg`, so `tertiary` + `warning` is orange text with the fill
> removed rather than a quieter chip. Both moved levels went *up* in contrast
> (medium 5.16 → 17.72 light, 9.21 → 17.27 dark); the before/after table is in
> §4.4 and the measurements are pinned in `e2e/a11y-contrast.spec.ts`.

**3 — Give the list a shape: a completed section, with a real heading.**
With `status=all`, completed rows simply appear below the active ones and a
screen-reader user gets no signal that the list changed character halfway down.
Render a `Separator` plus `<Typography.Heading level={2}>Completed</…>` between
the groups, only when the status filter is `all` and both groups are non-empty.
This is an accessibility **gain** — a real heading to navigate by — it makes the
ordering rule visible instead of implicit, and it gives a long list the
structure it currently lacks. Needs one copy-deck string (`Completed`).

**4 — Make progress visible once, at the top.**
`{done} of {total} done` is a number nobody feels. Put a `Meter` under the page
heading — verified compound: `.Root .Track .Fill .Output`, with `color` and
`size` (`dist/components/meter/index.d.ts`) — using the existing string as its
accessible output rather than as a second label. One accent bar, at the one
place in the app where the accent means something. This is the only ornament I
would add, and it earns its place by reporting real state.

**5 — `Today` should not look like `Mar 4, 2027`.**
Overdue gets `⚠` and a warning tint (§4.4); everything else is uniform muted
grey, so the single most actionable date in the app is as quiet as a date two
years out. Give `Today` `--accent-soft-foreground`, keeping the literal word as
the carrier of meaning. §6.4 unaffected.

**6 — Four empty states, one calendar icon.**
`TodoEmptyState` takes only `heading`/`body`/`actionLabel`, so `No matches`
shows a calendar with a tick. Add an icon slot and give the search-empty state
`IconSearch` (shipped, already listed in §5). The empty state is the first
screen a new account sees; it should not look like a fallback.

**7 — Motion, deliberately small.**
The only additions I want: a 150 ms transition on the title's
`line-through`/muted change when a todo completes, and a 150 ms fade-in on a
newly inserted row. Both `motion-reduce:transition-none`, per §6.9. That is the
whole budget. No list reflow animations, no springs — this is a tool, and a
tool that wobbles is annoying by the tenth use.

### 8.5 One default I think is wrong, and one thing to remove

**Default priority.** `medium` is the schema default and the form's default
(§4.5), so almost every todo is medium and the priority chip carries almost no
information across a real list. I would rather the create form defaulted to
**low** — the honest state of a task nobody has triaged — which would make
`medium` and `high` mean something the moment a user sets one. This changes no
schema constraint (`priority` still defaults to `medium` server-side for a
payload that omits it); it changes what the form pre-selects. **This is a PM
call, not mine** — it is a claim about how users triage, and I would want them
to weigh in.

**Remove: the priority chip on completed rows.** Once a todo is done, its
priority is history and it is competing for attention with the active rows above
it. Hiding it on completed rows only removes a chip from an already-struck-out
title, and §6.4 is unaffected because completion is carried by the checkbox
state and the `line-through`, not by the chip.

> **Done, and widened by one field: the due date goes with it.** The argument
> given here for the chip was already written down for the date, in
> `src/lib/todoGroups.ts` — "a completed todo is done, so its date has nothing
> left to say" — and the row rendered the date anyway. §4.4 is the spec.

### 8.6 What I would ask PM and QA

- **PM.** (a) Does dropping the create/edit confirm modal (§8.3.1) need a
  formal reopen of the Mutation UX ruling in `docs/CONVENTIONS.md`, or can the
  lead simply rule it as they ruled sign-in? (b) The default-priority question
  in §8.5. (c) For the record: is drag-and-drop reordering being reopened
  against `docs/PRD.md` §4, or is §8.1 the end of it?
- **QA.** (a) An optimistic toggle needs the **failure** path tested, and
  `docs/QA-REPORT.md` §8 lists failure paths as never yet exercised ("no fault
  injection"). I would not ship §8.3.2 without one injected 500 proving the row
  reverts and the toast fires. (b) Is a `Meter` inside the heading row still
  clear of horizontal scroll at 320 px? (c) After §8.4.1 removes `divide-y`,
  the row's hover and focus states become the only row boundary — worth
  re-measuring `--surface-hover` against `--surface` in both themes, since
  DEF-08's light-mode headroom was already thin (3.25:1 on a hovered row).
  **(c) is answered and closed by §8.7** — the measurement came back worse than
  I feared, and the row now has an outline so that hover is no longer load
  bearing.

**If exactly one thing is taken from this note, take §8.3.** Everything in §8.4
makes the app look better; §8.3 makes it feel like it is on your side.

---

### 8.7 The row boundary — decision record

§8.4.1 was taken: `divide-y` is gone, the rows are spaced pills. In §8.6 I asked
QA to re-measure what that left behind. The answer came back worse than I
expected, and this section records what I did about it. **This is the spec for
the row boundary; §4.3, §4.4 and §4.8 now describe the outcome.**

**What the measurements said.** All ratios computed from HeroUI's own token
graph — the surface levels resolve through `color-mix(in oklab, …)` against
`--surface-foreground`, composited before comparing, not eyeballed:

| Pair | Light | Dark |
|---|---|---|
| `--surface-hover` vs `--surface` (the hover pill) | 1.20 : 1 | 1.19 : 1 |
| `--surface-secondary` vs `--surface` | 1.15 : 1 | 1.13 : 1 |
| `--surface-tertiary` vs `--surface` | 1.20 : 1 | 1.18 : 1 |
| `--border` vs `--surface` | 1.35 : 1 | 1.21 : 1 |
| `--border-secondary` vs `--surface` (**chosen**) | **1.71 : 1** | **1.78 : 1** |
| `--border-secondary` vs `--surface-hover` | 1.42 : 1 | 1.50 : 1 |
| `--border-tertiary` vs `--surface` | 2.38 : 1 | 2.66 : 1 |

**Why spacing alone was not enough.** Separation by whitespace is a perfectly
good pattern, and I would normally defend it. It works because the rows sit on a
*different plane* from their container — a card on a page, a tile on a canvas —
and the plane, not the gap, is the boundary. These tokens cannot give us a
plane: the strongest surface-on-surface pair in the theme is 1.20:1, and the
rows share `--surface` with the Card they sit in, so `gap-1.5` was six pixels of
the row's own colour. That is not whitespace separation. That is no boundary,
dressed as one. And because hover does not exist on touch and we have no
row-level focus style, a phone had no separation in **any** state.

**Not an accessibility blocker, and nobody should argue it as one.** The `<li>`
elements carry the list semantics regardless of how they are painted; a screen
reader gets item counts and boundaries either way. Nor does WCAG 1.4.11
apply — a divider between two blocks of text is not a control boundary or a
meaningful graphic, and each row's *content* meets contrast on its own. This was
purely a question of visual perception, which is exactly why it was mine to
answer rather than QA's.

**The decision: outline the row.** `border border-border-secondary` on the
`<li>`, keeping `rounded-2xl`, `gap-1.5` and `hover:bg-surface-hover`.

Its merits, in the order I weighed them:

- It is **the same token and the same strength as the rule it replaced** —
  `divide-y divide-border-secondary` was 1.71:1 light, and this is 1.71:1 light
  / 1.78:1 dark. Nobody is being asked to accept a weaker boundary than what
  already shipped; the ink simply follows the pill's shape instead of cutting
  across it. That is what makes this not a revert: the contradiction §8.4.1
  identified — hairlines running between floating pills — does not come back.
- It works **at rest, in both themes, with no pointer**, which is the mobile
  case and the one that was fully broken.
- It **demotes hover to a hover state**, which is what a hover state should be.
  1.20:1 is thin, but it no longer has to carry structure — it only has to say
  "this row, the one under your cursor", and against a boundary that is already
  visible, it does.
- The two cues are **additive**. The gap and the outline reinforce each other,
  where the old list had a rule and nothing else.

**Rejected, and why.**

- *Revert to `divide-y`.* Restores the boundary at identical contrast but
  reinstates exactly the contradiction §8.4.1 was right about.
- *Keep it as-is and write down that the weaker boundary is acceptable.* I
  cannot write that honestly. 1.00:1 at rest is not a weak boundary, it is the
  absence of one, and on mobile there is no second state to fall back to.
- *Put the rows on `--surface-secondary` or `--surface-tertiary`.* The obvious
  "different plane" move, and the tokens will not do it: 1.13–1.20:1.
- *`--border-tertiary`* (2.38 / 2.66). Legible, and too loud. A perimeter is
  four sides of ink where a divider was one; at this strength eight rows read as
  eight boxes — a table of cards, which is further from the intent than the
  hairlines were. `--border-secondary` is the ceiling here, not the floor.
- *A shadow.* Non-starter: `--surface-shadow` is `0 0 0 0 transparent inset` in
  dark mode by design, so a shadow-based boundary would exist in one theme only.
- *A colour of our own, mixed from `--foreground`.* Available — the checkbox
  fix (DEF-08) does exactly this at 50% for a real control boundary that must
  clear 3:1. A row divider does not have that requirement, and inventing a
  colour where a semantic token fits is how a token system stops meaning
  anything.

**On `--field-border-width: 0px`.** Worth naming, since it caught us once
already: it is a *field* default, and this is a plain border utility on an
`<li>`, so it does not apply. The DEF-08 trap was a HeroUI form control whose
border width the theme zeroed out from under us. Any future boundary drawn on a
HeroUI field — not on our own element — has to set its width explicitly and be
measured, not assumed.


### 8.8 The board — what §8.1 does and does not cover

*2026-08-20 — Junior dev, implementing `docs/PRD.md` US-14.*

**§8.1 declined drag-and-drop *reordering*, and that decision stands untouched.**
US-14 ships a drag that reorders nothing: the columns are the five urgency
groups `groupTodos` already computes, and a drop writes a **due date** or a
**completion** through the two routes that already exist. No `position` column,
no within-column reordering, no schema change, **no new ordering authority** —
order inside a column is the server's, exactly as in the list.

So the two are compatible rather than contradictory, and the reason is worth
stating in one line: §8.1's objection is that manual position and due-date order
are rival authorities and only one can win. This board has no position at all.
Nothing in it should be read as permission to add one.

The full reasoning — the column-to-date mapping, why `Overdue` takes no drops,
the drop-position problem and the three options weighed against it, the keyboard
story, and what would change the decision — is a decision record, per
`docs/decisions/README.md`:
**`docs/decisions/2026-08-20-board-is-a-view-not-an-order.md`**.

The specification for what shipped is §4.11 (screen), §7.20 (copy) and
`docs/PRD.md` US-14.
