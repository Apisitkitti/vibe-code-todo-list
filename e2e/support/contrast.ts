import type { Locator, Page } from "@playwright/test";

/**
 * Colour measurement, done through the browser's own parser.
 *
 * Every token in this app is a `var()` chain that bottoms out in `oklch()`,
 * `lab()` or `color-mix()`. None of those can be parsed by hand from a string,
 * and none of them is what arithmetic can be done on directly — so nothing
 * here estimates. Each colour is painted into a 1x1 canvas and read back,
 * which is the same parser the compositor uses, and the numbers this returns
 * are therefore the numbers on screen.
 *
 * Two things this models that a naive reader gets wrong:
 *
 * 1. **Alpha is composited per layer.** A translucent background over a
 *    translucent background over the page is three blends, in order, from the
 *    root down — not one colour picked off the nearest ancestor that happens
 *    to be opaque.
 * 2. **`opacity` is a group multiplier, not a per-layer alpha.** An ancestor at
 *    `opacity: 0.6` dims its own background *and* every descendant's paint,
 *    including the text, against what sits outside the group. That is the whole
 *    mechanism behind the pending row (QA §A4), so getting it wrong would hide
 *    the defect being measured.
 */

/** Straight (un-premultiplied) sRGB: `r`/`g`/`b` are 0..255, `a` is 0..1. */
export interface Rgba {
  r: number;
  g: number;
  b: number;
  a: number;
}

export interface StackReading {
  /** The painted foreground pixel — `color` after its own alpha and group opacity. */
  foreground: Rgba;
  /** Everything painted behind it, root downwards, including the element's own background. */
  background: Rgba;
}

export interface ContrastReading extends StackReading {
  /** WCAG 2.x contrast ratio, 1..21. */
  ratio: number;
}

/**
 * Runs in the page. Written as one self-contained arrow so it survives being
 * serialised into the browser — nothing from this module's scope exists there.
 */
const readPaintedStack = (element: Element): StackReading => {
  const canvas = document.createElement("canvas");
  canvas.width = 1;
  canvas.height = 1;
  const ctx = canvas.getContext("2d", {
    willReadFrequently: true,
  }) as CanvasRenderingContext2D;

  const pixel = () => {
    const data = ctx.getImageData(0, 0, 1, 1).data;

    return [data[0], data[1], data[2]] as const;
  };

  /*
    Painted twice — once on black, once on white — and solved, rather than read
    straight out of one pass. A canvas stores premultiplied colour at 8 bits,
    so reading a low-alpha fill back directly loses precision in exactly the
    channels that matter. The gap between the two grounds is a clean linear
    function of alpha, so this recovers alpha and the straight colour without
    ever trusting a premultiplied value.
  */
  const resolve = (css: string): Rgba => {
    const paintOn = (ground: string) => {
      ctx.globalCompositeOperation = "copy";
      ctx.globalAlpha = 1;
      ctx.fillStyle = ground;
      ctx.fillRect(0, 0, 1, 1);
      ctx.globalCompositeOperation = "source-over";
      ctx.fillStyle = css;
      ctx.fillRect(0, 0, 1, 1);

      return pixel();
    };

    const onBlack = paintOn("rgb(0, 0, 0)");
    const onWhite = paintOn("rgb(255, 255, 255)");

    // Averaged across the three channels: each carries the same alpha, so this
    // is three measurements of one quantity rather than three quantities.
    const alpha =
      1 -
      (onWhite[0] -
        onBlack[0] +
        (onWhite[1] - onBlack[1]) +
        (onWhite[2] - onBlack[2])) /
        (3 * 255);

    if (alpha <= 0) return { r: 0, g: 0, b: 0, a: 0 };

    return {
      r: onBlack[0] / alpha,
      g: onBlack[1] / alpha,
      b: onBlack[2] / alpha,
      a: alpha,
    };
  };

  /** Source-over, in floats, on straight colour. */
  const over = (source: Rgba, backdrop: Rgba): Rgba => ({
    r: source.r * source.a + backdrop.r * (1 - source.a),
    g: source.g * source.a + backdrop.g * (1 - source.a),
    b: source.b * source.a + backdrop.b * (1 - source.a),
    a: 1,
  });

  /*
    Root-to-element, so group opacity accumulates in the direction it applies:
    a node's own `opacity` dims itself and everything below it.
  */
  const chain: Element[] = [];

  for (
    let node: Element | null = element;
    node !== null;
    node = node.parentElement
  ) {
    chain.unshift(node);
  }

  let groupAlpha = 1;
  // The ultimate ground is the canvas the browser itself paints on.
  let background: Rgba = { r: 255, g: 255, b: 255, a: 1 };

  for (const node of chain) {
    const style = getComputedStyle(node);
    const nodeOpacity = Number.parseFloat(style.opacity);

    groupAlpha *= Number.isFinite(nodeOpacity) ? nodeOpacity : 1;

    const layer = resolve(style.backgroundColor);

    if (layer.a > 0) {
      background = over({ ...layer, a: layer.a * groupAlpha }, background);
    }
  }

  const textColor = resolve(getComputedStyle(element).color);
  const foreground = over(
    { ...textColor, a: textColor.a * groupAlpha },
    background,
  );

  return { foreground, background };
};

