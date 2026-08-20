import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

import { describe, expect, test } from "vitest";

/**
 * `vercel.json` is the only place schema delivery is wired, and until this file
 * existed nothing read it. The ordering inside `buildCommand` is the most
 * load-bearing line in the branch that added it and it was defended by prose
 * alone: the review swapped it to `next build && prisma migrate deploy`, and
 * vitest, tsc and eslint all stayed green.
 *
 * Why the order is the thing worth pinning, rather than merely that
 * `migrate deploy` appears: Prisma's generated SQL names every scalar column,
 * so code that expects a column the database lacks does not degrade the feature
 * that uses it — `findMany` throws P2022 and every list query 500s. Running the
 * migration *before* `next build` means a migration that fails takes the build
 * down while the previously deployed version keeps serving. Running it after
 * opens a window where new code is live against an un-migrated database, and by
 * that mechanism the window is a total outage on every list rather than a
 * partial one.
 *
 * Vercel's schema sets `additionalProperties: false`, so the key list is also
 * asserted — a `"//"` comment key was tried here and rejected the file.
 */

const CONFIG_PATH = fileURLToPath(new URL("../../vercel.json", import.meta.url));

const config: Record<string, unknown> = JSON.parse(
  readFileSync(CONFIG_PATH, "utf8"),
);

const buildCommand = config.buildCommand;

/**
 * Checked against the downloaded `https://openapi.vercel.sh/vercel.json` when
 * this was written; every one of these is a real property there. It is a
 * deliberately small allow-list rather than the full 40, because the point is
 * to catch something being *added* to this file without a look at the schema.
 */
const EXPECTED_KEYS = ["$schema", "regions", "buildCommand"];

describe("vercel.json", () => {
  test("carries only keys Vercel's schema accepts", () => {
    // `additionalProperties: false` means an unknown key fails the deploy
    // rather than being ignored — including any spelling of a comment.
    expect(Object.keys(config).sort()).toEqual([...EXPECTED_KEYS].sort());
  });

  test("applies migrations as part of the deploy at all", () => {
    expect(buildCommand).toContain("prisma migrate deploy");
  });

  test("applies migrations BEFORE next build, not after", () => {
    expect(typeof buildCommand).toBe("string");

    const command = buildCommand as string;
    const migrateAt = command.indexOf("prisma migrate deploy");
    const buildAt = command.indexOf("next build");

    expect(migrateAt).toBeGreaterThanOrEqual(0);
    expect(buildAt).toBeGreaterThanOrEqual(0);

    // The assertion the review's swap has to fail on.
    expect(migrateAt).toBeLessThan(buildAt);
  });

  test("generates the client before it migrates or builds", () => {
    const command = buildCommand as string;
    const generateAt = command.indexOf("prisma generate");

    expect(generateAt).toBeGreaterThanOrEqual(0);
    expect(generateAt).toBeLessThan(command.indexOf("prisma migrate deploy"));
  });

  test("chains with && so a failed migration stops the build", () => {
    const command = buildCommand as string;

    // `;` would run `next build` even after the migration failed, which is the
    // whole failure this ordering exists to prevent.
    expect(command).not.toMatch(/;/);
    expect(command).toContain("&&");
  });
});
