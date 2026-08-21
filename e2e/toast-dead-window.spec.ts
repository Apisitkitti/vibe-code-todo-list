import type { Page } from "@playwright/test";

import { expect, test } from "./support/fixtures";

/**
 * DIAGNOSTIC — measures the dead window `docs/DESIGN.md` §4.10 describes.
 *
 * Not a contract test. It reports numbers rather than asserting a budget, and
 * it exists so the §4.10 figures are something this branch measured rather
 * than something it inherited.
 *
 * The measurement has to name *which* button it is timing. During a
 * close-then-add the previous toast's action button is still in the DOM — its
 * unmount is deferred behind the same transition chain — so a probe on the
 * bare `[data-slot="toast-action-button"]` locks onto the outgoing button,
 * which has been hittable for seconds, and reports a dead window shorter than
 * a lone add's. Every selector below is therefore keyed to the accessible name
 * of the toast under test.
 */

const STATUS_URL = /\/api\/todos\/[^/]+\/status$/;
const ACTION = '[data-slot="toast-action-button"]';
const completeAction = `${ACTION}[aria-label*="marked complete"]`;
const notCompleteAction = `${ACTION}[aria-label*="marked not complete"]`;

interface Sample {
  t: number;
  hits: boolean;
  transitioning: boolean;
  onTop: string | null;
}

interface ProbeReading {
  appearedAt: number;
  samples: Sample[];
}

interface Probe {
  selector: string;
  appearedAt: number | null;
  /** The user's own press — the origin §4.10's "dead button" is measured from. */
  writePressAt: number | null;
  samples: Sample[];
  pressOffset: number | null;
  pressOnTop: string | null;
  stop: () => void;
}

declare global {
  interface Window {
    __deadWindowProbe?: Probe;
  }
}

/**
 * Starts a per-frame probe over one named toast action button.
 *
 * Each frame it records whether `document.elementFromPoint` at the button's own
 * centre resolves to the button, and what is on top when it does not. That is
 * the question §4.10 turns on: the button is mounted and painted the whole
 * time, so "is it there" is the wrong measurement — "does a press at its centre
 * reach it" is the right one.
 *
 * It also arms a one-shot capture listener that stamps the offset and the
 * hit-test answer at the moment a real pointer press arrives, so a swallowed
 * press can say what swallowed it.
 */
const startProbe = async (page: Page, selector: string) => {
  await page.evaluate((probedSelector) => {
    let running = true;

    const probe: Probe = {
      selector: probedSelector,
      appearedAt: null,
      writePressAt: null,
      samples: [],
      pressOffset: null,
      pressOnTop: null,
      stop: () => {
        running = false;
      },
    };

    const describe = (element: Element | null) =>
      element === null
        ? null
        : `${element.tagName.toLowerCase()}[${element.getAttribute("data-slot") ?? "-"}]`;

    const isTransitioning = () =>
      document.getAnimations().some((animation) => {
        const pseudo = (animation.effect as KeyframeEffect | null)?.pseudoElement;

        return (
          animation.playState === "running" &&
          pseudo?.startsWith("::view-transition") === true
        );
      });

    const frame = () => {
      if (!running) return;

      const button = document.querySelector<HTMLElement>(probedSelector);

      if (button) {
        const now = performance.now();

        if (probe.appearedAt === null) probe.appearedAt = now;

        const rect = button.getBoundingClientRect();
        const onTop = document.elementFromPoint(
          rect.left + rect.width / 2,
          rect.top + rect.height / 2,
        );

        probe.samples.push({
          t: now,
          hits: onTop !== null && (onTop === button || button.contains(onTop)),
          transitioning: isTransitioning(),
          onTop: describe(onTop),
        });
      }

      requestAnimationFrame(frame);
    };

    /*
      The write's own press. Armed at probe start and stamped once, so the
      sweep can measure from the moment the user acted rather than from the
      moment the toast's button first existed. Those are the same instant for
      a lone add and ~350ms apart for a close-then-add, which is the whole of
      §4.10's "twice as long".
    */
    document.addEventListener(
      "pointerdown",
      () => {
        probe.writePressAt = performance.now();
      },
      { capture: true, once: true },
    );

    window.__deadWindowProbe = probe;
    requestAnimationFrame(frame);
  }, selector);
};

