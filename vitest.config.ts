import { fileURLToPath } from "node:url";

import { defineConfig } from "vitest/config";

import { resolveTestDatabaseUrl } from "./tests/setup/testDatabaseUrl";

const PROJECT_ROOT = fileURLToPath(new URL(".", import.meta.url));

/**
 * `DATABASE_URL` is resolved here rather than in a setup file because
 * `src/lib/prisma.ts` reads it while the module is being imported — by the
 * time a setup file's body runs, an import of the client would already have
 * captured the wrong value.
 */
export default defineConfig({
  resolve: {
    alias: {
      "@": fileURLToPath(new URL("./src", import.meta.url)),
    },
  },
  test: {
    environment: "node",
    env: {
      DATABASE_URL: resolveTestDatabaseUrl(PROJECT_ROOT),
      NODE_ENV: "test",
      // Never the real one: a test signature has no reason to be valid
      // anywhere, and the production secret should not be readable from here.
      BETTER_AUTH_SECRET: "test-only-secret-not-used-outside-vitest",
    },
    // The isolation suite shares two seeded users and one database. Running
    // files in parallel would let one file's cleanup delete another's rows.
    fileParallelism: false,
    include: ["tests/**/*.test.ts"],
  },
});
