# QA Report — Personal Todo App (v1) — **Fix-verification pass on `fix/dark-mode-checkbox`**

Tester: QA engineer
Date: 2026-08-16
Branch under test: `fix/dark-mode-checkbox` @ `ecf6104` ("fix: make the completion
checkbox visible in dark mode"), branched from `develop` @ `a6e9782`
Build under test: `npx next dev -p 3467` on `http://localhost:3467`, Node 24.14.0,
Neon Postgres (live DB)
Scope: verification of the DEF-08 / DEF-09 fix, plus the two items the previous
pass could not cover (desktop width, row tooltips), a regression sweep and a short
re-confirmation of cross-user isolation.

This report replaces the 2026-08-16 release-gate pass on `develop` (that text is
in git history at `ecf6104^`). **Defect numbering is carried over unchanged** —
`DEF-01`…`DEF-10` mean the same things they meant in the previous two passes.

Method, in one paragraph: black-box through the browser for the user-visible
flows; `curl` with real session cookies for the API and isolation probes;
**for every contrast number, my own compositing measurement** (described in §2)
rather than the numbers quoted in the commit message; keyboard-driven checks
where the harness blocked the pointer.

## Test accounts created for this pass

| Account | Purpose | Email |
|---|---|---|
| A | isolation owner | `qa+a1786862798@example.com` |
| B | isolation attacker | `qa+b1786862798@example.com` |
| C (pre-existing) | UI walkthrough | `qa+ui1786858394@example.com` — the previous pass's account, its browser session was still live |

A's todo ids used below: `cmsvfzs1u0000ukvemhystqxr` ("Ship release v3"),
`cmsvfzs5o0001ukvesd1q55ew` ("Buy milk"). B's own: `cmsvg07lm0004ukvesxjwcrdj`.

### Environment notes (please read — one of them is new)

1. **No process was killed except my own.** One dev server was started, on port
   3467, and it is the only one stopped. The unrelated project's server was never
   touched.
2. **Harness limitation, refined.** After *any* explicit `resize_window` call,
   **pointer input stops reaching the page** — a click on the `Active` filter at
   1280×800 left `aria-checked` and the URL unchanged, and a `hover` over a row's
   Edit button left `document.querySelectorAll(':hover')` empty, i.e. the page
   never saw the pointer at all. Two refinements on the previous pass's note:
   - **Keyboard input *does* survive the resize this time.** `Tab` moved focus
     through the whole page at 1280×800. That is what made the tooltip check
     possible (§4).
   - **Resizing back to 427×351 does not restore the pointer.** The previous pass
     recorded that reverting to the pane's native size revives input; setting the
     same numbers explicitly does not. Only a pane that has never been resized
     accepts the pointer.
   Consequence: everything requiring a real click was run first, at the pane's
   native 427×351; the desktop section is measurement plus keyboard only.
3. **Desktop screenshots render at a reduced scale.** At 1280×800 the captured
   image is 800×500 and the page is drawn small inside it. Desktop layout
   assertions below are therefore DOM geometry, not eyeballing.
4. `--force` navigations were used for fresh loads; console counts below are from
   the last full load in each configuration, not the cumulative buffer.

---

## 1. Verdict summary

| Item under verification | Verdict |
|---|---|
| **DEF-08 — completion checkbox invisible in dark mode** | **Verified fixed** (§2) |
| **DEF-08 — light mode not made worse** | **Verified** — light improved from 1.00:1 to 3.40:1 (§2) |
| **Checked state still reads correctly, both themes** | **Verified** (§2.3) |
| **Focus ring still visible, both themes** | **Verified** — visually; not measurable numerically, reason in §2.4 |
| **DEF-01 — 44×44 target intact** | **Verified** (§2.5) |
| **DEF-09 — wrong-type `note` message** | **Verified fixed** (§3) |
| Rest of the validation matrix, message accuracy | **Verified** — no other message describes the wrong mistake (§3) |
| **Desktop-width behaviour ≈1280 px** | **Verified** by geometry; pointer interaction at that width **could not be verified** (§4) |
| **Row Edit/Delete tooltips** | **Verified** via keyboard focus at 1280 px; **hover-triggered** tooltips **could not be verified** (§4) |
| **DEF-02 warning count at desktop width** | **Verified unchanged** — 1 per `/todos` load at both 427 and 1280 (§5) |
| **DEF-02 root cause** | **Now pinned, with proof** — `TodoFormModal`'s `<Modal>` root (§5) |
| Regression sweep (create / edit / toggle+Undo / delete / filters / search) | **Verified** (§6) |
| Cross-user isolation, short form | **Verified** (§7) |

| Story / NFR | Previous pass | This pass |
|---|---|---|
| US-06 List todos | **Fail** (DEF-08) | **Pass** |
| US-07 Toggle | **Partial** (DEF-08) | **Pass** |
| NFR-06 Dark mode | **Fail** (DEF-08) | **Pass** |
| NFR-08 Validation parity | Pass, with DEF-09 wording bug | **Pass**, DEF-09 closed |
| NFR-04 Keyboard accessibility | **Partial** (DEF-02) | **Partial** — DEF-02 still open, noise only |
| NFR-05 Responsive | Pass at 320/375/427 | Pass, now also 1280 (geometry) |

Everything else from the release-gate pass was not re-run and is not re-asserted
here; see §8.

---

## 2. DEF-08 — the completion checkbox in dark mode — **VERIFIED FIXED**

### 2.1 How I measured (independently of the lead's numbers)

I did not take the commit message's 5.14 / 3.40 on trust. In the live page I:

1. Read `getComputedStyle` for the control's `border-*`, `background-color` and
   `::before` (the accent fill), and the SVG checkmark's `stroke`.
2. Normalised **every** colour string — including `lab()`, `color(srgb …)` and the
   `color-mix()` the fix introduces — to sRGB bytes **plus alpha** by painting it
   on a 1×1 `<canvas>` twice, once over black and once over white, and solving
   `a = 1 − (onWhite − onBlack)/255`. This avoids hand-converting `lab()` and
   avoids trusting any single computed-value format.
3. Composited the ancestor background stack from the control upward until an
   opaque layer was found (control → label → row `<li>` → `<ul>` → card → main →
   body), so "the row behind it" is the *painted* colour, not a token.
4. Alpha-composited the border over the box interior, and separately over the row,
   then applied the WCAG 2.x relative-luminance and contrast-ratio formulas.
5. Cross-checked the arithmetic by hand for the dark border (0.5·252 + 0.5·24 =
   138 → L = 0.2547; box L = 0.00941 → 5.13) and cross-checked the *visual* result
   against screenshots at both themes.

The border resolves to `color(srgb 0.988 0.988 0.988 / 0.5)` in dark and
`color(srgb 0.094 0.094 0.106 / 0.5)` in light — i.e. the `color-mix()` does
resolve, in this browser, to half-strength foreground as intended.

### 2.2 Unchecked box — the actual numbers

Measured on `/todos` with a real list: one incomplete todo ("Ship release v3 RC2
QA4", high, due Aug 20, has a note) and one complete ("Buy milk").

| | Dark | Light |
|---|---|---|
| Page background | `rgb(6,6,7)` | `rgb(245,245,245)` |
| Card / row behind the box | `rgb(24,24,27)` | `rgb(255,255,255)` |
| Box interior (painted) | `rgb(24,24,27)` | `rgb(255,255,255)` |
| Border width / style | `1px solid` | `1px solid` |
| Border as painted | `rgb(138,138,139)` | `rgb(139,139,141)` |
| **Border vs box interior** | **5.14 : 1** ✅ | **3.40 : 1** ✅ |
| **Border vs row behind** | **5.14 : 1** ✅ | **3.40 : 1** ✅ |
| Border vs *hovered* row (`--surface-hover`) | 4.76 : 1 ✅ (row `rgb(39,39,42)`) | 3.25 : 1 ✅ (row `rgb(234,234,234)`) |

All four principal figures clear WCAG 1.4.11's 3:1 for a non-text control
boundary. My dark and light numbers agree with the lead's to two decimals, so
that measurement is confirmed rather than merely repeated. The hover row is the
tightest case in light at **3.25:1** — it still passes, but there is only 0.25
of headroom, so any future darkening of the border token should be re-measured.

Because the box interior is opaque, the border reads the same against the box
and against the row; there is no case where the box "disappears into" the row.

### 2.3 The pre-fix baseline, and light mode specifically

To be sure light mode was not made worse I measured the **pre-fix rendering
directly**, by removing the two utility classes the fix adds (`border` and the
`color-mix` border colour) from one live control in the DOM only — no file was
touched, and the class list was restored immediately afterwards:

| | Dark (pre-fix) | Light (pre-fix) |
|---|---|---|
| Border width | `0px` | `0px` |
| Box interior vs row | **1.00 : 1** | **1.00 : 1** |
| Only remaining edge cue | none (`box-shadow` all `rgba(0,0,0,0)`) | drop shadows at α ≤ 0.06 |

So the previous pass's dark-mode finding is reproduced exactly (1:1, no border),
and — a correction worth recording — **light mode was also 1.00:1 on the box
interior**; the earlier description of light as "a white circle with a visible
ring" was generous, the ring was three shadows at 4–6 % alpha. The fix takes
light from 1.00:1 to 3.40:1. **Light is improved, not degraded.**

### 2.4 Checked state and focus ring

**Checked state — correct in both themes.** The accent fill is the control's
`::before` (`rgb(4,133,247)`), which is `opacity: 0; scale: 0.7` when unselected
and `opacity: 1; scale: 1` when selected — so my earlier reading of the control's
own `background-color` (unchanged at `rgb(24,24,27)`) was not the whole picture,
and the fill is genuinely painted. Screenshots confirm a blue box with a white
tick in both themes.

| | Dark | Light |
|---|---|---|
| Accent fill vs row behind | 4.81 : 1 | 3.68 : 1 |
| Checkmark (`rgb(252,252,252)`) vs accent fill | 3.59 : 1 | 3.59 : 1 |

The checkmark is a `<polyline>` revealed by `stroke-dashoffset` (`66px` hidden →
`44px` ≡ one full `22px` dash period ≡ drawn). Both states verified on the same
page: the completed row shows the tick, the active row does not.

**Focus ring — still visible in both themes, not swallowed by the new border.**
Keyboard focus (`Tab`, then `shift+Tab` back onto the control, so react-aria's
keyboard modality is genuinely set) paints a ring on the visually-overlaid
`<input>` with `outline: auto` at `outline-offset: 2px` — i.e. **outside** the
16 px box, structurally separate from the 1 px border. Confirmed visually in
both themes by screenshot.

I am **not** quoting a contrast number for the ring, deliberately: with
`outline-style: auto` Chrome paints its own dual-tone ring and ignores
`outline-color`, and the computed colours (`rgb(153,200,255)` dark,
`rgb(229,151,0)` light) are demonstrably not what is painted — the ring is blue
in both screenshots. Any ratio computed from those values would be fiction.
Verdict: **visible, verified visually; not measured.**

### 2.5 DEF-01 — the 44×44 target — **intact**

At 427 px, both rows' pressable `checkbox__content` measures **44 × 44**, and
`document.elementFromPoint` at all five sampled points (four 3 px-inset corners
and the centre) resolves inside that element. A real pointer click at the centre
toggled the todo.

At ≥ `sm` the same element measures **36 × 36** — that is the deliberate
`sm:min-h-9 sm:min-w-9` in `TodoRow.tsx`, not a regression; it clears WCAG 2.5.8
AA (24 × 24) and the 44 px rule applies to the touch widths, where it holds.

### 2.6 Verdict

**DEF-08: Verified fixed.** US-06's "a completion control" is visible in dark
mode, light mode improved rather than regressed, checked state and focus ring
both survive, and the tap target is unchanged. NFR-06 returns to **Pass**.

---

## 3. DEF-09 and the validation matrix — **VERIFIED FIXED**

The exact payload from the brief, `POST /api/todos` as a signed-in user:

```
{"title":"T","priority":"low","note":5}
→ 400 {"code":"BAD_REQUEST","message":"The note must be text.",
       "fieldErrors":{"note":"The note must be text."}}
```

The message now names the actual mistake. The length message is still reached by
an actual length violation, so the two cases are now distinct:

| Payload | Status | Message |
|---|---|---|
| `note: 5` | 400 | `The note must be text.` ← **DEF-09 fixed** |
| `note: true` / `{}` / `[1]` / `null` | 400 | `The note must be text.` |
| `note` 2001 chars | 400 | `Keep the note under 2000 characters.` |
| `title: ""` / `"   "` / `5` / `true` | 400 | `Enter a title.` |
| `title` 201 chars | 400 | `Keep the title under 200 characters.` |
| `priority: "urgent"` / `5` / omitted | 400 | `Choose a priority: low, medium, high.` |
| `dueAt: "not-a-date"` / `"2026-02-31"` / `5` / `true` | 400 | `Enter a valid date (YYYY-MM-DD).` |
| `completed` present on `POST` | 400 | `Completion is changed by the checkbox, not by saving the todo.` |
| array / bare string / number / unparseable JSON | 400 | `That request wasn’t valid.` (no `fieldErrors`) |
| `{title, priority}` only | 201 | `note: null, dueAt: null` |
| `note: ""` | 201 | stored as `null` |

`PATCH /api/todos/<own id>` with `{"note":5}` gives the same corrected message,
so the fix covers the shared schema, not just the create path.

**Re-check for other messages that describe the wrong mistake — none found.**
Two things I looked hard at and decided are *not* defects:

- `title: 5` → `Enter a title.` A non-string title is, from the user's point of
  view, no title; the message is accurate about the required action and matches
  the copy deck. Contrast with the old `note` case, which asserted a 2000-character
  limit the caller was nowhere near — that was the actual wrongness.
- `dueAt: 5` / `priority: 5` → the same messages as the malformed-value cases.
  Both messages describe the required shape, so they remain true for a wrong type.

**One asymmetry, pre-existing, not filed as a new defect:** a `GET` returns
`note: null` / `dueAt: null`, but `POST`/`PATCH` reject explicit `null` for both
(`The note must be text.` / `Enter a valid date (YYYY-MM-DD).`), so a client
cannot round-trip a fetched todo verbatim. `dueAt` behaved this way before this
diff and `note`'s behaviour is unchanged — only its message changed. Worth a
ticket, not a release blocker, and out of scope for this pass.

Status route re-probed as A and still correct and distinct:
`{"completed":true}` → 200; `{"completed":"yes"}` → `Completion must be true or
false.`; `{"completed":true,"title":"X"}` → `Only completion can be changed here.
Save the todo's other fields separately.`; `PATCH` with `completed` on the main
route → `Completion is changed by the checkbox, not by saving the todo.`

---

## 4. Desktop width and the row tooltips — the previous pass's two gaps

### 4.1 Desktop layout at 1280×800 — **Verified (geometry)**

Measured after a full reload at 1280×800:

| Check | Measurement | Verdict |
|---|---|---|
| No horizontal scroll | `scrollWidth === clientWidth === 1280` | Pass |
| Content column centred and capped | `main` at `x=304, w=672` (`max-w-2xl`) in a 1280 viewport | Pass |
| **Filter bar on one row** | status radios `y=231.5`, priority select `y=231.5`, search `y=231.5` — **all three share a row**; x-ranges 336–538, 550–676, 716–916, no overlap | Pass |
| **Toolbar button placement** | `New todo` at `x=336, w=95, h=44` — auto width, left-aligned at the content edge (`sm:w-auto sm:self-start`), **not** full-bleed as at mobile | Pass |
| Row controls | Edit/Delete at the row's right edge, 36×36 each | Pass |
| Checkbox contrast at 1280 | identical to 427: 5.14:1 dark, 3.40:1 light | Pass |

**Could not verify at 1280 px:** anything requiring a real click or a real hover
— the pointer does not reach the page after a resize (note 2). I am not reporting
desktop *interaction* as passing, and I have no evidence it is broken either.

### 4.2 Row Edit/Delete tooltips — **Verified via keyboard focus**

At 1280 px the `sm:`-and-up tooltips do render. Because keyboard input survives
the resize, I reached them with `Tab`:

| Focused control | Tooltip | Evidence |
|---|---|---|
| `Edit "Ship release v3 RC2 QA4"` | `Edit` | `[role=tooltip]` present, `visibility: visible`, `opacity: 1`, button carries `aria-describedby="react-aria…_r_l_"` |
| `Delete "Ship release v3 RC2 QA4"` | `Delete` | `[role=tooltip]` at `x=868 y=285 w=53 h=32`, directly above the button at `x=876 y=320 w=36 h=36`; `aria-describedby` wired |

Both were also visible in a screenshot. **Hover-triggered** tooltips specifically
**could not be verified** — a `hover` at the button's correct coordinates left
`:hover` matching zero elements, so the page never received the pointer. The
tooltip component, its content, its positioning and its accessible wiring are all
confirmed working; only the mouse-entry trigger path is unproven in this harness.

---

## 5. DEF-02 — `PressResponder` warning — still present, **and now pinned**

### 5.1 Count

| Page / width | Warnings per fresh load |
|---|---|
| `/todos` at 427×351 | **1** (two consecutive fresh loads, 1 each) |
| `/todos` at 1280×800 | **1** |

**The count does not change at desktop width.** Unchanged from the previous pass.

### 5.2 Root cause — proven, and it is not the account menu

The lead was right to reject the `Dropdown` lead. Reading the installed packages:
`react-aria`'s `PressResponder` warns from a mount-only `useEffect` when no
descendant called `usePress` (which is what registers). HeroUI's
`Dropdown.Trigger` is `react-aria-components`' `Button` → `useButton` → `usePress`
→ `register()`, so the account menu registers correctly and does **not** warn.

The actual source is **`TodoFormModal`**:
`src/app/todos/components/TodoFormModal.tsx:144` renders `<Modal state={state}>`,
and HeroUI's `Modal` root is react-aria's `DialogTrigger`
(`node_modules/@heroui/react/dist/components/modal/modal.js:34`), which always
wraps its children in a `PressResponder`. The modal is *controlled* by `state`
and has no `Modal.Trigger` child, so nothing pressable ever registers → exactly
one warning per mounted instance. This is the **same shape** as the bug already
fixed in `ConfirmDialog`, which dropped the `<AlertDialog>` root for precisely
this reason (the comment in `src/components/ConfirmDialog.tsx` says so).

**How I proved it, at runtime, rather than inferring it.** `TodoListScreen`
renders the modal with `key={editingTodo?.id ?? "create"}`, so changing which
todo is being edited remounts *that component and nothing else*. With
`console.warn` patched to count:

| Action | Expected if the source is `TodoFormModal` | Observed |
|---|---|---|
| Client-side mount of `/todos` (router push from a 404 page, so the patch was installed before mount) | +1 | **1** |
| Click `Edit` on a row (`key` "create" → todo id, modal remounts, nothing else does) | +1 | **2** |
| Click `New todo` (`key` back to "create", modal remounts) | +1 | **3** |

Each isolated remount of that one component produced exactly one warning. That is
direct evidence, not correlation with the app shell.

**Fix shape, for whoever picks it up:** the same as `ConfirmDialog` — skip the
`Modal` root and drive `Modal.Backdrop` (a `ModalOverlay`) with the controlled
`isOpen`/`onOpenChange` props. Not attempted here; this pass changes no code.

**Impact unchanged:** console noise only. Every dialog behaves correctly (§6).
NFR-04 stays **Partial** for this reason alone.

---

## 6. Regression sweep — **no regressions found**

Run at 427×351 with real clicks and typing, against account C's live list.

| Flow | Result |
|---|---|
| **Create** | `New todo` → modal `New todo`, Title focused on open; typed a title; confirm `Add this todo?` / `“QA verify pass todo” will be added to your list.`; `POST /api/todos` → 201; row appeared without reload; count `1 of 2 done` → `1 of 3 done`, newest first |
| **Edit** | `Edit` → modal `Edit todo` **pre-filled** (`title="Ship release v3 RC2"`, `note="cut the tag"`, `dueAt="2026-08-20"`); appended text; confirm `Save these changes?` / `“…QA4” will be updated.`; `PATCH /api/todos/<id>` → 200; row updated in place |
| **Toggle + Undo** | Click toggled, row moved to the completed group with strikethrough, count `1 of 3` → `2 of 3`; toast `Todo “QA verify pass todo” marked not complete` **with `Undo`**; clicking `Undo` issued a **third `PATCH /api/todos/<id>/status`** (confirmed in the network log — the scoped route, not a shortcut) and the count returned |
| **Delete** | `AlertDialog` `Delete this todo?` naming the record; **`Cancel` focused first**; **Escape closed it without mutating** (row still present, count unchanged) and **focus returned to the triggering `Delete "…"` button**; reopened and confirmed → row gone, count `2 of 3` → `1 of 2`, toast `Todo “QA verify pass todo” deleted` |
| **Filters** | `Active` → `?status=active`, list narrowed to the single incomplete todo |
| **Search** | typing `zzz` → `?status=active&q=zzz`, distinct search empty state `No matches` / `No todos match “zzz”.` with `Clear search` |
| **Theme toggle** | Header button switched light↔dark, set `data-theme`, toggled `.dark`, persisted `heroui-theme` |
| **Modals / toasts vs `docs/CONVENTIONS.md`** | Every mutation is preceded by a confirm naming the record; toggle is the approved no-confirm exception and reports by toast with `Undo`; destructive confirm focuses `Cancel`; non-destructive focuses the confirm action |

**Console and network across the run:** no unhandled rejections; **no 5xx** — the
dev server log for the entire session contains no error and no stack trace; every
4xx traces to a deliberate probe of mine (plus `/nope-404`, which I navigated to
on purpose to get a clean client-side remount for §5.2). The Speed Insights
beacon remains inert in dev. The only recurring console message is the DEF-02
warning.

---

## 7. Cross-user isolation — **short form, Verified**

**This is deliberately the short form.** The diff under test touches exactly two
files — `TodoRow.tsx` (a CSS class) and `form/schema.ts` (one error string) —
and neither is in the authorization path: no route handler, no session code, no
Prisma query changed. The full isolation battery was run to completion in the
previous pass on the parent commit, so re-running it in full would re-prove
untouched code. Confirmation probes, all as B against A's real ids:

| Probe (as B) | Expected | Actual |
|---|---|---|
| `GET /api/todos` | none of A's | only B's own todo |
| `GET /api/todos/<A id>` | — | `405`, empty (DEF-04, unchanged) |
| `PATCH /api/todos/<A id>` `{"title":"HACKED BY B"}` | `404` | `404 {"code":"NOT_FOUND","message":"That todo no longer exists."}` |
| `PATCH /api/todos/<A id>/status` `{"completed":true}` | `404` | `404`, same body |
| `DELETE /api/todos/<A id>` | `404` | `404`, same body |
| `?query=milk` (A's exact title) | empty | `{"todos":[]}` |
| unauthenticated `PATCH …/status` | `401` | `401 {"code":"UNAUTHORIZED","message":"Sign in again to continue."}` |
| A's list re-read afterwards | unchanged | all 4 todos intact, no title rewritten |

A nonexistent id (`totally-made-up-id-xyz`) returns the byte-identical `404`, so
there is still no existence oracle. NFR-01 holds.

---

## 8. Not tested / could not verify in this pass

- **Pointer interaction at desktop width**, and **hover-triggered** tooltips —
  harness (note 2). Marked *could not verify*, not pass, not broken.
- **Real touch activation** at mobile widths — measurement and hit-testing only.
- **Failure paths** (create / toggle / delete error handling) — no fault injection.
- **DEF-10** (`INTERNAL` declared but unreachable) — unchanged by this diff, not
  re-examined; still open from code inspection.
- **DEF-04** (`GET /api/todos/[id]` → `405`) — unchanged, informational.
- **M-5** production boot, expired session cookies, duplicate-email sign-up,
  wrong-password copy, loading skeleton, 200-todo performance, bundle secret
  leakage, WCAG *text* contrast — all carried over from previous passes, not
  re-run. Only non-text contrast was measured here.
- Sign-up / sign-in / sign-out flows were not re-walked in the browser this pass;
  account creation for A and B went through the auth API and succeeded.

---

## 9. Recommendation

## **SHIP.**

**DEF-08 is genuinely fixed, and I verified it myself rather than accepting the
numbers in the commit.** By my own canvas-normalised compositing measurement the
unchecked control's border reads **5.14:1** against both the box interior and the
row in dark, and **3.40:1** in light — both clear WCAG 1.4.11's 3:1 — and the
worst case anywhere in the fix, a hovered row in light mode, is **3.25:1**, still
passing. The pre-fix state reproduces at **1.00:1 in both themes**, which also
corrects the earlier record: light mode was never really fine, it just failed
less visibly. Checked state (accent fill 4.81:1 dark / 3.68:1 light, white
checkmark 3.59:1 on the fill), focus ring and the 44×44 target all survive the
change. **DEF-09 is closed** and the rest of the validation matrix contains no
other message that describes the wrong mistake.

**The two gaps from the last pass are now mostly closed.** Desktop layout at
1280 px is correct — filter bar on one row, toolbar button auto-width and
left-aligned, no horizontal scroll — and the row tooltips do render, with correct
content, position and `aria-describedby`, reached by keyboard. I could not drive
the pointer at that width, so desktop *mouse* interaction and hover-triggered
tooltips remain unproven; that is a harness limit, not a finding against the app.

**What stays open, and none of it blocks:**

- **DEF-02** (Minor) — 1 console warning per `/todos` load, unchanged at desktop
  width. It is now **pinned with proof** to `TodoFormModal`'s `<Modal>` root, and
  the fix is the same one-line shape already applied to `ConfirmDialog`. Console
  noise only; it should be scheduled, not rushed into this release.
- **DEF-04** (informational), **DEF-10** (declared-but-unreachable `INTERNAL`,
  code inspection only) — both unchanged by this diff.
- The `null` round-trip asymmetry on `note`/`dueAt` noted in §3 — pre-existing,
  worth a ticket.

**One caveat on the strength of this pass, stated plainly.** It was scoped to the
fix, so it is not a fresh release gate: the auth flows, the failure paths and the
full isolation battery were carried over from the previous pass rather than
re-proved, and no test exercised a real mouse at desktop width. Within that
scope, the fix does what it claims, it did not break anything I could reach, and
the Major that blocked the release is gone.
