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

---

# Decision: scope for `fix/add-refresh-gap`

Author: Product Manager
Date: 2026-08-16
Read against: the working tree of `fix/add-refresh-gap` (19 lines, uncommitted, all in
`src/app/todos/components/TodoListScreen.tsx`), `docs/REVIEW.md` m-4/m-7/m-8,
`docs/QA-REPORT.md` §5 and §9, `docs/CONVENTIONS.md` → Mutation UX.

**The decision, up front:** keep the skeleton, but scope it — it is the right fix on a
filter change and on a create/edit save, and the wrong fix on a toggle and a delete. **No
feature rides along.** The only thing added to this branch beyond the scoping is review
finding **m-4**, because the scoping decision depends on it being correct. Effort: XS, half a
day including re-verification. No `CONVENTIONS.md` exception is needed for any of this.

## 1. Is the skeleton the right fix? — Yes, for two of the four callers

Ship the skeleton. It is the correct fix for exactly the two cases that motivated the branch:

- **Filter / search change — skeleton.** This is review m-8 verbatim, and the Senior's fix
  is the right one. The whole list is being replaced by a different list, the user asked for
  that replacement, and showing the old set while the new one loads is actively misleading —
  it reads as "your filter did nothing". The render-time flag rather than an effect is also
  the correct call; it avoids the one frame of stale rows an effect would leave.
- **Create and edit save — skeleton.** The modal closing over an unchanged list is the gap
  the lead actually hit, and it is real. A create changes list membership and ordering, so
  there is no single row to point at; blanking to the skeleton is honest and brief.

It is the wrong fix for the other two:

- **Toggle (and Undo) — no skeleton, silent refetch.** Checking a box is the most repeated
  action in the app and the one action `docs/CONVENTIONS.md` already exempts from the confirm
  rule precisely because ten checkboxes must not mean ten dialogs. Ten checkboxes must not
  mean ten full-list blanks either. The change is one row, the user knows which row, and
  `TodoRow`'s existing `opacity-60 pointer-events-none` treatment is a *localised*
  progress signal that is strictly better than a global one. Blanking the entire list to
  report a single checkbox is disproportionate, and it costs scroll position and visual
  context on a long list.
- **Delete — no skeleton, silent refetch.** Same reasoning. The confirm dialog already
  carries a pending state, the row already dims, and the toast already confirms. There is no
  moment where the user could think the app ignored them.

**Where this reverses me, stated plainly.** Backlog #3 said "optimistic toggle *and* drop the
post-mutation full-list reload". I am **not** asking for that on this branch and I am
softening the second half of it: the full-list reload after a create or edit is fine and
should stay, because a create genuinely can change ordering and membership in ways the
returned record does not tell us. What I still want, unchanged, is the optimistic **toggle** —
but that is its own change with its own review, and it is item 2 in the queue below, not
something to smuggle in here. Until it lands, the toggle keeps today's behaviour: await the
write, then refetch quietly. Never showing unconfirmed state is the right conservative default
for a v1; it just should not be paid for with a full-screen flash.

## 2. Should a feature ride along? — No. Keep it focused.

Nothing from the backlog goes on this branch. Three reasons, in order of weight:

1. **The last QA pass was not a release gate.** `docs/QA-REPORT.md` §9 says so explicitly —
   auth flows, failure paths and the full isolation battery were carried over rather than
   re-proved, on the grounds that the diff under test touched two files and no authorization
   code. This branch has the same property today and can be verified the same cheap way.
   Adding a feature forfeits that and forces a full gate for a 19-line fix.
