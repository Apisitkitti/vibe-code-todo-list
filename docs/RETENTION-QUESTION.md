# Why nobody comes back — and what it would take to find out

Author: Analyst
Date: 2026-08-21
Read against: `prisma/schema.prisma`, `src/app/api/todos/**`, `src/lib/auth.ts`,
`src/lib/session.ts`, `src/app/layout.tsx`, the installed `better-auth@1.6.x` source in
`node_modules/`, `docs/PRD.md`, `docs/PM-PROPOSAL.md`, and the local `todo_app_dev`
database.

**The position, up front.** The question "why does nobody come back?" is not answerable and
is not currently worth answering, because **there is no population to ask it about.** On the
evidence, the null hypothesis — *these accounts were never users* — is not one candidate
among four. It is the only one that survives contact with the data, and the other three are
untestable until it is displaced. The first real question is not retention. It is **how to
get one real user**, and after that, **how to record that they came back** — which the app
currently cannot do, for reasons that are in the schema and in `better-auth`'s sign-out
handler rather than in anyone's analytics budget.

This document says which questions today's data answers, which it does not, what the minimum
addition is, and what sample size would make any of it mean something.

---

## 0. Provenance — where every number in this document comes from

This project has twice propagated a number that turned out to be a paraphrase (a "~30%" for
a written gate of "above 40%"; a `--muted` contrast of 4.83:1 quoted as current when it
described a pre-fix state). So every claim below is tagged, and the tags are load-bearing.

| Tag | Means |
|---|---|
| **[M-prod]** | Measured by me against the **production** database (Neon) in an **earlier** pass. **Not re-run today** — `.env`'s Neon line is commented out and stays that way. True as of that read; I have not re-verified it and it may have moved. |
| **[M-dev]** | Measured by me today, 2026-08-21, against local `todo_app_dev` via `psql`, read-only. This database is a **developer's scratch data**, not users. |
| **[C]** | Read in the code — this repo's source, or the installed package source under `node_modules/`. Quoted with a path. |
| **[I]** | Inferred. The reasoning is given so it can be attacked. |

Where a number is not tagged, it is arithmetic performed in this document and the working is
shown.

### The prior findings this rests on — [M-prod], earlier pass, not re-run

- 18 accounts.
- 17 of the 18 on `@example.com`.
- 24 todos.
- 14 distinct titles across those 24, with `Buy milk` appearing six times.
- **Zero users active on a second calendar day.**
- The "66.7% burst capture" figure was eight scripted inserts. The twelve inter-create gaps
  split cleanly: **8 gaps at 120–209 ms** (machine-generated) and **4 gaps at ≥ 51 s**
  (human). The 66.7% was measuring a script.

### What local `todo_app_dev` says today — [M-dev], 2026-08-21

Run against `postgresql://postgres@127.0.0.1:5432/todo_app_dev`:

```sql
SELECT 'users',        count(*) FROM "user"
UNION ALL SELECT 'users_example_com', count(*) FROM "user" WHERE email LIKE '%@example.com'
UNION ALL SELECT 'todos',        count(*) FROM todo
UNION ALL SELECT 'sessions',     count(*) FROM session
UNION ALL SELECT 'todos_with_dueAt', count(*) FROM todo WHERE "dueAt" IS NOT NULL;
```

| | |
|---|---|
| users | **3** — `sparker@example.com`, `testuser@example.com`, `designer@example.com` |
| of which `@example.com` | **3 of 3** |
| todos | 56 |
| distinct titles | 55 |
| todos with a `dueAt` | 4 (7.1%) |
| `createdVia = quickAdd` | **56 of 56** |
| session rows | 35 (28 of them for `sparker@`) |
| distinct calendar days on which any todo was created | **1** (2026-08-20) |

This is not a second sample of users. It is the team's own three hand-made accounts on one
afternoon, and the reason it is in this document is that **it has the same signature as
production**: `@example.com` addresses, one day, no returns. The 17 production accounts are
not this repo's automated suites either — `tests/` and `e2e/` mint addresses under the
reserved `.test` and `.invalid` TLDs (`tests/support/factory.ts`, `e2e/support/fixtures.ts`,
`e2e/happy-path.spec.ts:125`), never `@example.com` [C]. There is no seed script in
`prisma/` [C]. So the production accounts were made **by hand, by this team**, the same way
the three local ones were. That is the strongest single piece of evidence for the null
hypothesis in this document.

