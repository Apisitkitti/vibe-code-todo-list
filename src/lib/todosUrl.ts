import {
  DEFAULT_PRIORITY_FILTER,
  DEFAULT_STATUS_FILTER,
  DEFAULT_VIEW,
  type TodoListFilters,
  type TodoView,
} from "./todo";

/**
 * The one place a `/todos` URL is written.
 *
 * Filters have lived in the URL since US-10, and the view joined them in US-14.
 * That is the whole reason this file exists: while `TodoFilters` was the only
 * writer it could rebuild the query string from the filters alone, and the
 * moment a second piece of state moved into the URL, every writer that did not
 * know about it silently *deleted* it. Changing the status filter would have
 * dropped the user out of the board, and so would `Clear filters` — two
 * different components, the same bug, neither of them obviously wrong on its
 * own.
 *
 * So the query string is built from the complete state once, here, and both
 * writers hand over everything they know. A third writer is then correct by
 * construction rather than by having read this comment.
 */

export const TODOS_PATH = "/todos";

export const STATUS_PARAM = "status";
export const PRIORITY_PARAM = "priority";
export const QUERY_PARAM = "q";
export const VIEW_PARAM = "view";

/**
 * The path plus only the parameters that are not at their default.
 *
 * Defaults are omitted rather than spelled out, so the canonical `/todos` and
 * an explicit `/todos?status=all&view=list` are the same screen and the plain
 * one is what the address bar shows. `URLSearchParams` orders keys by insertion,
 * so the same state always produces the same string — which is what makes a
 * `router.replace` to the current URL a no-op instead of a history entry.
 */
export const todosUrl = (filters: TodoListFilters, view: TodoView): string => {
  const params = new URLSearchParams();

  if (filters.status !== DEFAULT_STATUS_FILTER) {
    params.set(STATUS_PARAM, filters.status);
  }
  if (filters.priority !== DEFAULT_PRIORITY_FILTER) {
    params.set(PRIORITY_PARAM, filters.priority);
  }
  if (filters.query !== "") params.set(QUERY_PARAM, filters.query);
  if (view !== DEFAULT_VIEW) params.set(VIEW_PARAM, view);

  const search = params.toString();

  return search === "" ? TODOS_PATH : `${TODOS_PATH}?${search}`;
};

/**
 * `Clear filters` and `Clear search`: the filters go back to their defaults and
 * **the view stays**.
 *
 * Which is a product ruling, not an implementation detail. The user asked to
 * stop narrowing the list; they did not ask to leave the board they are looking
 * at. Emptying the whole query string would have done both, and the second half
 * would have looked like the app losing its place.
 */
export const clearedFiltersUrl = (view: TodoView): string =>
  todosUrl(
    {
      status: DEFAULT_STATUS_FILTER,
      priority: DEFAULT_PRIORITY_FILTER,
      query: "",
    },
    view,
  );