const readProbe = async (page: Page): Promise<ProbeReading> =>
  page.evaluate(() => {
    const probe = window.__deadWindowProbe;

    probe?.stop();

    return {
      appearedAt: probe?.appearedAt ?? 0,
      samples: probe?.samples ?? [],
    };
  });

/** Milliseconds from the button existing to the first frame a press would land. */
const deadWindowMs = ({ appearedAt, samples }: ProbeReading): number | null => {
  const landed = samples.find((sample) => sample.hits);

  if (!landed) return null;

  return Math.round(landed.t - appearedAt);
};

const summarise = (label: string, reading: ProbeReading) => {
  const blocked = reading.samples.filter((sample) => !sample.hits);
  const onTop = new Set(blocked.map((sample) => sample.onTop));

  console.log(
    `[§4.10] ${label}: dead for ${deadWindowMs(reading)}ms — ` +
      `${blocked.length} blocked of ${reading.samples.length} frames; ` +
      `on top while blocked: ${[...onTop].join(", ") || "n/a"}`,
  );
};

/**
 * Presses the named button with a real pointer, `delay` ms after that button's
 * first frame, and reports whether the press reached it.
 */
const pressAfter = async (
  page: Page,
  delay: number,
  origin: "button" | "write" = "button",
) => {
  const target = await page.evaluate(async ({ wait, from }) => {
    const probe = window.__deadWindowProbe;

    const until = (predicate: () => boolean) =>
      new Promise<void>((resolve) => {
        const tick = () => (predicate() ? resolve() : requestAnimationFrame(tick));

        tick();
      });

    const originAt = () =>
      from === "write" ? probe?.writePressAt : probe?.appearedAt;

    await until(() => probe?.appearedAt != null && originAt() != null);
    await until(() => performance.now() - (originAt() ?? 0) >= wait);

    const button = document.querySelector<HTMLElement>(probe?.selector ?? "");

    if (!button) return null;

    const rect = button.getBoundingClientRect();

    /*
      Armed here rather than when the probe starts, because the write under
      test is itself a pointer press: a listener armed earlier is consumed by
      the checkbox click and reports that press's offset and hit target
      instead of the Undo's. That is exactly what the first run of this
      diagnostic did, and it made every sample read
      `swallowed(svg[checkbox-default-indicator--checkmark])`.
    */
    document.addEventListener(
      "pointerdown",
      (event) => {
        const probed = window.__deadWindowProbe;

        if (!probed) return;

        probed.pressOffset =
          performance.now() -
          ((from === "write" ? probed.writePressAt : probed.appearedAt) ?? 0);
        probed.pressOnTop = (() => {
          const onTop = document.elementFromPoint(event.clientX, event.clientY);

          return onTop === null
            ? null
            : `${onTop.tagName.toLowerCase()}[${onTop.getAttribute("data-slot") ?? "-"}]`;
        })();
      },
      { capture: true, once: true },
    );

    return { x: rect.left + rect.width / 2, y: rect.top + rect.height / 2 };
  }, { wait: delay, from: origin });

  if (!target) throw new Error("the probed toast action button was not mounted");

  await page.mouse.click(target.x, target.y);

  return page.evaluate(() => ({
    offset: window.__deadWindowProbe?.pressOffset ?? null,
    onTop: window.__deadWindowProbe?.pressOnTop ?? null,
  }));
};

const countStatusPatches = (page: Page) => {
  const seen = { count: 0 };

  page.on("request", (request) => {
    if (request.method() === "PATCH" && STATUS_URL.test(request.url())) {
      seen.count += 1;
    }
  });

  return seen;
};

const SETTLE_MS = 1500;

