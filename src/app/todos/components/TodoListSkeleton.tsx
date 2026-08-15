import { Skeleton } from "@heroui/react";

const SKELETON_ROW_COUNT = 4;

/** Row geometry matches `TodoRow` so nothing shifts on swap (§4.8). */
export const TodoListSkeleton = () => {
  return (
    <ul
      aria-busy="true"
      aria-label="Loading todos"
      className="divide-y divide-border-secondary"
    >
      {Array.from({ length: SKELETON_ROW_COUNT }).map((_, index) => (
        <li key={index} className="flex items-center gap-3 px-4 py-3">
          <Skeleton className="size-5 rounded-(--radius) " />
          <Skeleton className="h-4 flex-1 rounded-(--radius)" />
          <Skeleton className="h-5 w-16 rounded-(--radius)" />
        </li>
      ))}
    </ul>
  );
};
