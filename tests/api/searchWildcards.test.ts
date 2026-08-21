import { afterAll, beforeAll, describe, expect, test, vi } from "vitest";

import {
  currentRequestHeaders,
  headersWithCookie,
  setRequestHeaders,
} from "../support/headers";

vi.mock("next/headers", () => ({
  headers: async () => currentRequestHeaders(),
}));

import { GET } from "@/app/api/todos/route";

import {
  createTestUser,
  createTodo,
  deleteTestUsers,
  type TestUser,
} from "../support/factory";
import { getRequest, readList } from "../support/request";

/**
 * What `%`, `_` and `\` mean when a user types them into the search box.
 *
 * `GET /api/todos` searches with Prisma's `contains` + `mode: "insensitive"`,
 * which compiles to `ILIKE '%' || $1 || '%'`. Parameterising `$1` stops SQL
 * injection; it does **not** stop LIKE pattern metacharacters, because those
 * are interpreted by `ILIKE` *after* the parameter is bound. So the question
 * "are `%` and `_` literal characters or wildcards?" cannot be answered from
 * the Prisma types — only from the database — and it is answered here, against
 * the real Postgres the app runs on.
 *
 * The answer must be **literal**. A search box takes a search term, not a
 * pattern: a user typing `50%` is looking for a discount, and a user typing
 * `a_b` is looking for `a_b`. Treating them as wildcards is a defect with two
 * separate harms — it returns rows the term does not appear in, and a bare `%`
 * matches the entire account — and it also silently desynchronises the server
 * from `todoMatchesFilters` (`src/lib/todoListState.ts`), which mirrors this
 * predicate on the client with JavaScript's `includes` and has always been
 * literal. That predicate is what tells a user their new todo is *hidden by
 * your filters*, so the two disagreeing makes that sentence a lie.
 *
 * Each case below pairs a row containing the character **literally** with a
 * decoy that only matches if the character is a wildcard. The decoy is what
 * makes the test able to fail in the wildcard direction rather than merely
 * assert that the obvious row comes back.
 */

const EMAIL_DOMAIN = "@search-wildcards.test";

let owner: TestUser;

const asOwner = () => setRequestHeaders(headersWithCookie(owner.cookie));

/** The literal-match row, then the row only a wildcard reading reaches. */
const PERCENT_LITERAL = "50% off milk";
const PERCENT_DECOY = "50 things to sell off";

const UNDERSCORE_LITERAL = "plan a_b review";
const UNDERSCORE_DECOY = "plan axb review";

/**
 * `\` is LIKE's default escape character in Postgres, so it is the third
 * metacharacter and not a bystander: any fix that escapes `%` and `_` with a
 * backslash has to escape the backslash itself first, or a user's own `\`
 * starts escaping the character after it.
 */
const BACKSLASH_LITERAL = "notes in C:\\temp folder";
const BACKSLASH_DECOY = "notes in C:temp folder";

/**
 * Two metacharacters in one term, which is the case every fixture above
 * misses: each of them carries exactly one, so a fix that escapes only the
 * first occurrence — or only the last — passes all of them.
 *
 * That is not a hypothetical mutation. `LIKE_METACHARACTERS` is a *global*
 * regex, and the module's own comment argues at length for the single pass
 * precisely because of how two metacharacters interact: a second pass "would
 * revisit the backslashes the first pass had just introduced and turn `\%`
 * into `\\%`, a literal backslash followed by a live wildcard". The whole
 * argument is about terms this file never built. Dropping the `g` (audit A9)
 * or escaping only the last match (A9b) both survived.
 *
 * Each pair below is a literal row plus a decoy that only a *partly* escaped
 * term reaches, and the two decoys are chosen so that one catches each
 * direction:
 *
 *  - `50%Zoff later` — reachable only if `%` was escaped and `_` was not, so
 *    `_` is standing for `Z`. That is "first match only".
 *  - `50 cents _off` — reachable only if `_` was escaped and `%` was not, so
 *    `%` is standing for ` cents `. That is "last match only".
 */
const MULTI_LITERAL = "50%_off today";
const MULTI_DECOY_TRAILING_LIVE = "50%Zoff later";
const MULTI_DECOY_LEADING_LIVE = "50 cents _off";

/**
 * The backslash paired with a wildcard, which is the exact interaction the
 * single-pass design is defending. `C:\%temp` half-escaped reads as a literal
 * `C:\` followed by a live `%`, so it matches any path that starts `C:\` and
 * later contains `temp` — including `BACKSLASH_LITERAL` above, which is why
 * this one is caught twice over.
 */
const MULTI_BACKSLASH_LITERAL = "disk C:\\%temp files";
const MULTI_BACKSLASH_DECOY = "disk C:\\oldtemp files";

/** Nothing about these should be reachable by a pattern in the search box. */
const PLAIN_ROWS = ["Buy milk", "Call the vet", "Water the plants"];

const SEEDS = [
  PERCENT_LITERAL,
  PERCENT_DECOY,
  UNDERSCORE_LITERAL,
  UNDERSCORE_DECOY,
  BACKSLASH_LITERAL,
  BACKSLASH_DECOY,
  MULTI_LITERAL,
  MULTI_DECOY_TRAILING_LIVE,
  MULTI_DECOY_LEADING_LIVE,
  MULTI_BACKSLASH_LITERAL,
  MULTI_BACKSLASH_DECOY,
  ...PLAIN_ROWS,
];

