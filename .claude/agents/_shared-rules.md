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
