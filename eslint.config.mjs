import { defineConfig, globalIgnores } from "eslint/config";
import nextVitals from "eslint-config-next/core-web-vitals";
import nextTs from "eslint-config-next/typescript";

const eslintConfig = defineConfig([
  ...nextVitals,
  ...nextTs,
  // Override default ignores of eslint-config-next.
  globalIgnores([
    // Default ignores of eslint-config-next:
    ".next/**",
    "out/**",
    "build/**",
    "next-env.d.ts",
    // Playwright's output. Gitignored, but a developer who has just run the
    // suite has thousands of bundled vendor files sitting here, and linting
    // them buries the real findings under a few thousand warnings.
    "playwright-report/**",
    "test-results/**",
  ]),
]);

export default eslintConfig;