---

## 1. What the current data *can* answer

These are real, and each is one `SELECT` against columns that already exist. They are worth
writing down because the team's instinct will be to add instrumentation before spending what
is already there.

**Q1. How many accounts exist, and when was each created?**

```sql
SELECT date("createdAt") AS day, count(*) FROM "user" GROUP BY 1 ORDER BY 1;
```

**Q2. How many accounts ever created a todo at all?** — the first funnel step that exists.

```sql
SELECT count(*) FILTER (WHERE t.n IS NULL) AS never_created,
       count(*) FILTER (WHERE t.n IS NOT NULL) AS created_something
FROM "user" u
LEFT JOIN (SELECT "userId", count(*) n FROM todo GROUP BY 1) t ON t."userId" = u.id;
```

**Q3. How long between signing up and the first todo?**

```sql
SELECT u.email, min(t."createdAt") - u."createdAt" AS time_to_first_todo
FROM "user" u JOIN todo t ON t."userId" = u.id GROUP BY u.email, u."createdAt";
```

**Q4. On how many distinct calendar days did a user *write* something?** — the closest thing
to retention the schema supports, and it is not retention (see §2).

```sql
SELECT "userId", count(DISTINCT date("createdAt")) AS writing_days
FROM todo GROUP BY 1 ORDER BY 2 DESC;
```

**Q5. Was this a human or a script?** — the inter-create gap distribution. This is the query
that dismantled the 66.7% figure and it should be run before any behavioural claim.

```sql
SELECT "userId",
       "createdAt" - lag("createdAt") OVER (PARTITION BY "userId" ORDER BY "createdAt")
         AS gap
FROM todo ORDER BY "userId", "createdAt";
```

**Q6. Field-fill rates** — `dueAt IS NOT NULL`, `priority <> 'medium'`, `note IS NOT NULL`,
`createdVia`. All answerable. All currently describing the team's own hands.

**Q7. Current completion state** — `completed = true` counts. State, not history; see §2.

---

## 2. What it cannot answer, and exactly why

Each of these is a fact about the schema or the code, not a wish for a dashboard.

### 2.1 It cannot answer "did anyone come back?" — because a visit writes nothing

Reading the list is a `GET`. It writes no row anywhere. A user who signs in every morning for
a week, reads their list, and closes the tab is **byte-for-byte identical in this database**
to a user who never returned after signup. `docs/PM-PROPOSAL.md` §5 measure 1 counts "todos
created per active user-day" — that is *writing* days, and it silently redefines "active" as
"created a todo", which is a much stronger condition than returning.

The two things that look like they might carry a visit both fail:

- **`session` is not a log — it is destructible live state.** `better-auth`'s sign-out
  handler deletes the row outright: `await ctx.context.internalAdapter.deleteSession(
  sessionCookieToken)` in `node_modules/better-auth/dist/api/routes/sign-out.mjs` [C]. A user
  who signs out erases the record that they were ever there. US-03 makes signing out a
  first-class, tested flow (`docs/PRD.md` US-03), so this is the normal path, not an edge
  case.
- **`session.updatedAt` is a *partial* day-2 signal, and it is the one thing in the schema
  nobody has spent.** `src/lib/auth.ts` sets `session: { expiresIn: 7 days, updateAge: 1 day }`
  [C], and the installed refresh path writes `updatedAt: new Date()` only when
  `session.expiresAt - expiresIn + updateAge <= Date.now()`
  (`node_modules/better-auth/dist/api/routes/session.mjs:206-228`) [C] — i.e. only when the
  session is more than ~24 h past its last refresh. So on a **surviving** session,
  `updatedAt > createdAt` is genuine proof the user made a request at least a day later.

  ```sql
  -- The one day-2 query the schema already supports. Run it before building anything.
  SELECT u.email, s."createdAt", s."updatedAt", s."updatedAt" > s."createdAt" AS returned_a_day_later
  FROM session s JOIN "user" u ON u.id = s."userId" ORDER BY 1, 2;
  ```

  Its limits, stated so nobody over-reads it: it is destroyed by sign-out; it is a single
  overwritten timestamp, so it says "at least once", never how many times; and it has
  day-granularity by construction. It is a floor on returns, never a count of them.

