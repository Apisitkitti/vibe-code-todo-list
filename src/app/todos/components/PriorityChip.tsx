import { Chip } from "@heroui/react";

import { PRIORITY_FILTER_LABELS, PRIORITY_GLYPHS } from "@/app/todos/constants";
import type { TodoPriority } from "@/lib/todo";

/**
 * Only `High` is loud (`docs/DESIGN.md` §8.4.2).
 *
 * `medium` is the schema default, so a real list was a column of near-identical
 * warning-tinted `soft` chips and `High` had nothing to stand out against.
 * `low` and `medium` drop to `tertiary`; `high` keeps `soft` + `danger`.
 *
 * The colour goes with the variant for `medium`, and that is not an extra
 * liberty — `chip--tertiary` sets only `--chip-bg: transparent`
 * (`@heroui/styles/dist/components/chip.css`), while `--chip-fg` still comes
 * from the *colour* class. `variant="tertiary" color="warning"` is therefore
 * orange text with the fill taken away, which is louder against a quiet row,
 * not quieter. `default` is the only pairing that makes the chip recede.
 *
 * Colour was never carrying the meaning and still is not: the word
 * (`High`/`Medium`/`Low`) and the shape glyph (`▲`/`■`/`▼`) are untouched, so
 * §6.4 holds exactly as written.
 */
const PRIORITY_CHIP_STYLES: Record<
  TodoPriority,
  { color: "danger" | "default"; variant: "soft" | "tertiary" }
> = {
  high: { color: "danger", variant: "soft" },
  medium: { color: "default", variant: "tertiary" },
  low: { color: "default", variant: "tertiary" },
};

export interface PriorityChipProps {
  priority: TodoPriority;
}

export const PriorityChip = ({ priority }: PriorityChipProps) => {
  const label = PRIORITY_FILTER_LABELS[priority];
  const { color, variant } = PRIORITY_CHIP_STYLES[priority];

  return (
    <Chip color={color} variant={variant} size="sm">
      <Chip.Label>
        <span aria-hidden="true" className="mr-1">
          {PRIORITY_GLYPHS[priority]}
        </span>
        <span className="sr-only">Priority: </span>
        {label}
      </Chip.Label>
    </Chip>
  );
};
