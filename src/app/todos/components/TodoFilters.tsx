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
  DEFAULT_PRIORITY_FILTER,
  DEFAULT_STATUS_FILTER,
  PRIORITY_FILTER_VALUES,
  STATUS_FILTER_VALUES,
  type TodoListFilters,
  type TodoPriorityFilter,
  type TodoStatusFilter,
} from "@/lib/todo";

const TODOS_PATH = "/todos";
const STATUS_PARAM = "status";
const PRIORITY_PARAM = "priority";
const QUERY_PARAM = "q";
const SEARCH_DEBOUNCE_MS = 300;

export interface TodoFiltersProps {
  filters: TodoListFilters;
}

/**
 * Filter state lives in the URL so it survives a reload (`docs/PRD.md` US-10).
 * The current values arrive as props from the server component, so this never
 * needs to read the search params itself.
 */
export const TodoFilters = ({ filters }: TodoFiltersProps) => {
  const router = useRouter();
  const [, startTransition] = useTransition();
  const [query, setQuery] = useState(filters.query);
  const [lastAppliedQuery, setLastAppliedQuery] = useState(filters.query);

  // Adjusting state during render rather than in an effect: the search box
  // follows the URL when navigation changes it from outside this component.
  if (lastAppliedQuery !== filters.query) {
    setLastAppliedQuery(filters.query);
    setQuery(filters.query);
  }

  const pushFilters = (next: TodoListFilters) => {
    const params = new URLSearchParams();

    if (next.status !== DEFAULT_STATUS_FILTER) params.set(STATUS_PARAM, next.status);
    if (next.priority !== DEFAULT_PRIORITY_FILTER) {
      params.set(PRIORITY_PARAM, next.priority);
    }
    if (next.query !== "") params.set(QUERY_PARAM, next.query);

    const search = params.toString();

    startTransition(() => {
      router.replace(search === "" ? TODOS_PATH : `${TODOS_PATH}?${search}`, {
        scroll: false,
      });
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
  }, [query, filters.query, filters.status, filters.priority]);

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
        <SearchField.Group>
          <SearchField.SearchIcon />
          <SearchField.Input placeholder="Search todos" />
          <SearchField.ClearButton />
        </SearchField.Group>
      </SearchField>
    </div>
  );
};
