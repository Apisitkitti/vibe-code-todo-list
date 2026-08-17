import { describe, expect, test } from "vitest";

import { createHandoff } from "@/lib/handoff";

/**
 * The `More options` handoff (QA DEF-23, Senior F5/F6).
 *
 * Both failure modes here are invisible from the outside, which is why they
 * are pinned at this level rather than through the screen. A promise that
 * answers twice keeps its first value silently; one that never answers leaves
 * the quick-add bar's `await` suspended for the life of the page, and from the
 * user's side that looks exactly like a dismissal — the bar keeps its text
 * either way. The e2e suite can only see the outcome, so it cannot tell a
 * handoff that was answered `false` from one that was dropped on the floor.
 */
describe("createHandoff", () => {
  test("resolves with the answer it is given", async () => {
    const handoff = createHandoff<boolean>();
    const asked = handoff.ask(false);

    expect(handoff.answer(true)).toBe(true);
    await expect(asked).resolves.toBe(true);
  });

  test("a dismissal is an answer, not an absence of one", async () => {
    const handoff = createHandoff<boolean>();
    const asked = handoff.ask(false);

    handoff.answer(false);

    await expect(asked).resolves.toBe(false);
  });

  /**
   * The guard the screen relies on: the modal's save path answers
   * synchronously, and the effect watching the dialog close then answers
   * again. Only the first is real, or a save would be reported as a dismissal
   * one frame later and the bar would never clear.
   */
  test("answers once — a second answer is refused and changes nothing", async () => {
    const handoff = createHandoff<boolean>();
    const asked = handoff.ask(false);

    expect(handoff.answer(true)).toBe(true);
    expect(handoff.answer(false)).toBe(false);
    expect(handoff.answer(false)).toBe(false);

    await expect(asked).resolves.toBe(true);
  });

  test("answering nothing is a no-op that says so", () => {
    const handoff = createHandoff<boolean>();

    expect(handoff.answer(true)).toBe(false);
  });

  /**
   * Senior F5. Asking again used to overwrite the outstanding resolver, which
   * left the first opener awaiting a promise nothing could ever settle. The
   * superseded question is answered rather than abandoned.
   */
  test("asking again releases the opener still waiting", async () => {
    const handoff = createHandoff<boolean>();
    const first = handoff.ask(false);
    const second = handoff.ask(false);

    await expect(first).resolves.toBe(false);

    expect(handoff.answer(true)).toBe(true);
    await expect(second).resolves.toBe(true);
  });

  test("a fresh question is answerable after the last one was settled", async () => {
    const handoff = createHandoff<boolean>();

    handoff.answer(true);

    const asked = handoff.ask(false);

    expect(handoff.answer(true)).toBe(true);
    await expect(asked).resolves.toBe(true);
  });
});
