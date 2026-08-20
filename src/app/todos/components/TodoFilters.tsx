"use client";

import {
  Label,
  ListBox,
  SearchField,
  Select,
  ToggleButton,
  ToggleButtonGroup,
} from "@heroui/react";

import {
  PRIORITY_FILTER_LABELS,
  STATUS_FILTER_LABELS,
} from "@/app/todos/constants";
import type { UrlStateChange } from "@/lib/filterSync";
import {
  PRIORITY_FILTER_VALUES,
  STATUS_FILTER_VALUES,
  type TodoListFilters,
  type TodoPriorityFilter,
  type TodoStatusFilter,
} from "@/lib/todo";

export interface TodoFiltersProps {
  /** The URL's filters, which is what the controls show. */
  filters: TodoListFilters;
  /** The search box's text, which is *not* the URL's — see `useTodosUrlSync`. */
  query: string;
  onQueryChange: (value: string) => void;
  onFilterChange: (change: UrlStateChange) => void;
}

/**
 * Filter state lives in the URL so it survives a reload (`docs/PRD.md` US-10).
 *
 * **This component no longer writes the URL.** It used to own the search text,
 * the debounce and the guard that decides whether a landing navigation is its
 * own echo — all of which moved to `useTodosUrlSync` when the view toggle
 * became a second writer of the same query string. Two writers reading the URL
 * to rebuild it is how a change that has not landed yet gets deleted; there is
 * one owner now, and this row is one of the controls that asks it for a change.
 */
export const TodoFilters = ({
  filters,
  query,
  onQueryChange,
  onFilterChange,
}: TodoFiltersProps) => {
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

          onFilterChange({ status: key as TodoStatusFilter });
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

          onFilterChange({ priority: key as TodoPriorityFilter });
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
        onChange={onQueryChange}
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
