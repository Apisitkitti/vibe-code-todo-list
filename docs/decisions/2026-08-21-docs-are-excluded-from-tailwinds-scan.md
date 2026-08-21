# `docs/` is excluded from Tailwind's scan with `@source not`, and it is worth 2,326 bytes

*2026-08-21 — on `chore/tailwind-source-scope`.*

**What was decided:** `src/app/globals.css` gains `@source not "../../docs";`.
Tailwind v4's automatic scan was reaching the whole repository, so utilities
merely *named* in `docs/` prose were emitted as real CSS rules. The exclusion is
written as a negation rather than as `source(none)` plus an allow-list, because
the failure mode of over-narrowing is silent.

This is a **correctness** change, not a performance one. See the size section —
the win is 2,326 bytes raw and 339 bytes gzipped, and it should not be sold as
anything more.

## What raised it

A standing report that "nine dead selectors ship to users, three of which name
classes that have never appeared in `src/` at all."

**Both halves of that are wrong, and wrong in the same direction — it is worse
than reported.** Measured rather than assumed:

- **Thirty** selectors, not nine.
- **All thirty** are absent from `src/` as far as Tailwind's own extractor is
  concerned, not three. By a cruder literal `grep` over `src/`, twenty-six of
  the thirty do not occur in any form; the other four are explained below and
  are not real uses either.

## The mechanism, verified against the installed version

Tailwind v4 configures scanning from CSS. There is no `tailwind.config.js` here
and adding one would not have helped.

`node_modules/@tailwindcss/postcss/dist/index.mjs` builds the scanner's source
list as:

```
root === "none" ? []
: root === null  ? [{ base, pattern: <recursive glob>, negated: false }]
: [{ ...root, negated: false }]
```

…and then concatenates every `@source` rule onto it. `root` comes from a
`source(…)` argument on `@tailwind utilities` (which is what `@import
"tailwindcss" source(…)` desugars to). Nothing in this project passes one:
`src/app/globals.css` imports `@heroui/react/styles`, which reaches
`@import "tailwindcss"` bare via `@heroui/styles/dist/index.css`. So `root` is
`null` and the scanner starts from a recursive glob at the repository root.

The pre-existing `@source "../../src";` line was therefore doing **nothing** —
`src/` was already inside the repo-root sweep. It is kept, now as a deliberate
statement rather than an accident.

`@source not "…"` is the v4 exclusion form. Confirmed by reading the parser in
`node_modules/tailwindcss/dist/lib.mjs` (v4.3.3), which strips a leading `not `
into a `negated: true` flag on the source entry, and separately supports
`@source inline(…)` and `@source not inline(…)`. `tailwindcss@4.3.3` ships no
docs directory, so this was read out of the compiled source.

## The selector diff — the actual deliverable

Method: `rm -rf .next` → `npm run build`, before and after, extracting every
class selector from the emitted CSS chunks (unescaping CSS ident escapes,
string literals stripped first so `content:` values cannot forge a selector),
sorted, then `diff`ed.

**Before: 767 class selectors. After: 737. Removed: 30. Added: 0.**

