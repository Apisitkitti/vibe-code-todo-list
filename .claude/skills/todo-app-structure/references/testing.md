# Tests

Read before writing a test or touching CI.

## Three suites, three jobs

| Suite | Runner | Talks to | Put a test here when |
|---|---|---|---|
| `tests/unit/` | Vitest | nothing | The property is arithmetic over values — a parser, a predicate, a reducer |
| `tests/api/` | Vitest | real Postgres | The answer depends on the database: authorization, ordering, collation, the wire contract |
| `e2e/` | Playwright | real browser + dev server | It is only true once the DOM exists: focus, keyboard journeys, toasts, contrast |

**`tests/api/` does not go over a socket.** It imports the route handler and
calls it as a plain function with a real `NextRequest`, so URL parsing,
`searchParams` and JSON body reading all run for real, against a real database,
with a real better-auth cookie. What it does not exercise is the network, Next's
routing, or `src/proxy.ts`.

That shape has a consequence you must reproduce in a new file: the handler reads
the session through `next/headers`, so mock it and drive it from the support
helpers.

```ts
vi.mock("next/headers", () => ({ headers: async () => currentRequestHeaders() }));

// then, per request:
setRequestHeaders(headersWithCookie(userA.cookie));
const response = await GET(getRequest("/api/todos?status=all"));
```

The mock has to be declared **above** the handler imports, because the handler
resolves `next/headers` at import time.

Put a test at the **lowest layer that can actually fail for the reason you care
about.** `src/lib/todoListState.ts` exists because the optimistic revert is the
only correctness property optimistic state has, and a browser cannot be asked to
prove that a rollback restored the exact value, the exact count and the exact
section — pure functions can, and a unit test does.

The converse also holds: do not unit-test a claim about the database. Restating
a `where` clause in a unit test asserts that you can retype it.
`tests/api/filterPredicate.test.ts` instead asserts the property that matters
against the real handler — *anything the client predicate calls hidden is
genuinely absent from the response.*

## Running them

```bash
npm run test:run     # Vitest, once
npm run test:e2e     # Playwright
```

Never read either through a pipe. `| tail` reports the exit code of `tail` and
truncates the decisive line; that has produced four separate false conclusions
on this project. Redirect to a file, record `$?` on its own line, read both back.

## Isolation

Tests **create their own accounts through the real sign-up endpoint and only
ever see rows they created.** Nothing inserts a session row by hand, so
`getSession()` does a genuine lookup and the isolation assertions rest on the
real auth path rather than on a fixture that agrees with itself. That is what
lets the suites share one `todo_app_test` database.

Two different mechanisms, so copy the right one:

- **`tests/api/`** — each file creates its users with its own `EMAIL_DOMAIN` and
  deletes them afterwards. `vitest.config.ts` sets `fileParallelism: false`
  precisely because of this: run the files in parallel and one file's cleanup
  deletes another's rows.
- **`e2e/`** — each test signs up its own account through the browser, via
  `e2e/support/fixtures.ts`.

Either way it holds only as long as nobody writes a test that counts rows
globally or truncates a table. **Do not write one.** If you need a count, scope
it to your own account.

`tests/setup/testDatabaseUrl.ts` and `e2e/support/testDatabaseUrl.ts` refuse a
hosted host, any database not named `*_test`, and the app's own URL — so aiming
a suite at production is not something a stray env var can do by accident. Keep
that guard; it is the only thing standing between a test sign-up and real data.

## Timezone

CI runs at `TZ=Pacific/Kiritimati` (UTC+14) deliberately. At UTC the date
logic's two calendars — the UTC day a `dueAt` falls on, and the viewer's local
day — are the same value, so a test that confuses them still passes. Collapsing
the two once made 187 tests pass at UTC and redden 12 at UTC+14. The offset is
what makes the date tests discriminate rather than merely run. Do not "fix" a
date test by removing it.

## Two hazards that have each cost a night

**The e2e port.** `playwright.config.ts` reuses an existing server rather than
fighting for the port, so a second worktree adopts the first one's dev server
and reports a pass for code it never ran. Set `E2E_PORT` to something other than
3117 in every worktree but one. CI leaves it unset — one checkout, one port,
and `reuseExistingServer` is off there.

**The shared database.** Two worktrees resolve the same `todo_app_test`, so two
suites running at once share it. Account-scoped isolation holds; a global count
would not.

Never kill a process you did not start: a busy port belongs to someone, possibly
to another project entirely.

## What a test has to do to be worth having

- **Watch it fail first.** A green check you have never seen go red is a claim,
  not a control. CI once ordered the test step after a gate that always failed,
  so the suite never ran at all and the job reported success.
- **Assert something that can be false.** A `toHaveCount(0)` that retries past
  the moment the thing would have appeared cannot fail. Pin the moment.
- **Prefer a property to a restatement.** "Anything called hidden is genuinely
  absent" survives a change to the clause; a copy of the clause does not.
- **Assert copy through `e2e/support/copy.ts`**, not inline strings. Curly and
  straight quotes are not interchangeable — toast prose uses `“ ”`, `aria-label`s
  built from a raw title use `"`. Asserting the wrong one is the difference
  between a passing test and a test that silently matches nothing.

## Definition of done

`rm -rf .next`, then build, typecheck, lint, both suites — each exit code
recorded and read back. `npm run build` before `npx tsc --noEmit`: the build
generates the route types under `.next/types`, and without them `tsc` reports
errors about `RouteContext` and `PageProps` that have nothing to do with your
change.
