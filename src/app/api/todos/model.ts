import type { Todo } from "@/generated/prisma/client";

import type { TodoPriority } from "@/lib/todo";

/**
 * The data model for `/api/todos`. Each model owns both its shape and the way
 * a database row becomes that shape, so there is nowhere else to build one
 * and no second definition to drift. Error shapes live in `./errors.ts`; the
 * handlers' shared reads live in `./util.ts`.
 */

/** One todo as it crosses the wire. Dates are ISO strings, never `Date`. */
export class TodoResponse {
  readonly id: string;
  readonly title: string;
  readonly note: string | null;
  readonly priority: TodoPriority;
  readonly completed: boolean;
  readonly dueAt: string | null;
  readonly createdAt: string;

  constructor(todo: Todo) {
    this.id = todo.id;
    this.title = todo.title;
    this.note = todo.note;
    this.priority = todo.priority;
    this.completed = todo.completed;
    this.dueAt = todo.dueAt ? todo.dueAt.toISOString() : null;
    this.createdAt = todo.createdAt.toISOString();
  }

  static from = (todo: Todo) => new TodoResponse(todo);

  static fromList = (todos: Todo[]) => todos.map(TodoResponse.from);
}

/** The list endpoint's body: the page of todos plus the counts beside it. */
export class TodoListResponse {
  readonly todos: TodoResponse[];
  readonly totalCount: number;
  readonly completedCount: number;

  constructor(todos: Todo[], totalCount: number, completedCount: number) {
    this.todos = TodoResponse.fromList(todos);
    this.totalCount = totalCount;
    this.completedCount = completedCount;
  }
}
