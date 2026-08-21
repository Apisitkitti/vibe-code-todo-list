/** Strings rendered by more than one file. Single-use copy is inlined at the
 *  point of use instead. */

/** The list screen's heading, mirrored by the loading skeleton. */
export const PAGE_HEADING = "Your todos";

/** Form modal footer and any future dialog that dismisses without acting. */
export const CANCEL_LABEL = "Cancel";

/** The list's load-failure retry and the route error boundary. */
export const TRY_AGAIN_LABEL = "Try again";

/**
 * The one worked example of the quick-add vocabulary (`docs/DESIGN.md` §7.17,
 * §7.7).
 *
 * Two places show it: the bar's own placeholder, and the never-used empty
 * state's syntax line. It is a constant rather than a string written twice
 * because those two are the only teaching this feature does and they must not
 * teach two different examples — a user who reads `pay rent friday high` on the
 * empty screen and then meets a different example in the bar has been given two
 * vocabularies for one parser.
 *
 * The sentences around it stay at their own call sites, single-use copy, and
 * are deliberately phrased so that changing this example does not make either
 * of them false.
 */
export const QUICK_ADD_EXAMPLE = "pay rent friday high";
