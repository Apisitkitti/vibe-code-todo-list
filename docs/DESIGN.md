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
  defaults.
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
| Softer border | `--border-secondary` | Row dividers inside a card. |
| Divider line | `--separator` | Used by `Separator`. |
| Accent (brand) | `--accent` | Primary buttons, links, active filter. |
| Text on accent | `--accent-foreground` | |
| Accent tint | `--accent-soft` / `--accent-soft-foreground` | Selected filter chip. |
| Danger | `--danger` / `--danger-foreground` | Delete confirm button. |
| Danger tint | `--danger-soft` / `--danger-soft-foreground` | High-priority chip, error text. |
| Warning tint | `--warning-soft` / `--warning-soft-foreground` | Medium-priority chip, overdue date. |
| Success tint | `--success-soft` / `--success-soft-foreground` | Completed-state affordances. |
| Neutral tint | `--default-soft` / `--default-soft-foreground` | Low-priority chip. |
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
  ├─ Page heading + count
  ├─ Add-todo affordance
  ├─ Filter bar
  └─ Card (the list)
</main>
```

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

**Add-todo affordance.** A full-width primary button that opens the create
modal (§4.5). On mobile it is a normal stacked button; it is **not** a floating
action button — an FAB would overlap the last row and needs safe-area handling
we don't want.

```tsx
<Button variant="primary" fullWidth onPress={createModal.open}>New todo</Button>
```

On `sm:` and up it collapses to `sm:w-auto sm:self-start` (use
`className="sm:w-auto sm:self-start"` and drop `fullWidth` at that breakpoint by
simply not setting `fullWidth` and using `className="w-full sm:w-auto"` instead).

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

**The list.** A single `Card` containing a `<ul>`; each todo is an `<li>`
separated by a 1px bottom border, **not** by `Separator` components (one
element per row is cheaper and avoids a stray element in the a11y tree).

```tsx
<Card>
  <Card.Content className="p-0">
    <ul className="divide-y divide-[var(--border-secondary)]">
      {todos.map(t => <TodoRow key={t.id} todo={t} />)}
    </ul>
  </Card.Content>
</Card>
```

**Responsive.**

| Breakpoint | Behaviour |
|---|---|
| Mobile <640 | Page gutter `px-4`. Add button full-width. Filter bar stacks: toggle group on row 1 (`fullWidth`), search on row 2. Todo row: two lines (see §4.4). Row actions always visible. |
| Tablet 640–1023 | Gutter `sm:px-6`. Add button shrinks to content width, left aligned. Filter bar becomes one row, search pushed right with `sm:ml-auto`. Todo row: single line. |
| Desktop ≥1024 | Gutter `lg:px-8`, `py-8`. Content still capped at `max-w-2xl` — do **not** widen. Row actions fade in on hover/focus-within (`opacity-0 group-hover:opacity-100 group-focus-within:opacity-100`), but remain in the tab order at all times. |

---

### 4.4 Todo item row

Fixed left-to-right order: **checkbox → title (+ note) → priority → due date → edit → delete.**

```tsx
<li className="group flex items-start gap-3 px-4 py-3 hover:bg-[var(--surface-hover)]">
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
    <Typography type="body" weight="medium" truncate
      className={todo.completed ? "line-through text-[var(--muted)]" : undefined}>
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
| `medium` | `color="warning" variant="soft" size="sm"` | `■` | `Medium` |
| `low` | `color="default" variant="soft" size="sm"` | `▼` | `Low` |

```tsx
<Chip color="danger" variant="soft" size="sm">
  <Chip.Label><span aria-hidden="true" className="mr-1">▲</span>High</Chip.Label>
</Chip>
```

The glyph is decorative (`aria-hidden`); the word carries the meaning for
screen readers and for colour-blind sighted users alike.

**Due date.** `<Typography type="body-sm" color="muted">` inside a `<time>`:

```tsx
<time dateTime={todo.dueAt.toISOString()}>
  <Typography type="body-sm" color="muted">{formatted}</Typography>
</time>
```

Format: `Today`, `Tomorrow`, `Yesterday`, otherwise `MMM d` (same year) or
`MMM d, yyyy`. **Overdue and not completed:** prefix with `⚠` (aria-hidden) and
use `className="text-[var(--warning-soft-foreground)]"` on the `Typography`,
plus a visually-hidden `Overdue —` before the date. If `dueAt` is null render
nothing — no "No due date" placeholder, which is noise.

**Actions.** Two icon-only buttons. HeroUI ships no pencil or trash icon
(the icon set is `IconChevronDown/Up/Left/Right`, `IconPlus`, `IconMinus`,
`IconSearch`, `IconCalendar`, `CloseIcon`, `InfoIcon`, `WarningIcon`,
`DangerIcon`, `SuccessIcon`, `CircleDashedIcon`, `ExternalLinkIcon` —
verified in `dist/components/icons.d.ts`). Use inline `<svg>` with
`stroke="currentColor"`, `width={16} height={16}`, `aria-hidden="true"`.

```tsx
<Button variant="ghost" size="sm" isIconOnly aria-label={`Edit "${todo.title}"`} onPress={…}>…</Button>
<Button variant="ghost" size="sm" isIconOnly aria-label={`Delete "${todo.title}"`} onPress={…}>…</Button>
```

