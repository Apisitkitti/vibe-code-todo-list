# The board is a view, not an order

*2026-08-20 — Junior dev, implementing `docs/PRD.md` US-14.*

**What was decided:** the board ships as a second *view* of the same todos —
columns that are the list's own urgency groups, and a drag that writes a due
date or a completion through the routes that already exist — with **no
`position` column, no within-column reordering and no ordering authority of its
own**, and with **no insertion indicator**, because a drop chooses a column and
the order inside a column is the server's.

**What raised it:** the user asked for kanban with drag-and-drop.
`docs/DESIGN.md` §8.1 and `docs/PM-PROPOSAL.md` §4 rule out manual reordering,
on the grounds that a hand-placed position and due-date order are rival
authorities and only one can win. That decision stands and this feature does not
reopen it — so the question became what a board can honestly be without one.

**Verified, not assumed:** every claim below about what a drop writes is pinned
by `tests/unit/todoBoard.test.ts` and `e2e/board.spec.ts`, both watched failing
against the pre-feature tree before they were trusted, and both re-run against
two deliberate mutations (see the end of this record).

## What shipped

A second view of the same todos at `?view=board`: the five
urgency groups `groupTodos` already computes, as columns, with cards draggable
between them. A drop writes a **due date** or a **completion** through
`PATCH /api/todos/[id]/due` and `PATCH /api/todos/[id]/status` — the routes
that already existed. **No `position` column, no within-column reordering, no
schema change, and no new ordering authority.** Order inside a column is the
server's, exactly as it is in the list.

**This must not be read as a step towards manual ordering.** §8.1's argument is
untouched by it: manual position and due-date order are rival authorities and
only one can win. This board has no position at all, which is precisely why it
can coexist with the due-date order rather than compete with it.

## The rule that generates every other answer

> **A drop does exactly what that card's own reschedule menu would do, and a
> column the menu cannot produce is not a drop target for that card.**

Everything below follows from it, including the accessibility story:

| Column | Active card | Completed card |
|---|---|---|
| `Overdue` | refused | allowed only if that is where it returns to |
| `Today` | the menu's `Today` | as above |
| `Upcoming` | the menu's `Tomorrow` — the nearest day in the column | as above |
| `No date` | the menu's `Clear due date` | as above |
| `Completed` | tick the checkbox | — |

`Overdue` refuses an active card because **no control in this app sets a date in
the past**. Being overdue is what time does to a date, not something a user
chooses; honouring the drop would mean back-dating a todo to yesterday, a fact
about the record nobody asked to state. Cards are still dragged *out* of it,
which is the move that actually matters.

A completed card has exactly one valid target — the column it returns to when
reopened, decided by the date it still holds. Reopening is a `/status` write and
sets no date, so any other target would either land the card somewhere other
than where it was released, or issue a second write the user did not ask for and
the keyboard has no equivalent of. Refusing tells the truth *before* the release
rather than after it.

## The drop-position problem, and what was chosen

A reschedule is deliberately **not** optimistic on the list, and for a good
reason: a due date is the second sort key, so the client cannot know where the
row lands, and `todoListState`'s invariants forbid it from guessing. But a card
that springs back to its old column until the server answers is a broken drag —
moving the thing is the entire point of direct manipulation.

Both stay true. The card changes **column** immediately and its **position
inside that column** is never guessed. `applyDueDate` is the line between them:
it rewrites the field and leaves the sequence exactly as the server sent it, so
the card re-cuts into its new column on the next render while keeping the index
the old sequence gave it. Nothing anywhere chooses a position, and the refetch
replaces the guess with the server's order.

The honest consequence: **a card can settle at a different index inside its new
column when the refetch lands.** So:

**There is no insertion indicator anywhere on this board.** No gap opens under
the pointer, no line is drawn between two cards, no placeholder follows the
drag. The drop target is the whole column and it highlights as one object,
because a column is what a drop actually chooses.

