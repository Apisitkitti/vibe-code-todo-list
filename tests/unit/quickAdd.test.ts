import { describe, expect, test } from "vitest";

import { parseQuickAdd, type QuickAddTokenKind } from "@/lib/quickAdd";

/**
 * The quick-add parser (PM backlog #1).
 *
 * **The cases that matter most here are the ones where nothing fires.** A
 * parser that lifts a word out of a title the user meant literally is worse
 * than no parser at all (`docs/PM-PROPOSAL.md` §2), and every such failure is
 * silent — the todo saves, the toast says it saved, and the title is simply
 * short by one word. So most of this file asserts that a word stayed in the
 * title, and each of those tests names the rule it is defending.
 *
 * The "must not fire" half is also written to be *mutation-sensitive*, after a
 * review found five surviving mutants in it (MA-4). Loosening a whole-word
 * comparison to `includes`, dropping the `in` anchor, opening the vocabulary,
 * or relaxing the date shape each has a test below that goes red — which is
 * the difference between a test that describes the rule and a test that holds
 * it.
 *
 * `now` is built with the local-time `Date` constructor, the same way
 * `todoListState.test.ts` does it: "tomorrow" is the viewer's calendar day, so
 * an ISO literal would make these pass in UTC and fail from an offset — which
 * is exactly what `TZ=Pacific/Kiritimati` in the suite's own command line
 * exists to catch.
 */

/** Local noon on Monday 17 August 2026. Tomorrow is Tuesday the 18th. */
const NOW = new Date(2026, 7, 17, 12, 0, 0);

const parse = (input: string, release?: readonly QuickAddTokenKind[]) =>
  parseQuickAdd(input, { now: NOW, release });

describe("parseQuickAdd — the PM's example, and the vocabulary", () => {
  test("reads a title, a day and a priority out of one line", () => {
    const result = parse("buy milk tomorrow high");

    expect(result.title).toBe("buy milk");
    expect(result.dueAt).toBe("2026-08-18");
    expect(result.priority).toBe("high");
  });

  test("does not care which of the two trailing words comes first", () => {
    expect(parse("buy milk high tomorrow")).toMatchObject({
      title: "buy milk",
      dueAt: "2026-08-18",
      priority: "high",
    });
  });

  test("today and tonight are both the day the reader is standing in", () => {
    expect(parse("call the vet today").dueAt).toBe("2026-08-17");
    expect(parse("call the vet tonight").dueAt).toBe("2026-08-17");
  });

  test("a weekday name means the next one strictly ahead", () => {
    expect(parse("pay rent friday high")).toMatchObject({
      title: "pay rent",
      dueAt: "2026-08-21",
      priority: "high",
    });
  });

  test("a weekday name on that same weekday means the one coming, not today", () => {
    // NOW is a Monday. `monday` must not quietly mean "today".
    expect(parse("water the plants monday").dueAt).toBe("2026-08-24");
    // And the day just gone is next week's, not last week's.
    expect(parse("water the plants sunday").dueAt).toBe("2026-08-23");
  });

  test("next week is seven days out", () => {
    expect(parse("ship the deck next week")).toMatchObject({
      title: "ship the deck",
      dueAt: "2026-08-24",
    });
  });

  test("in N days counts forward, singular or plural", () => {
    expect(parse("chase the invoice in 3 days").dueAt).toBe("2026-08-20");
    expect(parse("chase the invoice in 1 day").dueAt).toBe("2026-08-18");
  });

  test("an explicit YYYY-MM-DD is taken as written", () => {
    expect(parse("book the flights 2026-12-25")).toMatchObject({
      title: "book the flights",
      dueAt: "2026-12-25",
    });
  });

  test("a priority word is read even when it names the default", () => {
    const result = parse("tidy the garage medium");

    expect(result.title).toBe("tidy the garage");
    expect(result.priority).toBe("medium");
    // The chip has to appear, or "medium" would vanish with nothing to say so.
    expect(result.tokens).toHaveLength(1);
  });

  test("defaults to medium priority and no date when nothing fires", () => {
    expect(parse("buy milk")).toMatchObject({
      title: "buy milk",
      dueAt: "",
      priority: "medium",
      tokens: [],
    });
  });

  test("an empty or blank line parses to nothing at all", () => {
    expect(parse("")).toMatchObject({ title: "", tokens: [] });
    expect(parse("   ")).toMatchObject({ title: "", tokens: [] });
  });

  test("collapses the whitespace a typed line accumulates", () => {
    expect(parse("  buy   milk   tomorrow  ").title).toBe("buy milk");
  });
});

