import { Button, EmptyState, Typography } from "@heroui/react";

import { LABELLED_CONTROL_SIZING } from "@/lib/styles";

export interface TodoEmptyStateProps {
  heading: string;
  body: string;
  /**
   * One line teaching the quick-add vocabulary, under the body copy (§7.7).
   *
   * Optional, and only one of `resolveEmptyState`'s five branches passes it:
   * the never-used account. `No matches` must not teach syntax — a user who has
   * already typed a search is not meeting the parser for the first time, and
   * answering "your search found nothing" with "here is how to write a due
   * date" is the app talking about itself instead of about their question.
   */
  hint?: string;
  actionLabel?: string;
  onAction?: () => void;
}

/**
 * Rendered inside the list `Card` in place of the `<ul>`, so the page does not
 * jump when the first todo arrives (`docs/DESIGN.md` §4.7).
 */
export const TodoEmptyState = ({
  heading,
  body,
  hint,
  actionLabel,
  onAction,
}: TodoEmptyStateProps) => {
  return (
    /*
      `gap-4` here separates two things, not five (§2.2).

      This was one `gap-3` across five children, which said the icon, the
      heading, the body, the teaching line and the button were all peers — and
      once the button lost its accent fill (§1) it read as a fifth line of copy
      rather than as the thing to press. The copy is one block at `gap-2` and
      the action is a step further out at `gap-4`, so the hierarchy is in the
      spacing rather than only in the fill.

      No `text-center`. It was here and it did nothing: `Typography` defaults to
      `align="start"` and puts `text-align: start` on the `<h4>` and each `<p>`
      itself (`typography--align-start`, `@heroui/styles`), and a declared value
      beats an inherited one — so the container's alignment never reached the
      copy at all. Each `Typography` states its own `align` below, which is the
      only place that can decide it; keeping a dead `text-center` alongside them
      would be a second way to set one thing, and the one that loses.
    */
    <EmptyState className="flex flex-col items-center gap-4 px-6 py-12">
      {/*
        The copy, as one block. `gap-2` is §2.2's icon-to-label step and is what
        makes the four of them read as one statement rather than as four.
      */}
      <div className="flex flex-col items-center gap-2">
        <div aria-hidden="true" className="text-(--muted)">
          <svg
            width={32}
            height={32}
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth={1.5}
            strokeLinecap="round"
            strokeLinejoin="round"
          >
            <path d="M4 5h16v15a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1Z" />
            <path d="M8 3v4M16 3v4" />
            <path d="M9 13l2 2 4-4" />
          </svg>
        </div>
        {/*
          `align="center"` on every one of these, and it is load-bearing rather
          than belt-and-braces — see the note on the container above. Without it
          a line that wraps is laid out from the start edge inside a box the
          flex container has centred, so the short last line sits left of
          everything around it. `e2e/empty-state-centring.spec.ts` measures each
          rendered line box against the container's centre at 390px, where the
          body takes two lines and the teaching line takes three.
        */}
        <Typography type="h4" weight="semibold" align="center">
          {heading}
        </Typography>
        <Typography type="body-sm" color="muted" align="center">
          {body}
        </Typography>
        {/*
          The one distinctive thing this product does was taught only in a
          placeholder that vanishes on the first keystroke (§7.7). A tester put
          it plainly: *"I have no idea what 'high' means. Is that the priority?
          … Nobody told me, and I didn't figure it out."* This is where they are
          told, once, on the one screen where nothing else is competing for the
          space.
        */}
        {hint ? (
          <Typography type="body-sm" color="muted" align="center">
            {hint}
          </Typography>
        ) : null}
      </div>
      {/*
        `secondary`, not `primary` (`docs/DESIGN.md` §1, §4.7).

        §1 allows the empty `/todos` screen one primary button, and it shipped
        with two about 150px apart — the quick-add `Add`, and this one, whose
        entire job is to move focus to that one. The button that performs the
        capture keeps the accent; the button that points at it does not.

        `secondary` rather than `tertiary`, and **not for the reason that was
        written down.** The case made for it was that a fill-less button becomes
        a text link wearing button spacing — true of `ghost` and `outline`, and
        measurably not true of `tertiary`: `button--secondary` and
        `button--tertiary` both set `--button-bg: var(--default)`
        (`@heroui/styles/dist/components/button.css`) and paint the identical
        fill, rgb(235,235,236) light / rgb(39,39,42) dark.

        What actually separates them is `--button-fg`. `secondary` takes
        `--accent-soft-foreground`, so the label is accent-tinted and reads as
        the call to action; `tertiary` leaves `currentColor` and reads as
        chrome. That is the right distinction for the one thing this screen is
        asking the user to do, and it costs label contrast rather than buying it
        — 6.25:1 against tertiary's 14.87:1 in light, both clear of 4.5:1.

        It still says `Add a todo`, still focuses the quick-add input, and still
        carries §6.3's height floor.
      */}
      {actionLabel && onAction ? (
        <Button
          variant="secondary"
          size="sm"
          className={LABELLED_CONTROL_SIZING}
          onPress={onAction}
        >
          {actionLabel}
        </Button>
      ) : null}
    </EmptyState>
  );
};
