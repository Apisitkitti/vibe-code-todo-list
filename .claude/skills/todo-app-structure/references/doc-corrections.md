# What `docs/` asserts that the code does not do

Read this before believing `docs/CONVENTIONS.md` or `docs/DESIGN.md` on any
structural question.

These documents are mostly good and mostly current. The entries below are the
places where they are not, verified against the code on this branch. They are
listed because the most common review finding on this project, all quarter, has
been documentation asserting behaviour that is not there — in both directions:
comments justifying behaviour with mechanisms that turned out not to exist, and
rules the code had quietly outgrown.

**None of these are fixed by this skill existing.** The skill is the correct
description; the documents still say what they say. Fixing them is the team
lead's call, and `docs/REVIEW.md` §4.2 already asked for it.

Line numbers below are as of `49492e2` and will drift the moment anyone edits
those files — which is the same failure this file documents, so treat them as a
hint and search for the quoted text. When a correction here stops matching, the
document was fixed: delete the entry rather than updating the number.

## `docs/CONVENTIONS.md` — server actions

This is the important one, because the sentence it gets wrong is the
security-relevant one.

| Line | What it says | What is true |
|---|---|---|
| 120–122 | Folder layout lists `src/server/ # ALL server actions live here, "use server"`, with `todo.action.ts` and `auth.action.ts` | **`src/server/` does not exist and never has.** Neither file has ever existed |
| 123 | `service/ # client-facing wrappers that call server actions` | Services call HTTP route handlers through axios. They have never called a server action |
| 147 | "Any server action that does exist lives under `src/server/`" | There are none |
| 384–385 | "**The same zod schema is re-validated inside the server action.** Client validation is UX; the server action is the trust boundary" | The re-validation happens in the **route handler**, which is the trust boundary. `docs/CONVENTIONS.md` says this correctly itself, in "Route handlers are the trust boundary" — the document contradicts itself four sections apart |
| HTTP section | "Server actions invoked directly from a client component do not need axios" | Describes a case that does not arise |

A style doc that is wrong about naming is an annoyance. A style doc that is
wrong about **where the trust boundary is** is a hazard, because it is the first
thing a new contributor reads.

## `docs/CONVENTIONS.md` — smaller drift

- **Route handler step 1** offers "`requireUser()` (or `getSession()` and return
  `401`)" as equivalent options. They are not interchangeable in a route
  handler: `requireUser()` *redirects*, which is meaningless to an axios call
  that asked for JSON. Every route handler in the app uses `getSession()` and
  returns `unauthorizedResponse()`. `requireUser()` is for server components and
  layouts.
- **The Forms folder-shape example** shows a shared `src/components/form/`. The
  shared thing is `src/components/ui/` (the `Form*` field components); there is
  no shared `components/form/` directory.
- **The schema location** is now `src/lib/todo.schema.ts`, not a route's
  `components/form/schema.ts`. `docs/REVIEW.md` §1.3 / E-3 asked for this and it
  is done; CONVENTIONS' Forms section has not been updated to match.
- **`parseDueDate` is in `src/lib/todo.ts`, not `src/lib/date.ts`.** CONVENTIONS'
  Dates section says "dayjs does date parsing and formatting (`src/lib/date.ts`,
  `parseDueDate`)". `date.ts` holds the *display* side — `formatDueDate` and
  `dueDayOffset`, the UTC-day arithmetic the grouping sections cut on. The
  parsing side is in `todo.ts` beside the constants it validates against. This
  one is worth knowing about because it is cheap to believe: the first draft of
  this skill repeated it verbatim from CONVENTIONS without checking.

- **The `AlertDialog` sub-component list** in Mutation UX names
  `.Root .Trigger .Backdrop .Container .Dialog …` as "verified sub-components".
  They do all exist, but **this app deliberately uses none of the first two**:
  every dialog here is controlled and trigger-less, and `.Root` is react-aria's
  `DialogTrigger`, which warns on every mount when nothing registers as its
  pressable. Reading the list as a recommended composition is how DEF-02 was
  reached twice. `src/components/ConfirmDialog.tsx` shows the shape to copy.

## `docs/DESIGN.md`

- **§7 numbering.** §7.15 physically precedes §7.14. Cite section numbers from
  the deck by name as well as number.
- **Superseded copy.** §4.7, §7.3 and §7.7 still describe a `New todo` toolbar
  button, §4.7 with a code sample rendering one. §7.17 and §7.18 replaced it
  with the quick-add bar, and §7.17 says so in as many words. The button does
  not exist: `TodoListScreen` renders `QuickAddBar`, ungated, and the empty
  state's call to action focuses that bar rather than opening a modal. When two
  sections disagree the later-written one usually wins — but check the code,
  which is the only arbiter.
- **§4.8 vs §8.3.2** on the pending row treatment were reconciled in favour of
  §8.3.2: the row-level dim applies to a confirmed **delete** only. It was
  removed elsewhere because `opacity` is a group multiplier and dimmed the
  title to 2.32:1, below even the large-text floor.
- **§3's colour ban is now enforced by ESLint**, including its `color-mix()`
  carve-out. The stated exception — correcting a HeroUI token that fails a WCAG
  floor — lives in `src/app/globals.css`, which the lint rule does not cover, so
  the exception still works exactly as §3 describes it.

## Fixed on this branch

- `src/app/api/todos/errors.ts` claimed "Success shapes live in `./model.ts`".
  There is no `model.ts` — the file was renamed to `util.ts` and the comment did
  not follow. Corrected. It was the **only** dangling file reference in all of
  `src/`, `tests/` and `e2e/`, which is worth knowing: the code's comments are
  well maintained about paths. The documents are where the drift collects.

## Still open, filed, not done

Listed so nobody re-discovers them as new:

- **No `prisma/migrations/`.** Schema reaches production by hand. A column in
  `schema.prisma` that is not in the database makes **every** list query 500,
  because Prisma selects every scalar field. CI cannot catch it — CI pushes the
  schema to a throwaway database. `docs/REVIEW.md` §1.4 / E-5;
  `docs/STACK.md` has the by-hand runbook.
- **`ApiErrorCode.Internal` is never constructed.** No route handler has a
  `try`/`catch`, so a database failure returns Next's HTML 500 with no
  `message`, and nothing logs it. §1.6 / E-8.
- **No rate limiting** anywhere, including sign-in and sign-up.
- **No password reset.** A forgotten password is permanent data loss.
- **No post-deploy verification.** `main` auto-deploys and nothing checks it
  afterward.
