/**
 * The shared style values — the class strings that encode a *rule* from
 * `docs/DESIGN.md` rather than one component's own layout.
 *
 * **Why these are TypeScript constants and not CSS.** Three homes were
 * possible and two lose:
 *
 * - A HeroUI **token override** in `globals.css` is barred by §3 except for a
 *   token whose shipped value fails a WCAG floor, and neither half of that bar
 *   is met here: none of these values *is* a HeroUI token (there is no shipped
 *   variable for a tap-target floor or a content max-width), so there is
 *   nothing to override, and no contrast measurement to justify it with. The
 *   two standing exceptions are `--muted` and `--accent`, both in
 *   `globals.css`, both carrying their measurements.
 * - A Tailwind **`@utility`** in `globals.css` would work, and loses on the
 *   failure it allows. A misspelt utility class is not an error anywhere: it
 *   emits no CSS, the element silently keeps its intrinsic size, and the
 *   result is a 20×20 button — which is DEF-16 exactly, the defect the floor
 *   below exists to prevent. A misspelt import of a constant fails `tsc`
 *   before it reaches a browser. The rule these values carry is one this
 *   project has already shipped as a defect once, so the home that makes
 *   breaking it a compile error is the one it gets.
 *
 * The remaining cost of constants is that Tailwind must still *see* the class
 * strings to emit them; `@source "../../src"` in `globals.css` covers this
 * file, and the strings are written out in full below rather than built from
 * fragments, so the scanner finds them.
 *
 * **Naming.** UPPER_SNAKE_CASE, and the name says what the value *means* to
 * the design system, never what it does in CSS: `ICON_BUTTON_SIZING`, not
 * `MIN_H_11`. Two shapes:
 *
 * - `<ROLE>` alone when the constant is that element's entire shared
 *   treatment — `SECTION_HEADING`, `LIST_CONTAINER`.
 * - `<ROLE>_<ASPECT>` when it is one aspect of an element that also carries
 *   classes of its own — `ICON_BUTTON_SIZING`, `ROW_TITLE_LAYOUT`. `ASPECT`
 *   is `SIZING` for dimensions and tap floors, `LAYOUT` for how a thing sits
 *   in its parent.
 *
 * **When a value earns a name at all.** Only when it encodes a rule that
 * outlives the component: it appears in more than one component, or it is a
 * numbered rule from `docs/DESIGN.md`, or a second place has to match it or
 * something visibly breaks (a skeleton against the thing it stands in for). A
 * class that appears once, in the component it belongs to, describing that
 * component's own layout, stays inline — that is where it is already correct.
 */

/* ---------------------------------------------------------------- targets  */

/**
 * The 44×44 tap floor (`docs/DESIGN.md` §6.3, `docs/PRD.md` NFR-05), relaxing
 * to 36 on pointer devices at `sm:`.
 *
 * This value was two identical constants in two files before it lived here.
 * It is the rule DEF-16 broke — a 20×20 clear button, below even WCAG 2.2 SC
 * 2.5.8's 24×24 — and `e2e/a11y-targets.spec.ts` measures it, so a change made
 * in one copy and forgotten in the other was a defect nothing pointed at.
 *
 * Both axes: for controls whose width is not set by a label, i.e. icon-only
 * buttons and the row checkbox.
 */
export const ICON_BUTTON_SIZING = "min-h-11 min-w-11 sm:min-h-9 sm:min-w-9";

/**
 * The same floor, height only, for controls a label already makes wide enough
 * — text buttons, the priority `Select` trigger, the search field group.
 */
export const LABELLED_CONTROL_SIZING = "min-h-11 sm:min-h-9";

/**
 * The floor without the `sm:` relaxation, for the submit and cancel buttons of
 * a form or a dialog. These stay 44 at every width because they are the
 * committing action and are full-width on mobile, so the height is the whole
 * target.
 */
export const FORM_ACTION_SIZING = "min-h-11";

/**
 * An action button that takes the full width on mobile and hugs its label on
 * pointer: the floor above, plus `w-full sm:w-auto`. Composed from
 * `FORM_ACTION_SIZING` so the floor has exactly one definition.
 *
 * Named for the shape rather than for a dialog, because it is not only a
 * dialog's: `TodoFormModal` and `ConfirmDialog` use it in a stacked footer,
 * and `QuickAddForm`'s submit uses it inline in the list screen, where there
 * is no dialog at all. An earlier name said `DIALOG_` and was wrong at that
 * third site — the same mistake this file's own rule warns about, that two
 * places reaching one string for different reasons must not be given a name
 * that claims only one of the reasons.
 */
