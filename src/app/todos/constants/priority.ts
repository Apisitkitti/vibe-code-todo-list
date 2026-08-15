import type { TodoPriority } from "@/lib/todo";

/** Colour never carries the meaning alone (`docs/DESIGN.md` §4.4, §6.4). */
export const PRIORITY_GLYPHS: Record<TodoPriority, string> = {
  high: "▲",
  medium: "■",
  low: "▼",
};
