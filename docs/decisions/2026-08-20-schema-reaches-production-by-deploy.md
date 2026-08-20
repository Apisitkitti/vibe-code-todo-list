# Schema reaches production through the deploy, not through a person

**What was decided.** `prisma/migrations/` is now the only route schema takes to
any database, and `vercel.json` runs `prisma migrate deploy` as part of the
deploy's build command — before `next build` — so a release cannot ship code
whose schema has not been applied.

## What raised it

There was no `prisma/migrations/`. The app used `prisma db push`, CI pushed the
schema to a throwaway Postgres, and Vercel's build was
`prisma generate && next build`. **Nothing applied schema to Neon.**

The consequence is worse than it first sounds, and this is the part worth
keeping. Prisma's `findMany` with no `select` names every scalar column in the
generated SQL. So a column that exists in `schema.prisma` and not in the
database does not degrade the feature that uses it — it fails the whole query.
`src/app/api/todos/route.ts` `GET` has no `try`/`catch` around
`prisma.todo.findMany`, so the throw becomes a 500. **Every list query, for
every user, on deploy.**

Verified rather than reasoned about. Against a scratch database with the
`createdVia` column dropped, the real generated client raised:

```
PrismaClientKnownRequestError  code=P2022
The column `todo.createdVia` does not exist in the current database.
```

`createdVia` was applied to Neon by hand with `psql`, and `docs/WORKFLOW.md`
documented that sequence honestly. Documenting it is what made it durable: a
runbook is a control that depends on someone remembering, and QA had already
called this the highest-probability catastrophic event in the repository.

## Why

**`migrate deploy` before `next build`, not after, and not as a post-deploy
step.** A migration that fails takes the build down with it, and the version
already deployed keeps serving. Running it after the build — or after traffic
cuts over — creates a window in which new code selecting a new column is live
against a database that lacks it, and by the mechanism above that window is not
a partial outage, it is a total one on every list.

**In `vercel.json`'s `buildCommand`, not in the `build` script.** `migrate
deploy` needs a reachable database. Folding it into `build` would make
`npm run build` — what a developer runs to check that a change compiles — fail
on a machine with no Postgres running, and fail with `P3005` on any local
database predating `prisma/migrations`. Deploys are the only place the migration
must run, so they are the only place it is wired.

**Rejected: keeping `db push` in CI.** CI now runs the same `migrate deploy`
production runs, plus a `migrate diff --exit-code` step. Under `db push` the
migration files could be wrong — malformed SQL, or simply absent for a committed
schema edit — and CI would still be green, because it built its tables from
`schema.prisma` and never read the migrations at all.

**Rejected: a `"//"` comment key in `vercel.json`.** This reasoning was first
written into that file as a `"//"` array. Vercel's schema rejects it:

```
The `vercel.json` schema validation failed with the following message:
should NOT have additional property `//`
```

JSON has no comment syntax, and the `"//"` convention that several tools tolerate
is not tolerated here. It is a clean instance of the rule in
`.claude/agents/_shared-rules.md` about reading the installed tool's own rules
rather than reusing a syntax remembered from elsewhere — it looked fine, it
parsed, and it failed at the one validator that mattered. Hence this file.

## Baselining an existing database

`migrate deploy` refuses a non-empty database with no migration history —
`P3005`, exit 1, **without modifying anything**, which was confirmed against a
populated scratch database whose rows survived intact. Baselining records
`0_init` as applied without running its SQL:

```
DATABASE_URL='…' npx prisma migrate resolve --applied 0_init
```

**`resolve --applied` writes a history row and executes no SQL**, so if the
database does not actually match the migration, it records a state that was
never true and the drift is never repaired. Check first — read-only, exit 0 when
identical and 2 when not, `--script` in place of `--exit-code` to print the SQL
still missing:

```
DATABASE_URL='…' npx prisma migrate diff \
  --from-config-datasource --to-schema prisma/schema.prisma --exit-code
```

In Prisma 7.9.1 only `db push` still accepts `--url`; `migrate deploy`,
`status`, `resolve` and `diff` read the datasource from `prisma.config.ts`. They
are pinned by setting `DATABASE_URL` for the command, which works because
`process.loadEnvFile` does not overwrite an already-set variable — verified,
because the failure mode would have been silent.

## What would change this

- If a migration ever needs to run against a database the build cannot reach,
  `buildCommand` stops being the right place and this moves to a release step
  with its own credentials.
- A destructive change — a drop or a rename — is not covered here. The old code
  is still serving traffic while the migration runs, so those need an expand /
  migrate / contract sequence across two deploys, and this record should not be
  read as blessing them.
- If deploys ever become concurrent, `migrate deploy` has no lock of its own
  beyond Postgres's advisory lock, and that assumption needs revisiting.
