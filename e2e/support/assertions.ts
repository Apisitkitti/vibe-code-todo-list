import { expect, type Locator, type Page, type Route } from "@playwright/test";

import { AXIOS_LEAK_PATTERNS } from "./copy";

/**
 * Shared assertions and fault injectors.
 *
 * The fault injectors deliberately fulfil rather than abort where the point is
 * a server error, and abort where the point is a transport failure — the two
 * take different branches through `getErrorMessage` and the difference is the
 * whole subject of the fault-injection spec.
 */

/** The API's own error body: `{ code, message }` per `src/lib/apiError.ts`. */
export const apiErrorBody = (code: string, message: string) =>
  JSON.stringify({ code, message });

/**
 * A 500 that still speaks the API's contract. `getErrorMessage` reads
 * `response.data.message`, so this is what the user ends up reading.
 */
export const fulfilApiError = async (
  route: Route,
  status: number,
  code: string,
  message: string,
) => {
  await route.fulfill({
    status,
    contentType: "application/json",
    body: apiErrorBody(code, message),
  });
};

/**
 * A 500 that does NOT speak the contract — an HTML error page from a proxy or
 * load balancer, which is what a real outage usually looks like from the
 * browser. There is no `message` to read, so `getErrorMessage` must fall
 * through to the caller's copy-deck fallback. This is the case that would
 * expose a raw axios string if the fallback were ever removed.
 */
export const fulfilOpaqueError = async (route: Route, status: number) => {
  await route.fulfill({
    status,
    contentType: "text/html",
    body: "<html><body>502 Bad Gateway</body></html>",
  });
};

/**
 * Asserts that nothing the user can read is transport noise. `getErrorMessage`
 * exists precisely to keep axios's own `message` ("Request failed with status
 * code 500", "Network Error") off the screen, and this is the assertion that
 * proves it still does.
 */
export const expectNoTransportLeak = async (locator: Locator) => {
  const texts = await locator.allInnerTexts();
  const joined = texts.join("\n");

  for (const pattern of AXIOS_LEAK_PATTERNS) {
    expect(
      joined,
      `raw transport text leaked to the user: ${pattern}`,
    ).not.toMatch(pattern);
  }
};

/**
 * Point-in-time check that nothing on screen is claiming success.
 *
 * This MUST NOT be written as `await expect(toasts.filter(...)).toHaveCount(0)`.
 * That assertion retries, and HeroUI toasts self-expire after four seconds
 * (`DEFAULT_TOAST_TIMEOUT`, never overridden by the app), so a retrying
 * "count is zero" sits and watches a false success toast expire and then
 * reports a pass. Demonstrated in review: making a failed toggle also raise
 * its success toast — the app lying to the user — left the retrying form green
 * and merely slower, 6.5s instead of 2.3s.
 *
 * Reading once, after the failure has already been asserted and the durable
 * state has settled, is what makes the absence mean "it never appeared"
 * instead of "it is not here any more".
 */
export const expectNoFalseSuccess = async (
  toasts: Locator,
  ...forbidden: string[]
) => {
  const onScreen = (await toasts.allInnerTexts()).join("\n");

  for (const message of forbidden) {
    expect(
      onScreen,
      `a failed mutation reported success: "${message}"`,
    ).not.toContain(message);
  }
};

/**
 * The same one-shot read for anything else whose absence is the assertion.
 * Retrying would again let a briefly-present element pass as never-present.
 */
export const expectAbsentNow = async (locator: Locator, reason: string) => {
  expect(await locator.count(), reason).toBe(0);
};

/**
 * Counts requests without changing them. Used to prove a press produced
 * exactly one request — the double-press guard's actual contract.
 */
export interface RequestCounter {
  get count(): number;
}

export const countRequests = (page: Page, match: RegExp, method: string): RequestCounter => {
  let count = 0;

  page.on("request", (request) => {
    if (request.method() === method && match.test(request.url())) count += 1;
  });

  return {
    get count() {
      return count;
    },
  };
};

