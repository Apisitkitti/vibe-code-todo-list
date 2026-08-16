# PM proposal — what to build after v1

Author: Product Manager
Date: 2026-08-16
Read against: `docs/PRD.md`, `docs/DESIGN.md`, `docs/STACK.md`, `docs/CONVENTIONS.md`,
`docs/QA-REPORT.md`, `docs/REVIEW.md`, `prisma/schema.prisma`, and `src/app/todos/**`.

**The recommendation, up front:** build a keyboard-first quick-add — one always-visible
input at the top of `/todos` that parses `buy milk tomorrow high` into title, `dueAt` and
`priority`, saves on Enter, and skips the confirm dialog. Then make the list order respect
the due dates it already collects. Everything else in this document ranks below those two.

---

## 1. Where this app stands

The engineering is better than the product. Cross-user isolation is not just claimed but
proven — the QA pass ran a foreign-id attack across every verb and got a byte-identical
`404` each time, and a client-supplied `userId` in the POST body is discarded. Completion
now has its own `/api/todos/[id]/status` route with a `.strict()` schema, so a save can
never silently swallow a checkbox flip. Accessibility is real rather than decorative:
priority is carried by glyph *and* word *and* an `sr-only` prefix, overdue by `⚠` plus a
hidden `Overdue —`, row actions revealed with `group-focus-within` rather than `hidden`,
44px targets everywhere with a `sm:` relaxation. A grep for hex colours across `src/`
returns zero. The three-tier error model (field → Alert → toast) with a copy deck behind it
is more discipline than most teams bring to a v1. None of that is throwaway.

What makes it forgettable is that it is a form with a list attached. The list is in
creation order, forever. The app asks for a due date and a priority and then does nothing
with either — a todo due today sits below one created five minutes ago with no date at all,
and `▲ High` is decoration, not sequencing. Nothing on the screen is different because it is
Tuesday morning versus Sunday night. And the capture path — the single most repeated action
in any todo app — is the slowest thing on the screen: click **New todo**, wait for a modal,
type, submit, then read a second dialog asking `Add this todo?` and click **Add todo** again.
Two dialogs and four interactions to record "buy milk". `docs/CONVENTIONS.md` mandates that
confirm step for every create, update and delete; it was the right instinct applied without
exception, and on the create path it costs more than it protects. A user who tries this app
next to Apple Reminders will notice the speed difference in the first thirty seconds and
will not get as far as noticing the authorization model.

---

## 2. The one thing to build next

### Quick-add: a keyboard-first capture bar with inline date and priority parsing

**Recommendation.** Replace the **New todo** button as the primary capture path with a
persistent single-line input at the top of the list on `/todos`. Typing
`buy milk tomorrow high` and pressing Enter creates a todo titled "Buy milk" with
`dueAt` = tomorrow and `priority` = high, in one keystroke, with no modal and no confirm
dialog. The parsed tokens are shown as removable chips under the input before you commit, so
the parse is never a surprise. The existing modal stays, reachable from a small **More
options** affordance and from every row's Edit button, for the cases that need a note or a
specific calendar date.

**The user problem.** Capture friction kills todo apps. A list is only worth reading if it
is complete, and it is only complete if adding to it is cheaper than remembering. Today
adding one todo costs a click, a modal mount, a form, a submit, a confirmation dialog and a
second click. That is a tax on the action the whole product depends on, and it is a tax the
user pays dozens of times for every once they pay the delete-confirmation tax that the same
convention was written to protect them from.

**Why this beats the alternatives I considered.**