### 2.2 It cannot answer "did the product ever do its job?" — `completed` is state, not an event

There is no `completedAt`. `Todo` carries `createdAt` and `updatedAt` and nothing else
temporal (`prisma/schema.prisma`) [C]. So:

- You cannot tell *when* a todo was completed, or whether it was completed and reopened.
- You cannot count completions at all — only how many todos are *currently* ticked.
- **A deleted todo is gone.** `DELETE /api/todos/[id]` is `prisma.todo.deleteMany(...)`
  (`src/app/api/todos/[id]/route.ts:74`) [C] — a hard delete, no soft-delete column, no trash
  (and `docs/PRD.md` §4 puts trash out of scope). A user who created ten todos, completed
  them all, cleaned up and left looks exactly like a user who created nothing.

### 2.3 `updatedAt` cannot carry the counter-measure it was created for — measured

This is the sharpest instrumentation defect in the repo, and it is measurable today.

`docs/PM-PROPOSAL.md` §5 measure 5 defines the mis-parse rate — the counter-measure that
would pull quick-add back — as todos "edited within 120 seconds of creation":
`updatedAt - createdAt < interval '120 seconds'`, with **"above 10% and the feature is doing
harm"**. The `createdVia` column exists specifically so this measure is computable, and the
schema comment says so [C].

**It is not computable.** `updatedAt` is one Prisma `@updatedAt` field shared by every write
path: the edit `PATCH /api/todos/[id]`, the completion toggle `PATCH /api/todos/[id]/status`,
and the reschedule `PATCH /api/todos/[id]/due` all run `prisma.todo.updateMany` against the
same row [C]. A toggle is indistinguishable from a title correction, and only the most recent
write survives.

Run against local `todo_app_dev` today [M-dev]:

```sql
SELECT count(*) AS within_120s,
       count(*) FILTER (WHERE completed) AS of_which_completed,
       round(100.0 * count(*) / (SELECT count(*) FROM todo), 1) AS pct_of_all_todos
FROM todo
WHERE "updatedAt" > "createdAt"
  AND "updatedAt" - "createdAt" < interval '120 seconds';
```

| within_120s | of_which_completed | pct_of_all_todos |
|---|---|---|
| 15 | **15** | **26.8%** |

Measure 5 reads **26.8%** on this data — nearly three times its own "the feature is doing
harm" threshold — and **every single one of the 15 is a completed todo**, i.e. the write that
moved `updatedAt` was a checkbox, not a correction. Widening to every touched row: 22 of 56
todos have `updatedAt > createdAt`, and 21 of those 22 are completed [M-dev]. The gate fires
on people ticking things off quickly, which is the product **working**.

This is the failure mode the analyst role exists for, in a new place: a plausible ratio
answering a different question than the one asked. **Measure 5 must not be run as written.**

### 2.4 It has nothing at all from before `user.createdAt`

There is no landing page, no signup-form-viewed record, no referrer, no first-touch column,
nothing. The funnel begins at "an account already exists". So the two hypotheses that live
entirely upstream of the account — *people arrive and bounce*, and *people start signing up
and don't finish* — have **zero evidence on either side**, in principle, not merely today.

One asset does exist and has never been read: `@vercel/speed-insights` is mounted in
`src/app/layout.tsx` [C] and has been collecting real-user route data in the Vercel dashboard
this whole time. It is a performance product, not a product-analytics one, and it is not
per-user — but it does carry route-level real-user page loads, which is the only pre-account
signal currently in existence. **Somebody should open that dashboard before anybody writes
code.** Free, zero risk, five minutes. [I: I have not seen the dashboard and make no claim
about what is in it.]

### 2.5 `createdVia` is real, and currently measures nothing

56 of 56 local todos are `quickAdd` [M-dev]. The column works exactly as its schema comment
describes and it is the one deliberate analytics addition in the repo — but a column that
partitions a population of three developers into one bucket is not yet data. It becomes
useful the moment there are real users; it is not the missing piece.

---

## 3. The competing explanations, written so they can be told apart

