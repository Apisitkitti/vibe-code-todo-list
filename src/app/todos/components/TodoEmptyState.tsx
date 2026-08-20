import { Button, EmptyState, Typography } from "@heroui/react";

import { LABELLED_CONTROL_SIZING } from "@/lib/styles";

export interface TodoEmptyStateProps {
  heading: string;
  body: string;
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
      {actionLabel && onAction ? (
        <Button
          variant="primary"
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
