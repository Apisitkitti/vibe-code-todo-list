import { readFileSync, readdirSync, statSync } from "node:fs";
import { join, relative, resolve } from "node:path";

import { describe, expect, it } from "vitest";

/**
 * Nothing may import `toast` from `@heroui/react`.
 *
 * This is a source-level test because the failure it guards is silent. The app
 * renders its toast region over its **own** queue (`src/lib/toast.ts`), built
 * with the `wrapUpdate` escape hatch `docs/DESIGN.md` §4.10 names. HeroUI's
 * exported `toast` is bound at module load to a different queue — the default
 * one — and nothing renders a region for it. So a call on the wrong `toast`
 * type-checks, lints, builds, runs, throws nothing, and simply never shows the
 * user anything.
 *
 * That is not hypothetical. Five call sites were on HeroUI's `toast` when the
 * queue was introduced — every sign-in and sign-up outcome, the quick-add
 * failure, the modal's save failure, and the sign-out failure — and each would
 * have gone quiet with no error anywhere. Four of the five are the *failure*
 * message, which is the one nobody exercises by accident.
 *
 * A `no-restricted-imports` rule would say this better and closer to the code.
 * It belongs in `eslint.config.mjs`, which this branch does not own; the
 * recommendation is in the branch report and this test holds the line until
 * then.
 */

const SOURCE_ROOT = resolve(__dirname, "../../src");

const SOURCE_EXTENSIONS = [".ts", ".tsx"];

const sourceFiles = (directory: string): string[] =>
  readdirSync(directory).flatMap((entry) => {
    const path = join(directory, entry);

    if (statSync(path).isDirectory()) return sourceFiles(path);

    return SOURCE_EXTENSIONS.some((extension) => path.endsWith(extension))
      ? [path]
      : [];
  });

/**
 * Matches an import *statement* from `@heroui/react` and reads its clause, so
 * the word `toast` in a comment or an identifier is not a finding. Multi-line
 * clauses are the ordinary shape here, hence the `[\s\S]`.
 */
const HEROUI_IMPORT = /import\s+([\s\S]*?)\s+from\s+"@heroui\/react";/g;

/** The specifier itself, not `useToast`, `toastVariants` or `ToastQueue`. */
const TOAST_SPECIFIER = /(^|[{,\s])toast(\s*,|\s*}|\s+as\s)/;

describe("the app's toast queue is the only one", () => {
  it("no source file imports `toast` from @heroui/react", () => {
    const offenders = sourceFiles(SOURCE_ROOT).filter((path) => {
      const source = readFileSync(path, "utf8");

      return [...source.matchAll(HEROUI_IMPORT)].some(([, clause]) =>
        TOAST_SPECIFIER.test(clause),
      );
    });

    expect(
      offenders.map((path) => relative(SOURCE_ROOT, path)),
      "these files raise toasts onto a queue no region renders — import from @/lib/toast",
    ).toEqual([]);
  });

  it("catches the import shape it is meant to catch", () => {
    // The guard is only worth having if it matches what it claims to. Both
    // clause shapes the codebase actually writes are checked here, plus the
    // three near-misses that must NOT be findings.
    expect(TOAST_SPECIFIER.test("{ toast }")).toBe(true);
    expect(TOAST_SPECIFIER.test("{\n  Button,\n  toast,\n  Modal,\n}")).toBe(true);

    expect(TOAST_SPECIFIER.test("{ toastVariants }")).toBe(false);
    expect(TOAST_SPECIFIER.test("{ useToast }")).toBe(false);
    expect(TOAST_SPECIFIER.test("{ ToastQueue }")).toBe(false);
  });
});
