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

---
---

# Risk assessment: drag-and-drop and the current branch — 2026-08-16

*(Re-scoped mid-write, at the lead's request, to lead with "how do we make this
app more appealing to use". §C onward is the drag-and-drop risk assessment as
originally asked for; §B is the new headline and is written from the driving
seat rather than from the spec.)*

Tester: QA engineer
Date: 2026-08-16
Written against: working tree of `fix/add-refresh-gap` @ `4020b9b` + uncommitted
changes, `docs/PRD.md`, `docs/DESIGN.md` §6, `docs/REVIEW.md` m-4/m-8,
`docs/PM-PROPOSAL.md` (the PM's uncommitted "Decision: scope for
`fix/add-refresh-gap`").

**This is an assessment, not a test pass. No code was run, no server was started,
no process of anyone's was touched.** Everything below is code reading,
measurement carried over from §2–§7 above, and my own documented harness limits.
Where I say a number is unverified, I have not verified it.

## A. Verdicts, up front

| Question | Verdict |
|---|---|
| Replace the completion checkbox with drag and drop | **Do not build it.** High risk, and — the deciding point — **I cannot verify it with current tooling** (§C.3) |
| Is the skeleton split (create/edit/filter yes; toggle/delete no) the right call | **Yes**, the reasoning is sound and I agree with it |
| Is the per-row pending signal sufficient for toggle | **Nearly** — one real gap, filed as **DEF-12** |
| Is it sufficient for delete | **No.** Filed as **DEF-11**, and it is caused by this branch |
| Sign-off shape | **Short form on isolation only. Full form on the regression sweep.** The presentation-diff precedent does **not** carry (§D.4) |
| Can I sign the branch off today | **No** — none of the change under discussion is committed (§D.1) |

And the answer to the re-scoped question, in one line: **the app's appeal problem
is not that it lacks a gesture — it is that it asks permission to do the thing
you already told it to do.** §B.

---

## B. Where this app is actually unpleasant — from the driving seat

I have created, edited, toggled, undone and deleted todos across three passes on
three accounts. None of what follows is a defect. All of it passes.

Ranked by how much it wears, not by how hard it is to fix.

### B.1 — The confirm dialog on **create** and **edit**. This is the one. ★★★★★

From my own §6 sweep, the recorded steps to write down "Buy milk":

> `New todo` → modal opens → type the title → submit → **a second dialog:
> `Add this todo?` / "“QA verify pass todo” will be added to your list."** →
> `Confirm` → toast.

**Two dialogs and a toast to add a todo.** The second dialog asks me to confirm
an action that is not destructive, not irreversible, not expensive, and whose
entire content is the sentence I just typed and am still looking at. It tells me
what I am about to do in the past tense of my own intent. Editing is the same
shape: `Save these changes?`

I have sat through that dialog more times than anyone, and it is the single
thing about this app I would remove first. It is not slow — it is *patronising*.
It reads as though the app does not trust that pressing a button labelled "Add"
meant "add".

And it is **all** it does. There is no unsaved-work protection in it, no
validation summary, no diff of what changed on an edit. It is a modal that says
"really?" and has one useful button.

`docs/CONVENTIONS.md` → Mutation UX mandates it — a confirm naming the record
before every mutation, with the toggle as the sole exception. That rule is
correct for **delete** and wrong for everything else, and I think it was written
as a safety principle without anyone sitting through it two hundred times.

**Proposal:** invert the confirm budget. Confirm what cannot be undone; undo what
can.

| Action | Today | Proposed |
|---|---|---|
| Create | confirm dialog + toast | **toast only**, no dialog |
| Edit | confirm dialog + toast | **toast only**, no dialog |
| Toggle | toast **with Undo** | unchanged — this is already right |
| Delete | confirm dialog + toast | unchanged — this is the one that earns it |

This is one exception to one convention, it deletes UI rather than adding any,
and it takes create from six interactions to four and edit from five to three.

**Can I verify it? Yes, completely, at every width.** It removes a step from a
flow §6 already covers; the assertion is "no `AlertDialog` appears and the
`POST` still fires". Nothing pointer-dependent. This is the highest-value and
cheapest-to-verify item on my list, which is why it is first.

### B.2 — The list never tells me what to do next ★★★★☆

`docs/PRD.md` §2 fixes the default order as *active before completed, then
`createdAt` descending*. So a todo due **tomorrow, marked high** sits below one I
typed forty seconds ago with no due date and no priority.

The app renders priority (`PriorityChip`) and due date (`TodoDueDate`, with the
overdue `⚠` treatment) on every row — it is *displaying* urgency it refuses to
*act* on. Driving it, I kept scanning the list to re-derive an order the app
already had all the data to produce. For a todo app, "what should I do next" is
the whole job, and this one makes you do it yourself.

This is the PM's backlog #2 and I want to put my weight behind it from the
testing seat, with one addition: **do it as the default order, not as a sort
dropdown.** A dropdown is a preference the user has to discover, set, and
maintain; a better default is a thing that is simply true when they open the app.

**Can I verify it? Yes, trivially and at every width** — it is a DOM-order
assertion over `<li>` ids, no pointer involved. It is also the kind of thing that
should be a unit test on the query, not a browser check at all (see P1).

### B.3 — Undo is on the wrong action, and it evaporates ★★★☆☆

The one action with **Undo** is the toggle — the most reversible action in the
app, where undo means "click the box again". The one action that is genuinely
irreversible, delete, has no undo at all; it has a dialog instead.

And the undo that does exist lives **only in a toast**. §6 verified it works and
that it correctly re-runs the scoped endpoint — but a toast auto-dismisses. Undo
you have to catch is not a safety net, it is a reflex test. Twice during testing
I meant to click it and the toast had gone.

**Proposal, in priority order:** (a) make the toggle toast's Undo keyboard
reachable and give it a longer life; (b) once B.1 lands and delete is the *only*
dialog left, revisit whether delete would be better as **undo-able toast** than
as a dialog — that is the modern pattern and it is strictly less friction. (b) is
a PM call with a data-model cost (PRD §4 rules out soft delete), so I raise it,
I do not push it.

**Can I verify it? Partly.** A toast action is a click; at the native 427 px pane
I can click it, at desktop width I cannot (the pointer limit). If the toast
action is **keyboard-reachable**, I can verify it at both widths — which is a
concrete reason to build it that way regardless.

### B.4 — Adding several todos in a row is a modal round-trip each time ★★★☆☆

Setting up test data, the create loop was the slowest part of every pass: open
modal, type, submit, confirm, wait for the skeleton, click New todo, repeat. US-05
requires the form to reset to defaults after a create — which it does — but the
form is *closed* by then, so the reset is invisible and the next todo starts with
another modal.

This is the PM's backlog #1 (quick-add bar), and driving the app is what convinced
me it is real rather than a nice-to-have. Note it also **compounds with B.1**: a
quick-add bar that raises a confirm dialog on every Enter would be worse than
what we have now. If B.1 is refused, quick-add should be dropped, not built with a
dialog — which is, I notice, exactly what the PM already concluded.

**Can I verify it? Yes, completely, at every width.** A text input and the Enter
key are the single most testable interaction that exists in my harness — keyboard
input survives everything, including the resize bug.

### B.5 — Completed todos accumulate in the list forever ★★☆☆☆

Account C's list by the end of the last pass was mostly finished work I had to
scroll past. There is no clear-completed, no collapse, no "3 completed" summary
row. PRD §4 rules out bulk actions for v1 and I am not asking to reopen that —
but a **collapsed group header** for completed items is presentation, not a bulk
action, and it would keep the top of the list about the present. Low priority;
raising it because it is the thing I noticed getting worse over time rather than
on first use.

**Can I verify it? Yes** — a disclosure control, keyboard-operable, DOM-assertable.

### B.6 — The pattern underneath all of this, which is a design constraint

Look at what B.1–B.5 have in common versus the drag proposal in §C:

| | Verifiable with current tooling | Widths |
|---|---|---|
| B.1 drop create/edit confirm | **Fully** | all |
| B.2 due-date-aware default order | **Fully** | all |
| B.4 quick-add bar | **Fully** | all |
| B.5 collapse completed | **Fully** | all |
| B.3 undo in toast | **Partly** — fully if keyboard-reachable | 427 only, unless keyboard |
| §C drag to complete | **No** | none |

**Everything that makes this app more pleasant and that I can actually verify is
keyboard-driven or text-driven. The one proposal I cannot verify at any width is
the pointer-driven one.** That is not a coincidence and it is worth the team
holding onto: with this harness, *typed and keyed* interactions are cheap to
prove and *pointed and dragged* ones are not.

I am not saying build only what QA finds convenient. I am saying that four of the
five things that would most improve this app to use are also the four cheapest
things to prove correct, and the gesture is both the most expensive to build and
the only one I would have to mark *could not verify* forever. If appeal is the
goal, the ordering more or less writes itself.

### B.7 — Acceptance criteria that pass while the experience stays poor

Ranked. These are the ACs I would change, and P2/P3 in §E are two more.

1. **US-05 / US-08 count no steps.** Every create AC is about *state* — the todo
   exists, the fields are right, the form resets. Not one of them says anything
   about how many interactions it takes, so the six-step create in B.1 passes
   perfectly. An AC set that cannot distinguish a two-step create from a six-step
   one is not describing the experience it claims to describe. **Add an AC to
   US-05:** *"a todo with only a title can be created in at most two
   interactions from the list view, without a confirmation step."* That single
   line makes B.1 a requirement instead of an opinion, and it is trivially
   testable.
2. **US-06's default-order AC locks in the wrong order as correct.** *"active
   before completed, within each group newest-created first"* — written as an
   acceptance criterion, so B.2 cannot be filed as a bug against it. It is the
   sharpest case of an AC testing the thing that was built rather than the thing
   that is useful. **Amend it** as part of B.2, and note the PM already has the
   PRD amendment on the queue.
3. **US-06's loading AC cannot tell a good implementation from a bad one.**
   *"a loading state (skeleton or spinner) is shown rather than a blank
   screen."* The entire argument on `fix/add-refresh-gap` is about *which*
   changes deserve the skeleton — and **both** the committed always-skeleton
   version and the working tree's split version satisfy this AC identically. An
   AC that a good and a bad implementation both pass is doing no work. **Reword:**
   *"a loading state is shown when the set of todos being displayed changes
   (first load, filter, search, create, edit); a single-row change (toggle,
   delete) does not blank the list."* That is testable, and it is exactly the
   contract this branch is trying to establish.
4. **US-07's failure AC** — see P3 in §E. Passes vacuously against a
   non-optimistic implementation.
5. **Nothing anywhere covers what happens after a mutation.** No AC in US-05,
   US-07, US-08 or US-09 says where focus goes, whether scroll position survives,
   or whether the list jumps. Those are precisely the things that make an app feel
   cheap, and precisely the things this branch is quietly changing. B.1's new AC
   and the reworded US-06 loading AC between them cover most of it.

### B.8 — What I found myself wishing for, that is not above

Two small ones, both keyboard, both fully verifiable, both roughly free:

- **A keyboard shortcut to start a new todo** (`n`) and one to focus search
  (`/`). I reached for both repeatedly out of habit. With B.4 they turn the app
  into something you can use without touching the mouse at all — which is also,
  conveniently, the configuration I can test most thoroughly.
- **A visible count of what is left, not just what is done.** The header reads
  `1 of 3 done`. Driving it, what I wanted to know was how many were *left*, and
  I kept doing the subtraction. Copy change, nothing more.

---

## C. Proposal 1 — drag and drop instead of the checkbox

### C.1 Acceptance criteria currently passing that this puts at risk

Taking "currently passing" from §1 above (US-06 Pass, US-07 Pass, NFR-05 Pass,
NFR-06 Pass, NFR-04 Partial).

| Story / NFR | What is at risk | Severity |
|---|---|---|
| **US-07** (all six ACs) | Every AC is phrased "activate its completion control". There is no completion control after this change; all six must be re-proved from zero, and the failure AC ("the control reverts to its previous state") has no resting control to revert to — a dropped row has to animate back, which is new behaviour nobody has specified | **Highest** |
| **US-06** | "a todo row renders … **a completion control**" becomes false on the face of it. Also DESIGN §6.4 requires completed state to be carried by *both* the checked box **and** `line-through`; delete the box and the pair becomes a single cue, which is exactly the "colour/one-carrier" rule §6.4 exists to prevent | **High** |
| **NFR-04** | DESIGN §6.8 and NFR-04 require every interactive element operable **by keyboard alone**. A drag has no keyboard equivalent unless one is built — and a keyboard equivalent for "complete this todo" is, functionally, the checkbox the proposal deletes. NFR-04 is already **Partial** (DEF-02); this would take it to **Fail** | **High** |
| **NFR-05** | DEF-01's 44×44 measurement is a measurement *of `checkbox__content`* (§2.5). Remove the element and the measurement does not "still pass", it **ceases to exist**. Separately: a drag on a touch row competes with page scroll at 320–427 px, and a horizontal swipe has to complete inside a 320 px viewport without triggering the "no horizontal scroll" rule | **High** |
| **NFR-06** | See B.2 | **Medium** |
| **US-09** | Row drag competes with the desktop hover-revealed Edit/Delete cluster (`TodoRow.tsx:156`, `lg:opacity-0 … group-hover:opacity-100`) and with text selection on the title. Not fatal, but it is a fresh interaction conflict on the destructive control | **Medium** |
| **US-10 / US-11** | A drop that completes a todo while the `Active` filter is applied makes the row vanish mid-gesture. With this branch's silent refetch there is now no skeleton covering that swap | **Medium** |

PRD §4 also lists "drag-and-drop reordering" as explicitly **out of scope for
v1**. This proposal is drag-to-complete rather than drag-to-reorder, so it is
not literally the excluded item — but it lands the same gesture surface on the
same rows, and it is worth the PM saying which of the two the exclusion meant.

### C.2 What happens to DEF-01 and DEF-08 — both **invalidated, not merely reopened**

**DEF-01 (44×44).** §2.5 measured the pressable `checkbox__content` at exactly
44×44 at 427 px, with `elementFromPoint` resolving inside it at all five sampled
points. That evidence is about one element. Delete it and the evidence is void —
not "still good", void. Whatever replaces it (a drag handle, or the whole row as
the drag surface) needs its own hit-test from scratch, and a full-row drag
surface raises a *new* question my measurement never had to answer: the row also
contains Edit and Delete at 36×36 and a title, so the draggable area and the
pressable areas now overlap and need a hit-priority rule.

**DEF-08 (dark-mode contrast).** The fix is one class on `Checkbox.Control`
(`TodoRow.tsx:125`) — `border border-[color-mix(in_srgb,var(--foreground)_50%,transparent)]`.
Delete the checkbox and you delete the fix and every number attached to it:
5.14:1 dark, 3.40:1 light, 4.81:1 accent fill, 3.59:1 checkmark. The defect is
not reopened in the sense that the old bug returns; it is worse than that — the
subject of the defect is gone and **the same class of bug reappears untested on
a new affordance**. WCAG 1.4.11's 3:1 applies to a drop target and a drag handle
exactly as it applied to a checkbox border, and this codebase has already shipped
a 1.00:1 control boundary once because HeroUI's `--field-border-width` is `0px`
and the field background matches the row. The default is *not* safe here.

One number from §2.2 to carry forward: the tightest passing case in the whole
DEF-08 fix was a **hovered row in light mode at 3.25:1** — 0.25 of headroom. Any
new affordance has to be measured in four states (light/dark × rested/hovered),
plus a fifth and sixth nobody has had to measure before: **dragging** and
**drop-target-active**. That is six measurements, and I would want all six.

### C.3 Can I test it? — **No, not at desktop width, and unproven at mobile.**

This is the part I want read before anyone estimates the work.

My documented harness limits, from §Environment note 2 above:

1. After **any** explicit `resize_window` call, **pointer input stops reaching
   the page**. A click on the `Active` filter at 1280×800 left `aria-checked`
   and the URL unchanged; a `hover` over a row's Edit button left
   `document.querySelectorAll(':hover')` **empty** — the page never saw the
   pointer at all.
2. Resizing *back* does not restore it. Only a pane that has never been resized
   accepts the pointer, and that pane is **427×351**.
3. Consequence, already recorded in §4.1 and §8: **hover-triggered tooltips
   could not be verified**, and desktop pointer interaction is marked *could not
   verify* — not pass, not broken.

A drag is pointer-driven, and it is strictly *more* demanding than the two things
I already cannot do. So, plainly:

- **At desktop width (≥640 px, where `sm:` sizing and the hover-revealed row
  actions live): I could not verify a drag at all.** The pointer does not reach
  the page there. Not "hard" — impossible with this harness.
- **At the native 427×351 pane: unproven, and I will not promise it.** Real
  clicks work there (§2.5, §6). A drag is not a click: it needs
  `pointerdown` → several intermediate `pointermove`s → `pointerup`, and the
  intermediate moves are what every drag implementation actually listens to. I
  have never exercised that path in this harness and have no evidence it
  synthesises them. If the implementation uses the **native HTML5**
  `dragstart`/`dragover`/`drop` events rather than pointer events, my confidence
  drops further — those are frequently not synthesisable through automation at
  all.
- **Touch drag on a real device: definitely not.** §8 already records that real
  touch activation has never been tested — only measurement and hit-testing.
  Drag-to-complete is a *primarily touch* interaction, so its primary platform is
  the one I have the least coverage of.

The consequence is the thing to weigh: **this change would move the app's most
repeated action onto the one interaction class my tooling cannot exercise.**
Today I can click a checkbox and watch `PATCH /api/todos/<id>/status` in the
network log. After this change, "does completing a todo work" becomes a
manual-only question at every width, every release. That is a permanent, ongoing
cost, not a one-off verification cost.

**What I would need to verify it** — any one of these, in order of preference:

1. **Playwright in the repo** (see proposal P1 in §E). Real pointer sequences,
   real `page.mouse.move` steps, real touch emulation, a viewport fixed at launch
   so the resize bug never applies, and it runs in CI on every branch. This is
   the answer, and it is worth doing whether or not drag ships.
2. **A keyboard-operable equivalent, specified up front.** Keyboard input
   *does* survive the resize (§Environment note 2) — that is the only reason the
   tooltip check in §4.2 was possible at all. If the implementation is
   `dnd-kit`-shaped (Space to lift, arrows to move, Space to drop, Escape to
   cancel, with a live-region announcement), I can verify the state machine, the
   announcements and the resulting `PATCH` at **both** widths by keyboard. I
   would still not have verified the mouse or the finger.
3. **Manual testing by a human on a real phone**, scheduled and budgeted, every
   release. This is a real and acceptable answer. It is also the one that quietly
   becomes "nobody did it" by release three.

If the answer is "we'll build it and QA will figure it out", the honest reply is
that I will report it as *could not verify* indefinitely, the same way §8 has
carried "real touch activation" and "failure paths" across three passes now.

### C.4 Regression surface once rows are draggable

What I would have to re-test **every release**, on top of today's §6 sweep:

1. **Drag versus the list changing underneath it.** Drag in flight when a
   refetch lands; drag in flight when the skeleton mounts (this branch makes a
   filter change blank the list, which would unmount the row being dragged); drag
   in flight when another row's toggle resolves and reorders the list.
2. **Drag versus scroll on touch**, at 320/375/427. The classic failure: the list
   stops scrolling because every vertical drag is captured.
3. **Drag versus the existing row controls** — hover-reveal, focus-within reveal,
   title text selection, and the 36×36 Edit/Delete hit areas now inside a
   draggable surface.
4. **Focus management.** DESIGN §6.8 requires tab order to follow visual order.
   Where does focus go after a drop? After a drop that removes the row from a
   filtered list? After a drop that fails? Today the checkbox keeps focus and
   that is trivially true.
5. **Escape / cancel semantics**, and drag interacting with an open modal or the
   confirm dialog.
6. **Undo.** PRD §4 puts undo-on-toggle in scope and §6 verified it re-runs the
   same scoped endpoint. Undo after a *drag* has to restore the row's position,
   not just its `completed` value.
7. **Six contrast measurements** (§C.2), both themes, rested/hovered/dragging.
8. **Motion.** DESIGN §6.9 says the only animations are HeroUI's own and requires
   `motion-reduce:transition-none` on the row transition. Drag adds transforms
   that need their own reduced-motion path.
9. **Screen-reader announcements** for lift/move/drop — DOM-inspectable only, no
   real AT in this harness.
10. **NFR-09 at 200 todos** — drag over a long list is where transform-per-row
    implementations fall over.

That is roughly ten new recurring checks, at least four of which I cannot
currently perform, to replace one checkbox click that I *can* perform and that
currently passes.

### C.5 Recommendation on the proposal

**Do not build it in v1.** Not on taste — on three testability facts: it deletes
the artifacts that DEF-01 and DEF-08 were verified against, it takes NFR-04 from
Partial to Fail unless a keyboard path is built (which re-creates the deleted
control), and **the primary interaction cannot be verified by this team's current
tooling at any width where the desktop layout applies.**

If the lead wants it anyway, the minimum precondition is **P1 (Playwright) landing
first**, plus a specified keyboard path, plus the six contrast measurements
scheduled as part of the story rather than after it.

And on the re-scoped question it was an instance of: drag would make completing a
todo *feel* more physical, and completing a todo is not where this app is
unpleasant — checking the box already works and is one interaction. The
unpleasantness is in §B.1, three steps earlier, and it is removable by deleting
UI rather than by adding a gesture nobody can test.

---

## D. The current branch, `fix/add-refresh-gap`

### D.1 First, a discrepancy that blocks sign-off regardless of merit

**The change described to me is not what is committed on the branch.**

```
git diff develop...fix/add-refresh-gap  →  1 file, 19 insertions, 1 deletion
```

The committed diff (`4020b9b`) contains the render-time `lastFilterKey` flag and
moves `setIsLoading(true)` into a **single** `reload()` — which means the
committed branch shows the skeleton on **every** refetch, *including* toggle and
delete. That is the opposite of the split under discussion.

The split (`reloadWithSkeleton` / `reloadSilently`) and the `pendingTodoIds`
`Set` exist **only as uncommitted working-tree edits**:

```
git status --short
 M docs/PM-PROPOSAL.md
 M src/app/todos/components/TodoListScreen.tsx
```

`develop`'s copy of the file still has `pendingTodoId` as a single `string | null`
slot at line 61, so m-4 is genuinely unfixed in git.

I am assessing the **working tree**, since that is what the PM's decision
describes and what I read. But I cannot sign off a diff that does not exist in
version control, and neither can review. **Ask: commit the tree before the
sign-off pass**, so that what I test and what merges are provably the same bytes.
This is not pedantry — my last pass pinned a defect by remounting one component;
that kind of evidence is worthless if the code moves underneath it.

### D.2 Is the split the right call? — Yes

I agree with it, and for a testing reason the PM did not state: **the skeleton is
a global signal, and a global signal for a local change destroys the evidence of
what actually happened.** When the whole list blanks on a toggle, I cannot see
that the row moved between groups, I cannot watch the count go `1 of 3` → `2 of
3` continuously, and I lose scroll position on a long list — so every §6 toggle
assertion becomes a before/after comparison across a blank frame instead of an
observed transition. Silent refetch is *easier* to test correctly, not just
nicer. Same for delete.

Keeping the skeleton for create/edit/filter is right for the mirror-image reason:
the list identity genuinely changes, so there is no continuity to preserve.

Two implementation points I checked rather than assumed:

- The render-time `setState` (`TodoListScreen.tsx:87-90`) is the sanctioned
  "adjust state during render" pattern and matches what `TodoFilters.tsx:53-56`
  already does. Not a concern.
- **Search does not strobe.** I expected the skeleton to flash per keystroke;
  `TodoFilters.tsx:33,77-86` debounces the URL push at 300 ms, so `filterKey`
  changes once per pause. Good. The filter bar also stays mounted during the
  skeleton (`hasTodos` reads the *previous* `result`), so focus is not lost from
  the search box mid-type. Both worth an explicit check at sign-off, both look
  correct by reading.

### D.3 Is the per-row pending signal observable and sufficient?

**For a toggle: nearly.** The `Set` genuinely fixes m-4's pointer race — two
concurrent toggles now each hold their own guard, and `pendingTodoIds.has(id)`
drives `isPending` per row (`TodoListScreen.tsx:315`), which lands as
`pointer-events-none opacity-60` on the `<li>` (`TodoRow.tsx:98`). It is
DOM-observable, so I can assert it directly. But:

> **DEF-12 (Minor→Major if the optimistic toggle lands) — the pending guard is
> pointer-only; the keyboard walks straight through it.**
> `TodoRow.tsx:98` guards the row with `pointer-events-none opacity-60`. That
> stops the mouse. It does **not** stop the keyboard: the `Checkbox` is not
> `isDisabled`, the row carries no `aria-busy`, and `pointer-events: none` has no
> effect on focus or on Space/Enter activation. A keyboard user can Tab to the
> checkbox and press Space three times during one in-flight request and issue
> three `PATCH`es that can land out of order — **precisely the failure m-4
> describes, reached by a different input**. m-4's fix is therefore half a fix.
> **This is mine to own:** I saw the `opacity-60 pointer-events-none` treatment in
> the last pass and did not file it, because the global skeleton was covering the
> window anyway. This branch removes that cover, so it now matters. Filing it
> late is the right call, the same way DEF-08 was.
> **Fix shape:** pass `isDisabled={isPending}` to the `Checkbox` and add
> `aria-busy` on the row, rather than relying on a CSS property that only one
> input device respects.
> **Also relevant to NFR-04**, which is already Partial.

**For a delete: no — and this branch causes it.**

> **DEF-11 (Major) — a deleted row stays live and interactive between the write
> and the refetch.**
> `handleDelete` (`TodoListScreen.tsx:203-220`) calls `reloadSilently()` on
> success and then, in `finally`, sets `isDeleting = false` and
> `pendingDelete = null`. Both run when the **DELETE returns**, which is *before*
> the silent refetch lands. The row's `isPending` is
> `isDeleting && pendingDelete?.id === todo.id` (line 316) — so the moment the
> write succeeds, the guard drops while the deleted todo is **still rendered**.
> For the length of the refetch the user has a row on screen that no longer
> exists in the database and is fully clickable: toggling it or opening Edit
> issues a request against a dead id, which by §7 returns
> `404 {"code":"NOT_FOUND","message":"That todo no longer exists."}` — a
> confusing error for a row the user is looking at.
> The committed branch does **not** have this bug, because its skeleton covers
> that exact window. The working tree introduces it.
> **Fix shape:** clear `pendingDelete` only after the refetch resolves, or keep
> the deleted id in `pendingTodoIds` until the reload lands.

A second point on delete, softer: the PM's justification is "the row already dims
so the skeleton is disproportionate". For delete that justification does not
hold — **the confirm dialog is on top of the row for the whole pending window**,
so the user never sees the dim. What actually carries delete is the dialog's own
`isPending` (`ConfirmDialog`, verified §6) plus the toast. The conclusion is
still right; the stated reason isn't the load-bearing one, and I would rather the
record say so.

Third, smaller: `clearPending` in `handleToggle`'s `finally` (line 199) also runs
before the silent refetch lands, so there is a window with **no signal at all**
between the write returning and fresh data arriving. Lower severity than DEF-11
because the row is showing the correct value by then. Worth an explicit
observation at sign-off, not a defect.

**One thing I am flagging as not-measured rather than asserting either way.**
`opacity-60` is now the *only* signal on a toggle, so it is on screen alone and
longer than before. The completed title is already `text-muted`; muted text at
60 % opacity over `--surface` may fall under NFR-06's 4.5:1. I have **not**
measured it and I am not going to guess — §2's canvas-compositing method applies
directly and it is a ten-minute measurement. **It goes in the sign-off pass as a
required number, both themes.**

### D.4 Sign-off shape — short form on isolation, **full form on the sweep**

The precedent I set in §7 was: *the diff touches two files, neither in the
authorization path — no route handler, no session code, no Prisma query — so the
full isolation battery would re-prove untouched code.*

**That reasoning still applies, but only to the isolation battery.** The tree
diff touches exactly one client component. No route handler, no session code, no
Prisma query, no schema. So: **§7 short form again, same seven probes, and I am
comfortable with that.**

**It does not apply to the rest of the gate, and I want to correct the framing.**
Last time the diff was *presentation* — a CSS class and an error string. This one
is **the client state machine**: two loading flags, a pending set, mutation
sequencing, and refetch ordering. That is behaviour, and it is the specific place
where races live — DEF-11 and DEF-12 above are both in that diff and neither is
visible in a screenshot. A 19-line diff is not a small diff when all 19 lines are
concurrency.

So: **short form on isolation, full §6 regression sweep, plus new concurrency
cases.** Half a day.

**What I would run:**

| # | Check | Why |
|---|---|---|
| 1 | Full §6 sweep — create / edit / toggle+Undo / delete / filters / search | Baseline; every one of these callers changed shape |
| 2 | **No skeleton on toggle, undo, or delete**; **skeleton present** on modal save, filter change, search, and `retry` | The branch's actual claim |
| 3 | **Two fast toggles on different rows** — both rows keep `opacity-60 pointer-events-none` until each own request returns | m-4, the reason the `Set` is here |
| 4 | **Keyboard Space-spam on one row during flight** — count `PATCH`es in the network log | **DEF-12**; expect ≥2 today |
| 5 | **Confirm a delete and click the still-visible row before the refetch lands** | **DEF-11**; expect a 404 |
| 6 | Toggle under the `Active` filter — row leaves the list with no skeleton (US-07 AC) | Silent refetch changed how this AC is observed |
| 7 | Type in search — skeleton appears **once** per 300 ms pause, not per keystroke; **search box keeps focus and its caret** | Debounce + `hasTodos` gating, both new interactions with the render-time flag |
| 8 | Filter change while a toggle is in flight — pending row does not resurrect stale state | The `isCurrent` guard (line 351) under a new caller mix |
| 9 | **Measure `opacity-60` row text**, both themes, against NFR-06 4.5:1 | §D.3; now the sole signal |
| 10 | §7 isolation, short form, seven probes | Unchanged precedent |
| 11 | `npx tsc --noEmit`, `npm run lint`, `npm run build` (NFR-10) | Gate |

**Recommendation on the branch: fix DEF-11 before merge** — it is a Major that
this diff introduces and it is a few lines in the same `finally`. DEF-12 I would
accept as a follow-up ticket *if* it is scheduled ahead of the PM's queue item 2
(the optimistic toggle), because an optimistic toggle on top of a guard the
keyboard ignores is a data-consistency bug rather than a cosmetic one. With
DEF-11 fixed and DEF-12 ticketed, the split is right and the branch is good work.

---

## E. My own proposals, ranked

Taking the lead's open floor. Four things about **how testing works here**,
ordered by what I would actually spend the money on. (§B is my product list; if
you are ranking across both, B.1 goes above all four of these, and P1 goes above
everything else in §B.)

### P1 — Put Playwright in the repo. This is the one that matters.

`package.json` has `dev`, `build`, `start`, `lint`, `postinstall`, `db:push`,
`db:studio`. **There is no test framework of any kind** — no Vitest, no Jest, no
Playwright, no Testing Library. NFR-10's "quality gate" is `tsc`, `lint`, and
`build`: three checks that prove the app *compiles*. Nothing in CI has ever
proved the app *works*. Every functional assertion this project has, in three
passes, came from me driving a browser by hand and writing prose about it.

That is why §8 keeps growing. Real touch activation, failure paths, desktop
pointer, hover tooltips — all "not tested", all still not tested, and each pass I
re-explain why.

Playwright fixes most of it at once:

- **Viewport is set at launch**, so the resize-kills-pointer limit never applies
  — desktop pointer interaction and hover-triggered tooltips become verifiable,
  and §4.1/§4.2's two gaps close permanently.
- **Real pointer sequences and touch emulation**, which is the only way the drag
  question in §C ever gets answered.
- **`page.route()` fault injection**, which turns "failure paths — no fault
  injection" from a permanent §8 entry into three tests.
- It runs on every branch, so a 19-line concurrency diff like this one does not
  need me to hand-verify eleven things.

Scope I would ask for: **not** broad coverage. Six specs — the §6 sweep, one per
flow — plus the isolation probes as API tests. A day, maybe two. Then it grows
with the app instead of being a project.

**This is also my answer to the lead's question about my tooling limits.** The
harness bug is not fixable from my side; the right move is to stop depending on
that harness for anything load-bearing.

### P2 — PRD §7's release criteria do not cover where the bugs actually are.

§7 has four release criteria: all Must stories pass, cross-user isolation is
proved, unauthenticated redirects work, build gate green. Three of the four are
authorization.

Now count the defects I have actually filed: DEF-01 (touch target, NFR-05),
DEF-02 (keyboard/aria noise, NFR-04), DEF-05 (filter layout, NFR-05), DEF-08
(dark-mode contrast, NFR-06 — the Major that blocked a release). **Zero of them
would have been caught by any stated release criterion.** The one Major we have
had was found because I chose to measure something nobody asked me to measure.
That is not a repeatable process.

**Proposal:** add a fifth release criterion — *"No open Major against NFR-04,
NFR-05 or NFR-06. Non-text contrast of every interactive control is measured in
both themes, rested and hovered."* It is the criterion that would have caught the
only release-blocking defect this project has had, and it costs an afternoon.

### P3 — US-07's failure AC tests an implementation we do not have, and passes vacuously.

> *"Given the toggle request fails, When the error returns, Then the control
> reverts to its previous state and an error message is shown."*

`handleToggle` never moves the control optimistically — `TodoRow.tsx:103` says so
explicitly ("Stays in its current state until the confirmed mutation lands") and
`TodoListScreen.tsx:194` says "Nothing changed optimistically, so the row already
shows the truth." **There is nothing to revert.** The AC is satisfied by an
implementation that cannot fail it, which means it tests nothing, which is worse
than not having it — it reads like coverage.

This stops being academic the moment the PM's queue item 2 (optimistic toggle)
lands, at which point this AC becomes the single most important line in US-07 and
I *still* have no way to make a request fail on demand.

**Proposal, two parts:** (a) reword the AC to the contract the app actually has —
*"the control does not change state at any point, and an error toast names the
failure"*; (b) give me **fault injection** — a dev-only flag in the service layer
that rejects the next mutation. Without it, "failure paths" stays in §8 forever.
P1 delivers (b) for free via `page.route()`, which is part of why P1 is first.

### P4 — Make "could not verify" a first-class outcome in the report format, not prose.

Small, cheap, and I want it on the record. This report carries a growing set of
things that are neither pass nor fail, and they currently live in a §8 prose list
that is easy to skim past. Twice now a reader has needed me to restate that
"desktop pointer interaction" is *unproven*, not *passing*.

**Proposal:** the verdict table in §1 gets three states — **Pass**, **Fail**,
**Could not verify** — and any row in the third state names the blocker and what
would clear it. It makes the coverage gap visible at the top of the document
instead of at the bottom, and it makes P1's value obvious, because the third
column is mostly things Playwright would fix.

---

## F. What I need from the PM and the designer

**From the PM — on appeal (§B), which I would take before any of the below:**

1. **A ruling on B.1.** Dropping the confirm dialog on create and edit needs one
   exception to `CONVENTIONS.md` → Mutation UX. It is the highest-value change on
   my list, it is a deletion rather than a build, and it is fully verifiable. If
   it is refused, I would drop backlog #1 (quick-add) rather than build it with a
   dialog on every Enter — a fast capture bar that interrupts itself is worse than
   the modal we have.
2. **US-05's new step-count AC** (§B.7.1) and the **US-06 loading AC rewrite**
   (§B.7.3). The second one is urgent in a small way: it is the contract
   `fix/add-refresh-gap` is currently arguing about with no written target to
   argue against.
3. Confirmation that **backlog #2 lands as a changed default order**, not as a
   sort control (§B.2).

**From the PM — on drag and drop:**

1. A ruling on whether PRD §4's "drag-and-drop reordering" exclusion was meant to
   cover drag-*to-complete* as well. If yes, §C is moot and the proposal needs a
   PRD amendment before anyone estimates it.
2. If drag proceeds anyway: **US-07 rewritten first**, before implementation. All
   six of its ACs are written against a control that would no longer exist, and I
   will not be able to say "US-07 passes" against text describing a checkbox.
3. A decision on DEF-12's scheduling relative to queue item 2 (optimistic
   toggle). My position: DEF-12 must land first.