- *Versus due-date-aware ordering (backlog #2).* Ordering makes an existing list more
  useful; quick-add makes there be a list at all. Ordering is also nearly worthless today
  because most todos have no `dueAt` — the field is optional and the only way to set it is
  to open a modal and drive a segmented date picker. Quick-add is what makes `dueAt`
  populated enough for ordering to matter, so it comes first and makes #2 better. Ship both;
  ship this one first.
- *Versus tags, subtasks, or recurring todos.* Each is a schema change and a new mental
  model, and each is a bet that this user wants a heavier system. Quick-add is a bet that
  they want the current system to be fast, which is a much safer bet and needs no migration.
- *Versus "just polish what exists".* I considered recommending exactly that, and it is a
  defensible answer given four open Minors and the review's m-7/m-8. It is not my answer,
  because none of those defects is what makes the app forgettable — they are invisible from
  the UI. The one piece of polish that *is* product-visible (optimistic toggle) is backlog
  #3 and rides along cheaply.

**Cost, in engineering terms.** Medium — I would budget three to four days including review
and QA, not one.

- No schema change. Zero migration risk.
- A new pure module, roughly `src/lib/quickAdd.ts`: `parseQuickAdd(input) → { title, dueAt,
  priority }`. Deliberately small vocabulary — `today`, `tomorrow`, `tonight`, weekday names,
  `next week`, `in N days`, an explicit `YYYY-MM-DD`, and the words `low`/`medium`/`high`
  when they appear as a trailing token. Anything unrecognised stays in the title. dayjs is
  already a dependency and `parseDueDate` already owns the `YYYY-MM-DD` wire format, so the
  parser emits that string and nothing downstream changes. This module is the one piece
  worth unit-testing properly.
- A new `QuickAddBar.tsx` under `src/app/todos/components/`, using `TextField` + `Input`
  (already in the DESIGN component table) plus `Chip` for the parsed tokens (also already
  in use, for priority). No new HeroUI component, so `docs/DESIGN.md` §5 needs no new row.
- It calls the existing `createTodo()` service → existing `POST /api/todos` → existing
  `todoFormSchema` re-parse → `userId: session.user.id`. **The scoping rule is untouched:**
  parsing is a client-side convenience over the title string, the server still validates the
  same schema and still takes ownership from the session only. A hostile client can send
  whatever it likes and gets exactly the behaviour it gets today.
- Copy deck additions to `docs/DESIGN.md` §7.3: placeholder, the parsed-chip labels, the
  chip-removal `aria-label`s, and a success toast.

**The part that needs a decision, not just a ticket.** This proposal asks the team lead to
carve a second exception into the Mutation UX rule in `docs/CONVENTIONS.md`, alongside the
one already granted to the completion toggle. My argument is the same one that won that
exception: the rule exists so a user cannot destroy or alter something by accident, and a
create destroys nothing. The reversal cost of an unwanted todo is one delete — which still
confirms. The toast should carry an **Undo** action exactly as the toggle's does, which
makes quick-add strictly more reversible than the current confirm-dialog flow, since undoing
today means noticing, finding the row, clicking Delete, and confirming. If the lead declines
the exception, quick-add is not worth building: a confirm dialog on every Enter defeats the
entire point, and I would move backlog #2 into this slot instead.

**Where the risk actually is.** A parser that silently eats part of a title is worse than no
parser — a todo called "Call mum about tomorrow" must not lose the word "tomorrow" without
telling you. The parsed-token chips are not a nice-to-have, they are the mitigation, and the
feature should not ship without them. Keep the vocabulary small and English-only (the app is
English-only by PRD decision anyway) and refuse to be clever.

---

## 3. Ranked backlog

Ranked by value-to-effort. **#1–#4 are the batch I would actually commit to**: together they
are one medium and three smalls, they need one index migration between them, and they make
the app feel like a different product. #5–#6 are worth doing once #1 has shipped and told us
whether people set due dates. #7–#9 are real features that each roughly double a dimension of
complexity, and they are ranked below the line for that reason, not because the ideas are
bad. The line between #6 and #7 is the one that matters: above it, nothing changes the shape
of the codebase; below it, everything does.

### #1 — Quick-add capture bar *(the headline; see §2)*

- **Problem.** Adding a todo costs a modal and a confirmation dialog, so the list is
  incomplete.
- **UI.** `/todos`, above the filter bar: a full-width `TextField`/`Input` with placeholder
  `Add a todo — try "pay rent friday high"`. Parsed tokens appear as removable `Chip`s
  directly beneath it. Enter saves; the input clears and keeps focus for the next one. A
  **More options** text button opens the existing `TodoFormModal` pre-filled with whatever is
  already typed. The toolbar **New todo** button is retired; the empty state's CTA focuses
  this input instead of opening the modal.
- **Schema.** None.
- **Effort.** M.
- **Risk.** Requires a `CONVENTIONS.md` exception (see §2). A mis-parse that eats title text
  is the real product risk; the token chips are the mitigation and are not optional.

### #2 — Due-date-aware ordering, with Overdue / Today / Upcoming grouping

- **Problem.** The list is in creation order, so it never tells you what to do now; the due
  dates the app collects have no effect on anything except a small grey label.
- **UI.** `/todos`, the list `Card`. Active todos are grouped under sticky-free section
  headings — `Overdue`, `Today`, `Upcoming`, `No date` — rendered as `Typography type="body-sm"
  color="muted"` rows inside the same `<ul>`, with completed todos still last as a
  `Completed` group. Within each group, order by `dueAt` ascending then `priority` descending
  then `createdAt` descending. The existing row layout does not change at all. Empty groups
  render nothing; a user with no due dates anywhere sees exactly today's list and no headings.
- **Schema.** No field change; add `@@index([userId, dueAt])` to `Todo`. `orderBy` in
  `GET /api/todos` (`src/app/api/todos/route.ts:57`) becomes
  `[{ completed: "asc" }, { dueAt: { sort: "asc", nulls: "last" } }, { priority: "desc" },
  { createdAt: "desc" }]`; grouping is derived client-side from `dueAt` so no second query is
  needed. Scoping is unaffected — the `where` still starts from `{ userId: session.user.id }`.
- **Effort.** S–M.
- **Risk.** The `Priority` enum is declared `low, medium, high`, so Postgres sorts it in that
  order and `desc` gives high-first — worth an explicit test, because getting it backwards is
  silent. Grouping also changes what "Default list order" means in `docs/PRD.md` §2 and in
  US-06's acceptance criteria; that is a PRD amendment, not a quiet behaviour change.

### #3 — Optimistic toggle, and stop reloading the whole list after every mutation

- **Problem.** Checking a box waits for two round trips before the checkbox moves —
  `handleToggle` awaits the PATCH and then calls `reload()`, which refetches the list
  (`TodoListScreen.tsx:119-146`). On a phone connection the app feels broken.
- **UI.** No visual change specified beyond what `docs/DESIGN.md` §1 and §4.8 already
  describe — "state changes apply immediately and report failure via a toast". The row's
  existing `opacity-60 pointer-events-none` pending treatment finally does the job it was
  written for.
- **Schema.** None.
- **Effort.** S.
- **Risk.** Low, and this is the one open review finding (m-7) that a user can actually feel.
  Fold in m-4 while you are in the file — `pendingTodoId` is a single slot, so two fast
  toggles unlock each other's rows. Also fold in m-8: filter changes currently refetch with
  no loading state, so the previous results sit on screen and then swap.

### #4 — Search notes, not just titles

- **Problem.** Search is advertised as "search your todos" and silently only matches titles.
  The 2000-character note field — where the actual detail lives — is invisible to it, so a
  search that should hit returns `No matches`.
- **UI.** `/todos` filter bar, unchanged. Only the results change. Worth a small note-snippet
  line in the row when the match was in the note rather than the title, but that is optional
  polish, not the fix.
- **Schema.** None. One clause in `src/app/api/todos/route.ts:51`: `where.OR = [{ title:
  { contains: query, mode: "insensitive" } }, { note: { contains: query, mode: "insensitive" } }]`.
  **Care needed:** moving to `OR` must not displace `{ userId: session.user.id }` from the top
  level of the `where` — an `OR` written at the wrong nesting level is exactly how this class
  of bug becomes a data leak. This one line deserves a security-minded review and a test that
  User B's note text is unsearchable by User A.
- **Effort.** S.
- **Risk.** Low functionally, non-trivial in review attention for the reason above. `ILIKE
  %term%` on notes will not use an index; irrelevant at 200 todos, worth remembering at
  20,000.

### #5 — Reschedule from the row (Today / Tomorrow / Next week / Clear)

- **Problem.** Changing only a due date — the most common single edit in daily use — costs
  the full edit modal, a segmented date picker, and a confirm dialog. So people don't, and
  their due dates go stale, and stale due dates are worse than none.
- **UI.** Todo row, in the actions cluster: a third icon-only `Button` opening a `Dropdown`
  (both already in the component table) with `Today`, `Tomorrow`, `Next week`,
  `Pick a date…` (opens the existing modal), and `Clear due date`. Toast with **Undo**,
  matching the toggle pattern.
- **Schema.** None. It wants its own scoped route — `PATCH /api/todos/[id]/due` with a
  `.strict()` `{ dueAt: string | null }` schema — following the precedent the team already
  set with `/status`, so a reschedule can never carry a field edit. Same `updateMany({ where:
  { id, userId } })` shape.
- **Effort.** S–M.
- **Risk.** Row action density. Three icon buttons at 44px on a 320px viewport is tight next
  to a truncated title; check it at 320 before committing to the layout. Also needs the same
  confirm-dialog exception as #1, on the same reasoning.

### #6 — Bulk actions on completed todos (Clear completed / Archive)

- **Problem.** Completed todos accumulate at the bottom forever and there is no way to remove
  them except one delete dialog at a time. After a few weeks the `Completed` filter is a
  landfill.
- **UI.** `/todos`, visible only when the `Completed` filter is active and the list is
  non-empty: a single `Clear completed` text button above the list, going through the existing
  `ConfirmDialog` naming the count rather than a title — `12 completed todos will be
  permanently deleted.`
- **Schema.** None if it deletes. If the team wants archive-not-delete, that is
  `archivedAt DateTime?` on `Todo` plus an `archived` clause in every list query — which is a
  new state in the model and I would not pay that yet.
- **Effort.** S (delete) / M (archive).
- **Risk.** This is the one place where the confirm dialog absolutely stays, and where the
  count in the body text must be exact. `deleteMany({ where: { userId, completed: true } })` is
  a one-line query where a dropped `userId` deletes the entire table — it should be reviewed
  as a security change, not a feature.

---

*Below this line, each proposal changes the shape of the data model or the codebase. None of
them should start before #1–#4 have shipped and been lived with.*

### #7 — Recurring todos

- **Problem.** "Take out the bins every Tuesday" has to be recreated by hand every week, so
  the recurring half of real life lives outside the app entirely.
- **UI.** A `Repeat` field in the create/edit modal (`Select`: Never / Daily / Weekly /
  Monthly). A recurring todo's row shows a `↻` glyph plus an `sr-only` `Repeats weekly`.
  Completing one spawns the next occurrence and the toast says so.
- **Schema.** Real change: `recurrence String?` (or a `Recurrence` enum) and
  `recurrenceParentId String?` self-relation on `Todo`, plus an index. And a decision that is
  bigger than the columns: does completing an occurrence create the next row immediately
  (simple, and the list stays a list) or is the series virtual and expanded at read time
  (correct, and every query in the app becomes harder)? I would take the first and accept
  that it stores more rows.
- **Effort.** L.
- **Risk.** This is where a deliberately simple codebase stops being simple. Recurrence is a
  famous source of edge cases — edit one occurrence or the series, complete late, DST, "the
  31st" in February. `parseDueDate` already parses strictly for exactly this class of reason.
  It is a genuine bet, not a safe improvement, and I would want evidence from #1's due-date
  numbers before committing.

### #8 — Tags

- **Problem.** Priority is the only dimension available, so `work` and `home` are the same
  list and the only way to separate them is search discipline.
- **UI.** `#work` typed into quick-add becomes a tag (which is why this ranks after #1 —
  quick-add is what makes tags cheap to enter). Tags render as `Chip`s on the row beside
  priority, and the filter bar gains a tag filter.
- **Schema.** New `Tag` model (`id, name, userId`, unique on `[userId, name]`) plus an
  implicit many-to-many to `Todo`. **Every tag query must be scoped by `userId` too** — a tag
  is user data exactly like a todo, and the join makes it possible to leak the *existence* of
  another user's tag names even while their todos stay hidden. That is a new instance of the
  core rule in a place the current QA suite does not cover, and the isolation test in
  `docs/QA-REPORT.md` §2 would need extending before this ships.
- **Effort.** M–L.
- **Risk.** Tags are how a personal todo app becomes a project manager. On a 200-todo list
  they are mostly ceremony, and a tag filter alongside status, priority and search is four
  filters on a screen whose design principle is "content-first density".

### #9 — Subtasks

- **Problem.** A todo with multiple steps either becomes several unrelated rows or a note
  nobody re-reads.
- **UI.** An expandable `Disclosure` on rows that have children, showing a nested checklist
  with a `2 of 5` progress label.
- **Schema.** `parentId String?` self-relation on `Todo`. Cheap as a column, expensive
  everywhere else: filters, counts, ordering, the `{done} of {total} done` header and the
  delete cascade all have to decide whether a subtask is a todo.
- **Effort.** M–L.
- **Risk.** High complexity-per-unit-value. Ranked last deliberately — for a personal list
  the note field mostly covers this, and the flat list is the reason the app is scannable.

---

## 4. What not to build

**Sharing, collaboration, or anything multi-user.** Every Prisma call in this app is scoped
by `where: { userId: session.user.id }`, and the QA report's §2 isolation matrix is the single
strongest evidence of quality in this repo. Sharing replaces that one clause with a
membership lookup in every query, adds permission levels, invitations, an invitation email
path, and a "who changed this" question the schema cannot currently answer. It is not a
feature, it is a different product with a different threat model, and it would invalidate
every isolation test. Stay out. If the answer ever becomes yes, it is a v2 with its own PRD.

**Notifications and reminders of any kind.** The most-requested-sounding item on the
out-of-scope list, and it should stay there. Push requires service-worker plumbing the app
does not have and permission prompts users decline; email requires a scheduler (Vercel Cron —
free tier is limited and daily-granularity on Hobby) plus a transactional email provider
(**Resend: free to 3,000 emails/month and 100/day, then $20/month**, and the app has no
verified email addresses because `emailVerified` is `false` by design per US-01). A due-date
reminder that arrives unreliably is worse than none. **Revisit only after #2 ships** and the
data shows people actually set due dates.

**An AI or LLM assistant — "describe your week and I'll make the list".** Tempting, on-trend,
and wrong here. It puts a paid API call (a few dollars a month at personal volume, but a
metered third-party dependency and a new secret to manage) and a second of latency in the
middle of the fastest interaction in the app, and it sends the user's private todo text to a
third party — a real change to a product whose one promise is "nobody else can see this".
Backlog #1's parser gets most of the same value locally, instantly, for free, and
deterministically.

**A calendar view.** It looks like the obvious next screen and it is a large amount of layout,
responsive work and keyboard navigation for a field that is optional and currently mostly
null. It is also the wrong shape for this data: todos are a queue, not appointments. Backlog
#2 delivers what people actually want from a calendar view — "what is due now" — for a
fraction of the work.

**Offline / PWA.** Sync means conflict resolution, which means the server can no longer treat
`updatedAt` as authoritative, which touches every route handler. Not for a web app the user
opens on one device.

### On the PRD's existing out-of-scope list

| Item | Call |
|---|---|
| Sorting controls / reordering | **Revisit — partly.** Not a sort dropdown; a better *default* order (#2). A manual drag-and-drop reorder needs a `position` column and stays out. |
| Bulk actions | **Revisit now.** #6. Cheap, and the completed pile is a real problem within weeks. |
| Recurring todos | **Revisit later.** #7, and only on evidence from #2. |
| Tags / labels | **Revisit after #1.** #8. Quick-add is what makes them cheap to enter; without it they are a modal field nobody fills in. |
| Notifications | **Revisit after #2,** with the cost above stated plainly. |
| Trash / archive / soft delete | **Revisit only with #6,** and only if the team prefers archive to delete. |
| Teams / sharing / collaboration | **Stays out.** See above. |
| Social / OAuth login | **Stays out.** Adds provider config and account-linking edge cases; email+password works. |
| Sub-tasks | **Stays out for now.** #9, ranked last on purpose. |
| Attachments | **Stays out.** Needs blob storage — a new paid dependency (Vercel Blob is metered) for a personal list. |
| Offline / PWA / native | **Stays out.** |
| Calendar, analytics, streaks | **Stays out.** |
| Public API, import/export, integrations | **Stays out** — with one caveat: a plain JSON export is a small, honest thing to give a user who wants to leave, and I would take it as a one-day chore, not a feature. |
| Email verification, password reset, account deletion, profile editing | **Stays out as product work, but flag it:** no password reset means a user who forgets theirs has permanently lost their data. That is a support problem waiting to happen and it should be on the roadmap as an obligation, not as a feature competing with this backlog. |
| Internationalisation | **Stays out.** #1's parser is English-only and that is consistent. |

Two documentation fixes belong with this, both raised as N-8 in `docs/REVIEW.md`: `docs/PRD.md`
§4 still lists **search** and **undo** as out of scope while both are built, specified in
`docs/DESIGN.md`, and passing QA. The PRD should be amended so the scope boundary stops
contradicting the shipped app.

---

## 5. Success measures for quick-add

The app has no analytics and I am not proposing to add any third-party product analytics for
this. Every measure below is answerable from the existing `Todo` table with a SQL query, using
columns that already exist. Take a two-week baseline before the change and compare the two
weeks after.

**The measure that decides it:**

1. **Todos created per active user-day.** `COUNT(*)` grouped by `userId, date(createdAt)`, over
   days where the user created at least one todo. Quick-add is meant to lower the cost of
   capture, so more things get captured. Target: **+40% median**, measured over two weeks
   against the two-week baseline. If this does not move, the feature did not solve the problem
   I claimed it solves, whatever else improved.

**Supporting measures:**

2. **Share of new todos with a non-null `dueAt`.** `dueAt IS NOT NULL` over todos created in
   the window. Today this requires opening a modal and driving a date picker, so I expect the
   baseline to be low. Target: **from baseline to above 40%.** This is also the gate on
   backlog #2 and #7 — if people still do not set due dates when it costs nothing, both of
   those proposals are worth less than this document claims.

3. **Share of new todos with a non-default priority.** `priority <> 'medium'`. Same logic: does
   a cheaper input actually get used, or was the friction never the reason the field was empty?

4. **Burst capture.** Share of created todos whose `createdAt` is within 30 seconds of the
   previous todo by the same user. A capture bar that keeps focus should produce visible runs
   of two, three, five todos entered together; the modal flow structurally cannot. This is the
   cleanest signal that the interaction, and not something else, changed the behaviour.

**The counter-measure — the one that would make me pull it back:**

5. **Mis-parse rate.** Share of todos created via quick-add that are edited within 120 seconds
   of creation: `updatedAt - createdAt < interval '120 seconds'`. This is the proxy for "the
   parser ate my title" or "it guessed the wrong date". **Above 10% and the feature is doing
   harm** — the vocabulary is too greedy and should be cut back or the chips are not visible
   enough. Below 5% and the parser is honest. This one needs a way to tell quick-add creates
   from modal creates; the cheapest honest option is a nullable `createdVia String?` column on
   `Todo`, which is a two-line migration and the only schema change the headline recommendation
   asks for. It is worth it — without it, measure 5 cannot be computed and the feature ships
   unfalsifiable.

**Not a success measure:** number of quick-add uses, or the ratio of quick-add to modal
creates. Both go up simply because the bar is the thing at the top of the screen, and neither
tells us whether the user's list got better.
