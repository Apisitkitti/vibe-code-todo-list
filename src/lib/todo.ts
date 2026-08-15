import dayjs from "dayjs";
import customParseFormat from "dayjs/plugin/customParseFormat";
import utc from "dayjs/plugin/utc";

import type { Priority } from "@/generated/prisma/client";

dayjs.extend(utc);
dayjs.extend(customParseFormat);

/** The wire format for `dueAt`, shared by the schema, the API and the picker. */
export const DUE_DATE_FORMAT = "YYYY-MM-DD";

/** Field rules fixed by `prisma/schema.prisma` and `docs/PRD.md` §2. */
export const TITLE_MAX_LENGTH = 200;
export const NOTE_MAX_LENGTH = 2000;

export const PRIORITY_VALUES = ["low", "medium", "high"] as const;
export const STATUS_FILTER_VALUES = ["all", "active", "completed"] as const;
export const PRIORITY_FILTER_VALUES = ["all", ...PRIORITY_VALUES] as const;

export const DEFAULT_PRIORITY = "medium";
export const DEFAULT_STATUS_FILTER = "all";
export const DEFAULT_PRIORITY_FILTER = "all";

export type TodoPriority = Priority;
export type TodoStatusFilter = (typeof STATUS_FILTER_VALUES)[number];
export type TodoPriorityFilter = (typeof PRIORITY_FILTER_VALUES)[number];

export const PRIORITY_LABELS: Record<TodoPriority, string> = {
  low: "Low",
  medium: "Medium",
  high: "High",
};

/** Serialisable shape handed from the server component to client components. */
export interface TodoItemData {
  id: string;
  title: string;
  note: string | null;
  priority: TodoPriority;
  completed: boolean;
  dueAt: string | null;
  createdAt: string;
}

export interface TodoListFilters {
  status: TodoStatusFilter;
  priority: TodoPriorityFilter;
  query: string;
}

export interface TodoListResult {
  todos: TodoItemData[];
  totalCount: number;
  completedCount: number;
}

/**
 * Raised when a todo id matches no row owned by the session user — the same
 * answer for "deleted" and "belongs to somebody else" (`docs/PRD.md` NFR-01).
 */
export const TODO_NOT_FOUND_MESSAGE = "That todo no longer exists.";

export const isTodoPriority = (value: unknown): value is TodoPriority => {
  return (
    typeof value === "string" &&
    (PRIORITY_VALUES as readonly string[]).includes(value)
  );
};

export const parseStatusFilter = (value: unknown): TodoStatusFilter => {
  return typeof value === "string" &&
    (STATUS_FILTER_VALUES as readonly string[]).includes(value)
    ? (value as TodoStatusFilter)
    : DEFAULT_STATUS_FILTER;
};

export const parsePriorityFilter = (value: unknown): TodoPriorityFilter => {
  return typeof value === "string" &&
    (PRIORITY_FILTER_VALUES as readonly string[]).includes(value)
    ? (value as TodoPriorityFilter)
    : DEFAULT_PRIORITY_FILTER;
};

/**
 * `YYYY-MM-DD` to a UTC Date. That string stays the wire format for `dueAt`
 * even though the field is now a `DatePicker` — the picker's `DateValue`
 * serialises to exactly this via `toString()`, so the schema, the API contract
 * and the database are unaffected by the widget choice.
 *
 * Parsed in strict mode, so "2026-02-31" is rejected rather than rolled over.
 */
export const parseDueDate = (value: string): Date | null | "invalid" => {
  const trimmed = value.trim();

  if (trimmed === "") return null;

  const parsed = dayjs.utc(trimmed, DUE_DATE_FORMAT, true);

  return parsed.isValid() ? parsed.toDate() : "invalid";
};

/** The inverse of `parseDueDate`, for pre-filling the edit form. */
export const toDueDateInputValue = (iso: string | null): string => {
  return iso ? iso.slice(0, 10) : "";
};
