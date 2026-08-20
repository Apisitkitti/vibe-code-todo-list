# Decision records

One file per decision that took an argument to reach. Dated, and **immutable
once written**.

## Why this directory exists

This project's specifications keep absorbing the arguments that changed them.
`docs/DESIGN.md` §8 contradicts §1 on purpose, because §8 is a decision record
that was filed inside a specification; §8.4.1 corrects §4.3 with a block quote
correcting the correction. `docs/QA-REPORT.md` has been rewritten wholesale more
than once, which loses its own history — several defects it lists as open were
fixed afterwards, and the report does not retract.

The result is documents that are simultaneously the current rules and a
transcript of how they got that way, where a reader cannot tell which sentence
is which. Two failures follow, and both have happened here:

- A rule the code outgrew stays on the page, because deleting it would delete
  the reasoning too.
- A conclusion survives with none of its reasoning, so the next person
  re-litigates it — the `PressResponder` diagnosis went missing twice and was
  twice recorded as "confirmed present, not re-diagnosed".

A decision record separates the two. The specification says what is true now.
The record says what we chose, when, why, and what we rejected.

## When to write one

- A convention changed, or gained an exception.
- Two documents disagreed and somebody had to rule.
- A defect's diagnosis was non-obvious and cost real time to find.
- A dependency's behaviour forced a design.
- Something was deliberately **not** done, and the next person will otherwise
  propose it again.

Not for: a bug fix whose reason fits in the commit body. That is what commit
bodies are for.

## Format

`YYYY-MM-DD-short-slug.md`, and inside:

- **What was decided** — one sentence, at the top.
- **What raised it** — the observation, with the file, the defect id, or the
  measurement.
- **Why** — including what was rejected and what it would have cost.
- **What would change this** — the condition under which the decision should be
  revisited. A decision with no stated expiry gets treated as permanent.

State what you verified and what you assumed. If a claim is untested, say so
rather than writing it as fact — a record asserting a mechanism that does not
exist is worse than no record, because it will be believed.

## The model to copy

`docs/REVIEW.md` → "DEF-02 — decision record: the `PressResponder` warning was
ours" is the shape this directory is for, and it says why it was written:

> Recorded here because the defect has outlived several people's attention and
> was twice noted as "confirmed present, not re-diagnosed" — the diagnosis is
> the part that kept going missing.

It names the mechanism, cites the library file it verified the claim against,
records that the fix was watched failing before and passing after, and closes
with the gate that keeps it closed. Copy that.

It has not been moved here: it is embedded in a review of a specific branch and
extracting it would rewrite that review. New records go here.
