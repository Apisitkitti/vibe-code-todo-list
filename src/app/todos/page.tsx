import type { Metadata } from "next";

import {
  parsePriorityFilter,
  parseStatusFilter,
  type TodoListFilters,
} from "@/lib/todo";

import { TodoListScreen } from "./components/TodoListScreen";

export const metadata: Metadata = {
  title: "Todos",
};

const QUERY_PARAM = "q";

const readParam = (value: string | string[] | undefined): string => {
  return typeof value === "string" ? value : "";
};

/**
 * Filters live in the URL (`docs/PRD.md` US-10) and are read here, but the
 * todos themselves are fetched from the client through `/api/todos`; the
 * route guard is `requireUser()` in this route's layout.
 */
const TodosPage = async ({ searchParams }: PageProps<"/todos">) => {
  const params = await searchParams;

  const filters: TodoListFilters = {
    status: parseStatusFilter(params.status),
    priority: parsePriorityFilter(params.priority),
    query: readParam(params[QUERY_PARAM]).trim(),
  };

  return (
    <main className="mx-auto flex w-full max-w-2xl flex-1 flex-col gap-6 px-4 py-6 sm:px-6 lg:px-8 lg:py-8">
      <TodoListScreen filters={filters} />
    </main>
  );
};

export default TodosPage;
