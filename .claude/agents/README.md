# The team, as files

Six roles this project actually ran with, written down so they stop being
re-invented in a prompt each time. Each file is loaded by name — `pm`,
`ux-designer`, `junior-dev`, `senior-reviewer`, `qa`, `sdet`.

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
  permanently deleted user data.
- **Identity, not position** — every defect family here came from re-deriving
  something from a property that is only usually equivalent.
- **Price the claim, not the diff** — a three-line change produced this
  project's only Critical defect.
- **Say when you were wrong** — every role has, in writing, and each time it
  was the most useful line in the report.

If one of these rules stops being true, change the file. A rule nobody
believes is worse than no rule, and this team has rewritten its own
conventions twice when reality disagreed.