/**
 * The largest box a visually-hidden element may paint.
 *
 * Tailwind's `sr-only` is `position: absolute` at `width: 1px; height: 1px`
 * with `clip-path: inset(50%)` — so 1px is the value, not a tolerance.
 * Anything larger is on screen.
 */
export const SR_ONLY_MAX_PX = 1;

/**
 * How a word is presented, which is three independent properties and not one.
 *
 * The e2e mutation audit found four survivors (`P1`, `B3`, `D1`, `D3`) that all
 * come apart here, because every assertion the suite had — `toContainText`,
 * `getByText`, element counts, resolved colour — reads only the first of the
 * three:
 *
 * 1. **the text is in the DOM** — what `textContent` sees;
 * 2. **the text occupies layout** — what a bounding box sees;
 * 3. **the text reaches the accessibility tree** — what a screen reader sees.
 *
 * `sr-only` removes (2) and keeps (1) and (3). `aria-hidden` removes (3) and
 * keeps (1) and (2). Neither moves `textContent` by a byte, which is why
 * `P1` survived 104 tests and `B3` survived 51. Playwright's `toBeHidden` is no
 * help either: an `sr-only` element has a non-empty 1×1 box and reports
 * visible.
 *
 * So a caller names which of these it means, and means exactly one:
 */
export type Presentation =
  /** Drawn on screen and announced. The default for anything §6.4 calls a word. */
  | "visible"
  /**
   * Announced but not drawn — the `sr-only` announcement that carries a level
   * or a state for a screen-reader user which a sighted user infers from the
   * visual treatment.
   */
  | "screen-reader-only"
  /**
   * Drawn but not announced — an `aria-hidden` glyph that duplicates, in ink, a
   * word carried elsewhere. `TodoDueDate`'s `⚠` and the priority glyphs are
   * these: they must paint, and they must *not* be read out a second time.
   */
  | "decorative";

interface WordingCarrier {
  text: string;
  tag: string;
  className: string;
  width: number;
  height: number;
  ariaHidden: boolean;
}

/**
 * Every text node under `root` carrying `wording`, with the box its nearest
 * element ancestor actually paints.
 *
 * **The nearest element ancestor, deliberately, and not a `Range`.** Measured
 * during the spike behind this helper: a `Range` over the text node reports the
 * text's own unclipped geometry — `26.9×15.0` for the chip's `High` both before
 * and after that word was wrapped in `sr-only`. `overflow: hidden` and
 * `clip-path` do not move it, so a range-based probe cannot see `P1` at all.
 * The element's box does: `44.2×20.0` → `1.0×1.0`.
 *
 * **Text nodes, and not leaf elements.** `a11y-contrast.spec.ts`'s
 * `announcementBoxesIn` scans leaf *elements*, which works for the `sr-only`
 * spans it was written for and cannot see the chip's `High` — that is a bare
 * text node directly inside `Chip.Label`, whose leaf element also holds the
 * glyph and the `Priority: ` prefix. Walking text nodes finds both shapes.
 */
const wordingCarriers = async (
  root: Locator,
  wording: string,
): Promise<WordingCarrier[]> =>
  root.evaluate((element, needle) => {
    const walker = document.createTreeWalker(element, NodeFilter.SHOW_TEXT);
    const carriers = [];

    for (
      let node = walker.nextNode();
      node !== null;
      node = walker.nextNode()
    ) {
      if (!(node.textContent ?? "").includes(needle)) continue;

      const parent = node.parentElement;

      if (parent === null) continue;

      const rect = parent.getBoundingClientRect();

      /*
        `aria-hidden` is inherited by the whole subtree, so the answer is an
        ancestor walk rather than a look at the carrier alone. Reported per
        carrier only so a failure can name which element did it; the authority
        on tree membership is the aria snapshot below, which is the browser's
        own computation rather than this re-implementation of one rule of it.
      */
      let ariaHidden = false;

      for (
        let cursor: HTMLElement | null = parent;
        cursor !== null;
        cursor = cursor.parentElement
      ) {
        if (cursor.getAttribute("aria-hidden") === "true") {
          ariaHidden = true;
          break;
        }
      }

      carriers.push({
        text: (node.textContent ?? "").trim(),
        tag: parent.tagName.toLowerCase(),
        className: parent.className,
        width: rect.width,
        height: rect.height,
        ariaHidden,
      });
    }

    return carriers;
  }, wording);

