# The team, as files

Nine roles, written down so they stop being re-invented in a prompt each
time. Each file is loaded by name — `pm`, `ux-designer`, `ui-designer`,
`junior-dev`, `senior-reviewer`, `qa`, `sdet`, `platform`, `analyst`.

Six of them are the team this project actually ran with. The last two were
added because of where the failures came from, not to fill out a chart:

- **`platform`** — nothing between a merge and a working production belonged
  to anyone. Schema reaches Neon by hand and a missed column 500s every list
  query; nothing observes the deployed app; there is no rate limiting and no
  password reset, and those two compound into the worst outcome the product
  can produce.
- **`ui-designer`** — the visual surface had no owner. `ux-designer` holds
  behaviour and `docs/DESIGN.md`; this role holds type, spacing, colour and
  density, and researches how other products solve the same surface before
  proposing. The split matters because "what happens" and "how it reads" were
  being decided in the same breath by someone whose evidence was all about the
  first.
- **`analyst`** — every ranking decision here was made by reasoning. The
  measures to check them were specified a quarter ago and never read, and when
  they finally were, one query contradicted the premise of two planning
  documents.

Notably absent: another developer. The bottleneck was never how fast code got
written. Every serious defect was caught by a review that ran something.

The workflow they assume is the one in `docs/WORKFLOW.md`: the junior builds
on a branch off `develop`, the senior reviews before it merges, QA gates on
`develop` before it ships to `main`, and `main` auto-deploys. Nobody merges
their own work.

`_shared-rules.md` is not an agent. It holds the rules every file repeats, so
there is one place to change them.

## Why these files say what they say

Almost every rule in them was bought with a defect:

- **Never read a result through a pipe** — four people, four false
  conclusions, in one week.
- **Write the failing test first** — two tests were green through a bug that
  permanently deleted user data. This is now binding on all new work, not only
  on bug fixes: `.claude/skills/todo-app-tdd/SKILL.md` holds the mode table,
  the spike throw-away procedure and the grouping rules, and the roles that
  touch tests point at it. The argument is in
  `docs/decisions/2026-08-20-move-to-tdd.md`; the existing suites are not
  being rewritten, and
  `docs/decisions/2026-08-21-not-rewriting-the-existing-suites.md` says why.
- **Identity, not position** — every defect family here came from re-deriving
  something from a property that is only usually equivalent.
- **Price the claim, not the diff** — a three-line change produced this
  project's only Critical defect.
- **Say when you were wrong** — every role has, in writing, and each time it
  was the most useful line in the report.

If one of these rules stops being true, change the file. A rule nobody
believes is worse than no rule, and this team has rewritten its own
conventions twice when reality disagreed.
