# House rules (every role)

Not an agent — the rules each agent file below repeats. Kept here so there is
one place to change them.

## Never read a result through a pipe

`cmd | tail` reports the exit code of `tail`, and truncates the line that
mattered. This has produced a false conclusion for four different people on
this project: an eslint error swallowed into a commit; a review finding based
on `grep -rl … | head -5` reported as "absent from every installed package"
when the unpiped search returned 50 files; a "152 passed" that was hiding
"13 failed"; and a wrapper reporting exit 1 from a trailing `grep -c` that
exits 1 on the success case.

    cmd > /tmp/x.log 2>&1; echo "EXIT=$?"

Then read the file. Every gate is judged by its own recorded exit code.

## Never kill a process you did not start

A busy port belongs to someone, possibly another project entirely. QA once
killed an unrelated project's dev server. Pick a free port, use it, stop only
what you started.

## Never point anything at production

`.env` should read `DATABASE_URL="postgresql://postgres:…@127.0.0.1:5432/todo_app_dev"`.
Verify it before any database command rather than assuming — a worktree copy
was found inverted, pointing at Neon, and nobody could explain how. Pin
`--url` explicitly on Prisma commands. The suites resolve `todo_app_test`
through `resolveTestDatabaseUrl`; a bare Prisma command has no such guard.

## Say what is true, including about yourself

Every role on this team has been wrong in writing and said so, and each time
it was the most useful line in the report. Report what you ran, what it
returned, and which parts you verified by execution versus by reading. If a
mutation survived, say it survived. If you could not reproduce something, say
so rather than reporting the conclusion you expected.

## Distrust what you remember about a library

Every dependency here has moved under someone this quarter, and the pattern
is always the same: an API that worked the way you expect in the version you
learned, and does not any more. The failure is silent — the command exits 0,
the component renders, the test passes — until it does not.

What this project has already paid for:

- `prisma db push --skip-generate` does not exist in Prisma 7. Neither does
  `prisma migrate diff --from-url`, which was replaced by
  `--from-config-datasource`. Both were used from memory and both failed.
- HeroUI v3 is a react-aria-components rewrite, not v2 with new styles. Six
  defects came from composing it the way the old API allowed: `Modal`'s root
  is a `DialogTrigger` that wraps children in a `PressResponder` for a trigger
  that never registers; `Typography` claims `MenuItem`'s label slot, so a date
  preview became the item's whole accessible name; `useMediaQuery` reads
  `matchMedia` on the first client render, so a media-gated view hydrates
  against a server render that chose the other one.
- Next 16 replaced `middleware.ts` with `proxy.ts`, and generates route types
  into `.next` — so `tsc` fails with phantom errors until a build regenerates
  them. `AGENTS.md` says to read `node_modules/next/dist/docs/` before writing
  code, and it says so because this version differs from what most models
  learned.

So: **read the installed version's own documentation before you use an API
you have not used in this repo before.** Not the web, not memory —
`node_modules/<pkg>/`, the `.d.ts`, the package's own docs directory. Check
what the version in `package.json` actually is first; `^` in a dependency
means the installed version is not necessarily the one you last read about.

When you find that the documentation and the installed code disagree, the
installed code wins and the disagreement is worth reporting.

## Verify a change landed before you interpret its result

A command that did nothing usually exits 0. A `sed` whose pattern did not
match, a `perl` substitution that silently applied zero times, an edit written
to the wrong path — all succeed, and then the result you measure is the result
of doing nothing.

This has produced three false conclusions here, every one of them a mutation
reported as *surviving* when it had never been applied. Each time it read as
"the tests do not cover this", which is the opposite of the truth.

Before you draw a conclusion from a change, assert the change exists:
`git diff --name-only` non-empty, or grep the new text back out of the file.
If you are running a set of mutations, make the runner refuse to proceed when
the patch did not apply, rather than trusting yourself to remember.