2. **The backlog item that would ride along most naturally needs a ruling first.** Quick-add
   (#1) is contingent on a second exception to the Mutation UX rule, which the lead has not
   ruled on. That ruling deserves to be made on its own merits, not arrive as a side effect of
   a fix branch.
3. **Shared-file pressure is an argument for sequencing, not for bundling.** Yes, #1, #2 and
   #3 all touch `TodoListScreen.tsx`. That means merge order matters — it does not mean they
   should merge together. This file is now the app's whole client state machine; two
   unreviewed behaviour changes landing in it at once is exactly how a subtle refetch bug
   ships.

## 3. What is on the branch, exactly

**Name:** scope the refetch skeleton to list-shape changes, and fix the pending-row slot.

**On screen.** Changing a filter, running a search, or saving from the create/edit modal shows
the skeleton until fresh data lands — unchanged from what is in the tree now. Toggling a
checkbox, undoing a toggle, or confirming a delete no longer blanks the list; the affected row
keeps its dimmed pending treatment and the list updates in place when the refetch returns.

**Files.** `src/app/todos/components/TodoListScreen.tsx` — the only file.

**Changes.** Split today's single `reload()` into two callers-facing helpers: one that raises
`isLoading` before bumping `reloadToken` (used by `TodoFormModal.onSaved` and by `retry`), and
one that bumps the token silently (used by `handleToggle`, `undoToggle` and `handleDelete`).
The render-time `lastFilterKey` flag stays exactly as written. Plus **m-4**: replace the single
`pendingTodoId` slot with a `Set<string>` keyed by id.

**Why m-4 is not scope creep.** My answer in §1 is that the row's own pending treatment is a
good enough signal for a toggle. m-4 is the bug that makes that treatment unreliable — toggle
row A then row B and B loses its guard while its request is still in flight. I am removing the
global signal, so the local one has to actually work. It is three lines in the same state
machine, in the same file, in the same review.

**Explicitly not included:** optimistic updates of any kind; any change to `reload`'s
underlying refetch-the-whole-list strategy; m-7; the DEF-02 `TodoFormModal` fix; the filter-bar
pop-in that m-8 mentions as a secondary symptom (`hasTodos` gating) — it is real but cosmetic
and belongs with #2's list-rendering work. No quick-add, no ordering, no notes search.

**Confirm-modal exception:** **none required.** Nothing here changes whether a mutation
confirms. The toggle keeps the one exception it already has.

**Verification ask:** re-run the §6 regression sweep only — create, edit, toggle + Undo,
delete, filters, search — and confirm no skeleton appears on toggle or delete, and that two
fast toggles both keep their dimmed row. No isolation re-run: no route handler, no session
code, no Prisma query is touched.

## 4. The queue after this branch

1. **DEF-02 — `TodoFormModal`'s `<Modal>` root.** One day at most. QA has pinned it with
   runtime proof and the fix shape is the one already applied to `ConfirmDialog`. It is the
   last thing holding NFR-04 at Partial, and it is a warm-up, not a project.
2. **Backlog #3, reduced to m-7 — optimistic toggle.** Its own branch, now landing on a
   correct per-id pending set. This is the half of #3 I still stand behind.
3. **The lead's ruling on a create-path confirm exception.** A decision, not a ticket, and the
   gate on what comes fourth. If it is refused, #2 below moves into that slot instead and
   quick-add is dropped rather than built with a dialog on every Enter.
4. **Backlog #1 — quick-add capture bar.** M, three to four days. Ship only with the parsed-
   token chips.
5. **Backlog #2 — due-date-aware ordering and grouping,** including the `@@index([userId,
   dueAt])` and the PRD amendment to US-06.
6. **Backlog #4 — search notes as well as titles,** reviewed as a security change because of
   the `OR` nesting risk.

Riding along wherever convenient, not competing for a slot: the N-8 PRD corrections (search
and undo are still listed as out of scope), and the `note`/`dueAt` `null` round-trip
asymmetry QA raised in its §3.

---

# Decision: drag-and-drop — and what would actually make this app appealing

Author: Product Manager
Date: 2026-08-16
Read against: `docs/PRD.md` §4 (reordering is explicitly out of scope), `docs/QA-REPORT.md`
§8 and §9, `docs/REVIEW.md` (m-7, DEF-02/DEF-10), `docs/CONVENTIONS.md` → Mutation UX,
`prisma/schema.prisma`, `src/app/todos/components/TodoListScreen.tsx`.

> The lead has since reframed the question: *how do we make this application genuinely more
> appealing to use?* Drag-and-drop is one instance of it, not the question. **The answer to
> the real question is §7, and my ranked first move is there.** §1–§3 dispose of
> drag-and-drop, briefly, because it was asked. §5 is the branch-scope call. §7–§9 are the
> headline.

**Drag-and-drop, up front: no.** The completion checkbox does not become a drag target —
that is a straight downgrade, not a feature. Manual reordering, the interesting version of
the idea, is a genuine feature and I am still declining it for now: it is a third ordering
model competing with two better ones, it needs a schema change, a new write route and a new
isolation test, and it does not fix the thing the lead is actually complaining about. The
app feels plain because **the screen is the same on Tuesday morning as on Sunday night** —
that is an ordering-and-context problem, and backlog #2 is already aimed at it. What I would
add is one small new item, a dated list header, which I rank at #2b.

The lead's underlying complaint is right and I am not dismissing it. Only the proposed
remedy.

## 1. Two different jobs, and the question conflates them

A checkbox answers "is this done?". A drag answers "where does this go?". They are not
substitutes, and the reason todo apps put a checkbox on the left and a drag handle on the
right is that both questions get asked about the same row.

**Replacing the checkbox with a drag gesture is never right here.** Concretely:

- It makes the app's single most-repeated action harder. Every drag-to-complete design costs
  more motor precision than a tap, and the gesture is not self-evident — a checkbox says what
  it does by being a checkbox.
- It breaks NFR-04 outright. Keyboard operability of a drag gesture requires a second,
  parallel keyboard affordance; the moment you build that, you have a button — so you have
  reinvented the checkbox and kept the drag as decoration on top.
- It is unverifiable in our current harness. `docs/QA-REPORT.md` §8 records that QA could not
  drive a real pointer at desktop width and did not test real touch activation at mobile
  widths. Making an unexercisable gesture the primary completion control means US-07 ships on
  inference. That is not a risk I take on the one interaction the product is for.
- `docs/DESIGN.md`'s completed-state work (checkbox state *and* strikethrough, never colour
  alone) is built around a control that has a state. A drag has no resting state to read.

So: the checkbox stays, unconditionally. If there is a gesture worth discussing on a row it
is **swipe-to-complete on touch, as an addition to the checkbox, never a replacement** — and
that is a UX question I am parking, not a backlog item.

**The interesting version is adding manual reordering** — a drag handle that sets a
persistent per-user position. That is the version I actually evaluated below.

## 2. The call: decline manual reordering, and here is what it collides with

The app would then have three ordering models:

1. **Creation order** — what ships today, and what `docs/PRD.md` §2 defines as "Default list
   order".
2. **Due-date-aware order** — backlog #2. Uses `dueAt` and `priority`, two fields the app
   already collects on every todo and then ignores completely.
3. **Manual position** — this proposal. Uses data that does not exist yet and that the user
   has to create by hand, one drag at a time.

**A list has one order.** It can have one order with tiebreakers, or a sort control that
switches between orders — and a sort control is on the PRD's out-of-scope list for a reason:
it converts a decision the product should make into a preference the user has to manage.

So the app cannot coherently have all three as peers. It can have exactly one coherent
combination: **due-date bucket first, manual position as the tiebreaker inside the bucket**
(`completed` → `Overdue`/`Today`/`Upcoming`/`No date` → `position` → `createdAt`). Anything
else — manual position as the global key — makes `dueAt` decorative again, which is the exact
defect #2 exists to remove.

**If I have to cut one, I cut manual reordering, and it is not close.** #2 sequences data the
user has already given us, for free, on every existing row, retroactively, with no migration
and no new gesture. Manual reordering sequences nothing until the user does the work, gives
nothing to a user who never drags, and is worth *less* the more todos you have — which is
precisely when ordering starts to matter. Ranked on value-to-effort it does not reach my top
six.

**Where this refines what I wrote before:** §4's out-of-scope table already said "A manual
drag-and-drop reorder needs a `position` column and stays out." I am holding that line, and
adding the reason I did not spell out then — it is not the column that is expensive, it is
that manual order and due-date order are rival authorities and only one can win.

## 3. Cost, if the lead overrules me

Stated honestly so the decision is informed, not so it looks impossible.

**Schema.** `position Int` on `Todo` (not `Float`, and not "just renumber" — use spaced
integers, e.g. gaps of 1024, so an insert between neighbours is one write instead of a table
rewrite), plus `@@index([userId, position])`. Plus a backfill migration assigning spaced
positions to every existing row in current `createdAt desc` order — the first migration in
this repo that has to touch existing rows, and it must be written so a re-run is safe. Add
`createdVia`-style renumber maintenance: gaps exhaust after enough drags into the same slot,
so there needs to be a "renumber this user's list" path, even if it is rare.

**A new write route.** `PATCH /api/todos/[id]/position`, `.strict()`, following the precedent
already set by `/status` so a reorder can never carry a field edit. It should take
**neighbour ids** (`{ beforeId, afterId }`) and compute the midpoint server-side, not a
client-supplied integer — and **both neighbour ids must be verified as owned by the session
user in the same statement**, or reordering becomes an oracle for the existence of another
user's todo. That is a fresh instance of NFR-01 in a verb `docs/QA-REPORT.md` §2's isolation
matrix has never run. It needs a new row in that matrix before it ships.

**Ordering under a filter or a search — the part with no good answer.** Dragging inside a
filtered list is ambiguous by construction: dropping row X between two *visible* rows says
nothing about the hidden rows between them, and there is no interpretation that is not a
guess. Two defensible rules:

- **Disable dragging whenever any filter, priority filter or search is active** (drag handles
  hidden, keyboard reorder disabled, with a one-line explanation). Honest, and what I would
  do.
- Interpret the drop as the midpoint of the two visible neighbours' true positions. Works
  mechanically, and produces a global order the user did not intend and cannot see.

Either way the completed/active split is not draggable across — `completed` sorts first in
every query and a drag over that boundary would silently mean "complete this todo", which is
the conflation from §1 sneaking back in.

**Reconciliation when manual order and due-date order disagree.** The rule, and it must be a
rule and not an implementation accident: **manual position is a tiebreaker within a due-date
bucket, never across buckets.** A drag never moves a todo between `Overdue` and `Upcoming`;
a drop outside the source bucket snaps back. Changing a todo's due date re-buckets it and it
lands at the bucket's default position — a due-date edit beats a stale drag, because the date
is a fact and the position is a preference. If the team wants the opposite (manual wins
globally), then #2 should not ship at all, and that is the real trade being made.

**Effort: L. Five to seven days**, and I would not believe a smaller number. Migration with
backfill (first of its kind here) + new route + new isolation test + a drag library that is
not in `docs/STACK.md` (dnd-kit or equivalent — a new production dependency and a
`STACK.md` entry) + a keyboard-equivalent reorder with live-region announcements to hold
NFR-04 + touch-drag-versus-scroll disambiguation at 320px + a `docs/DESIGN.md` §5 component
row + a `docs/PRD.md` §4 amendment, since reordering is currently listed as explicitly out of
scope. And QA cannot carry anything over: a new write route means the full isolation battery
re-runs.

Set that against #2 at S–M, one index, no migration, no new dependency, no new gesture.

## 4. What I would ship instead for "the app feels plain"

The complaint is real and I want to answer it, not deflect it. My diagnosis: the app is not
plain because it lacks *interactions*, it is plain because it lacks *a point of view about
right now*. Nothing on the screen knows what day it is.

Ranked against the existing backlog — the order barely changes, which is the point:

1. **Backlog #1, quick-add** — unchanged at the top, still gated on the lead's confirm-modal
   ruling (§ below). A list that is fast to add to is the precondition for everything else.
2. **Backlog #2, due-date-aware ordering with Overdue / Today / Upcoming grouping** — this is
   the answer to "feels plain". Today a todo due this morning sits below one created five
   minutes ago with no date; `▲ High` is decoration. Grouping makes the list rearrange itself
   as the week moves, which is the single most alive-feeling change available and it uses only
   data we already store. S–M.
3. **NEW — #2b: a dated list header.** One line above the list in `TodosHeader`:
   `Saturday, 16 August · 3 due today · 1 overdue`. It uses the counts `GET /api/todos`
   already returns plus one date format, needs no schema change, no new component (`Typography`
   + existing tokens), and it is the cheapest thing in this document that makes the screen
   different every day. **XS, half a day.** It only earns its place once #2's buckets exist,
   so it ships with #2, not before.
4. **Review m-7, optimistic toggle** — half of "plain" is "sluggish". A checkbox that moves on
   click instead of after two round trips is the highest felt-quality-per-line change in the
   repo. Already queue item 2; unchanged. **S.**
5. **Backlog #5, reschedule from the row** — this is what drag-and-drop is really promising:
   the feeling that the list is *manipulable*, that you can push things around without
   opening a modal. A Today/Tomorrow/Next week dropdown delivers that feeling for S–M instead
   of L, and it does it with a keyboard-operable control. Needs the same confirm exception as
   #1.

Explicitly **not** on this list: animation, confetti, illustration, a theme picker. They are
cheaper than drag-and-drop and they answer the complaint even less — a plain list that
sparkles is still a plain list. The one motion I would take is the row transition that falls
out of #2's regrouping for free, honouring `motion-reduce` like everything else already does.

## 5. Revised branch scope — reversing part of my last memo

**What changed.** My last memo argued for a focused branch on *review cost*. The lead has now
put a competing cost on the table — production deploys — that I did not weigh, and it is a
legitimate one. So I am changing the rule I decide by:

> **Bundle by verification cost, not by review cost.** Anything that can be proved by the
> same cheap regression sweep this branch already needs can ride along. Anything that forces
> a fresh release gate — a migration, a route handler, a new failure path, a copy deck change,
> a `CONVENTIONS.md` exception — does not, no matter how small the diff looks.

That is a real reversal of "**No feature rides along**" as an absolute. Under the new rule two
of the four candidates ride, and the reason two do not is no longer "keep it focused" — it is
that they would cost more in QA time than they save in deploys.

**Rides along:**

- **DEF-02 — `TodoFormModal`'s `<Modal>` root.** Yes. QA has pinned it with runtime proof, the
  fix is the identical shape already applied to `ConfirmDialog`, and it is the last item
  holding NFR-04 at Partial — which makes it the highest-value thing available for the price.
  This branch already touches `TodoFormModal`'s call site (`onSaved`), so the two land in one
  reviewer's head. **Conditional on QA (§6):** removing a react-aria root is exactly the kind
  of change that can quietly take focus trapping, Escape, or focus-restore with it. If QA
  finds any of those regress, DEF-02 comes straight back off this branch and becomes its own
  ticket.
- **DEF-10 — `ApiErrorCode.Internal` declared but never emitted.** Yes, **in its removal form
  only.** Either delete the unreachable member, or — per `docs/REVIEW.md` M-4's second option
  — write the exclusion into `docs/CONVENTIONS.md` so the next reader stops trusting a
  guarantee that does not hold. Both are zero-runtime-behaviour changes that need no new test.
  **What does not ride along is the other fix for the same finding:** wrapping every handler in
  a `try`/`catch` so `Internal` is actually emitted. That touches four route handlers, adds a
  new error path, and drags the full isolation battery back in. Same defect id, two very
  different prices — take the cheap one now, file the other.

**Does not ride along:**

- **Review m-7 — optimistic toggle.** No, and the deploy argument does not move me here. It
  rewrites the same state machine this branch has just rewritten (`reloadSilently`,
  `pendingTodoIds`), and its whole value is in the failure path — apply locally, revert in
  `catch`. `docs/QA-REPORT.md` §8 states plainly that **failure paths were not tested, with no
  fault injection**. Bundling m-7 therefore converts a cheap targeted sweep into a gate that
  needs fault injection QA does not currently run. That costs more than the deploy it saves.
  It stays queue item 2, on its own branch, immediately after this one — so it is one deploy
  later, not one quarter later.
- **Quick-add (backlog #1).** No, and **it is blocked on a ruling, not on capacity.** It needs
  the lead's second exception to the Mutation UX rule in `docs/CONVENTIONS.md`. I am flagging
  that as a gate: **I am not assuming the answer, and if the answer is no, quick-add is
  dropped rather than built with a confirm dialog on every Enter** — backlog #2 takes its slot.
  Separately, even with the exception granted, quick-add carries the `createdVia` migration
  (needed for success measure 5, or it ships unfalsifiable), new copy deck entries, and a new
  parser module. Every one of those is a full-gate trigger.

**The branch, restated.** Scope the refetch skeleton to list-shape changes (done, in the
tree); m-4's per-id pending `Set` (done, in the tree); DEF-02's `<Modal>` root; DEF-10 as a
declaration removal plus the `CONVENTIONS.md` note. **Effort: still S — under a day.** One
deploy instead of three, and no confirm-modal exception is required by anything on it.

## 6. What I need from UX and QA

I have not seen their assessments; these are the findings that would move me.

**From QA:**

- **Can you drive a drag at all** — real pointer at desktop width, real touch at 320px? §8
  says no to both today. If that stands, it is close to decisive on its own: an interaction QA
  cannot exercise must not become the primary completion control, and should not become a
  primary ordering control either.
- **DEF-02 on this branch:** re-count console warnings on `/todos` load, and re-walk focus
  trap, Escape-to-close and focus-restore-to-trigger on both create and edit. That check is
  the gate on DEF-02 riding along.
- **Confirm the sweep is still cheap** with DEF-02 and DEF-10 added — create, edit, toggle +
  Undo, delete, filters, search, no skeleton on toggle or delete, two fast toggles both
  keeping their dimmed row. If adding these two forces a fresh isolation run, tell me and I
  will drop DEF-10's `CONVENTIONS.md` half and keep only the code deletion.

**From UX:**

- **Is there a keyboard-equivalent reorder that meets NFR-04 without becoming a second,
  parallel UI?** If the honest answer is "you need an explicit Move up / Move down control
  anyway", that is a strong signal the drag is ornament on top of a button.
- **Does a drag handle survive 320px** alongside a 44px checkbox, a title, and the existing
  edit/delete cluster — the density problem I already flagged against backlog #5? And does
  drag-to-reorder fight vertical scroll on touch?
- **Note the asymmetry:** a positive UX finding does **not** flip §1. Replacing the checkbox is
  a product objection — completion and ordering are different jobs — and no amount of
  interaction craft resolves that. A positive UX finding *would* raise my confidence in the
  deferred variant in §2 (manual position as an in-bucket tiebreaker), which is the version I
  would revisit after #1 and #2 have shipped and we know whether people set due dates at all.

---

## 7. The real question: what makes this app appealing

**One-line answer: this app is not unappealing because it lacks features — it is unappealing
because it makes you ask permission to use it, and because the screen never knows what day it
is.** Fix those two things, in that order of felt impact, and nothing about the feature set
needs to change.

Watch the first sixty seconds as a new user. You sign up — and a dialog asks you to confirm
that you want to sign up. You sign in — and a dialog asks you to confirm that you want to
sign in (`SignInForm.tsx:191-200`, `SignUpForm.tsx:224-233`). You click **New todo**, a modal
mounts, you type "buy milk", you submit, and a *second* dialog asks `Add this todo?`. Four
dialogs before the app has done a single thing for you. Then the todo lands in a list ordered
by creation time, forever, where the due date you were asked for changes nothing and the
priority you were asked for changes nothing.

That is the product. Not plainness — **ceremony without stakes, wrapped around a list with no
opinion.**

### 7.1 My first move, and I am changing my own ranking to say it

**Ship backlog #2 + #2b: due-date-aware ordering, Overdue / Today / Upcoming grouping, and
the dated header line.** S–M plus XS. One index. No migration, no new dependency, no new
gesture, no ruling required from anyone.

**This supersedes §4 above and the §3 backlog, where I ranked quick-add first.** Two reasons
I now think that was wrong:

1. **Quick-add is gated and #2 is not.** Quick-add cannot start until the lead rules on the
   confirm exception, and I said myself that a refusal kills it. Putting a blocked item at #1
   is how a backlog stalls. #2 is work I can start this week with nobody's permission.
2. **I over-valued capture and under-valued opinion.** I argued ordering was "nearly
   worthless today because most todos have no `dueAt`". That is true of a *new* list and
   false of a used one, and it quietly assumed the user's problem is getting things in rather
   than knowing what to do next. Appeal comes from the app telling you something you did not
   already know. Faster capture makes the app cheaper; grouping makes it *useful*. `dueAt` and
   `priority` are already collected on every todo and used for nothing — that is the largest
   pool of unspent value in the product, and it costs one `orderBy` and one index to spend it.

**Cost:** `@@index([userId, dueAt])`; the `orderBy` change in `GET /api/todos`; client-side
bucketing; one header line built from counts the API already returns.
**Risk:** the `Priority` enum sorts `low, medium, high` so `desc` gives high-first — silent if
wrong, so it needs an explicit test. Grouping changes what "Default list order" means, so
`docs/PRD.md` §2 and US-06 need a real amendment, not a quiet behaviour change. And a user
with no due dates anywhere must see exactly today's list with no empty headings — that is a
requirement, not a nicety.

### 7.2 The thing I would put on the table that nobody asked for

**Proposal: replace the blanket confirm-modal convention with "confirm destructive and
irreversible actions only."** This is a `docs/CONVENTIONS.md` change and therefore **a ruling
for the lead, which I am flagging as a gate and not assuming.** It is also, per line changed,
the single most appealing thing available in this repo.

Today `docs/CONVENTIONS.md` mandates a confirm dialog before every create, update and delete,
plus both auth forms. The instinct — protect the user from accidents — is right. The
application of it is not, because **it does not distinguish actions that destroy something
from actions that make something.** Signing in destroys nothing. Creating a todo destroys
nothing; its reversal cost is one delete, which still confirms. Editing a todo is recoverable
by editing it again.

Under the reformed rule: **delete confirms. Bulk delete confirms, with an exact count. Nothing
else does.** Create, edit, sign-in and sign-up lose their dialogs; the toggle keeps the
exception it already has; every non-confirming mutation keeps its toast, and create and edit
gain **Undo** on that toast the way the toggle already does — which leaves the app *more*
reversible than it is now, since undoing a create today means noticing, finding the row,
clicking Delete and confirming.

**Why this beats what I had.** I previously asked for this as a narrow second exception,
bundled inside quick-add — a 3-to-4-day feature. That was a mistake of packaging: it made a
cheap, high-impact change contingent on an expensive one, and it asked the lead to rule on a
principle while looking at a feature. Unbundled, the reform is **S — one to two days across
four call sites and the copy deck** — it needs no schema change and no new component, it
delivers most of quick-add's felt speed immediately, and it de-risks quick-add by proving the
principle on the existing flow before we build a parser on top of it.

**Risk, stated plainly.** This removes a safety net the lead deliberately installed, and it is
the lead's document. If the ruling is **no**, I accept it and quick-add is dropped rather than
built with a dialog on every Enter, exactly as I said before. If the ruling is **partial** —
say, create and auth lose the dialog, edit keeps it — I will take that; the auth-form dialogs
are the indefensible ones and I would trade the rest for them. The one place the dialog
absolutely stays is deletion, and bulk deletion is where the count in the body text has to be
exact.

### 7.3 The ranked answer

1. **#2 + #2b — due-date ordering, grouping, dated header.** S–M + XS. Ungated. **Start here.**
2. **The confirm-rule reform (§7.2).** S. **Gated on the lead's ruling** — it is a decision,
   not a slot, and it ships the day the ruling lands, in parallel with #1 rather than after it.
3. **m-7 — optimistic toggle.** S. Half of "plain" is "sluggish"; the checkbox should move on
   click, not after two round trips. Its own branch, immediately after the current one.
4. **Backlog #1 — quick-add.** M. Only if §7.2 is granted, and worth less once §7.2 has landed
   — which is an argument for doing it later, not for doing it never.
5. **Backlog #5 — reschedule from the row.** S–M. The manipulability that drag-and-drop was
   really promising, delivered with a keyboard-operable control.

**Not on the list, deliberately:** drag-and-drop (§1–§3), animation, illustration, a theme
picker, streaks, gamification. A plain list that sparkles is still a plain list, and every one
of them costs accessibility review for decoration.

**What I will not trade for appeal, at any ranking:** the per-user isolation guarantee and the
accessibility work. Those are the floor the product stands on, not items competing on it. Any
proposal of mine that weakens either is withdrawn on that ground alone — which is why §1
rejects the drag-for-checkbox idea even if UX can make it feel wonderful.

## 8. How I would weigh engineering proposals against user-facing work

Since the floor is open and engineering will propose work with no visible user value: **I do
not claim that product ranking wins by default, and I would not want it to.** Half of what
makes this app good — the isolation matrix, the copy deck, the token discipline — is work no
user can see.

The rule I would decide by, and I will apply it against my own items too. Engineering work
**outranks** a user-facing item when any of these is demonstrated, not merely asserted:

- **It is a correctness or security invariant.** Anything touching `where: { userId }`, session
  handling, or validation parity goes to the top, ahead of everything in §7. Not negotiable
  and not mine to rank.
- **It gets more expensive the longer it waits.** A migration that is cheap at 200 todos and
  painful at 20,000; a convention drift that every new file compounds.
- **It is a precondition for two or more ranked items.** `docs/REVIEW.md` m-5's
  write-then-reread consolidation is the clean example: every future scoped write route —
  `/position`, `/due` — inherits that shape, so fixing it once pays three times. That earns a
  slot on compounding, not on tidiness.

Work that meets **none** of the three — renaming, extracting, restructuring for its own sake —
queues behind user-facing work, and I will say so plainly rather than absorbing it quietly.
The burden of proof is symmetrical: I have to show a user-facing item changes behaviour
someone will notice, and engineering has to show which of the three tests its item passes.
"It is the right shape" is not one of the three.

Two live examples, so this is not abstract. **DEF-10's `try`/`catch` wrapper** fails all three
today — the fallback strings already work — so it queues; the declaration removal rides along
free (§5). **M-5's `BETTER_AUTH_URL` boot check** passes the first test outright and I would
take it ahead of anything in §7, one line, no argument.

## 9. Open questions I am not deciding for other people

- **The confirm-rule reform (§7.2) is the lead's ruling.** I am not assuming it, and my §7.3
  ranking is written so that a refusal costs one slot rather than the plan.
- **Whether #2's grouping is designable** without headings that clutter a 320px list, and
  whether a user with no due dates ever sees a heading — UX's call on the layout, mine on the
  rule that empty groups render nothing.
- **Whether QA can gate #2 cheaply.** It changes one `orderBy` and adds an index; the `where`
  clause is untouched, so I believe the isolation battery carries over. If QA disagrees, the
  estimate goes up and I want to know before I commit to it, not after.