Four candidates. For each: what it predicts, and the observation that would separate it from
the others. The point of the table is that **three of the four make predictions the app
cannot currently observe** — which is the finding.

| | Explanation | Predicts | Separated by |
|---|---|---|---|
| **H0** | **The accounts were never real users.** They are the team's own hand-made test accounts. | `@example.com` addresses; machine-timed inter-create gaps; duplicate throwaway titles; creation clustered in developer working sessions; no second day, ever. | Address domain, gap distribution, title repetition — **all three already observable, all three already confirmed.** |
| **H1** | **The product does nothing useful.** People arrive, look, and leave. | High arrival count, low signup count; accounts with zero todos; near-zero completions. | Needs a **pre-account** count (arrivals) and a **completion event**. Has neither. |
| **H2** | **Useful, but nobody finished the first run.** Drop-off inside signup or before the first todo. | Signup starts ≫ signup completions; accounts that exist with no todo; long or infinite time-to-first-todo. | Needs a **signup-started** event. Q2 and Q3 (§1) give the *second half* of this funnel; the first half does not exist. |
| **H3** | **They finished the first run and had nothing to come back to.** | Todos created, some completed, then silence — and crucially, possibly **silent visits**: coming back, looking at a stale list, leaving. | Needs a **visit** record. §2.1: a visit writes nothing, so H3's most distinctive prediction is invisible. |

### The verdict on H0, plainly

**H0 explains the entire observed dataset with nothing left over, and I think it is the whole
story.**

- 17 of 18 production accounts on `@example.com` [M-prod]; 3 of 3 local accounts on the same
  domain [M-dev]; the automated suites use `.test`/`.invalid`, not `@example.com` [C]; there
  is no seed script [C]. The addresses were typed by people on this team.
- `Buy milk` six times across 14 distinct titles in 24 todos [M-prod] is not a person's list.
  It is `docs/PRD.md` US-05's example string, typed repeatedly by whoever was testing US-05.
- 8 of 12 inter-create gaps at 120–209 ms [M-prod] are not typing.
- Zero second-day activity [M-prod] is what you get from accounts nobody intended to keep.

**The correct reading of "zero users active on a second day" is not "retention is 0%". It is
"the retention denominator is 1, and possibly 0."** With 17 of 18 accounts excluded as
non-users, the real sample is at most one account — and I cannot confirm from the data that
even that one was a stranger rather than a team member on a personal address. Everything the
team might conclude about H1, H2 or H3 from this dataset would be a conclusion about its own
QA habits.

### What that costs, arithmetically

The standard bound for zero events in `n` observations is the **rule of three**: the 95%
upper confidence limit on the true rate is ≈ 3/n.

- Taken at face value — 0 returners in 18 — the bound is 3/18 = **16.7%**. Even the naive
  reading cannot rule out a true return rate of 16%, which would be an ordinary consumer
  product, not a failure.
- Taken honestly — 0 returners in **1** real account — the bound is 3/1 = 300%, i.e. capped
  at **100%**. **Zero information.** The true return rate could be anything.

A gate that fires on this is a gate firing on noise, which is worse than no gate.

---

## 4. The minimum addition — three events, not "add analytics"

Three events. Each is named for the hypothesis it discriminates, each has a concrete
implementation in this codebase, and together they are one table, one column, and one
package. If only one gets built, build **E1**.

### E1 — `app_opened`: one row per user per calendar day the app served them the list

**The event that makes retention exist at all.** Without it, §2.1 stands: returning is
invisible.

**Minimum implementation.** An append-only table, unique on `(userId, day)`:

```prisma
model UserDay {
  userId  String
  day     DateTime @db.Date
  firstAt DateTime @default(now())
  user    User     @relation(fields: [userId], references: [id], onDelete: Cascade)
  @@id([userId, day])
  @@map("userDay")
}
```

written from **one place**: `requireUser()` in `src/lib/session.ts`, which every protected
page and route already passes through [C]. One `createMany({ skipDuplicates: true })` per
request, one row per user per day, no growth beyond one row per active user-day.

**Why not reuse `session`.** Sign-out deletes it (§2.1). This table is not deletable by a
user action, which is the whole point of an event log.

