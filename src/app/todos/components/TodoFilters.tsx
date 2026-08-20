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
import { ICON_BUTTON_SIZING, LABELLED_CONTROL_SIZING } from "@/lib/styles";
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
            className={`${LABELLED_CONTROL_SIZING} flex-1 sm:flex-none`}
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
        <Select.Trigger className={LABELLED_CONTROL_SIZING}>
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
        <SearchField.Group className={LABELLED_CONTROL_SIZING}>
          <SearchField.SearchIcon />
          {/*
            `min-w-0` is what keeps the clear button reachable, and it is not a
            cosmetic tweak — see `e2e/a11y-targets.spec.ts`.

            A flex item's automatic minimum size is its min-content width, and
            an `<input>`'s min-content is its default intrinsic width (`size=20`
            worth of glyphs), which is a *font metric*, not a layout choice.
            Without `min-w-0` the input refuses to shrink below it, so once the
            group's content — icon 28 + input min-content + the button's 44px
            margin box (36 wide at `sm:`, plus its 8px end margin) — exceeds
            the `sm:max-w-64` cap of 256px, the surplus is pushed off the end of
            the group. The group computes `overflow: hidden`, and overflow
            clipping clips *hit-testing*, so the clear button stops taking the
            pointer on the right-hand side first and then entirely. It has 8px
            of headroom (its `margin-inline-end`) before that starts.

            Measured: min-content is 242px, so 14px of slack. Forcing the input
            to `monospace` takes the group's `scrollWidth` to 261 against a
            `clientWidth` of 256 — already overflowing — and cuts the button's
            headroom from 8px to 3px — so the overflow is reachable by
            construction. **What tipped it over on CI is not established.** A
            fallback face while `next/font` settles was the first guess and it
            does not survive measurement: no face reaches the cliff at this
            width. Left unknown deliberately rather than filled in.

            `min-w-0` puts the group's cap back in charge: the input yields, the
            button keeps its place, and no font can push the content out. The
            cost is that a very narrow field shows fewer characters of the query
            at once — which is the right thing to give up, and the only thing
            the group can give up without taking width from the filter row.

            Not fixed by removing `overflow: hidden`: the group carries the 12px
            field radius and its children are deliberately squared against it
            (`search-field__input` zeroes its own corner radii, and the focus
            and autofill backgrounds paint to the edge), so the clip is what
            makes the rounded field rounded.
          */}
          <SearchField.Input className="min-w-0" placeholder="Search todos" />
          {/*
            HeroUI ships this control at 20×20 — `padding: 4px` around a 12px
            icon and no min-size. That is below NFR-05's 44×44 and, alone in
            this app, below WCAG 2.2 SC 2.5.8's 24×24 floor (QA DEF-16). Missing
            it puts text back in the box and silently changes which list the
            user is looking at.

            The same `ICON_BUTTON_SIZING` step the row actions use (§6.3): 44
            on phones, relaxing to 36 for pointer input. The group is given the
            matching *height* floor so the field grows with the button rather
            than the button escaping it vertically — and that also lines the
            search box up with the status toggles and the priority select
            beside it, which were already `LABELLED_CONTROL_SIZING`. The
            horizontal half of that is the input's `min-w-0` above; the group
            has no width floor and cannot be given one without taking width
            from the rest of the row.

            `aria-label` last, because `CloseButton` hardcodes `aria-label="Close"`
            before spreading its props: "Close" describes dismissing something,
            which is not what this does.
          */}
          <SearchField.ClearButton
            className={ICON_BUTTON_SIZING}
            aria-label="Clear search"
          />
        </SearchField.Group>
      </SearchField>
    </div>
  );
};
