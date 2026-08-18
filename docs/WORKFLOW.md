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

## Schema changes reach production by hand

This project has no `prisma/migrations/`; it has always used `prisma db push`,
and CI pushes the schema to a throwaway database. Vercel's build runs
`prisma generate && next build` — **nothing applies schema to Neon**. A branch
that adds a column therefore ships code that expects a column production does
not have, and Prisma selects every scalar field, so a missing one does not
degrade a feature: every list query 500s.

So a schema change is two deploys' worth of care in one:

1. Apply the DDL to Neon **before** merging to `main`, additively — a new
   column nullable, no default, so existing rows are not backfilled with an
   answer nobody measured.
2. Record the exact DDL in the pull request, since the repo does not.
3. Only then merge, and check the first write of that shape after the deploy.

`createdVia` was the first change where this mattered and it was applied this
way. Anything that drops or renames needs more than this note.