**Discriminates:** H3 from silence. A user who returns and reads without writing becomes
visible, and "came back and found nothing worth doing" separates from "never came back".

**Cost:** one table, one upsert, one call site. Carries `docs/PM-PROPOSAL.md`'s standing
constraint that **schema changes reach production by hand** — there is a `prisma/migrations/`
directory now (`0_init`, `0001_add_rate_limit`) but nothing in the build applies it, so this
is a manual step against Neon. Note also that `rateLimit` is **absent from local
`todo_app_dev`** — `SELECT to_regclass('public."rateLimit"')` returns null [M-dev] — so
migration `0001` has not been applied locally and the local/production schemas already
disagree. That is worth someone's attention independently of this document.

### E2 — `signup_started`: the first pre-account event that has ever existed

**Discriminates:** H1 from H2 — arrivals who never start, versus starts that never finish.
Today both are equally invisible (§2.4), so H1 and H2 are indistinguishable *in principle*.

**Minimum implementation.** No schema change and no new vendor: add `@vercel/analytics`
(same vendor, same account, same plumbing as the `@vercel/speed-insights` already in
`src/app/layout.tsx` [C]) for route-level page views. `/sign-up` views versus rows in `user`
over the same window is the arrival → account conversion, which is the number that decides
whether the problem is upstream or downstream of the form.

**Deliberately not a per-user event.** Attributing a pre-account visit to a person means an
anonymous id in a cookie, which is a real privacy decision on a product whose one promise is
"nobody else can see this" (`docs/PM-PROPOSAL.md` §4 makes exactly this argument against
sending todo text to an LLM). An aggregate route count answers the funnel question without
that trade. If the team ever wants per-user attribution, it should be a separate,
explicit decision.

### E3 — `todo_completed`, with a timestamp

**Discriminates:** H3 from H1 among people who *did* create todos. "Created ten, ticked
eight, never came back" is a reason-to-return problem. "Created ten, ticked none" is the
product not doing its job. These are opposite diagnoses and today they are the same row.

**Minimum implementation.** `completedAt DateTime?` on `Todo`, written by
`PATCH /api/todos/[id]/status` when setting `true` and set to `null` when setting `false`
[C: that route already writes exactly one field through `updateMany`, so this is one more key
in the same `data`]. Nullable with no default, for the same reason `createdVia` is — every
existing row predates the distinction and `NULL` is the only honest thing to say about them.

**It also repairs §2.3.** With `completedAt` present, measure 5 can exclude rows whose only
touch was a completion, which is 15 of its 15 current false positives [M-dev]. The measure is
still imperfect — a reschedule still moves `updatedAt` — so if the team wants measure 5 to be
trustworthy rather than merely less wrong, the honest form is an append-only `TodoEvent`
log (`todoId, userId, kind, at`) rather than more nullable timestamps. That is more than the
minimum, and I am not asking for it yet.

### What is deliberately *not* on this list

Third-party product analytics (PostHog, Mixpanel, Segment), session replay, funnels-as-a-
service. At n≈0 they measure nothing, they cost a vendor relationship and a privacy posture,
and `docs/PM-PROPOSAL.md` §5 already committed to answering measures from the app's own
tables. Nothing here changes that commitment.

---

## 5. What would count as enough — the arithmetic

The question the team is waiting on is D7 return: **of people who create an account, what
share come back on a later day?** Here is what each sample size buys. Definitions: `n` =
real, non-team accounts created; observation window = 7 days *after the last signup*, so the
calendar cost is n's acquisition time **plus one week**.

**(a) To be 95% likely to see at least one returner, if the true return rate is 10%.**
Probability of seeing none is 0.9ⁿ; require 1 − 0.9ⁿ ≥ 0.95:

    n ≥ ln(0.05) / ln(0.9) = (−2.996) / (−0.1054) = 28.4  →  n = 29

**n = 29.** This is the *cheapest* threshold: below it, "zero returners" is an unsurprising
outcome of a perfectly ordinary product, and reading it as failure is the mistake this
document exists to prevent.