*Rejected: an indicator captioned as approximate.* It is a control that tells
you it is lying and asks you to aim at it anyway — it would train users to aim
at a position the app then declines to honour, which is worse than never
offering one. *Rejected: making the board optimistic about position too.* That
requires a client-side sort, which is a second ordering authority — the exact
thing §8.1 and `docs/PM-PROPOSAL.md` §4 refused.

Two things stand in for what the indicator would have given:

- the order note under the columns says once, in words, that a drop chooses a
  column and not a place in it, and what the order inside a column is;
- the card that just moved keeps a focus-coloured ring for 2.5s, so a user who
  dropped it into a busy column can see where it went. This is the piece that
  turns "it may settle elsewhere" from a surprise into an observation.

At today's data — production holds 25 todos across 18 accounts and the largest
list anyone owns is 4 — a card almost never has neighbours to settle among. The
design is written for the case anyway, because the alternative is a promise that
starts breaking on the first user who has five.

## Keyboard, and why there is no keyboard drag mode

Because there does not need to be one. Every move a drop makes is a move the
card's own controls already make: the reschedule menu writes the dates, the
checkbox writes the completion, and `TodoActions` is *the same component* the
row uses, so the two cannot drift. §6.8's objection to react-aria's keyboard
drag mode — it moves items to positions and cannot express "this sets a date" —
is the reason the pointer gesture was built on plain HTML5 drag events instead
of `useDrag`/`useDrop`: the library's headline feature over them is exactly the
mode that would have to be disabled.

Focus is **restored, not redirected**, on both paths. A card that changes column
is unmounted and rebuilt, so the control the user was standing on is destroyed
with nothing visible to show for it. The reschedule path lands back on the
card's own trigger (`restoreRescheduleFocus`, unchanged); the toggle path lands
back on the card's checkbox (`restoreToggleFocus`, new). Moving to the toast's
Undo — right on the list, where a status filter has *removed* the row and the
toast is the only route back — would arm a different mutation under the user's
next `Space` for a card they can still see.

## What would change this

- **If anyone ever needs order inside a column**, that is a new argument against
  §8.1 and must be made on §8.1's terms — a schema migration, a scoped endpoint,
  and a second ordering system. It is not something this board has softened.
- **If the board turns out to be worth less than the gesture.** Apple Reminders
  ships drag-to-reschedule with no board at all: `Today` is cut into
  Morning / Afternoon / Tonight and dragging a reminder into a section sets its
  time — the section boundary is the control. This app already has those
  sections in its list, and the list works at 375px where five columns do not.
  If usage shows people reaching for the board to *move* things rather than to
  *see* them, the cheaper and more portable feature is to make the list's own
  section headings drop targets and retire the columns. Two caveats worth
  recording so nobody mis-plans it: the two are not equivalent on touch —
  HTML5 drag does not fire on touch at all, so a phone would need a real
  pointer-events gesture with a long-press to disambiguate from vertical
  scrolling (§8.1's own argument) — and `boardMove` is deliberately
  view-agnostic, so the mapping itself would carry over unchanged.
- **If nobody uses either.** Nobody has returned to this app for a second day,
  and a board is a feature for someone with a lot of work and a daily habit. The
  measurement to watch is repeat visits, not board opens.

## What the mutations showed

Two deliberate breaks, each run against both suites:

- **Dropping the column-to-date mapping** (every dated column writes today).
  Caught by two unit tests. **Not caught by the browser suite as first
  written** — it dragged only to `Today` and `No date`, so a constant `Today`
  satisfied it. A drag onto `Upcoming` was added, and the mutation then failed
  there too. A mapping is only pinned by more than one of its entries.
- **Dropping the landing-column rule** (a completed card accepts any column).
  Caught by three unit tests, and again **not** by the browser suite, which
  never dragged a completed card. A test that completes a card, drops it on the
  wrong column and asserts nothing moved was added; the mutation then failed
  there too.

Recorded because the pattern is the same both times and is the useful lesson: a
unit test over the mapping catches the mapping, and only a browser test catches
whether the mapping is the one the *gesture* actually reaches. Neither layer was
sufficient alone, and in both cases the gap was invisible until the mutation
exposed it.