test.describe("§4.10 dead window", () => {
  /*
    **Off by default — run with `MEASURE_TOAST=1`.**

    These three are a measurement, not a gate. They report numbers and assert
    only that they collected samples, so leaving them in every run would buy
    the release gate nothing and cost it about two minutes per project. The
    contract they informed is asserted where a contract belongs:
    `e2e/undo-semantics.spec.ts` → "an armed Undo is live on its first frame",
    which is one real pointer press and goes red the moment the `wrapUpdate`
    escape hatch is dropped.

    Kept rather than deleted because the numbers in `src/lib/toast.ts` and in
    `docs/DESIGN.md` §4.10 are only as good as the harness that produced them,
    and the next person to doubt them should be able to re-run it rather than
    rebuild it.

    The stacking test below is NOT gated: it is fast, and it is a finding
    nobody has acted on yet.
  */
  test.skip(
    !process.env.MEASURE_TOAST,
    "measurement, not a gate — set MEASURE_TOAST=1 to run",
  );

  test("probes a lone add and a close-then-add", async ({
    signedIn: page,
    todos,
  }) => {
    await todos.quickAdd("Alpha");
    await expect(todos.rowByText("Alpha")).toBeVisible();

    // Let the create receipt's own transition finish, so the toggle below is a
    // lone add with nothing chained in front of it.
    await page.waitForTimeout(SETTLE_MS);

    await startProbe(page, completeAction);
    await todos.toggle("Alpha", true);
    await expect(page.locator(completeAction)).toBeVisible();
    await page.waitForTimeout(SETTLE_MS);

    summarise("lone add", await readProbe(page));

    // The repeat write: `handleToggle` dismisses the outstanding Undo, and the
    // new toast's add is chained behind that close.
    await startProbe(page, notCompleteAction);
    await todos.toggle("Alpha", false);
    await expect(page.locator(notCompleteAction)).toBeVisible();
    await page.waitForTimeout(2 * SETTLE_MS);

    summarise("close-then-add", await readProbe(page));
  });

  /**
   * The ground truth the probe is only a proxy for: a real pointer press,
   * delivered through the browser's own input pipeline, at a controlled offset
   * from the toast action button's first frame.
   *
   * A fresh todo per sample, and a fresh row for the close-then-add sweep, so
   * no sample inherits another's toast stack.
   */
  const sweep = (
    label: string,
    origin: "button" | "write",
    delays: number[],
    arrange: (
      page: Page,
      todos: import("./support/fixtures").TodosScreen,
      title: string,
    ) => Promise<void>,
    selector: string,
  ) =>
    test(`sweeps a real press across ${label}`, async ({ signedIn: page, todos }) => {
      const patches = countStatusPatches(page);
      const results: string[] = [];

      for (const delay of delays) {
        const title = `S${delay}`;

        await todos.quickAdd(title);
        await expect(todos.rowByText(title)).toBeVisible();

        /*
          **A reload per sample, and it is not tidiness.** `UNDO_WINDOW_MS` is
          12s, so an unreloaded sweep accumulates toasts faster than they
          expire; `Toast.Provider` renders only `maxVisibleToasts` (3) and
          stacks them with a scale transform, so from the fourth sample on the
          probed button's centre can sit under a toast in front of it. The
          first run of this diagnostic showed exactly that as a lone
          `swallowed` at 900ms sitting between two `LANDED`s — a stacking
          artefact reading as a timing result.
        */
        await page.reload();
        await expect(todos.rowByText(title)).toBeVisible();

        await arrange(page, todos, title);

        await startProbe(page, selector);

        // The write under test. Not awaited on a Playwright assertion first —
        // the probe is what waits, in the page, for the button's first frame.
        await todos.toggle(title, selector === completeAction);

        const before = patches.count;
        const press = await pressAfter(page, delay, origin);

        await page.waitForTimeout(900);

        results.push(
          `${delay}→${Math.round(press.offset ?? -1)}ms ` +
            `${patches.count > before ? "LANDED" : `swallowed(${press.onTop})`}`,
        );
      }

      console.log(
        `[§4.10 sweep — ${label}, from the ${origin}] ${results.join(" | ")}`,
      );

      expect(results).toHaveLength(delays.length);
    });

  sweep(
    "a lone add",
    "write",
    [200, 300, 350, 400, 450, 500, 550, 600],
    async () => {},
    completeAction,
  );

  sweep(
    "a close-then-add",
    "write",
    [500, 600, 650, 700, 750, 800, 850, 900],
    async (page, todos, title) => {
      // Arm an Undo on this row first, and let it settle, so the write under
      // test is a genuine close-then-add rather than a lone add.
      await todos.toggle(title, true);
      await expect(
        todos.toastTitles.filter({ hasText: `“${title}” marked complete` }),
      ).toBeVisible();
      // Settled, so the chain under test is exactly one close and one add
      // rather than a leftover add with those two behind it.
      await page.waitForTimeout(SETTLE_MS);
    },
    notCompleteAction,
  );
});