/**
 * The `OR` has two arms and they are two separate call sites, so the note arm
 * needs its own literal/decoy pair rather than a re-run of the title's. The
 * metacharacter sits **mid-term** deliberately: a trailing `%` is a trailing
 * wildcard on a `contains` that already ends in one, so it changes no match
 * set and a test built on it cannot tell an escaped arm from a raw one.
 *
 * `q_r` is used rather than the title pair's `a_b` so the two arms' cases
 * cannot mask each other.
 */
const NOTED_TITLE = "Quarterly numbers";
const NOTED_NOTE = "margin q_r held at 50%";
const NOTED_DECOY_TITLE = "Spending review";
const NOTED_DECOY_NOTE = "margin qxr held at 50";

const titlesMatching = async (query: string): Promise<string[]> => {
  const params = new URLSearchParams({
    status: "all",
    priority: "all",
    query,
  });
  const response = await GET(getRequest(`/api/todos?${params.toString()}`));

  expect(response.status).toBe(200);

  return (await readList(response)).todos.map((todo) => todo.title).sort();
};

beforeAll(async () => {
  await deleteTestUsers(EMAIL_DOMAIN);
  owner = await createTestUser(`owner${EMAIL_DOMAIN}`);
  asOwner();

  for (const title of SEEDS) {
    await createTodo(owner.id, { title });
  }

  await createTodo(owner.id, { title: NOTED_TITLE, note: NOTED_NOTE });
  await createTodo(owner.id, {
    title: NOTED_DECOY_TITLE,
    note: NOTED_DECOY_NOTE,
  });
});

afterAll(async () => {
  await deleteTestUsers(EMAIL_DOMAIN);
});

describe("search treats LIKE metacharacters as literal text", () => {
  test("`%` matches a percent sign, not any run of characters", async () => {
    /*
      Read as a pattern this is `%50% off%` — "50", anything at all, " off" —
      which reaches the decoy. Read as text it is the four characters the user
      typed, which reaches only the row that contains them.
    */
    expect(await titlesMatching("50% off")).toEqual([PERCENT_LITERAL]);
  });

  test("a search that is only `%` matches only the rows containing one", async () => {
    /*
      The sharpest form of the same defect: read as a pattern, `%%%` is the
      whole account. Read as text it is one character, and only the rows that
      carry it come back — one of them in its note rather than its title.

      The list is spelled out rather than derived from `SEEDS`, deliberately.
      Deriving it would make this case agree with whatever the fixtures happen
      to contain, which is the shape of assertion that cannot fail; enumerating
      it means adding a row carrying `%` has to come past this line. It did:
      the three multi-metacharacter rows below were added by the §2.6 work and
      this expectation went red, which is the assertion doing its job.
    */
    expect(await titlesMatching("%")).toEqual(
      [
        PERCENT_LITERAL,
        NOTED_TITLE,
        MULTI_LITERAL,
        MULTI_DECOY_TRAILING_LIVE,
        MULTI_BACKSLASH_LITERAL,
      ].sort(),
    );
  });

  test("`_` matches an underscore, not any single character", async () => {
    expect(await titlesMatching("a_b")).toEqual([UNDERSCORE_LITERAL]);
  });

  test("a backslash matches a backslash rather than escaping what follows", async () => {
    expect(await titlesMatching("C:\\temp")).toEqual([BACKSLASH_LITERAL]);
  });

  test("the note arm reads the term the same way the title arm does", async () => {
    /*
      The `OR` has two branches and escaping only one of them passes every
      case above — a mutant that was watched surviving before this test was
      tightened. `q_r` appears in no title at all, so this reaches the note
      arm and nothing else, and the decoy note beside it differs only in the
      character `_` would stand for.
    */
    expect(await titlesMatching("q_r")).toEqual([NOTED_TITLE]);
  });

  /**
   * Every case above carries one metacharacter, so all of them pass a fix that
   * escapes only the first occurrence or only the last. These two are the
   * cases that tell those apart.
   */
  test("two metacharacters in one term are both escaped, not just one of them", async () => {
    expect(await titlesMatching("50%_off")).toEqual([MULTI_LITERAL]);
  });

  test("a backslash beside a wildcard is escaped without freeing the wildcard", async () => {
    expect(await titlesMatching("C:\\%temp")).toEqual([MULTI_BACKSLASH_LITERAL]);
  });

  /**
   * The control the two above need: the decoys are genuinely in the account
   * and genuinely findable, so an empty-handed result from a partly escaped
   * term would not be mistaken for a passing assertion.
   */
  test("both decoys are really there, so the two cases above are not vacuous", async () => {
    expect(await titlesMatching("50%Zoff")).toEqual([MULTI_DECOY_TRAILING_LIVE]);
    expect(await titlesMatching("cents _off")).toEqual([MULTI_DECOY_LEADING_LIVE]);
    expect(await titlesMatching("oldtemp")).toEqual([MULTI_BACKSLASH_DECOY]);
  });

  test("ordinary searches are unaffected", async () => {
    expect(await titlesMatching("milk")).toEqual(
      [PERCENT_LITERAL, "Buy milk"].sort(),
    );
    expect(await titlesMatching("plan a")).toEqual(
      [UNDERSCORE_DECOY, UNDERSCORE_LITERAL].sort(),
    );
  });
});
