# Git workflow

## Branches

```
main                 production — auto-deploys to Vercel on every push
 └── develop         integration — QA tests here
      ├── feature/…  new work, branched from develop
      └── fix/…      bug fixes, branched from develop
```

- **`main`** is deployed automatically. Nothing is pushed to it directly;
  it only ever receives what has already been through `develop`.
- **`develop`** is the integration branch. Once work lands here, QA can test it.
- **`feature/…` and `fix/…`** always branch from `develop`, never from `main`.

Branch names are kebab-case after the prefix:

```
feature/todo-search
feature/user-avatar
fix/duplicate-toast
fix/session-expiry-redirect
```

## Daily flow

```bash
git checkout develop
git pull

git checkout -b feature/todo-search
# …work…
git push -u origin feature/todo-search
```

Open a pull request into `develop`, get the Senior review, then merge.
Releases go out by merging `develop` into `main`.

## Commit messages

Conventional Commits. The type prefix is required:

| Type | Use for |
|---|---|
| `feat:` | a new user-facing capability |
| `fix:` | a bug fix |
| `chore:` | tooling, dependencies, config, housekeeping |
| `refactor:` | restructuring with no behaviour change |
| `docs:` | documentation only |
| `test:` | tests only |
| `style:` | formatting only, no logic change |

```
feat: add priority filter to the todo list
fix: reject backslash paths in the next= redirect
chore: upgrade prisma to 7.9
refactor: extract shared form fields into components/ui
```

Rules:

- Lower case after the colon, no trailing period.
- Imperative mood: "add", not "added" or "adds".
- The subject says **what changed**; the body says **why**, when the why is
  not obvious. A reviewer should not have to read the diff to learn the intent.
- One logical change per commit. A refactor and a bug fix are two commits.

## Review gate — required before merging into `develop`

Every pull request into `develop` gets a Senior review first. No exceptions,
including small ones.

The review covers correctness and the rules in `docs/CONVENTIONS.md`, but the
**primary lens is readability**:

> Code is read by people, not only by an AI. A reviewer with no context should
> be able to follow it.

Specifically, the reviewer checks that:

- Names say what the thing is. A reader should not have to trace a variable to
  learn what it holds. No `data`, `tmp`, `handleThing2`.
- Functions do one thing and are short enough to hold in your head. A function
  that needs section comments to be navigable wants splitting.
- Nesting is shallow. Prefer early returns over an `else` pyramid.
- Comments explain **why**, not what. The what is already in the code; a
  comment restating it goes stale and starts lying.
- Non-obvious decisions carry a short note — a workaround, a spec reference, an
  ordering that matters. Anything a reader would otherwise "fix" by accident.
- Consistent with the code around it. A file should not read as though two
  people with different habits took turns.
- No dead code, no commented-out blocks, no leftover debug logging.
- The diff is reviewable: no unrelated reformatting mixed into a logic change.

A reviewer who has to ask "what does this do?" has found a defect, even when
the code is correct.

## QA

QA tests on `develop`, against `docs/PRD.md` acceptance criteria. A story is
not done until it passes there — merging into `develop` is what makes it
testable, not what makes it finished.

## Definition of done for a pull request

1. `npx tsc --noEmit` clean
2. `npm run lint` clean
3. `npm run build` succeeds
4. Senior review approved
5. Commits follow the convention above

## Two branches at once

Parallel work goes in a `git worktree`, one checkout per branch, so neither
side edits files the other has open. Two things do not separate themselves:

- **The e2e port.** `playwright.config.ts` reuses an existing server rather
  than fighting for the port, which means a second worktree adopts the first
  one's dev server and reports a pass for code it never ran. Set `E2E_PORT` to
  something other than 3117 in every worktree but one. This has already cost a
  night of chasing flakes that were one branch testing another's build.
- **The database.** Both worktrees resolve the same `todo_app_test`, so two
  suites running at the same moment share it. The account-scoped isolation in
  `e2e/support/fixtures.ts` holds — every test signs up its own account and
  only ever sees rows it created — but any test that counts rows globally or
  truncates a table would not. Don't write one.

Never kill a process you did not start: a port that is busy belongs to someone,
possibly to another project entirely.

## Schema changes

The schema reaches every database — yours, CI's and production's — by the same
route: files in `prisma/migrations/`, applied with `prisma migrate deploy`.

This used to be a manual step. There was no `prisma/migrations/`, the app used
`prisma db push`, and Vercel's build was `prisma generate && next build`, so
**nothing applied schema to Neon**. A branch that added a column shipped code
expecting a column production did not have, and because Prisma selects every
scalar field, a missing one does not degrade a feature — every list query 500s,
for everyone, on deploy. The control was this paragraph asking someone to
remember `psql` first. `createdVia` was applied that way.

The deploy now applies it instead: `vercel.json` sets `buildCommand` to
`prisma generate && prisma migrate deploy && next build`. The migration runs
**before** `next build`, so a migration that fails fails the build and the
currently deployed version keeps serving.

`vercel.json` carries no explanation of its own — Vercel's schema sets
`additionalProperties: false` and rejects even a `"//"` comment key. The
reasoning, including the P2022 failure it prevents and the alternatives that
were rejected, is in
[`docs/decisions/2026-08-20-schema-reaches-production-by-deploy.md`](decisions/2026-08-20-schema-reaches-production-by-deploy.md).

### Making a schema change

```bash
# Edit prisma/schema.prisma, then:
npx prisma migrate dev --name add_the_thing
```

That writes `prisma/migrations/<timestamp>_add_the_thing/migration.sql`, applies
it to your database, and regenerates the client. **Commit the migration
directory with the schema change** — they are one commit, and CI fails them
apart: a `migrate diff --exit-code` step checks that the migrations still
reproduce `schema.prisma`.

Keep changes additive and reversible. A new column is nullable with no default,
so existing rows are not backfilled with an answer nobody measured — see the
note on `createdVia` in `prisma/schema.prisma` for why that mattered. Anything
that drops or renames a column needs more care than this section covers: the
old code is still serving traffic while the new migration runs.

### Preparing a database that predates migrations

A database built by the old `db push` has the tables but no migration history,
so `migrate deploy` stops with `P3005: The database schema is not empty`.
Baseline it once — this records the first migration as applied without
re-running its SQL:

```bash
DATABASE_URL='postgresql://postgres@127.0.0.1:5432/todo_app_dev' \
  npx prisma migrate resolve --applied 0_init
DATABASE_URL='postgresql://postgres@127.0.0.1:5432/todo_app_dev' \
  npx prisma migrate deploy
```

**Check before you baseline.** `resolve --applied` writes a history row and runs
no SQL, so if the database does not actually match the migration, it records a
state that was never true and the drift never gets repaired. This is read-only
and says whether they match — exit 0 for identical, exit 2 for drift, and
`--script` instead of `--exit-code` prints the SQL that is still missing:

```bash
DATABASE_URL='...' npx prisma migrate diff \
  --from-config-datasource --to-schema prisma/schema.prisma --exit-code
```

### Pinning the database on a Prisma command

In Prisma 7.9.1 only `db push` still takes `--url`; `migrate deploy`, `status`,
`resolve` and `diff` all read the datasource from `prisma.config.ts`. Pin them
by setting `DATABASE_URL` for the command, as above — `process.loadEnvFile`
does not overwrite a variable that is already set, so the inline value wins over
`.env` rather than losing to it. Verified, because the failure mode is silent.