Wrap each in a `Tooltip` (`.Root`, `.Trigger`, `.Content`, `.Arrow`) on
`sm:` and up only; tooltips are useless on touch. The `aria-label` is the
accessible name regardless.

**Responsive.** Mobile: the title and the priority/date cluster stack (`flex-col`),
actions column stays on the right, always at full opacity. Tablet+: one line
(`sm:flex-row sm:items-center`). Desktop: actions hidden until hover/focus-within.

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
`{ isOpen, setOpen, open, close, toggle }`) and pass it as `Modal`'s `state` prop.
Do **not** use `Modal.Trigger` here — the same modal is opened from the page
button and from every row's edit button.

```tsx
const state = useOverlayState();

<Modal state={state}>
  <Modal.Backdrop variant="blur">
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
</Modal>
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
<ul className="divide-y divide-[var(--border-secondary)]" aria-busy="true" aria-label="Loading todos">
  {Array.from({ length: 4 }).map((_, i) => (
    <li key={i} className="flex items-center gap-3 px-4 py-3">
      <Skeleton className="size-5 rounded-[var(--radius)]" />
      <Skeleton className="h-4 flex-1 rounded-[var(--radius)]" />
      <Skeleton className="h-5 w-16 rounded-[var(--radius)]" />
    </li>
  ))}
</ul>
```

Match the skeleton row geometry to the real row (`px-4 py-3`, `gap-3`) so
nothing shifts on swap.

**In-button pending.** `Spinner` — only `.Root`; `size`:
`"sm" | "md" | "lg" | "xl"`; `color`: `"current" | "accent" | "success" | "warning" | "danger"`.
Inside a button always use `color="current"` so it inherits the button
foreground. Keep the button width stable: render
`<Spinner size="sm" color="current" />` plus the pending label, and set
`isDisabled` rather than swapping the element.

**Row-level pending** (toggle, delete): apply `opacity-60 pointer-events-none`
to the `<li>`. No spinner — these are optimistic.

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
   - Priority: the `Chip` always renders the **word** (`High`/`Medium`/`Low`)
     plus a distinct shape glyph (`▲`/`■`/`▼`). A user in greyscale must still
     be able to rank them.
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
| Add button | `New todo` |
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
| No todos | `Nothing here yet` | `Add your first todo and it will show up here.` | `New todo` |
| Filter=active, none | `All caught up` | `You have no active todos. Nice.` | — |
| Filter=completed, none | `Nothing completed yet` | `Todos you finish will appear here.` | — |
| Search, no match | `No matches` | `No todos match "{query}".` | `Clear search` |

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

Added for the "Mutation UX" section of `docs/CONVENTIONS.md`: every create,
update, toggle and delete is confirmed first and reports its outcome in a
toast that names the record. These success-toast strings supersede the
generic ones in §7.5 and §7.6.

| Slot | String |
|---|---|
| Confirm cancel (all) | `Cancel` |
| Create confirm heading | `Add this todo?` |
| Create confirm body | `“{title}” will be added to your list.` |
| Create confirm action | `Add todo` |
| Create confirm pending | `Adding…` |
| Update confirm heading | `Save these changes?` |
| Update confirm body | `“{title}” will be updated.` |
| Update confirm action | `Save changes` |
| Update confirm pending | `Saving…` |
| Complete confirm heading | `Mark this todo complete?` |
| Complete confirm body | `“{title}” will be marked complete.` |
| Complete confirm action | `Mark complete` |
| Reopen confirm heading | `Mark this todo not complete?` |
| Reopen confirm body | `“{title}” will be moved back to active.` |
| Reopen confirm action | `Mark not complete` |
| Toggle confirm pending | `Updating…` |
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

Added for the team lead's ruling recorded in `docs/CONVENTIONS.md` →
Mutation UX: the confirm-modal rule applies literally to both auth forms.
Both use the non-destructive `ConfirmDialog` variant, so the primary action
is autofocused and `Cancel` (§7.11) closes without submitting.

| Slot | String |
|---|---|
| Sign in confirm heading | `Sign in to your account?` |
| Sign in confirm body | `You’ll be signed in as “{email}”.` |
| Sign in confirm action | `Sign in` |
| Sign in confirm pending | `Signing in…` |
| Sign in success toast | `Signed in as “{email}”` |
| Sign in failure toast | *(the same message shown in the `Sign in failed` Alert)* |
| Sign up confirm heading | `Create this account?` |
| Sign up confirm body | `An account will be created for “{email}”.` |
| Sign up confirm action | `Create account` |
| Sign up confirm pending | `Creating account…` |
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
| Undo failure toast | `Couldn’t undo that. Try again.` |
| Sign out failure toast | `Couldn’t sign you out. Try again.` |

### 7.14 Malformed request

Added for review finding M-3: a `400` whose zod failure sits at the root of the
body (unparseable JSON, an array, a bare string, a body mixing toggle and form
fields) has no field to attach a message to. It must not borrow the *404* copy,
which would tell the user their todo was deleted.

| Slot | String |
|---|---|
| Malformed request body | `That request wasn’t valid.` |

Punctuation notes: use the typographic apostrophe (`'`) in contractions
(`don't`, `can't`, `Couldn't`) and curly double quotes around interpolated
titles in prose. Use the ellipsis character `…`.
