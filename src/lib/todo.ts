import dayjs from "dayjs";
import customParseFormat from "dayjs/plugin/customParseFormat";
import utc from "dayjs/plugin/utc";

import type { CreatedVia, Priority } from "@/generated/prisma/client";

dayjs.extend(utc);
dayjs.extend(customParseFormat);

/** The wire format for `dueAt`, shared by the schema, the API and the picker. */
export const DUE_DATE_FORMAT = "YYYY-MM-DD";

/** Field rules fixed by `prisma/schema.prisma` and `docs/PRD.md` §2. */
export const TITLE_MAX_LENGTH = 200;
export const NOTE_MAX_LENGTH = 2000;

export const PRIORITY_VALUES = ["low", "medium", "high"] as const;

/**
 * The two capture surfaces, and the wire spelling of each.
 *
 * Analytics only (`prisma/schema.prisma` → `CreatedVia`): it is never
 * rendered, never in a response body, and never editable. It lives here rather
 * than beside the route because the client is what *knows* the answer — the
 * route cannot infer which surface a request came from, and a header or a
 * `User-Agent` guess would be inference dressed as measurement.
 *
 * Not part of `todoFormSchema`. It is not a field of the todo the user is
 * describing; it is a fact about the act of creating it, so folding it into
 * the form schema would put it in front of `TodoForm`, `readFieldErrors` and
 * `TODO_FIELD_NAMES`, none of which have any business with it.
 */
export const CREATED_VIA_VALUES = ["quickAdd", "form"] as const;

export type TodoCreatedVia = CreatedVia;
export const STATUS_FILTER_VALUES = ["all", "active", "completed"] as const;
export const PRIORITY_FILTER_VALUES = ["all", ...PRIORITY_VALUES] as const;

/**
 * The two ways of looking at the same todos (`docs/PRD.md` US-14).
 *
 * A *view*, not a filter: it changes nothing about which rows are asked for or
 * which are shown, only how they are laid out. It sits beside the filters in
 * the URL for the same reason they do — a link to a board is a link to a board,
 * a reload keeps it, and the back button undoes it (US-10).
 *
 * It is deliberately **not** part of `TodoListFilters`: that interface is the
 * query `GET /api/todos` is asked, and it is passed straight to the service as
 * axios params. Folding a presentation choice into it would put `view=board` on
 * the wire, where the handler has no business seeing it.
 */
export const VIEW_VALUES = ["list", "board"] as const;

export const DEFAULT_PRIORITY = "medium";
export const DEFAULT_STATUS_FILTER = "all";
export const DEFAULT_PRIORITY_FILTER = "all";
export const DEFAULT_VIEW = "list";

export type TodoPriority = Priority;
export type TodoStatusFilter = (typeof STATUS_FILTER_VALUES)[number];
export type TodoPriorityFilter = (typeof PRIORITY_FILTER_VALUES)[number];
export type TodoView = (typeof VIEW_VALUES)[number];

/**
 * Which field the record editor opens on (`docs/DESIGN.md` §7.21).
 *
 * A named intent rather than a boolean, because the question the caller is
 * answering is "what did the user come to change" — and there are two answers
 * today only by coincidence. `Edit` says `title`; the reschedule menu's
 * `Pick a date…` says `dueAt`, because a menu item ending in `…` promises a
 * surface for specifying *this* thing and what arrives is the whole editor.
 *
 * It lives here, below the form and below the row's action menu, because both
 * ends of that handoff need it and neither may import the other.
 */
export type TodoFormFocus = "title" | "dueAt";

export const DEFAULT_FORM_FOCUS: TodoFormFocus = "title";

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
 * An unknown `view` is the list, silently. A URL is something people edit and
 * share, so a typo has to degrade to the default rather than to an error page —
 * the same ruling the two filter parsers above already make.
 */
export const parseView = (value: unknown): TodoView => {
  return typeof value === "string" && (VIEW_VALUES as readonly string[]).includes(value)
    ? (value as TodoView)
    : DEFAULT_VIEW;
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
