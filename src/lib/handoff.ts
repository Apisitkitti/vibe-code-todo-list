/**
 * A question asked across a UI boundary, and its one answer.
 *
 * The quick-add bar hands its text to the modal and has to know how that modal
 * ended: a save clears the bar, a dismissal leaves every character where it is
 * (QA DEF-23). The bar cannot see the dialog and the list cannot see the field,
 * so the answer travels as a promise the opener awaits.
 *
 * **The invariant is that it answers exactly once.** A promise that resolves
 * twice silently keeps its first value, and one that never resolves leaves the
 * awaiting handler suspended forever — neither shows up at the call site, so
 * both are stated here and pinned in `tests/unit/handoff.test.ts` rather than
 * left to the components to get right. `ask` supersedes an outstanding question
 * rather than overwriting it (Senior F5), because dropping the resolver is the
 * "never resolves" case wearing a different hat.
 */
export interface Handoff<T> {
  /**
   * Asks, and answers any question still outstanding with `superseded` first —
   * so an opener that never heard back is released rather than abandoned.
   */
  ask: (superseded: T) => Promise<T>;
  /**
   * Answers the outstanding question. Returns whether there was one, which is
   * what makes this usable as a guard: only the first of two answers is real.
   */
  answer: (value: T) => boolean;
}

export const createHandoff = <T,>(): Handoff<T> => {
  let pending: ((value: T) => void) | null = null;

  const answer = (value: T) => {
    const resolve = pending;

    /*
      Cleared before resolving, and this ordering is hygiene rather than a
      guard. It used to say it stopped "a continuation that asks again during
      its own resolution being answered by the call it is still inside", which
      describes something that cannot happen: `resolve()` settles the promise
      and queues its continuations as microtasks, so nothing awaiting this
      handoff runs before `answer` has returned, and `pending` is already
      `null` by then either way.

      Established by execution, not by reading: the mutation audit reported
      the swapped ordering as a surviving mutant (H1) and proposed a
      re-entrancy test to close it. That test was written, and the swapped
      ordering still passed the whole suite — twice, with the comment left in
      and taken out. It is an equivalent mutant, so there is deliberately no
      test below pinning the order; a test that cannot fail is worse than none.

      The order is kept because reading `pending` between the two lines would
      be a latent trap if this ever gained a synchronous callback, and because
      "clear the slot, then hand over" is the honest reading order.
    */
    pending = null;
    resolve?.(value);

    return resolve !== null;
  };

  const ask = (superseded: T) => {
    answer(superseded);

    return new Promise<T>((resolve) => {
      pending = resolve;
    });
  };

  return { ask, answer };
};
