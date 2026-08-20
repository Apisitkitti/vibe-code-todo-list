import type { Metadata } from "next";

import {
  parsePriorityFilter,
  parseStatusFilter,
  parseView,
  type TodoListFilters,
} from "@/lib/todo";
import { QUERY_PARAM, VIEW_PARAM } from "@/lib/todosUrl";

import { TodoListScreen } from "./components/TodoListScreen";

export const metadata: Metadata = {
  title: "Todos",
};

const readParam = (value: string | string[] | undefined): string => {
  return typeof value === "string" ? value : "";
};

/**
 * Filters and the chosen view live in the URL (`docs/PRD.md` US-10, US-14) and
 * are read here, but the todos themselves are fetched from the client through
 * `/api/todos`; the route guard is `requireUser()` in this route's layout.
 *
 * The view is read apart from the filters on purpose: `TodoListFilters` is the
 * query the API is asked, and it is handed to the service as axios params. A
 * presentation choice folded into it would travel to a handler that has no
 * business seeing it.
 */
const TodosPage = async ({ searchParams }: PageProps<"/todos">) => {
  const params = await searchParams;

  const filters: TodoListFilters = {
    status: parseStatusFilter(params.status),
    priority: parsePriorityFilter(params.priority),
    query: readParam(params[QUERY_PARAM]).trim(),
  };

  const view = parseView(params[VIEW_PARAM]);

  /*
    The board needs the width the list deliberately refuses (§2.2 fixes
    `/todos` at `max-w-2xl` so a line of text stays readable). Five columns
    inside 672px would be 130px each, so the container widens with the view —
    and only with the view, so the list is untouched. Below `lg` the board
    renders as the list anyway (`TodoListScreen`), where the cap is moot
    because the viewport is narrower than either.
  */
  return (
    <main
      className={`mx-auto flex w-full flex-1 flex-col gap-6 px-4 py-6 sm:px-6 lg:px-8 lg:py-8 ${
        view === "board" ? "max-w-7xl" : "max-w-2xl"
      }`}
    >
      <TodoListScreen filters={filters} view={view} />
    </main>
  );
};

export default TodosPage;
