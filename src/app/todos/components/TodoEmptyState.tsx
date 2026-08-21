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
    <EmptyState className="flex flex-col items-center gap-3 px-6 py-12 text-center">
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
      <Typography type="h4" weight="semibold">
        {heading}
      </Typography>
      <Typography type="body-sm" color="muted">
        {body}
      </Typography>
      {/*
        The one distinctive thing this product does was taught only in a
        placeholder that vanishes on the first keystroke (§7.7). A tester put it
        plainly: *"I have no idea what 'high' means. Is that the priority? …
        Nobody told me, and I didn't figure it out."* This is where they are
        told, once, on the one screen where nothing else is competing for the
        space.
      */}
      {hint ? (
        <Typography type="body-sm" color="muted">
          {hint}
        </Typography>
      ) : null}
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
