import { Card, Skeleton, Typography } from "@heroui/react";

import { PAGE_HEADING } from "@/app/todos/constants";
import { PAGE_HEADING_ROW, TODOS_PAGE_SHELL } from "@/lib/styles";

import { TodoListHeaderLine } from "./components/TodoListHeaderLine";
import { TodoListSkeleton } from "./components/TodoListSkeleton";

const TodosLoading = () => {
  return (
    <main className={TODOS_PAGE_SHELL}>
      <div className={PAGE_HEADING_ROW}>
        <Typography.Heading level={1}>{PAGE_HEADING}</Typography.Heading>
        <Skeleton className="h-4 w-24 rounded-(--radius)" />
      </div>

      {/*
        US-12's loading state: the date, and no count clauses — there is
        nothing loaded to count, and the requirement is that the counts never
        render as zero and then change. Rendered here rather than skeletoned so
        the line does not appear from nowhere when the route settles.
      */}
      <TodoListHeaderLine groups={null} />

      <Skeleton className="h-11 w-full rounded-(--field-radius) sm:w-32" />

      <Card>
        <Card.Content className="p-0">
          <TodoListSkeleton />
        </Card.Content>
      </Card>
    </main>
  );
};

export default TodosLoading;