Every removed selector, cross-checked two ways — `in_src` / `in_docs` are
candidate-set membership from Tailwind's own scanner
(`@tailwindcss/oxide`'s `Scanner`) run over each directory in isolation:

| Removed selector | in `src/` | in `docs/` |
|---|---|---|
| `bg-[var(--background)]` | no | yes |
| `bg-[var(--surface)]` | no | yes |
| `border-[var(--border)]` | no | yes |
| `dark:shadow-none` | no | yes |
| `divide-[var(--border-secondary)]` | no | yes |
| `divide-border-secondary` | no | yes |
| `fade-in` | no | yes |
| `focus-visible:ring-0` | no | yes |
| `focus:outline-none` | no | yes |
| `grayscale` | no | yes |
| `group-focus-within:opacity-100` | no | yes |
| `group-hover:opacity-100` | no | yes |
| `h-10` | no | yes |
| `inline-block` | no | yes |
| `inset-0` | no | yes |
| `m-1` | no | yes |
| `m-2` | no | yes |
| `m-3` | no | yes |
| `m-6` | no | yes |
| `md:h-9` | no | yes |
| `mt-0.5` | no | yes |
| `outline-none` | no | yes |
| `rounded-lg` | no | yes |
| `rounded-xl` | no | yes |
| `shadow` | no | yes |
| `text-[var(--foreground)]` | no | yes |
| `text-[var(--muted)]` | no | yes |
| `text-[var(--warning-soft-foreground)]` | no | yes |
| `text-gray-500` | no | yes |
| `z-50` | no | yes |

**Nothing was added, and nothing `src/` uses was removed.**

### The four that looked like near-misses

A naive `grep -rF` over `src/` returns a hit for four of the thirty. All four
are false positives, and each was opened and read rather than dismissed:

- **`group-hover:opacity-100`** and **`group-focus-within:opacity-100`** —
  `src/app/todos/components/TodoRow.tsx:253` has
  `lg:group-focus-within:opacity-100 lg:group-hover:opacity-100`. The classes
  `src/` actually uses are the **`lg:`-prefixed** ones, and both of those are
  still emitted after the change (verified present in the after-list). The
  grep matched a suffix. The unprefixed variants came only from `docs/`, where
  the same behaviour is *described* without the breakpoint prefix.
- **`m-1`** — `src/app/todos/components/TodoFormModal.tsx:143`, inside a
  comment: `(review m-1)`.
- **`m-6`** — `src/app/api/todos/errors.ts:23`, inside a comment:
  `(review m-6)`.

Those last two are review-item identifiers in English prose, not class names.
The scanner does not treat them as candidates in that position, which is why
they disappeared with `docs/` rather than surviving on `src/`. Worth noting as
the same hazard one layer in: prose inside `src/` is scanned too.

## Why a negation rather than `source(none)`

`source(none)` plus `@source "../../src"` would also have removed `docs/`, and
would have removed more besides. That is the problem. The scan currently
covers `e2e/`, `tests/`, `prisma/`, `public/`, `next.config.ts` and every other
tracked file at the root, and **nothing in this repository would fail if one of
those quietly stopped contributing a class a real component needs.** Neither
suite renders against the production CSS bundle; the page would simply render
wrong, and the next person would be debugging a missing utility with no failing
test to start from.

The negation removes exactly the directory that was identified and leaves every
other scanned path exactly as it was — which is what the empty "added" column
above demonstrates.

## The size, stated plainly

| | before | after | delta |
|---|---|---|---|
| Tailwind CSS chunk, raw | 426,602 B | 424,276 B | **−2,326 B (−0.55%)** |
| …gzip -9 | 40,567 B | 40,228 B | **−339 B (−0.84%)** |

The second chunk (fonts, 3,713 B) is byte-identical.

**This is not a performance win.** Three hundred and thirty-nine bytes over the
wire is noise. The reason to make the change is that the stylesheet should
describe the application and currently describes the documentation as well;
`shadow`, `rounded-lg` and `text-gray-500` in the shipped bundle are a standing
invitation to conclude the app uses them.

## What is verified and what is not

Verified by execution: the before/after builds, the selector extraction and
diff, the per-selector `in_src` / `in_docs` membership from Tailwind's own
`Scanner`, the byte and gzip sizes, and the full gate (build 0, `tsc --noEmit`
0, `eslint` 0, Vitest 492/492, Playwright 361 passed / 33 skipped).

Verified by reading the installed package source: the `root === null` default,
the `@source not` parse, and the fact that `@import "tailwindcss"` arrives bare
through HeroUI.

**Not verified:** that no *other* scanned directory is contributing dead
selectors. `e2e/`, `tests/` and the root-level markdown (`AGENTS.md`,
`CLAUDE.md`, `README.md`, `.claude/`) are all still in the sweep and were not
audited. `docs/` was the reported case and is the one that was measured.

## What would change this

- **Another directory is found to be leaking.** Add another `@source not`;
  do not switch to `source(none)` without first building the same before/after
  selector diff, because that is the change that can silently drop a live
  class.
- **`docs/` starts holding something that renders.** An MDX page, a Storybook
  story, a component example compiled into the app. Then the exclusion is
  wrong and needs narrowing to `docs/*.md` or lifting entirely.
- **A test starts asserting against the built CSS bundle.** That would remove
  the reason to prefer the conservative negation, because over-narrowing would
  stop being silent.
