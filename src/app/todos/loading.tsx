import { Card, Skeleton, Typography } from "@heroui/react";

import { PAGE_HEADING } from "@/app/todos/constants";

import { TodoListHeaderLine } from "./components/TodoListHeaderLine";
import { TodoListSkeleton } from "./components/TodoListSkeleton";

const TodosLoading = () => {
  return (
    <main className="mx-auto flex w-full max-w-2xl flex-1 flex-col gap-6 px-4 py-6 sm:px-6 lg:px-8 lg:py-8">
      <div className="flex items-baseline justify-between gap-4">
        <Typography.Heading level={1}>{PAGE_HEADING}</Typography.Heading>
        <Skeleton className="h-4 w-24 rounded-[var(--radius)]" />
      </div>

      {/*
        US-12's loading state: the date, and no count clauses — there is
        nothing loaded to count, and the requirement is that the counts never
        render as zero and then change. Rendered here rather than skeletoned so
        the line does not appear from nowhere when the route settles.
      */}
      <TodoListHeaderLine groups={null} />

      <Skeleton className="h-11 w-full rounded-[var(--field-radius)] sm:w-32" />

      <Card>
        <Card.Content className="p-0">
          <TodoListSkeleton />
        </Card.Content>
      </Card>
    </main>
  );
};

export default TodosLoading;
