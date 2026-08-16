# Stack & Conventions — read this before writing any code

Project root: `/Users/ikaooat/Practice/todo-app`

## Runtime

- **Node 24** via nvm. Every shell command must be prefixed:
  `export NVM_DIR="$HOME/.nvm" && . "$NVM_DIR/nvm.sh" && nvm use 24 >/dev/null && <cmd>`
- **npm** only. Never bun, never pnpm, never yarn.

## Stack

| Layer | Choice |
|---|---|
| Framework | Next.js 16.3.1, App Router, Turbopack, `src/` dir, alias `@/*` |
| React | 19.2.8 |
| Styling | Tailwind CSS v4 (CSS-first config, no `tailwind.config.js`) |
| Components | HeroUI **v3** (`@heroui/react` 3.2.4) |
| Auth | better-auth 1.6.28 (email + password) |
| ORM | Prisma 7.9 with the `pg` driver adapter (`prisma/schema.prisma`, `prisma.config.ts`) |
| DB | Neon Postgres (pooled connection) |
| Deploy | Vercel |

## Next.js 16 notes

`AGENTS.md` at repo root warns this Next version differs from training data.
Docs are bundled at `node_modules/next/dist/docs/` — read the relevant guide
before writing routing / data-fetching / caching code.

Known differences already hit:

- Layout props are typed `LayoutProps<"/">`, page props `PageProps<"/route">` —
  generated types, do not hand-roll `{ params }` interfaces.
- `params` and `searchParams` are Promises — `await` them.
- **`middleware.ts` is deprecated and renamed to `proxy.ts`.** Same
  functionality, new file name and export name (`export function proxy(request)`),
  placed at `src/proxy.ts`. Do not create a `middleware.ts`.
- Proxy is for optimistic redirects only — it is explicitly *not* a session
  management or authorization solution. Real authorization happens in the
  server component / route handler / server action that touches data.

## HeroUI v3 — NOT v2

v3 is a rewrite on top of `react-aria-components`. **Do not use v2 API from memory.**

- No `HeroUIProvider`, no `NextUIProvider`, no framer-motion.
- Styles come from one CSS import, already wired in `src/app/globals.css`:
  ```css
  @import "@heroui/react/styles";
  ```
- Dark mode is class-based: `.dark` on `<html>`.
- Components are **compound**, not prop-driven:
  ```tsx
  <Card>
    <Card.Header>
      <Card.Title>…</Card.Title>
      <Card.Description>…</Card.Description>
    </Card.Header>
    <Card.Content>…</Card.Content>
    <Card.Footer>…</Card.Footer>
  </Card>
  ```
- Text fields compose: `TextField` (root, holds value/validation) wraps
  `Label`, `Input`, `Description`, `FieldError`.
- Available components — check before importing:
  accordion, alert, alert-dialog, autocomplete, avatar, badge, breadcrumbs,
  button, button-group, calendar, card, checkbox, checkbox-group, chip,
  close-button, combo-box, date-picker, description, disclosure, drawer,
  dropdown, empty-state, error-message, field-error, fieldset, form, header,
  input, input-group, input-otp, kbd, label, link, list-box, menu, meter,
  modal, number-field, pagination, popover, progress-bar, progress-circle,
  radio, radio-group, scroll-shadow, search-field, select, separator,
  skeleton, slider, spinner, surface, switch, table, tabs, tag, textarea,
  textfield, time-field, toast, toggle-button, toolbar, tooltip, typography.
- **Verify any prop before using it.** Types live at
  `node_modules/@heroui/react/dist/components/<name>/index.d.ts`.
  Guessing a v2 prop that no longer exists is the #1 failure mode here.

## Files already in place (foundation — do not rewrite without reason)

| Path | Purpose |
|---|---|
| `prisma/schema.prisma` | User, Session, Account, Verification, Todo, Priority enum |
| `src/lib/prisma.ts` | Singleton PrismaClient on `PrismaPg` (dev hot-reload safe) |
| `src/generated/prisma` | Generated client — gitignored, rebuilt by `prisma generate` |
| `src/lib/auth.ts` | better-auth server instance, prismaAdapter, `nextCookies()` |
| `src/lib/auth-client.ts` | client hooks: `signIn`, `signUp`, `signOut`, `useSession` |
| `src/app/api/auth/[...all]/route.ts` | better-auth handler |
| `src/app/globals.css` | HeroUI + Tailwind entry |

## Data model

`Todo`: `id, title, note?, priority(low|medium|high), completed, dueAt?, userId, createdAt, updatedAt`

Every todo is scoped to `userId`. **Every query must filter by the session
user's id** — no exceptions, this is the core authorization rule.

## Env

`.env.local` holds `DATABASE_URL`, `BETTER_AUTH_SECRET` and `BETTER_AUTH_URL`,
and is gitignored. Prisma 7 no longer auto-loads env files, so
`prisma.config.ts` loads it explicitly via `process.loadEnvFile`.
Never print, commit, or paste these values.

## Commands

```bash
npm run dev        # next dev
npm run build      # prisma generate && next build
npm run db:push    # prisma db push
npm run lint
npx tsc --noEmit   # typecheck
```

## Schema changes against production

There is no migration history — the project uses `prisma db push`, which
applies whatever the schema file says with no reviewable artifact and no
ordering guarantee. That is survivable for a table nobody is reading yet. It
is not survivable for an index change on a live table, because the plain
statements `db push` issues take locks that stop the app:

- a non-concurrent `CREATE INDEX` holds a `SHARE` lock, blocking every write
  for the whole build
- `DROP INDEX` takes `ACCESS EXCLUSIVE`, which blocks reads too, and queues
  behind in-flight queries — taking new requests with it while it waits

So an index change goes out by hand, in this order, and **create always comes
before drop**:

```bash
# 1. Build the new index without blocking writes.
CREATE INDEX CONCURRENTLY "todo_userId_completed_dueAt_idx"
  ON "todo" ("userId", "completed", "dueAt");

# 2. Confirm it is valid. A failed concurrent build leaves an invalid index
#    that costs every write and serves no read.
SELECT indisvalid FROM pg_index
  WHERE indexrelid = '"todo_userId_completed_dueAt_idx"'::regclass;

# 3. Confirm the planner uses it, on production-sized data.
EXPLAIN SELECT … ;

# 4. Only then remove the one it replaces.
DROP INDEX CONCURRENTLY "todo_userId_completed_idx";

# 5. `db push` last, where it should be a no-op that re-syncs the shadow.
npx prisma db push
```

Keeping a redundant index is cheap; dropping the wrong one under load is not.
If step 3 is inconclusive, stop after step 2 and leave both in place.

## Definition of done

1. `npx tsc --noEmit` clean
2. `npm run lint` clean
3. `npm run build` succeeds
4. Every DB read/write scoped to the session user
