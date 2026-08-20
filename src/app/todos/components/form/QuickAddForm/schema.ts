import { z } from "zod";

/**
 * The quick-add bar's own shape: one line of raw text.
 *
 * It validates only what it can validate *about the raw string* — that
 * something was typed. Everything else is a claim about the todo the text
 * parses into, not about the text, so the bar re-parses its result through
 * `todoFormSchema` from `@/lib/todo.schema` before it calls the API. That is
 * deliberate: the title's rules live in one schema, the one the route handler
 * re-parses with, and the bar borrows them rather than restating them at a
 * second length.
 *
 * **It lives here, beside the form, because nothing else parses with it.** No
 * route handler ever sees a `{ text }` body — the bar turns its line into a
 * todo payload and posts *that*, so this schema is UX and only UX. The
 * opposite case is `todoFormSchema`, which the handlers under
 * `src/app/api/todos` re-parse and which therefore stays in `src/lib`, out of
 * reach of the rule that forbids `src/app/api/**` importing `@/app/**`.
 */
export const quickAddSchema = z.object({
  text: z.string("Enter a title.").trim().min(1, "Enter a title."),
});

export type QuickAddValues = z.infer<typeof quickAddSchema>;