/**
 * A second, separate reachability gap found while measuring the first, and it
 * is not a view transition.
 *
 * HeroUI's toast region stacks: the newest toast is `data-frontmost` and the
 * older ones sit behind it, offset and scaled, with no expand-on-hover
 * anywhere in the component (`node_modules/@heroui/react/dist/components/toast/toast.js`).
 * So a toast raised *after* an armed Undo covers that Undo's button, and it
 * covers it for as long as it lives — which for a receipt is `UNDO_WINDOW_MS`,
 * the same 12s the Undo itself gets.
 *
 * That sequence is not exotic: toggling a row and then capturing something in
 * the quick-add bar is an ordinary minute in this app, and the bar's receipt
 * is what lands on top.
 *
 * Pointer-only, like §4.10 — keyboard activation does not hit-test — and the
 * cap makes it matter more, because the Undo it buries is now the only one.
 */
test.describe("an Undo buried by a later toast", () => {
  test("reports what is on top of the Undo after a receipt lands", async ({
    signedIn: page,
    todos,
  }) => {
    await todos.quickAdd("Alpha");
    await expect(todos.rowByText("Alpha")).toBeVisible();

    await todos.toggle("Alpha", true);
    await expect(page.locator(completeAction)).toBeVisible();
    await page.waitForTimeout(SETTLE_MS);

    const beforeReceipt = await page.evaluate((selector) => {
      const button = document.querySelector<HTMLElement>(selector);

      if (!button) return null;

      const rect = button.getBoundingClientRect();
      const onTop = document.elementFromPoint(
        rect.left + rect.width / 2,
        rect.top + rect.height / 2,
      );

      return onTop === null
        ? null
        : `${onTop.tagName.toLowerCase()}[${onTop.getAttribute("data-slot") ?? "-"}]`;
    }, completeAction);

    // The receipt that lands on top of it.
    await todos.quickAdd("Bravo");
    await expect(todos.rowByText("Bravo")).toBeVisible();
    await page.waitForTimeout(SETTLE_MS);

    const afterReceipt = await page.evaluate((selector) => {
      const button = document.querySelector<HTMLElement>(selector);

      if (!button) return null;

      const rect = button.getBoundingClientRect();
      const onTop = document.elementFromPoint(
        rect.left + rect.width / 2,
        rect.top + rect.height / 2,
      );

      return {
        onTop:
          onTop === null
            ? null
            : `${onTop.tagName.toLowerCase()}[${onTop.getAttribute("data-slot") ?? "-"}]`,
        reaches: onTop !== null && (onTop === button || button.contains(onTop)),
      };
    }, completeAction);

    console.log(
      `[stacking] Undo's centre before a later receipt: ${beforeReceipt}; ` +
        `after: ${afterReceipt?.onTop} (reaches the button: ${afterReceipt?.reaches})`,
    );

    expect(beforeReceipt).not.toBeNull();
  });
});