export const FULL_WIDTH_ACTION_SIZING = `${FORM_ACTION_SIZING} w-full sm:w-auto`;

/*
 * The two constants below hold the same string and are deliberately not
 * merged, because the controls do not take the step for the same reason.
 *
 * Both sit on a 32px pointer step (`sm:min-h-8`) rather than the 36px one the
 * rest of the app relaxes to. That is **below the app's own pointer floor**
 * and above WCAG 2.2 SC 2.5.8's 24×24, which is the floor that actually
 * binds. It is pre-existing behaviour, not something this file introduced,
 * and no test pins either value: emptying them leaves the suite green. Treat
 * the 32px step as tolerated, not as sanctioned — if either control is
 * restyled, moving it up to `sm:min-h-9` needs no justification and keeping
 * it at 32 does.
 *
 * Each is used in exactly one place, which by the rule at the top of this file
 * would leave it inline. They are here anyway, and the exception is the point:
 * these are the app's only two deviations from §6.3's pointer floor, and a
 * deviation from a rule belongs where someone auditing that rule will look,
 * not hidden in the component that takes it.
 */

/**
 * The quick-add parser's chips — `pay rent`, `friday`, `high` — each a
 * readout of what the parser took from the typed text, which happens to be
 * pressable so it can be dismissed. A readout is not a control the user goes
 * looking for, which is the case for sizing it under the pointer floor.
 */
export const CHIP_SIZING = "min-h-11 sm:min-h-8";

/**
 * The quick-add bar's **More options** button, which opens the full todo
 * form. This is a real control and the reasoning above does not cover it —
 * it is at 32px because it sits in the chip row and matches the chips, which
 * is an alignment argument rather than an accessibility one. Kept separate
 * from `CHIP_SIZING` so that raising this one does not silently raise the
 * chips, and so the weaker justification stays attached to the control it
 * actually applies to.
 */
export const SECONDARY_ACTION_SIZING = "min-h-11 sm:min-h-8";

/* ------------------------------------------------------------------ shell  */

/**
 * The `/todos` page shell — content max-width, page gutters, vertical padding
 * and the gap between sections, which is four separate §2.2 rules in one
 * string (`max-w-2xl mx-auto`; `px-4 sm:px-6 lg:px-8`; `py-6` mobile / `py-8`
 * desktop; `gap-6`).
 *
 * The route's three entry points — `page.tsx`, `loading.tsx` and `error.tsx` —
 * must agree on it or the content jumps when the route settles or throws.
 * `TodosHeader`'s inner bar shares the max-width and the gutters but not the
 * vertical rhythm, and its classes interleave, so it is deliberately not
 * composed from this: see the note there.
 */
const TODOS_PAGE_SHELL_BASE =
  "mx-auto flex w-full flex-1 flex-col gap-6 px-4 py-6 sm:px-6 lg:px-8 lg:py-8";

export const TODOS_PAGE_SHELL = `${TODOS_PAGE_SHELL_BASE} max-w-2xl`;

/**
 * The same shell at the width the board needs (US-14).
 *
 * §2.2 caps `/todos` at `max-w-2xl` so a line of text stays readable, which is
 * right for the list and wrong for five columns — inside 672px they would be
 * 130px each. So the width, and only the width, follows the view.
 *
 * A separate constant rather than `` `${TODOS_PAGE_SHELL} max-w-7xl` ``,
 * because appending would not reliably win: two `max-w-*` utilities on one
 * element are resolved by their order in the generated stylesheet, not by
 * their order in the attribute. Sharing `TODOS_PAGE_SHELL_BASE` is what keeps
 * the other four §2.2 rules from drifting between the two.
 *
 * `loading.tsx` and `error.tsx` stay on the list width deliberately: neither
 * reads the view, and a skeleton that guessed board width would jump when the
 * route settled to a list.
 */
export const TODOS_BOARD_PAGE_SHELL = `${TODOS_PAGE_SHELL_BASE} max-w-7xl`;

/** The auth routes' shell: a centred card, §2.2's `px-4` gutter, `py-8`. */
export const AUTH_PAGE_SHELL = "flex-1 grid place-items-center px-4 py-8";

/** `max-w-sm` for auth cards, per §2.2's content-width rule. */
export const AUTH_CARD_SIZING = "w-full max-w-sm";

/* ------------------------------------------------------------------ forms  */

/** §2.2: `gap-4` between form fields. */
export const FORM_FIELD_STACK = "flex flex-col gap-4";

/**
 * §2.2: `gap-1.5` inside a form field group — the label, control and error
 * slot of one field. Lives on the four `src/components/ui/Form*` wrappers, so
 * every field in the app reserves its error slot identically.
 */