/**
 * Rule 3 — the capital letter is the user saying they meant the word.
 *
 * This reverses the module's first cut, which folded case and would have
 * turned `Black Friday` into `Black` (review MA-1). It is a stronger
 * guarantee than the chips: a capital means the parse never fires, so there is
 * nothing to notice and nothing to undo.
 */
describe("parseQuickAdd — case is a signal, not noise", () => {
  test("a capitalised weekday is part of a name, and stays in the title", () => {
    for (const title of [
      "Casual Friday",
      "Black Friday",
      "Cyber Monday",
      "Palm Sunday",
      "Ash Wednesday",
      "Sunday roast Sunday",
    ]) {
      expect(parse(title), title).toMatchObject({ title, dueAt: "", tokens: [] });
    }
  });

  test("a capitalised day word or priority word is left alone too", () => {
    expect(parse("buy milk Tomorrow")).toMatchObject({
      title: "buy milk Tomorrow",
      dueAt: "",
      tokens: [],
    });
    expect(parse("sing it an octave High")).toMatchObject({
      title: "sing it an octave High",
      priority: "medium",
      tokens: [],
    });
    expect(parse("ship the deck Next Week").dueAt).toBe("");
    expect(parse("chase it In 3 Days").dueAt).toBe("");
  });

  test("shifting one letter is enough to keep the word", () => {
    expect(parse("pay rent friday").dueAt).toBe("2026-08-21");
    expect(parse("pay rent Friday").dueAt).toBe("");
  });
});

