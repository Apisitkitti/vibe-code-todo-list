import { requireUser } from "@/lib/session";

import { TodosHeader } from "./components/TodosHeader";

/**
 * The app shell for the todos route. `requireUser()` runs here as well as in
 * every action, so an unauthenticated visitor is redirected before any todo
 * data is fetched (`docs/PRD.md` US-04).
 */
const TodosLayout = async ({ children }: LayoutProps<"/todos">) => {
  const user = await requireUser();

  return (
    <>
      <TodosHeader userName={user.name} userEmail={user.email} />
      {children}
    </>
  );
};

export default TodosLayout;