export const FIELD_GROUP_STACK = "flex flex-col gap-1.5";

/**
 * A dialog footer: reversed on mobile so the committing action sits at the
 * bottom under the thumb, in reading order on `sm:` and up. `TodoFormModal`
 * and the shared `ConfirmDialog` are the two, and a user meets both.
 */
export const DIALOG_FOOTER_LAYOUT =
  "flex flex-col-reverse gap-2 sm:flex-row sm:justify-end";

/* ------------------------------------------------------------------- list  */

/**
 * The row title takes the slack at `sm:` and up, which is what reserves the
 * metadata column (§1: *"Nothing reflows between rows; a row with no due date
 * leaves the slot empty rather than shifting"*).
 *
 * Without `flex-1` the title is sized by its own content, so the chip/date
 * cluster hugged the end of each title and landed somewhere different on every
 * row — the list had no column to scan down. With it, the cluster is pushed to
 * a consistent right edge and a row missing a date leaves the gap rather than
 * sliding everything left.
 *
 * `min-w-0` alongside it, or the flex item refuses to shrink below its content
 * width and `truncate` never fires. The trade is that long titles truncate
 * sooner, which is the trade §1 already made.
 *
 * `sm:` only: below that the row is `flex-col`, where `flex-1` would stretch
 * the title vertically instead and there is no column to reserve.
 */
export const ROW_TITLE_LAYOUT = "sm:min-w-0 sm:flex-1";

/**
 * A list section's heading (§7.16).
 *
 * `Typography.Heading` at `level={2}` renders a real `<h2>` but is styled
 * `text-3xl` (`typography--h2`), which would shout over the rows it labels.
 * `text-sm leading-6` is exactly the `body-sm` step the copy deck asks for
 * (§2.4, §7.16) — the size comes down, the element stays a heading, and the
 * semibold weight and tight tracking of a heading remain.
 *
 * `px-4` and not `px-2` because the heading has to start where its rows start.
 * A row is inset from the list by `LIST_CONTAINER`'s `p-2` and then by its own
 * `px-4`, so its content begins 25px from the Card's inner edge; at `px-2` the
 * heading began at 16. Nine pixels is the worst answer available — too small to
 * read as a hanging indent, too large to read as an edge — and it was the only
 * place in the app where two things meant to share an edge did not. The 1px
 * that remains is the row's own border, which no step on §2.2's scale can
 * absorb without inventing a 17px one. `e2e/section-heading-alignment.spec.ts`
 * measures it, and takes the row's border width as its tolerance rather than a
 * literal.
 */
export const SECTION_HEADING = "px-4 pt-1 text-sm leading-6";

/**
 * The list's own padding and row rhythm. `TodoListSkeleton` stands in for
 * `TodoGroupedList` while the route loads, so the two must match or the list
 * shifts on swap (§4.8) — which is a rule about a pair of files rather than
 * about either one.
 */
export const LIST_CONTAINER = "flex flex-col gap-1.5 p-2";

/**
 * The `/todos` heading and its counts line. Shared with `loading.tsx` for the
 * same §4.8 reason as `LIST_CONTAINER`: the heading must not move when the
 * skeleton is replaced by the real list.
 */
export const PAGE_HEADING_ROW = "flex items-baseline justify-between gap-4";

/**
 * The heading row **and** the dated line under it, as one block (§7.19).
 *
 * `Your todos` and `Wednesday, 20 August · 3 due today · 1 overdue` are one
 * statement — what this page is, and what day it is — but they were two direct
 * children of `main`, so §2.2's `gap-6` put 24px between them: the same
 * distance as between the quick-add bar and the Card. The page read as four
 * peers rather than as a titled block followed by three sections. `gap-1` (4px)
 * inside, and `main`'s `gap-6` then separates the whole block from the bar.
 *
 * Here rather than inline for the §4.8 reason `LIST_CONTAINER` and
 * `PAGE_HEADING_ROW` are: `loading.tsx` renders the same two elements, so a
 * wrapper applied in one and forgotten in the other moves the heading when the
 * route settles — which is the shift §4.8 exists to prevent, and which no
 * amount of care in one file can rule out.
 *
 * `error.tsx` does **not** take it, and that is not an oversight: it renders an
 * `Alert` and a retry button with no heading and no dated line, so there is no
 * block to wrap. It shares `TODOS_PAGE_SHELL` with the other two, which is the
 * part all three genuinely have in common.
 */
export const PAGE_HEADING_BLOCK = "flex flex-col gap-1";
