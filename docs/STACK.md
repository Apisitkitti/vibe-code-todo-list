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
npm run db:deploy  # prisma migrate deploy — apply migrations
npm run db:status  # prisma migrate status — what is applied where
npm run lint
npx tsc --noEmit   # typecheck
```

## Deployment region

`vercel.json` pins functions to **`sin1` (Singapore)** because the Neon
database is in `ap-southeast-1`. Without it Vercel defaults to `iad1`
(Washington DC), and every query crosses the Pacific — twice, since a request
that touches the database does at least one session lookup before its own
query.

That single hop is not a tuning detail here. Rendering `/todos` costs a
session lookup in the layout, then the client's list fetch costs another
session lookup plus the list query. At ~200ms of round trip each, the region
mismatch alone accounts for most of a slow first byte, and no amount of
application work recovers it.

Keep the function region and the database region equal. If the database
moves, this file moves with it.

## Schema changes against production

Schema reaches every database through `prisma/migrations/`, applied by
`prisma migrate deploy`. `vercel.json` runs it in `buildCommand` before
`next build`, so a deploy applies its own schema. The procedure this section
used to describe — apply the DDL by hand, then `db push` — is gone; see
[`docs/decisions/2026-08-20-schema-reaches-production-by-deploy.md`](decisions/2026-08-20-schema-reaches-production-by-deploy.md)
and `docs/WORKFLOW.md` → "Schema changes".

**Do not run `prisma db push` against production.** It was the old procedure and
it is now actively harmful: production has migration history, and `db push`
applies schema without writing a `_prisma_migrations` row. The database silently
stops matching its recorded history, and the next `migrate deploy` either
re-applies something already present or reports drift nobody can explain.
`npm run db:push` remains for local prototyping against a throwaway database
only — reconcile it into a real migration before committing.

### Index changes still need hand-written SQL

Migrations solve *delivery*, not *locking*. `prisma migrate dev` generates a
plain `CREATE INDEX`, and on a live table the statements it writes take locks
that stop the app:

- a non-concurrent `CREATE INDEX` holds a `SHARE` lock, blocking every write for
  the whole build
- `DROP INDEX` takes `ACCESS EXCLUSIVE`, which blocks reads too, and queues
  behind in-flight queries — taking new requests with it while it waits

So for an index change on a table with real rows, generate the migration and
then **edit the SQL by hand** before committing it, keeping this order —
**create always comes before drop**:

```sql
-- 1. Build the new index without blocking writes.
CREATE INDEX CONCURRENTLY "todo_userId_completed_dueAt_idx"
  ON "todo" ("userId", "completed", "dueAt");

-- 2. Only then remove the one it replaces.
DROP INDEX CONCURRENTLY "todo_userId_completed_idx";
```

Two things that were true of the by-hand procedure are still true, and one is
new:

- **Confirm the new index is valid before dropping the old one.** A failed
  concurrent build leaves an invalid index that costs every write and serves no
  read: `SELECT indisvalid FROM pg_index WHERE indexrelid =
  '"todo_userId_completed_dueAt_idx"'::regclass;` — and confirm the planner uses
  it on production-sized data with `EXPLAIN`. Keeping a redundant index is
  cheap; dropping the wrong one under load is not. If the `EXPLAIN` is
  inconclusive, ship the create and leave the drop for a later migration.
- **`CREATE INDEX CONCURRENTLY` does work inside a Prisma migration**, which is
  worth stating because the opposite is widely assumed — Postgres forbids it in
  a transaction block, and many migration tools wrap each migration in one.
  Prisma 7.9.1 does not, for PostgreSQL. Verified: a migration containing only
  `CREATE INDEX CONCURRENTLY` applied through `migrate deploy` with exit 0 and
  left `indisvalid = t`. The first draft of this section asserted the reverse
  from memory and the test contradicted it.
- **A migration that fails halfway is not rolled back**, and it blocks every
  subsequent deploy with `P3009` until a human resolves it. That is the single
  biggest operational hazard of putting migrations in the build path; the
  recovery commands are in the decision record's "What would change this".


## Definition of done

1. `npx tsc --noEmit` clean
2. `npm run lint` clean
3. `npm run build` succeeds
4. Every DB read/write scoped to the session user
