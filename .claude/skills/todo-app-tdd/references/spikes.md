# Spikes, and throwing them away

For HeroUI composition, focus management and drag, the interface is not knowable
in advance. This project has the receipts: `Typography` claiming `MenuItem`'s
label slot, `Modal`'s root wrapping its children in a `PressResponder` for a
trigger that never registers, `useMediaQuery` reading `matchMedia` on the first
client render so a media-gated view hydrates against the other one, a `mouseup`
landing on a different node and retargeting the click to `<html>`. No test
written in advance would have named any of those.

So you are allowed to build first here. What you are not allowed to do is keep
what you built.

**A spike that is kept is code written before its tests wearing a different
name** — which is what happens today, and is the single thing this decision
exists to stop. The word in the decision is *throw away*. It is not decorative.

## The procedure

**1. Branch the spike where it cannot be merged by accident.**

```bash
git checkout -b spike/drag-column-target develop
```

Never push a `spike/` branch, and never open a review on one. If you would
rather stay on your feature branch, commit the exploration with a `spike:`
subject so step 3 has something to point at.

**2. Explore. Optimise for learning, not for quality.**

Console logs, hardcoded ids, a component with four props that should be one — all
fine. Nobody is going to read it. Trying to write the spike well is the first
step towards keeping it.

**3. Write down what you learned, in prose, before you delete anything.**

This is the only artefact that survives. It should name:

- the mechanism, precisely — which element, which library file you verified it
  against, `node_modules/<pkg>/…`;
- the composition that did *not* work, and the symptom it produced;
- any number you measured, with the viewport and browser it was measured at;
- what a test would have to observe for the mechanism to be pinned.

If the mechanism cost real time to find, or a future person will otherwise
re-propose the composition that failed, it belongs in `docs/decisions/` — that
directory exists because the `PressResponder` diagnosis went missing twice and
was twice re-recorded as "confirmed present, not re-diagnosed".

**4. Destroy the code.**

```bash
git checkout feature/the-real-branch      # or: git switch -c feature/… develop
git branch -D spike/drag-column-target
```

On a spike commit on your own branch, wipe the files back to `develop`:

```bash
git checkout develop -- src/app/todos/components/Board.tsx
git status --short                        # confirm the wipe actually landed
```

Verify it landed. A `checkout` against a path that no longer matches succeeds
loudly, but a `sed`-style partial revert succeeds silently and leaves you
believing you started clean.

**5. Now write the test, from the notes, and watch it fail.**

You know the mechanism, so the interface is known, so you are in strict mode:
test first, red for the reason you expect, then the implementation. Write the
implementation from the notes, not from memory of the spike's shape.

## What "thrown away" means, exactly

**No line of the spike appears in the final diff.** If you are copying a block
out of the spike, you kept it — the point is not the keystrokes, it is that code
you are re-typing is code whose test is being written to fit it.

Three things legitimately survive, and only three:

- the **notes**, including any decision record;
- **measurements** — a number you read off a real render is an observation, not
  code;
- the knowledge of **which API to call**, which is what you went to find.

Not a component. Not a hook. Not "just the CSS". Not a helper you extracted
while spiking because it seemed clean.

## Recording it

Say in the commit body or the review message: **which mode, that a spike
existed, and that it was discarded.** One line.

    Mode: spike → discarded → test-first. Spike branch spike/drag-column-target
    deleted at <sha>; nothing from it survives in this diff. Notes in
    docs/decisions/2026-08-21-….md.

A reviewer is entitled to ask for the deletion and to diff your final change
against the spike if it still exists anywhere. If you cannot produce evidence
that it went, expect the change to be treated as written-before-its-tests,
because that is the only thing the evidence supports.

## When the second write genuinely costs too much

Say so, in the review, with the reason — that is a finding, not an excuse, and
this team has accepted accurate objections repeatedly. What is not acceptable is
keeping the spike quietly and describing the result as test-first. The cost of
writing some things twice was stated openly when this was agreed; it is the
price of the one defect class this project keeps producing, which is a test that
cannot fail.