const describeCarrier = (carrier: WordingCarrier) =>
  `<${carrier.tag} class="${carrier.className}"> “${carrier.text}” at ${carrier.width.toFixed(2)}×${carrier.height.toFixed(2)}${carrier.ariaHidden ? ", aria-hidden" : ""}`;

/**
 * Whether `wording` survives into the accessibility tree under `root`.
 *
 * `ariaSnapshot` is the oracle because it is Playwright's own tree, not a
 * guess: verified in the spike that an `sr-only` span's text **is** present in
 * the snapshot (`- text: "Priority: Medium"`) and that adding `aria-hidden="true"`
 * removes that line entirely while `textContent` is unchanged. That is exactly
 * the `B3` mutation, and it is the only one of the three properties the suite
 * previously had no way to read.
 *
 * The snapshot also merges adjacent text — the chip renders `Priority: ` and
 * `High` as two nodes and the snapshot shows one `text: "Priority: High"` — so
 * this is a substring test against the serialised tree, and it is the caller's
 * job to scope `root` tightly enough that an accessible name elsewhere in the
 * subtree cannot answer for the word being asked about.
 */
const reachesAccessibilityTree = async (root: Locator, wording: string) =>
  (await root.ariaSnapshot()).includes(wording);

/**
 * Asserts that `wording` is present under `root` and presented the stated way.
 *
 * This is the assertion `toContainText` should have been everywhere the claim
 * is about a *word* rather than about a colour. Use it wherever §6.4 says a
 * step keeps its word, and pass the `Presentation` that says who the word is
 * for.
 */
export const expectWording = async (
  root: Locator,
  wording: string,
  presentation: Presentation,
  label: string,
) => {
  const carriers = await wordingCarriers(root, wording);

  expect(
    carriers.length,
    `${label}: nothing under this element carries “${wording}” at all`,
  ).toBeGreaterThan(0);

  const inTree = await reachesAccessibilityTree(root, wording);
  const painted = carriers.filter(
    (carrier) => Math.max(carrier.width, carrier.height) > SR_ONLY_MAX_PX,
  );
  const rendering = carriers.map(describeCarrier).join("; ");

  if (presentation === "screen-reader-only") {
    expect(
      painted.map(describeCarrier),
      `${label}: “${wording}” is meant for screen readers only, but it paints a box — ${rendering}`,
    ).toEqual([]);
  } else {
    expect(
      painted.length,
      `${label}: “${wording}” draws nothing a sighted reader can see — every carrier is clipped: ${rendering}`,
    ).toBe(carriers.length);
  }

  if (presentation === "decorative") {
    expect(
      inTree,
      `${label}: “${wording}” is a decorative glyph and must not be announced, but it is in the accessibility tree`,
    ).toBe(false);
  } else {
    expect(
      inTree,
      `${label}: “${wording}” never reaches the accessibility tree — a screen reader is not told it. Carriers: ${rendering}`,
    ).toBe(true);
  }
};

/**
 * The counterpart, and a one-shot read for the same reason `expectAbsentNow` is
 * one: the claim is that the word is not there, and a retrying form would be
 * satisfied by watching it leave.
 */
export const expectWordingAbsent = async (
  root: Locator,
  wording: string,
  label: string,
) => {
  const carriers = await wordingCarriers(root, wording);

  expect(
    carriers.map(describeCarrier),
    `${label}: “${wording}” should not be here at all`,
  ).toEqual([]);
};

/** URL shapes for the three todo endpoints, used by routes and counters alike. */
export const TODO_LIST_URL = /\/api\/todos(\?|$)/;
/** `[id]` only — excludes `/status`, which is a different mutation. */
export const TODO_ITEM_URL = /\/api\/todos\/[^/?]+$/;
export const TODO_STATUS_URL = /\/api\/todos\/[^/?]+\/status$/;