**(b) To gate — is the return rate above 30% or below?** One-sample test of p₀ = 0.20 against
p₁ = 0.40, α = 0.05 two-sided, power 80%:

    n = [z(α/2)·√(p₀(1−p₀)) + z(β)·√(p₁(1−p₁))]² / (p₁ − p₀)²
      = [1.96·√0.16 + 0.8416·√0.24]² / 0.04
      = [1.96·0.400 + 0.8416·0.490]² / 0.04
      = [0.784 + 0.412]² / 0.04
      = 1.196² / 0.04 = 1.431 / 0.04 = 35.8  →  n = 36

**n = 36.** This is the number to put behind any PM gate phrased as "above X%". A gate
written without it is decoration.

**(c) To state a return-rate *number* to ±10 percentage points, 95% confidence.**
n = 1.96²·p(1−p)/0.10²:

    p = 0.30  →  3.8416 · 0.21 / 0.01 = 80.7   →  n = 81
    p = 0.50  →  3.8416 · 0.25 / 0.01 = 96.0   →  n = 96

**n ≈ 81–96.** Below this, do not publish a percentage.

**Summary: 29 to notice, 36 to gate, ~85 to quote.** Every one of those must be a **real,
non-team account**, which means the acquisition question comes first arithmetically, not just
rhetorically.

**What I cannot compute, and will not fake:** how many *visitors* produce 36 signups. That
needs an arrival → signup rate, which requires E2 to exist and a channel to exist. Any
visitor number in this document would be a made-up multiplier on a made-up conversion rate,
and this project has been burned by exactly that class of number twice. The first run of E2
produces it; until then it is unknown, and "unknown" is the correct entry.

**One further caution.** These n's assume the 36 accounts are *independent* users. Thirty-six
signups from one Show-HN burst on one day are not thirty-six independent draws on "will
people come back", and they will over-represent curiosity traffic. Two or three separate
acquisition attempts of ~15 each is a better sample than one of 40 — worth knowing *before*
the push, not after.

---

## 6. The two things to price rather than talk around

### 6.1 There is no acquisition channel — and this is the actual blocker

Nobody has ever tried to get a user. No landing page, no channel, no post, no invite, no
list. Every measurement in §5 has this as its precondition, and none of the engineering in §4
does anything at all until it is solved.

This reframes what the team has been doing. The last several releases have been quality work
on a product whose measured population is its own authors. That work is not wasted —
`docs/PM-PROPOSAL.md` §1's assessment of the isolation model and the accessibility work is
fair, and it is a genuinely better artefact than most v1s. But it has been **optimising an
unread denominator**, and the reason nobody noticed is that polishing is available and asking
for users is not. A 0.95px chip overflow has a definite fix. "Get thirty strangers to sign
up" does not, which is precisely why it keeps losing.

**The cheapest honest first step is not a feature.** It is: get the app in front of ~15
people who are not on this team, twice, a week apart, and see what happens. That does not
need E1, E2 or E3 to *start* — but without E1 the second half of the result is invisible, so
E1 should land first if the two can be sequenced at all.

### 6.2 Password reset is unbuilt, and I priced it — it matters, but not for the reason usually given

**What is true, from the code** [C]:

- There is no password-reset code anywhere in `src/`. A grep for `resend|forgetPassword|
  sendResetPassword|resetPassword|sendVerificationEmail` across `src/` and `package.json`
  returns **nothing** outside a prose mention in `docs/PM-PROPOSAL.md`.
- `better-auth`'s `/forget-password` endpoint *is* mounted, via the catch-all
  `src/app/api/auth/[...all]/route.ts`. It fails closed: with no
  `emailAndPassword.sendResetPassword` configured in `src/lib/auth.ts`, the installed handler
  throws `BAD_REQUEST / RESET_PASSWORD_DISABLED`
  (`node_modules/better-auth/dist/api/routes/password.mjs:51-56`).
- So a forgotten password is **terminal**. The only credential is `account.password`; there
  is no second factor, no recovery address (`emailVerified` is `false` by PRD design), and
  the `Verification` table exists but nothing writes to it.
- The team has already priced this once without noticing: the rate-limit doc comment in
  `src/lib/auth.ts` widens the sign-in burst from `better-auth`'s default 3 to 10 **explicitly
  because** "there is no password reset… a person who has genuinely forgotten which password
  they used, with no reset link to fall back on, should not be locked out for mistyping four
  times." The absence is already shaping security decisions.