describe("parseQuickAdd — where it must NOT fire", () => {
  test("rule 2: a single word is always the title, whatever it says", () => {
    expect(parse("tomorrow")).toMatchObject({
      title: "tomorrow",
      dueAt: "",
      tokens: [],
    });
    expect(parse("high")).toMatchObject({
      title: "high",
      priority: "medium",
      tokens: [],
    });
    expect(parse("2026-12-25")).toMatchObject({
      title: "2026-12-25",
      dueAt: "",
    });
  });

  test("rule 2: consuming never empties the title", () => {
    // Both words are vocabulary. The priority is taken and the scan then stops,
    // because taking the date too would leave a todo with no title.
    const result = parse("tomorrow high");

    expect(result.title).toBe("tomorrow");
    expect(result.dueAt).toBe("");
    expect(result.priority).toBe("high");
  });

  test("rule 2: a multi-word phrase cannot empty the title either", () => {
    // The two- and three-word phrases are where the guard actually bites: a
    // one-word match can only ever be refused by the loop, but `next week` and
    // `in 3 days` on their own would swallow the whole line.
    expect(parse("next week")).toMatchObject({
      title: "next week",
      dueAt: "",
      tokens: [],
    });
    expect(parse("in 3 days")).toMatchObject({
      title: "in 3 days",
      dueAt: "",
      tokens: [],
    });
  });

  test("rule 1: a vocabulary word that is not trailing stays in the title", () => {
    expect(parse("high priority handover")).toMatchObject({
      title: "high priority handover",
      priority: "medium",
      tokens: [],
    });
    expect(parse("tomorrow is the deadline")).toMatchObject({
      title: "tomorrow is the deadline",
      dueAt: "",
      tokens: [],
    });
  });

  test("rule 1: reading stops at the first word that is not vocabulary", () => {
    // `high` is trailing-adjacent but `report` sits between it and the tail.
    expect(parse("write the high report").priority).toBe("medium");
  });

  test("rule 4: a word that merely contains a vocabulary word is not it", () => {
    // Kills a `startsWith`/`includes` mutant on the priority table.
    expect(parse("finish the highlights").priority).toBe("medium");
    expect(parse("sort out the lowlands").priority).toBe("medium");
    // …and on the weekday table, in both directions.
    expect(parse("clear the mondays").dueAt).toBe("");
    expect(parse("survive the fridayest week ever").dueAt).toBe("");
    expect(parse("plan for tomorrows release").dueAt).toBe("");
  });

  test("rule 4: `day` and `days` are whole words too", () => {
    // Kills a `startsWith("day")` mutant on the `in N days` tail.
    expect(parse("chase the invoice in 3 daysx").dueAt).toBe("");
    expect(parse("chase the invoice in 3 daily").dueAt).toBe("");
  });

  test("rule 4: `in N days` needs its `in`", () => {
    // `count the days` passes vacuously — there are no digits — so the anchor
    // has to be tested against a line that has everything *but* the `in`.
    expect(parse("count the 3 days").dueAt).toBe("");
    expect(parse("read 3 days").dueAt).toBe("");
    // And the bare nouns are still not dates.
    expect(parse("count the days").dueAt).toBe("");
    expect(parse("plan the week").dueAt).toBe("");
  });

  /**
   * Rule 4, and the test that actually holds it.
   *
   * **The words below are the ones somebody would plausibly add**, which is
   * the whole point: an earlier version of this test named `urgent`,
   * `someday`, `asap`, `eod`, `critical` and `fortnight`, and a mutation
   * review pointed out that no plausible change adds any of those — so adding
   * `now` to the `today` branch survived with the suite fully green (RM-1).
   * A closure test that only names words nobody would add is not testing
   * closure.
   *
   * Every entry here is either a synonym of something already in the
   * vocabulary, a common abbreviation of it, or the obvious next step someone
   * would reach for. If one of them starts firing, that was a decision, and it
   * should be made in the copy deck and the PRD rather than in a `||`.
   */
  test("rule 4: the vocabulary is closed against the words most likely to be added", () => {
    const NOT_VOCABULARY = [
      // Synonyms and near-neighbours of `today` / `tonight`.
      "now",
      "later",
      "soon",
      "midnight",
      "noon",
      "immediately",
      // Abbreviations of things that *are* vocabulary.
      "tonite",
      "tmrw",
      "tmr",
      "mon",
      "tue",
      "wed",
      "thu",
      "fri",
      "sat",
      "sun",
      // Horizons the vocabulary deliberately does not cover.
      "weekend",
      "yesterday",
      "overmorrow",
      "eod",
      "eow",
      "asap",
      "someday",
      "fortnight",
      // Priority synonyms and shorthands.
      "urgent",
      "important",
      "normal",
      "critical",
      "blocker",
      "trivial",
      "hi",
      "lo",
      "med",
      "p1",
      "p2",
      "p3",
      "highest",
      "lowest",
    ];

    for (const word of NOT_VOCABULARY) {
      const input = `finish it ${word}`;

      expect(parse(input), input).toMatchObject({
        title: input,
        dueAt: "",
        priority: "medium",
        tokens: [],
      });
    }
  });

  test("rule 4: the multi-word phrases are closed too", () => {
    // `next week` is vocabulary; nothing else beginning `next` or `this` is,
    // and `in N days` does not generalise to other units.
    for (const phrase of [
      "next month",
      "next year",
      "next friday",
      "this week",
      "this month",
      "in a week",
      "in 2 weeks",
      "in 2 months",
      "in 48 hours",
    ]) {
      const input = `ship the deck ${phrase}`;

      expect(parse(input), input).toMatchObject({ title: input, dueAt: "" });
    }
  });

  test("rule 4: the `in N days` horizon has an exact edge", () => {
    // 365 is the last day that counts as a horizon rather than a date.
    expect(parse("renew the lease in 365 days").dueAt).toBe("2027-08-17");
    expect(parse("renew the lease in 366 days").dueAt).toBe("");
  });

  test("rule 4: the date shape is exact, not merely date-ish", () => {
    // Kills a mutant that drops strict parsing or loosens the format.
    expect(parse("ship it 2026-1-5").dueAt).toBe("");
    expect(parse("ship it 26-01-05").dueAt).toBe("");
    expect(parse("ship it 20261225").dueAt).toBe("");
    expect(parse("ship it 12-25-2026").dueAt).toBe("");
    expect(parse("ship it 2026/12/25").dueAt).toBe("");
  });

  test("rule 4: a date that does not exist stays a word", () => {
    // Strict parsing, like `parseDueDate`: February has no 31st, and rolling
    // it over to March would be the parser inventing a due date.
    expect(parse("file the return 2026-02-31")).toMatchObject({
      title: "file the return 2026-02-31",
      dueAt: "",
    });
  });

  test("rule 4: punctuation stuck to the word makes it a different word", () => {
    expect(parse("buy milk tomorrow!")).toMatchObject({
      title: "buy milk tomorrow!",
      dueAt: "",
    });
  });

  test("rule 4: in N days is digits only", () => {
    expect(parse("chase the invoice in three days").dueAt).toBe("");
    expect(parse("chase the invoice in a few days").dueAt).toBe("");
  });

  test("only one date and one priority are ever taken", () => {
    // The second `tomorrow` is read; the first is a word in the title.
    expect(parse("review tomorrow tomorrow")).toMatchObject({
      title: "review tomorrow",
      dueAt: "2026-08-18",
    });
    expect(parse("triage low high")).toMatchObject({
      title: "triage low",
      priority: "high",
    });
  });
});

