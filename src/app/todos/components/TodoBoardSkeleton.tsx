import { Skeleton } from "@heroui/react";

import { BOARD_COLUMN_IDS } from "@/lib/todoBoard";

/**
 * The board's loading state (§4.8, §8.8).
 *
 * Five columns, because the board always has five and a skeleton that guessed
 * fewer would reflow the whole grid on swap — the exact thing §4.8 asks a
 * skeleton to prevent. Two card outlines per column, not four as the list uses:
 * the count is a shape, and a column that comes back with one card should not
 * have been drawn as a full one.
 *
 * `aria-busy` and the label match the list's, so whichever view is loading
 * announces itself the same way.
 */
const SKELETON_CARDS_PER_COLUMN = 2;

export const TodoBoardSkeleton = () => {
  return (
    <div
      aria-busy="true"
      aria-label="Loading todos"
      className="grid grid-cols-5 items-start gap-2 p-2"
    >
      {BOARD_COLUMN_IDS.map((columnId) => (
        <div key={columnId} className="flex flex-col gap-1.5 p-2">
          <Skeleton className="h-5 w-20 rounded-(--radius)" />
          {Array.from({ length: SKELETON_CARDS_PER_COLUMN }).map((_, index) => (
            <div
              key={index}
              // Carries the card's outline, or the swap shifts by the border.
              className="flex flex-col gap-2 rounded-2xl border border-border-secondary px-3 py-3"
            >
              <Skeleton className="h-4 w-full rounded-(--radius)" />
              <Skeleton className="h-5 w-16 rounded-(--radius)" />
            </div>
          ))}
        </div>
      ))}
    </div>
  );
};
