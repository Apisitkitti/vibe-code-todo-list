# The reported `/sign-up` hydration mismatch does not reproduce

**Decided:** no fix was made, because no defect was found. The reported
hydration mismatch on `/sign-up` could not be reproduced under any condition
tried, in dev or in a production build, on either auth page. Coverage was added
so that if it is real, it fails loudly the next time it happens:
`e2e/console-clean.spec.ts` now asserts a clean console on `/sign-up` and
`/sign-in`.

**This record exists because a disproof rots faster than a fix.** A fix defends
itself — the test stays green and the code stays changed. A "we looked and found
nothing" survives only as long as someone remembers it, and the report then
resurfaces in three months and every run below gets repeated by somebody who has
no way of knowing they are repeating them. That has already happened twice on
this project with the `PressResponder` diagnosis, which was twice recorded as
"confirmed present, not re-diagnosed" (`docs/decisions/README.md`).

If you are reading this because the report came back: **start at "What would
change this" at the bottom, not at the top.**

## What raised it

A report that `/sign-up` logs a hydration mismatch, described as reported but
not diagnosed. `/sign-up` is the app's second-most-important screen, and a
mismatch there is not cosmetic — React discards the mismatched subtree and
rebuilds it, and that screen is nothing but inputs, so a field remounted under a
cursor is how typed characters and focus go missing.

## What was run, and under what

All against `fix/bugs` at `eae9dd1` + the branch's own commits, Node 24.14.0,
Next 16.3.1, React 19.2.8, Playwright chromium, `E2E_PORT=3211`.

| Condition | `/sign-up` | `/sign-in` |
|---|---|---|
| `next dev`, desktop (1280×800) | clean | clean |
| `next dev`, mobile (Pixel 7) | clean | clean |
| `next dev`, `colorScheme: dark` | clean | — |
| `next dev`, `localStorage` `heroui-theme=dark` set before load | clean | — |
| `next dev`, `?next=` param present | — | clean |
| `next build` + `next start` (production) | clean | clean |

"Clean" means: zero `console.error`, zero `console.warn`, and zero `pageerror`,
excluding the dev-server chatter `console-clean.spec.ts` already filters. Each
run navigated with a full `page.goto` — so the listener saw the server-rendered
document being hydrated, which is the only moment a mismatch is reported — then
filled the email field, because interacting requires the client tree to be live
and is therefore strictly later than hydration.

The production run additionally logged two `404`s, which are **not** hydration
and **not** application defects: `/_vercel/speed-insights/script.js` and
`/favicon.ico`. Both are served by Vercel and by nothing else, so both are
artifacts of running `next start` on a laptop. Anyone pointing a console
assertion at a local production build will see them and should not go hunting.

## The control, which is the part that makes this a disproof

A passing test proves nothing until it has been watched failing. So before
concluding anything, a deliberate mismatch was injected into
`src/app/sign-up/components/form/SignUpForm.tsx`:

```tsx
<Card.Description>
  It takes about ten seconds.
  {typeof window === "undefined" ? " SERVER" : " CLIENT"}
</Card.Description>
```

The new test went red, reporting:

> `pageerror: Hydration failed because the server rendered text didn't match the
> client. As a result this tree will be regenerated on the client.`

It also surfaced a second message as a *consequence* of the first — *"Encountered
a script tag while rendering React component"*, raised against the root layout's
theme-bootstrap `<script>` during the client's rebuild of the tree. Worth
knowing: that message is a symptom of a hydration failure elsewhere, not an
independent defect, and it disappears with the mismatch.

The injection was then reverted and the file verified byte-identical against a
pre-injection copy.

**So the assertion can go red on this exact page, for this exact class of
defect, and it does not.**

## Why the code agrees with the runs

Every hydration-sensitive construct in `src/` is on `/todos`, not on the auth
pages:

- `useMediaQuery` — `TodoListScreen.tsx`, `TodoFormModal.tsx`
- `suppressHydrationWarning` — the root layout's `<html>`, plus
  `TodoListHeaderLine.tsx` and `TodoDueDate.tsx`

Neither auth page renders a media query, a formatted date, `Date.now()`,
`Math.random()`, or a `typeof window` branch. `SignUpPage` and `SignInPage`
resolve their session on the server and then render a form whose output is fully
determined by its props. There is no mechanism there for the server and the
client to disagree.

The one genuine SSR/client divergence on these pages is the theme bootstrap
script in the root layout, which adds a class and a `data-theme` attribute to
`<html>` before React hydrates. That is exactly what the `<html>` element's
`suppressHydrationWarning` covers, and the two dark-theme rows in the table above
were run specifically to try to break it. They did not.

## The most plausible explanation for the report

**A browser extension or password manager mutating the form before React
hydrates.** React's own hydration-mismatch message names this case explicitly:
*"It can also happen if the client has a browser extension installed which messes
with the HTML before React loaded."*

It fits every fact: a sign-up form is precisely what a password manager injects
into, it would appear on `/sign-up` and not on `/todos`, it would be reproducible
for the person who reported it and for nobody else, and it is invisible to a
Playwright browser, which runs with no extensions.

**This is a hypothesis, not a finding.** It was not confirmed — confirming it
means reproducing on the reporter's own profile — and it should not be written up
anywhere as the cause. It is recorded because it is the first thing to check.

## What I verified, and what I did not

- **Verified by execution.** Every row of the table. The injected control going
  red, and the revert going green.
- **Verified by reading.** That the auth pages contain no hydration-sensitive
  construct; that `useMediaQuery` and `suppressHydrationWarning` appear only
  under `/todos` and in the root layout.
- **Not verified.** The extension hypothesis. Also *not* checked: Firefox and
  WebKit — this suite is chromium-only, and a rendering-engine-specific
  hydration mismatch is not something these runs would have caught.
- **Noted in passing, not investigated.** `TodoListScreen.tsx` and
  `TodoFormModal.tsx` both call `useMediaQuery` *without*
  `initializeWithValue: false`, which is the option
  `c72c998` added to the board's call for exactly this reason. The existing
  `/todos` console assertion passes, so there is no live mismatch there today.
  Both files were owned by other branches during this work and were not touched.
  Flagged only so the next person does not mistake it for undiscovered ground.

## What would change this

Reopen if — and only if — one of these is true. Otherwise the runs above stand
and re-running them is wasted work.

1. **A reproduction with the browser named and extensions disabled.** The
   single most useful thing a new report can carry. If it reproduces in a clean
   profile, this record is wrong and the table above is the list of conditions
   already ruled out, so start outside it.
2. **`e2e/console-clean.spec.ts` goes red on an auth page.** That is the
   coverage this investigation left behind and it is the intended trigger. It
   has been watched failing, so a red there is real.
3. **An auth page gains a client/server divergence** — a media query, a
   date rendered without `suppressHydrationWarning`, a `typeof window` branch,
   or anything read from `localStorage` during render. The finding above is
   about the code as it stands, and it expires the moment that changes.
4. **A non-chromium engine is added to the suite** and reports one.