const relativeLuminance = ({ r, g, b }: Rgba): number => {
  const channel = (value: number) => {
    const v = value / 255;

    return v <= 0.03928 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4);
  };

  return 0.2126 * channel(r) + 0.7152 * channel(g) + 0.0722 * channel(b);
};

/** WCAG 2.x contrast, computed in Node from two already-painted colours. */
export const contrastRatio = (a: Rgba, b: Rgba): number => {
  const first = relativeLuminance(a);
  const second = relativeLuminance(b);

  return (
    (Math.max(first, second) + 0.05) / (Math.min(first, second) + 0.05)
  );
};

export const formatRgb = ({ r, g, b }: Rgba): string =>
  `rgb(${Math.round(r)}, ${Math.round(g)}, ${Math.round(b)})`;

/**
 * The contrast of an element's own text against everything painted behind it.
 *
 * The element must be the one carrying the text — `color` is read from it, and
 * its own `background-color` counts as part of the backdrop, because that is
 * the order the text is painted in.
 */
export const measureContrast = async (
  locator: Locator,
): Promise<ContrastReading> => {
  const reading = await locator.evaluate(readPaintedStack);

  return { ...reading, ratio: contrastRatio(reading.foreground, reading.background) };
};

/** The composited colours at an element, without judging a ratio. */
export const measureStack = async (locator: Locator): Promise<StackReading> =>
  locator.evaluate(readPaintedStack);

/**
 * SC 1.4.11's question for a filled control: the control's own painted surface
 * against the surface it sits on. Both sides are composited stacks, so a
 * translucent fill over a translucent card still resolves to the two pixels a
 * user's eye actually compares.
 */
export const measureAgainstSurroundings = async (
  control: Locator,
  surroundings: Locator,
): Promise<ContrastReading> => {
  const inner = await measureStack(control);
  const outer = await measureStack(surroundings);

  return {
    foreground: inner.background,
    background: outer.background,
    ratio: contrastRatio(inner.background, outer.background),
  };
};

/**
 * A custom property's colour against the backdrop the element sits on.
 *
 * For `--focus`, which is painted as a ring *outside* the element and so is
 * judged against what the element sits on rather than against the element
 * itself. SC 1.4.11 wants 3:1 for a focus indicator, and `--focus` is aliased
 * to `--accent` — so anything that moves the accent has to be checked here as
 * well as on the buttons it fills.
 */
export const measurePropertyAgainstBackdrop = async (
  locator: Locator,
  property: string,
): Promise<ContrastReading> => {
  /*
    The **parent's** stack, not the element's. A ring is painted outside the
    control and a fill is judged against what surrounds it, so including the
    element's own background would compare the accent to itself and report
    1.00 — which is what it did before this was scoped up a level.
  */
  const [stack, propertyColor] = await Promise.all([
    measureStack(locator.locator("xpath=..")),
    locator.evaluate((element, name) => {
      const raw = getComputedStyle(element).getPropertyValue(name).trim();
      const canvas = document.createElement("canvas");
      canvas.width = 1;
      canvas.height = 1;
      const ctx = canvas.getContext("2d") as CanvasRenderingContext2D;

      ctx.globalCompositeOperation = "copy";
      ctx.fillStyle = raw;
      ctx.fillRect(0, 0, 1, 1);

      const data = ctx.getImageData(0, 0, 1, 1).data;

      return { r: data[0], g: data[1], b: data[2], a: data[3] / 255 };
    }, property),
  ]);

  return {
    foreground: propertyColor,
    background: stack.background,
    ratio: contrastRatio(propertyColor, stack.background),
  };
};

export const THEMES = ["light", "dark"] as const;

export type Theme = (typeof THEMES)[number];

/**
 * Pins the theme the way the app's own bootstrap script does — the class, the
 * attribute and the stored key together — so nothing re-resolves it to
 * `system` on a later render and no token block is left half-applied.
 *
 * Both blocks matter for every fix here: HeroUI scopes light to
 * `:root, .light, [data-theme="light"]` and dark to `.dark, [data-theme="dark"]`,
 * so a token corrected in one is not corrected in the other.
 */
/**
 * Pins the theme **before the page loads**, rather than correcting one already
 * on screen.
 *
 * `src/app/layout.tsx` stamps the class and the attribute from a `<head>`
 * script so there is no flash of the wrong theme (NFR-06), and it reads
 * `heroui-theme` out of `localStorage` to decide. Writing that key from an init
 * script — which runs before any page script on every navigation — is therefore
 * the only way a measurement is guaranteed never to see a frame of the other
 * palette, `@media` fallbacks included.
 *
 * `setTheme` is still the right tool for switching themes on a page that is
 * already up. This one is for a test that must reload anyway and wants the
 * first paint to be the theme under test.
 *
 * Calling it twice accumulates two init scripts; they run in order, so the last
 * theme asked for is the one that survives into the page.
 */
export const pinThemeBeforeLoad = async (
  page: Page,
  theme: Theme,
): Promise<void> => {
  await page.addInitScript((next) => {
    localStorage.setItem("heroui-theme", next);
  }, theme);
};

export const setTheme = async (page: Page, theme: Theme): Promise<void> => {
  await page.evaluate((next) => {
    localStorage.setItem("heroui-theme", next);
    document.documentElement.classList.remove("light", "dark");
    document.documentElement.classList.add(next);
    document.documentElement.setAttribute("data-theme", next);
  }, theme);
};
