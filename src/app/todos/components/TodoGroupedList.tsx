"use client";

import { Separator, Typography } from "@heroui/react";

import type { TodoItemData } from "@/lib/todo";
import { groupTodos } from "@/lib/todoGroups";

import { TodoRow } from "./TodoRow";

/**
 * `Typography.Heading` at `level={2}` renders a real `<h2>` but is styled
 * `text-3xl` (`typography--h2`), which would shout over the rows it labels.
 * `text-sm leading-6` is exactly the `body-sm` step the copy deck asks for
 * (`docs/DESIGN.md` §2.4, §7.16) — the size comes down, the element stays a
 * heading, and the semibold weight and tight tracking of a heading remain.
 */
const GROUP_HEADING_CLASS = "px-2 pt-1 text-sm leading-6";

export interface TodoGroupedListProps {
  todos: TodoItemData[];
  pendingTodoIds: ReadonlySet<string>;
  /** The row a confirmed delete is running against, if any (§8.3.2). */
  vanishingTodoId: string | null;
  showTooltips: boolean;
  onToggle: (todo: TodoItemData, nextCompleted: boolean) => void;
  onEdit: (todo: TodoItemData) => void;
  onDelete: (todo: TodoItemData) => void;
}

/**
 * The list, cut into urgency sections (`docs/DESIGN.md` §7.16).
 *
 * Each section is its own `<ul>` under its own heading rather than headings
 * spliced between `<li>`s, because a heading is not a list item: an `<h2>`
 * inside a `<ul>` is invalid, and screen readers would report one long list
 * whose count spans sections that mean different things. Separate lists give a
 * real count per section and a heading to jump to (§8.4.3).
 *
 * With a single section there are no headings at all, so the markup collapses
 * to what shipped before this change — one `<ul>` of rows.
 */
export const TodoGroupedList = ({
  todos,
  pendingTodoIds,
  vanishingTodoId,
  showTooltips,
  onToggle,
  onEdit,
  onDelete,
}: TodoGroupedListProps) => {
  const groups = groupTodos(todos);
  const showHeadings = groups.length > 1;

  return (
    /*
      `p-2` keeps the outermost pills off the Card's edge (§4.3); the gaps
      hold the rows' own outlines apart (§8.7).
    */
    <div className="flex flex-col gap-1.5 p-2">
      {groups.map((group, index) => (
        <section key={group.id} className="flex flex-col gap-1.5">
          {showHeadings ? (
            <>
              {/* Between sections only — never above the first. */}
              {index > 0 ? <Separator className="my-1" /> : null}
              <Typography.Heading
                level={2}
                color="muted"
                className={GROUP_HEADING_CLASS}
              >
                {group.heading}
              </Typography.Heading>
            </>
          ) : null}

          <ul className="flex flex-col gap-1.5">
            {group.todos.map((todo) => (
              <TodoRow
                key={todo.id}
                todo={todo}
                isPending={pendingTodoIds.has(todo.id)}
                isVanishing={todo.id === vanishingTodoId}
                showTooltips={showTooltips}
                onToggle={onToggle}
                onEdit={onEdit}
                onDelete={onDelete}
              />
            ))}
          </ul>
        </section>
      ))}
    </div>
  );
};