**The price, honestly.** Today, with a real-user population of at most one, the expected
number of people locked out is approximately **zero**, and building it now would be building
for nobody — the same mistake as everything else on the backlog. So: **not urgent today.**

**But it is not merely a support cost, and this is the part that has been missed.** The moment
the team runs an acquisition push to get the n = 36 of §5(b), a locked-out user is
**indistinguishable in the data from a user who chose not to return**. They are a false
negative on the exact metric the push exists to measure. At n = 36, if two people lock
themselves out, that is 5.6% of the sample silently converted into "did not return" — which is
the same order of magnitude as the 20-percentage-point effect the study is powered to detect.

So the ranking is precise, and it is neither "obligation" nor "feature":

> **Password reset is not a prerequisite for shipping. It is a prerequisite for the *first
> measurement*.** It should land in the same batch as E1 and before the first acquisition
> attempt, and it should be justified on measurement integrity, not on support volume.

It is also cheap to de-risk without Resend at all. A one-shot admin-issued reset — a token the
team generates by hand for anyone who mails and asks — costs no vendor account, no email
domain and no scheduler, and it removes the false-negative mechanism entirely at n = 36. The
Resend account and a real self-serve flow can wait until the user count justifies it. **The
blocker is not the Resend account; it is that nobody has decided the cheap version is
acceptable.** That is a decision for the lead, and I am not assuming it.

---

## 7. Recommendation

**Stop improving the product. Not forever — until there is someone to improve it for.**

Ranked, with the reason each sits where it does:

1. **Open the Vercel Speed Insights dashboard.** Free, five minutes, and it is the only
   pre-account data that has ever existed on this product. Do this before writing any code.
2. **Build E1 (`UserDay`).** One table, one call site. Without it, every future acquisition
   attempt produces an unreadable result, because a visit writes nothing. This is the one
   piece of engineering that genuinely must precede the users rather than follow them.
3. **Decide the cheap password-reset question (§6.2).** A ruling, not a ticket. Admin-issued
   reset, or Resend, or accept the false negatives knowingly. Any of the three is fine; not
   deciding is not.
4. **Try to get 15 real users. Then, a week later, 15 more.** This is the actual work and it
   has never been attempted. §5 says 29 to notice anything and 36 to gate on anything.
5. **Add E3 (`completedAt`) and E2 (`@vercel/analytics`)** alongside or just after, so the
   second cohort is better instrumented than the first.
6. **Then, and only then, reopen the backlog.** With real users and E1 in place,
   `docs/PM-PROPOSAL.md`'s measures become computable — with the exception of measure 5,
   which must be corrected first (§2.3) or it will fire falsely at ~27% and pull back a
   feature that is working.

**What I am *not* saying.** The quality work should not be reverted or regretted. The
isolation model, the accessibility work, and the test discipline are the floor a real user
would stand on, and they would have had to be built at some point regardless. The error was
never the quality of the work. It was that four consecutive planning documents ranked
features against each other while the denominator underneath all of them was **one**.

**And what I got wrong, in writing.** In an earlier pass I reported "not one user active on a
second day" as a finding about retention. It was a finding about *the data*, and I did not say
so clearly enough at the time — the same shape of error as the 16%-of-todos-have-due-dates
ratio that the analyst role exists because of. Zero returns out of one real account is not a
retention rate. It is an empty sample, and the rule-of-three bound on it is 100%.

---

## Appendix — every query in this document, runnable

Every query above is a `SELECT` and is written out inline rather than in a separate file, so
it can be copied and re-run without trusting this document's summary of it. Against local
dev:

```
psql "postgresql://postgres@127.0.0.1:5432/todo_app_dev" -c '<paste a query from above>'
```

Against production, they would need the Neon URL, which stays commented in `.env`. **If the
team wants §0's production numbers re-verified rather than carried forward from my earlier
pass, the queries to run are Q1–Q5 in §1 plus the `session.updatedAt` query in §2.1, all
read-only, and the lead should make that call — I have not run them today.** The one I would
most want re-run is the `session.updatedAt` day-2 query in §2.1: it is the only unspent
retention signal in the current schema, it costs one `SELECT`, and it may already contain the
answer to whether *anyone* has ever come back.
