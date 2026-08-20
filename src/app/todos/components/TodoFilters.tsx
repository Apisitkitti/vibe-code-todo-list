"use client";

import { useEffect, useState, useTransition } from "react";

import {
  Label,
  ListBox,
  SearchField,
  Select,
  ToggleButton,
  ToggleButtonGroup,
} from "@heroui/react";
import { useRouter } from "next/navigation";

import {
  PRIORITY_FILTER_LABELS,
  STATUS_FILTER_LABELS,
} from "@/app/todos/constants";
import {
  PRIORITY_FILTER_VALUES,
  STATUS_FILTER_VALUES,
  type TodoListFilters,
  type TodoPriorityFilter,
  type TodoStatusFilter,
  type TodoView,
} from "@/lib/todo";
import { todosUrl } from "@/lib/todosUrl";

const SEARCH_DEBOUNCE_MS = 300;

export interface TodoFiltersProps {
  filters: TodoListFilters;
  /**
   * Carried, not used: the view is another piece of URL state, and a writer
   * that rebuilt the query string without it would delete it — dropping a user
   * out of the board every time they changed a filter (`src/lib/todosUrl.ts`).
   */
  view: TodoView;
}

/**
 * Filter state lives in the URL so it survives a reload (`docs/PRD.md` US-10).
 * The current values arrive as props from the server component, so this never
 * needs to read the search params itself.
 */
export const TodoFilters = ({ filters, view }: TodoFiltersProps) => {
  const [query, setQuery] = useState(filters.query);
  const [lastAppliedQuery, setLastAppliedQuery] = useState(filters.query);
  const [, startTransition] = useTransition();

  const router = useRouter();

  // Adjusting state during render rather than in an effect: the search box
  // follows the URL when navigation changes it from outside this component.
  if (lastAppliedQuery !== filters.query) {
    setLastAppliedQuery(filters.query);
    setQuery(filters.query);
  }

  const pushFilters = (next: TodoListFilters) => {
    startTransition(() => {
      router.replace(todosUrl(next, view), { scroll: false });
    });
  };

  // Typing should not push a history entry per keystroke.
  useEffect(() => {
    if (query === filters.query) return;

    const timer = setTimeout(() => {
      pushFilters({ ...filters, query });
    }, SEARCH_DEBOUNCE_MS);

    return () => clearTimeout(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [query, filters.query, filters.status, filters.priority, view]);

  return (
    <div className="flex flex-col gap-3 sm:flex-row sm:items-center">
      <ToggleButtonGroup
        aria-label="Filter todos by status"
        selectionMode="single"
        disallowEmptySelection
        selectedKeys={[filters.status]}
        onSelectionChange={(keys) => {
          const [key] = [...keys];

          if (typeof key !== "string") return;

          pushFilters({ ...filters, status: key as TodoStatusFilter });
        }}
        size="sm"
        className="w-full sm:w-auto"
      >
        {/*
          The group is `w-full`, but the buttons sized to their content and sat
          centred inside it, so the row read as inconsistent against the
          full-width priority and search fields below — hence `flex-1` on each
          button (QA DEF-05, `docs/DESIGN.md` §4.3 "toggle group on row 1
          (fullWidth)").
        */}
        {STATUS_FILTER_VALUES.map((status) => (
          <ToggleButton
            key={status}
            id={status}
            className="min-h-11 flex-1 sm:min-h-9 sm:flex-none"
          >
            {STATUS_FILTER_LABELS[status]}
          </ToggleButton>
        ))}
      </ToggleButtonGroup>

      <Select
        aria-label="Filter todos by priority"
        selectedKey={filters.priority}
        onSelectionChange={(key) => {
          if (typeof key !== "string") return;

          pushFilters({ ...filters, priority: key as TodoPriorityFilter });
        }}
        className="flex w-full flex-col gap-1.5 sm:w-40"
      >
        <Label className="sr-only">Priority</Label>
        <Select.Trigger className="min-h-11 sm:min-h-9">
          <Select.Value />
          <Select.Indicator />
        </Select.Trigger>
        <Select.Popover>
          <ListBox>
            {PRIORITY_FILTER_VALUES.map((priority) => (
              <ListBox.Item key={priority} id={priority}>
                {PRIORITY_FILTER_LABELS[priority]}
              </ListBox.Item>
            ))}
          </ListBox>
        </Select.Popover>
      </Select>

      <SearchField
        aria-label="Search todos"
        value={query}
        onChange={setQuery}
        className="w-full sm:ml-auto sm:max-w-64"
      >
        <SearchField.Group className="min-h-11 sm:min-h-9">
          <SearchField.SearchIcon />
          <SearchField.Input placeholder="Search todos" />
          {/*
            HeroUI ships this control at 20×20 — `padding: 4px` around a 12px
            icon and no min-size. That is below NFR-05's 44×44 and, alone in
            this app, below WCAG 2.2 SC 2.5.8's 24×24 floor (QA DEF-16). Missing
            it puts text back in the box and silently changes which list the
            user is looking at.

            The same `ICON_BUTTON_SIZING` step the row actions use (§6.3): 44
            on phones, relaxing to 36 for pointer input. The group is given the
            matching floor so the field grows with the button rather than the
            button escaping it — and that also lines the search box up with the
            status toggles and the priority select beside it, which were
            already `min-h-11 sm:min-h-9`.

            `aria-label` last, because `CloseButton` hardcodes `aria-label="Close"`
            before spreading its props: "Close" describes dismissing something,
            which is not what this does.
          */}
          <SearchField.ClearButton
            className="min-h-11 min-w-11 sm:min-h-9 sm:min-w-9"
            aria-label="Clear search"
          />
        </SearchField.Group>
      </SearchField>
    </div>
  );
};
