# `Today` gets `--foreground`, not the accent §8.4 item 5 asked for

*2026-08-21 — Junior dev, on `fix/chrome`, from a ui-designer brief.*

**What was decided:** a due date reading `Today` renders at `--foreground`
instead of `--muted`. `docs/DESIGN.md` §8.4 item 5 asked for
`--accent-soft-foreground`; that half is **not** taken and should not be
revived without reading the "Why" below. `Tomorrow` is deliberately excluded.

**Why this record exists at all.** §8.4 item 5 carries no `> Done` block and no
retraction, unlike items 1, 2 and §8.5 — and there was no record anywhere of it
having been withdrawn. The withdrawal was oral history. So a reader arriving at
§8.4 finds an open proposal for an accent, and a shipped `TodoDueDate` that
emphasises `Today` some other way, with nothing connecting the two. That is
precisely the shape the `README.md` in this directory calls a conclusion
surviving with none of its reasoning, and it would be re-litigated.

## What raised it

`docs/DESIGN.md` §8.4 item 5, verbatim:

> **5 — `Today` should not look like `Mar 4, 2027`.**
> Overdue gets `⚠` and a warning tint (§4.4); everything else is uniform muted
> grey, so the single most actionable date in the app is as quiet as a date two
> years out. Give `Today` `--accent-soft-foreground`, keeping the literal word
> as the carrier of meaning. §6.4 unaffected.

The observation is right and was never the disputed part. The prescription was.

## Why the accent half died, and why it stays dead

The withdrawal rested on two arguments. **One of them has since expired.**

**Expired — chip competition.** When item 5 was written, every row wore a
priority chip: `PriorityChip` rendered `variant="soft"` for all three levels
and `medium` is the schema default, so a typical list was a column of
near-identical warning-tinted chips. An accent-tinted `Today` would have been a
second saturated thing per row. §8.4 item 2 has since shipped and `medium` lost
its chip entirely (`docs/DESIGN.md` §4.4), so an untriaged row now carries no
chip at all. **This argument no longer holds and should not be cited again.**

**Still holds — the structure has already said it.** A row reading `Today` sits
under a section headed `Today` (§7.16), and on the board inside a column headed
`Today` (§4.11). Accenting the row's word spends the one accent §3 allows at
rest on a word the structure has already said — and `/todos` is *already over*
that budget (§8.4's own preamble). This has nothing to do with chips, so
nothing that happens to the chips revives the accent.

## Why the single-section case is the exception that justified acting

`TodoGroupedList` sets `showHeadings = groups.length > 1`
(`src/app/todos/components/TodoGroupedList.tsx`), so a single-section list
renders **no headings at all** — the markup collapses to one `<ul>` of rows.

A brand-new account with one todo due today therefore has no `Today` heading,
no board column, and nothing else on screen saying what day it is except
§7.19's dated line, which is a summary and not a label on that row. The row's
own `Today` is the entire signal, and at `--muted` it is the same ink as
`Aug 28`. That is the first-todo moment, and it is what item 5 was actually
pointing at — the "structure has already said it" argument is exactly false in
the one case where the emphasis is load-bearing.

So the emphasis is granted and the accent is refused. `--foreground` says "this
one is different" without spending anything from §3's budget.

## The numbers, measured rather than quoted

Measured through `e2e/support/contrast.ts` — which paints each colour and reads
it back, rather than parsing `oklch()` / `color-mix()` by hand — at 1280×800,
on the Card, in both themes:

| | light | dark |
|---|---|---|
| `--muted` — where `Today` was | 5.60:1 | 6.75:1 |
| `--foreground` — where it is now | 17.72:1 | 17.27:1 |

Contrast **rises** in both themes, so there is no WCAG exposure and no §3
token override is involved. This is the identical argument on the identical two
tokens that `TodoGroupedList` already carries in a comment for dropping
`color="muted"` from its section headings — a precedent that was measured and
shipped in this codebase.

**A correction that belongs with these numbers.** The brief that commissioned
this work stated `--muted` as "4.83:1 on the Card". That is a **pre-DEF-15**
reading: the token was corrected in light (`src/app/globals.css`, scoped
`:root:not(.dark):not([data-theme="dark"])`) and 4.83 has not been the Card
figure since. It survives in past tense in `e2e/a11y-contrast.spec.ts`'s §7.16
and DEF-15 comments, which is where it was picked up and re-quoted as current.
Both comments now say so explicitly. Current readings for the record: `--muted`
is 5.14:1 on the page background in light and 5.60:1 on the Card; in dark,
7.72:1 on the page and 6.75:1 on the Card.

## Why `Today` alone, and not `Today` / `Tomorrow`

`Today` is a word this app has already made **structural**: a section heading
(§7.16), a board column (§4.11), and the reschedule menu's first item (§7.21).
`Tomorrow` is a section heading nowhere — it falls inside `Upcoming` — and is
the menu's second item and nothing else.

Emphasising both would not extend a signal, it would create a second tier of
muted: two weights of grey where the reader has to learn which is which.
Emphasising one makes a three-step ramp the app had half-built:

| Step | Ink | Carrier besides colour |
|---|---|---|
| Future / undated | `--muted` | the date itself |
| `Today` | `--foreground` | the literal word `Today` |
| Overdue | `--warning-soft-foreground` | `⚠` + a visually-hidden `Overdue — ` |

Three ordered steps of urgency in one column, **none of them colour-only**, so
§6.4 is untouched.

## What was rejected, and what it would have cost

- **`--accent-soft-foreground` (item 5 as written)** — spends §3's one
  saturated element at rest on a page already over budget, to say what the
  section heading says two lines above. Rejected.
- **Emphasising `Tomorrow` too** — see above. Rejected, and pinned: the
  `` `Tomorrow` stays muted `` test in `e2e/due-date-ramp.spec.ts` goes red on
  it. That test was watched failing under exactly that mutation.
- **Reading `label === "Today"` in `TodoDueDate`** — ties a visual treatment to
  the copy deck, so a §7.4 wording change would silently move the emphasis.
  Rejected; `formatDueDate` reports `isToday` instead.
- **Calling `dueDayOffset` a second time from the row** — asks "what day is it"
  twice from one render. §7.19 makes this exact argument for the header line:
  two answers computed from one input at two moments can differ, and the moment
  here is midnight. Rejected for the same reason.

## What was verified by execution, and what was not

Verified: every contrast figure above is from a Playwright run, not a
stylesheet reading. The `isToday` pairing — true for precisely the offset
`dueDayOffset` calls `0` — is pinned in `tests/unit/todoDates.test.ts` and was
watched failing against `dayOffset <= 0`. The three-ink ramp and the
single-section case are pinned in `e2e/due-date-ramp.spec.ts`, both watched
failing against `color="muted"` before the change.

Not verified: that the emphasis actually helps a first-time user find their
first todo. That is a usability claim and nothing here measures it. It is the
premise item 5 asserted and this record accepts on the same evidence item 5
had, which is none.

## What would change this

- **Anyone proposing the accent again** — reopen only on the "structure has
  already said it" argument, which is the one still standing. Chip competition
  is spent; do not cite it.
- **If §7.16's headings ever render for a single section** (i.e.
  `showHeadings` stops being `groups.length > 1`), the exception this record
  rests on disappears and `Today` at `--foreground` should be re-argued from
  scratch rather than kept out of habit.
- **If a fourth urgency step is ever wanted**, this is where the ramp runs out:
  three ordered steps is the most the due-date column can carry while every one
  of them keeps a non-colour carrier (§6.4).