4. P1 (Playwright) as a queue item, ranked. I would put it above item 1
   (DEF-02) — DEF-02 is console noise; P1 is the reason we keep shipping on my
   unverified word.

**From the designer:**

0. **On §B, before drag:** if B.1 is approved, the create and edit flows need a
   replacement completion signal — today the confirm dialog is doing double duty
   as the "something happened" beat. My read is that the toast plus the row
   appearing is enough, but that is a design call, not mine. And if B.3(b) is
   ever taken up, an undo-able delete toast needs a life long enough to actually
   catch — I have missed the current one twice.

1. If drag proceeds: **the keyboard path, specified before the pointer path.**
   Not as an accessibility afterthought — it is the only path I can verify at
   desktop width, so it is the difference between a testable feature and an
   untestable one.
2. The **second non-colour cue for completed state**, given DESIGN §6.4 requires
   a pair and drag removes the checked box from it. `line-through` alone is not
   what §6.4 asks for.
3. The **hit-priority rule** for a draggable row that also contains a checkbox
   replacement, a 36×36 Edit, a 36×36 Delete and selectable title text — which
   region owns a `pointerdown`, and where drag must *not* initiate.
4. **Drag and drop-target colours chosen to a 3:1 target from the start**, in
   both themes and both hover states. §2.2 found the light hovered case at
   3.25:1 with 0.25 of headroom; picking these by eye and measuring afterwards is
   how DEF-08 happened.