describe("parseQuickAdd — the tokens, and keeping the text", () => {
  test("reports what it took, in the order the words appear", () => {
    const { tokens } = parse("buy milk tomorrow high");

    expect(tokens.map((token) => token.kind)).toEqual(["due", "priority"]);
    expect(tokens.map((token) => token.text)).toEqual(["tomorrow", "high"]);
  });

  test("the token carries the words exactly as typed, for putting them back", () => {
    expect(parse("chase it in 3 days").tokens[0].text).toBe("in 3 days");
    expect(parse("ship the deck next week").tokens[0].text).toBe("next week");
  });

  test("labels read in the same words the row does", () => {
    expect(parse("buy milk tomorrow high").tokens.map((t) => t.label)).toEqual([
      "Due Tomorrow",
      "High priority",
    ]);
    expect(parse("book the flights 2026-12-25").tokens[0].label).toBe(
      "Due Dec 25",
    );
  });

  test("releasing the date puts the word back and leaves the priority alone", () => {
    // The case the chips exist for: "tomorrow" is trailing and is meant
    // literally, so rule 2 cannot save it and the user has to be able to.
    expect(parse("Call mum about tomorrow", ["due"])).toMatchObject({
      title: "Call mum about tomorrow",
      dueAt: "",
      tokens: [],
    });

    expect(parse("Call mum about tomorrow high", ["due"])).toMatchObject({
      title: "Call mum about tomorrow",
      dueAt: "",
      priority: "high",
    });
  });

  /**
   * Review B-1. A released kind used to be *skipped* rather than stepped over,
   * so the scan stopped at the unconsumed word and everything to its left
   * became unreachable — releasing the date silently reverted the priority to
   * medium and took its chip with it. Both orders are asserted, because the
   * first version of this test passed only because its fixture happened to put
   * the priority last.
   */
  test("releasing one kind never costs the other, in either word order", () => {
    expect(parse("Call mum about high tomorrow", ["due"])).toMatchObject({
      title: "Call mum about tomorrow",
      dueAt: "",
      priority: "high",
    });

    expect(parse("Call mum about tomorrow high", ["due"])).toMatchObject({
      title: "Call mum about tomorrow",
      dueAt: "",
      priority: "high",
    });

    // The surviving reading still reports itself, or the chip would vanish.
    expect(
      parse("Call mum about high tomorrow", ["due"]).tokens.map((t) => t.kind),
    ).toEqual(["priority"]);
  });

  /**
   * Review RB-1, and the other direction of the same guarantee: a release must
   * never make the parser take *more* than it took before.
   *
   * **These fixtures are all-vocabulary on purpose.** Rule 2 is the only brake
   * on such a line, and the bug was that a stepped-over run still counted
   * toward rule 2's budget — so releasing one kind freed a lift the unreleased
   * parse had refused. The test above this one could not see it: three
   * non-vocabulary words in front of the vocabulary leave the budget so slack
   * that nothing is ever refused.
   */
  test("a release never lets the parser take more than it already had", () => {
    // Unreleased, rule 2 stops after the date.
    expect(parse("high tomorrow")).toMatchObject({
      title: "high",
      dueAt: "2026-08-18",
      priority: "medium",
    });

    // Pressing "keep tomorrow in the title" must give exactly that — not a
    // todo titled `tomorrow` that has swallowed `high` on the way past.
    expect(parse("high tomorrow", ["due"])).toMatchObject({
      title: "high tomorrow",
      dueAt: "",
      priority: "medium",
      tokens: [],
    });

    // Symmetric, with the kinds the other way round.
    expect(parse("friday high")).toMatchObject({
      title: "friday",
      priority: "high",
      dueAt: "",
    });
    expect(parse("friday high", ["priority"])).toMatchObject({
      title: "friday high",
      dueAt: "",
      priority: "medium",
      tokens: [],
    });
  });

  test("the words a release hands back are never spent on something else", () => {
    // Three words, all vocabulary. `in 3 days` is a three-word run, so
    // releasing it must not then fund lifting `high` out of a one-word title.
    expect(parse("high in 3 days", ["due"])).toMatchObject({
      title: "high in 3 days",
      dueAt: "",
      priority: "medium",
      tokens: [],
    });

    // And with one word to spare, the lift is allowed again.
    expect(parse("ship high in 3 days", ["due"])).toMatchObject({
      title: "ship in 3 days",
      dueAt: "",
      priority: "high",
    });
  });

  test("releasing the priority puts that word back and leaves the date alone", () => {
    expect(parse("rate the risk as high tomorrow", ["priority"])).toMatchObject({
      title: "rate the risk as high",
      dueAt: "2026-08-18",
      priority: "medium",
    });

    expect(parse("rate the risk as tomorrow high", ["priority"])).toMatchObject({
      title: "rate the risk as high",
      dueAt: "2026-08-18",
      priority: "medium",
    });
  });

  test("a released run is stepped over, so reading continues past it", () => {
    // Without the step-over the scan would stop dead at `tomorrow` and never
    // reach `high` at all.
    const stepped = parse("plan the week tomorrow high", ["due"]);

    expect(stepped.title).toBe("plan the week tomorrow");
    expect(stepped.priority).toBe("high");
  });

  test("releasing both is the same as not parsing at all", () => {
    expect(parse("buy milk tomorrow high", ["due", "priority"])).toMatchObject({
      title: "buy milk tomorrow high",
      dueAt: "",
      priority: "medium",
      tokens: [],
    });
  });

  test("releasing a kind that did not fire changes nothing", () => {
    expect(parse("buy milk tomorrow", ["priority"])).toMatchObject({
      title: "buy milk",
      dueAt: "2026-08-18",
    });
  });
});
