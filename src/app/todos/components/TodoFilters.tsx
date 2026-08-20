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
import { ICON_BUTTON_SIZING, LABELLED_CONTROL_SIZING } from "@/lib/styles";
import {
  abandonPendingPushes,
  createFilterSync,
  isPushNeeded,
  nextFilters,
  recordPush,
  setSearchQuery,
  syncToUrl,
} from "@/lib/filterSync";
import { TODOS_PATH } from "@/lib/routes";
import {
  DEFAULT_PRIORITY_FILTER,
  DEFAULT_STATUS_FILTER,
  PRIORITY_FILTER_VALUES,
  STATUS_FILTER_VALUES,
  type TodoListFilters,
  type TodoPriorityFilter,
  type TodoStatusFilter,
} from "@/lib/todo";

const STATUS_PARAM = "status";
const PRIORITY_PARAM = "priority";
const QUERY_PARAM = "q";
const SEARCH_DEBOUNCE_MS = 300;
/**
 * How long a push is given to land before its recording is thrown away.
 *
 * A `replace` that is dropped or superseded reports nothing, so the only way
 * to notice is to stop waiting. Comfortably longer than a debounce plus a
 * round trip on a loaded machine, and short enough that a user who has been
 * left looking at a stale URL gets the correcting push rather than a wrong
 * list.
 */
const PUSH_SETTLE_MS = 2000;

export interface TodoFiltersProps {
  filters: TodoListFilters;
}

/**
 * Filter state lives in the URL so it survives a reload (`docs/PRD.md` US-10).
 * The current values arrive as props from the server component, so this never
 * needs to read the search params itself.
 */
export const TodoFilters = ({ filters }: TodoFiltersProps) => {
  const [sync, setSync] = useState(() => createFilterSync(filters));
  /**
   * Bumped when a push is given up on, purely to re-run the debounce effect.
   *
   * The effect is keyed on the field's text and the URL's values, which is
   * what stops a recorded push from re-triggering it — see `isPushNeeded`. The
   * cost of that is that abandoning a push changes nothing the effect watches,
   * so without this counter a push that never landed would never be retried
   * and the field and the URL would sit disagreeing forever.
   */
  const [pushAttempt, setPushAttempt] = useState(0);
  const [, startTransition] = useTransition();

  const router = useRouter();

  /*
    Adjusted during render rather than in an effect: the controls follow the
    URL when navigation changes it from outside this component.

    What they must *not* follow is one of our own pushes landing, which arrives
    through this same prop and is indistinguishable from an outside navigation
    by its values alone — that is the revert `syncToUrl` exists to stop.
    Reading the reconciled state below rather than `sync` keeps this render on
    the answer just computed instead of the one being replaced.
  */
  const synced = syncToUrl(sync, filters);

  if (synced !== sync) setSync(synced);

  const { query } = synced;

  /**
   * Hand a change to the router.
   *
   * `changes` is laid over the **settled target** — what the URL will hold once
   * everything already pushed has landed — and never over `filters`. Spreading
   * the prop is what made a filter press and a keystroke each able to discard
   * the other: whichever went second rebuilt its push from a URL that did not
   * yet know about the first. Going through `nextFilters` is what keeps the two
   * directions symmetric.
   */
  const push = (changes: Partial<TodoListFilters> = {}) => {
    const next = nextFilters(synced, changes);
    const params = new URLSearchParams();

    if (next.status !== DEFAULT_STATUS_FILTER) params.set(STATUS_PARAM, next.status);
    if (next.priority !== DEFAULT_PRIORITY_FILTER) {
      params.set(PRIORITY_PARAM, next.priority);
    }
    // Already trimmed by `nextFilters`, which is the form it will come back in.
    if (next.query !== "") params.set(QUERY_PARAM, next.query);

    const search = params.toString();

    setSync((current) => recordPush(current, next));

    startTransition(() => {
      router.replace(search === "" ? TODOS_PATH : `${TODOS_PATH}?${search}`, {
        scroll: false,
      });
    });
  };

  // Typing should not push a history entry per keystroke.
  useEffect(() => {
    if (!isPushNeeded(synced, filters)) return;

    const timer = setTimeout(() => {
      push();
    }, SEARCH_DEBOUNCE_MS);

    return () => clearTimeout(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [query, filters.query, filters.status, filters.priority, pushAttempt]);

  /*
    Nothing reports a `replace` that was dropped or superseded, so a recording
    for it would otherwise sit in `pending` for the life of the page — claiming
    a target the URL will never reach, and swallowing the next outside
    navigation that happened to carry the same tuple. Giving up on it puts the
    field back in disagreement with the real URL, and the counter re-runs the
    debounce above, which is the whole of the retry path.
  */
  useEffect(() => {
    if (synced.pending.length === 0) return;

    const timer = setTimeout(() => {
      setSync(abandonPendingPushes);
      setPushAttempt((attempt) => attempt + 1);
    }, PUSH_SETTLE_MS);

    return () => clearTimeout(timer);
  }, [synced]);

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

          push({ status: key as TodoStatusFilter });
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

          push({ priority: key as TodoPriorityFilter });
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
        onChange={(value) => setSync((current) => setSearchQuery(current, value))}
        className="w-full sm:ml-auto sm:max-w-64"
      >
        <SearchField.Group className={LABELLED_CONTROL_SIZING}>
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
            already `LABELLED_CONTROL_SIZING`.

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
