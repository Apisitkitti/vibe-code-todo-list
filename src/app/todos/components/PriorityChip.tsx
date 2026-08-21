import { Chip } from "@heroui/react";

import { PRIORITY_FILTER_LABELS, PRIORITY_GLYPHS } from "@/app/todos/constants";
import type { TodoPriority } from "@/lib/todo";

/**
 * Only `High` is loud, and the untriaged default draws nothing at all
 * (`docs/DESIGN.md` §8.4.2, §4.4).
 *
 * `medium` is the schema default, so it is not a level anyone chose — it is the
 * level a todo has when nobody has triaged it. A twenty-row list drew twenty
 * chips, most of them `■ Medium`, and the chip was the *widest* element in the
 * metadata cluster while reporting an absence of information. It is gone;
 * Todoist's P4 is the reference and makes the same argument.
 *
 * `low` keeps `tertiary` rather than going with it, because a deliberate
 * down-rank *is* information. `high` keeps `soft` + `danger`.
 *
 * The colour goes with the variant for `low`, and that is not an extra liberty
 * — `chip--tertiary` sets only `--chip-bg: transparent`
 * (`@heroui/styles/dist/components/chip.css`), while `--chip-fg` still comes
 * from the *colour* class. `variant="tertiary" color="warning"` is therefore
 * orange text with the fill taken away, which is louder against a quiet row,
 * not quieter. `default` is the only pairing that makes the chip recede.
 */
const PRIORITY_CHIP_STYLES: Record<
  Exclude<TodoPriority, "medium">,
  { color: "danger" | "default"; variant: "soft" | "tertiary" }
> = {
  high: { color: "danger", variant: "soft" },
  low: { color: "default", variant: "tertiary" },
};

export interface PriorityChipProps {
  priority: TodoPriority;
}

export const PriorityChip = ({ priority }: PriorityChipProps) => {
  const label = PRIORITY_FILTER_LABELS[priority];

  /*
    The default level: no chip, and the accessible content unchanged.

    §6.4 asks for the word plus the shape glyph wherever a priority is *drawn*,
    and this level is no longer drawn — so the announcement has to carry it
    alone, byte-for-byte as the chip published it (`Priority: ` + the label).
    A sighted user infers `Medium` from absence, exactly as a Todoist user
    infers P4 from an absent flag; a screen-reader user meets the row's
    metadata as a sequence of announcements and cannot perceive absence the
    same way — a row that simply stopped mentioning priority would be
    indistinguishable from one whose priority failed to render. §4.4 carries
    the whole trade.

    Rendered here rather than in `TodoRow` — which is where §4.4's first draft
    put it — so the level's own component stays the only file that knows which
    levels draw, and so the string is still built from `PRIORITY_FILTER_LABELS`
    rather than hard-coded at a second site. The DOM is identical either way.

    `sr-only` is `position: absolute`, so this contributes no width and no
    `gap-2` step to the metadata cluster: the row's right edge is unmoved, which
    is the §1 reflow promise `e2e/row-layout.spec.ts` measures.
  */
  if (priority === "medium") {
    return <span className="sr-only">{`Priority: ${label}`}</span>;
  }

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
