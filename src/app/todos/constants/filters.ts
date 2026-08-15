/** Filter and search copy (§7.3, §7.10). */

import type { TodoPriorityFilter, TodoStatusFilter } from "@/lib/todo";

export const STATUS_FILTER_ARIA_LABEL = "Filter todos by status";
export const PRIORITY_FILTER_ARIA_LABEL = "Filter todos by priority";
export const PRIORITY_FILTER_LABEL = "Priority";
export const SEARCH_ARIA_LABEL = "Search todos";
export const SEARCH_PLACEHOLDER = "Search todos";

export const STATUS_FILTER_LABELS: Record<TodoStatusFilter, string> = {
  all: "All",
  active: "Active",
  completed: "Completed",
};

export const PRIORITY_FILTER_LABELS: Record<TodoPriorityFilter, string> = {
  all: "All priorities",
  low: "Low",
  medium: "Medium",
  high: "High",
};
