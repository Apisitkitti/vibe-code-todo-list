/**
 * Only the `/todos` copy that more than one file needs, plus the label maps
 * keyed by the domain types in `@/lib/todo`. Everything used in exactly one
 * place is written inline there — the wording still comes from the copy deck
 * in `docs/DESIGN.md` §7.
 */

export * from "./shared";
export * from "./filters";
export * from "./priority";
