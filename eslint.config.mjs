import { defineConfig, globalIgnores } from "eslint/config";
import nextVitals from "eslint-config-next/core-web-vitals";
import nextTs from "eslint-config-next/typescript";

/**
 * The rules below are conventions this team already enforced by reading. Each
 * one has been raised in review at least once, and a rule a reviewer holds by
 * hand is a rule that goes stale the first time the reviewer is busy — the
 * `src/server/` architecture `docs/CONVENTIONS.md` still describes has never
 * existed, and nothing noticed for a quarter. These fail the build instead.
 *
 * Where each rule is written down is named beside it, and every one of them was
 * watched failing against a deliberate violation before it was committed. A
 * rule nobody has seen fire is a claim, not a control (`docs/REVIEW.md` B-1).
 */

/** Palette colours banned by `docs/DESIGN.md` §3 — hex and functional notation. */
const RAW_COLOUR_PATTERN = "#[0-9a-fA-F]{3,8}|(rgb|rgba|hsl|hsla|oklch|oklab)\\(";

/**
 * Tailwind's own palette scales, also banned by §3 (`bg-zinc-900`).
 * `color-mix()` is deliberately absent from both patterns: §3 names it as the
 * sanctioned way to compose a missing shade from an existing token.
 */
const TAILWIND_PALETTE_PATTERN =
  "(bg|text|border|ring|from|via|to|fill|stroke|outline|decoration|shadow|divide|placeholder|accent|caret)-(slate|gray|zinc|neutral|stone|red|orange|amber|yellow|lime|green|emerald|teal|cyan|sky|blue|indigo|violet|purple|fuchsia|pink|rose)-[0-9]{2,3}";

const COLOUR_PATTERN = `${RAW_COLOUR_PATTERN}|${TAILWIND_PALETTE_PATTERN}`;

const COLOUR_MESSAGE =
  "docs/DESIGN.md §3: every colour is a var(--token) from §2.1. A hard-coded colour does not swap with the theme, so it is a dark-mode defect that light-mode review cannot see. Compose a missing shade with color-mix() from an existing token. The one exception — correcting a HeroUI token that fails a WCAG floor — lives in src/app/globals.css, which this rule does not lint.";

/**
 * `no-restricted-syntax` does not merge across config objects — a later block
 * that sets it replaces the earlier one wholesale. So the shared selectors are
 * declared once here and spread into every block that adds to them, rather
 * than each block quietly dropping the rules it did not restate.
 */
const CONVENTION_SYNTAX = [
  /*
    `docs/DESIGN.md` §3 — the token ban, applied to application code.

    Checked as source text (string literals and template chunks) rather than as
    JSX, because a colour reaches the DOM through `className`, through a `style`
    object and through a composed class string alike, and §3 bans it in all
    three.
  */
  { selector: `Literal[value=/${COLOUR_PATTERN}/]`, message: COLOUR_MESSAGE },
  {
    selector: `TemplateElement[value.raw=/${COLOUR_PATTERN}/]`,
    message: COLOUR_MESSAGE,
  },

  /*
    `docs/CONVENTIONS.md` → Arrow functions everywhere, the half `func-style`
    cannot see.

    `func-style` reports a bare `function foo() {}` but not
    `export default function TodosPage() {}` — which is the shape that actually
    turns up, because it is what every Next.js scaffold and every code sample
    written before this convention produces. Verified: `func-style` alone passes
    that file clean.
  */
  {
    selector: "ExportDefaultDeclaration > FunctionDeclaration",
    message:
      "docs/CONVENTIONS.md → Arrow functions everywhere: a default export is a named const followed by `export default Name`, so the component keeps a real name in stack traces and React DevTools.",
  },
];

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
    // Throwaway scripts from browser-driven persona sessions. Gitignored,
    // but .gitignore does not reach eslint — it scans the directory, not the
    // index — so a session that left twenty of them behind fails lint on
    // `require()` in files nobody intends to keep.
    "persona*.js",
    "test-user-*.js",
    // Prisma's generated client. Gitignored and rewritten by every
    // `prisma generate`, so a finding here is unfixable — the next generate
    // reverts the fix. The conventions below describe code people write.
    "src/generated/**",
  ]),

  {
    name: "todo-app/conventions",
    files: ["src/**/*.ts", "src/**/*.tsx"],
    rules: {
      /*
        `docs/CONVENTIONS.md` → Arrow functions everywhere.

        The rule exists for a reason that is easy to lose: arrow consts are not
        hoisted, so "define a helper above its first use" is a real constraint
        on how a module is ordered, and a `function` declaration silently
        exempts itself from it. Mixing the two means a reader cannot tell by
        looking whether the order of a file matters.
      */
      "func-style": ["error", "expression", { allowArrowFunctions: true }],

      "no-restricted-syntax": ["error", ...CONVENTION_SYNTAX],

      /*
        `docs/CONVENTIONS.md` → "Runs on the client" does NOT mean the database
        moves to the browser.

        Prisma is importable only from a route handler. This is the rule with
        the worst failure mode in the repo: importing it into a client component
        does not fail loudly, it pulls `DATABASE_URL` toward a browser bundle,
        and the boundary it crosses is the one every other authorization
        guarantee is built on. `src/lib/auth.ts` is the single allowed
        exception below, and it is granted explicitly rather than assumed.
      */
      "no-restricted-imports": [
        "error",
        {
          patterns: [
            {
              group: ["@/lib/prisma", "**/lib/prisma"],
              message:
                "docs/CONVENTIONS.md → Route handlers are the trust boundary: database access happens only inside src/app/api/**. A client component that imports Prisma pulls DATABASE_URL toward the browser bundle. Call the route handler through src/service/*.service.ts instead.",
            },
          ],
        },
      ],
    },
  },

  {
    /*
      `docs/CONVENTIONS.md` → No try/catch in services.

      A service is a transport call and its return value. The moment one
      swallows an error it has decided something the UI is the only layer
      qualified to decide — which toast to raise, which field to mark invalid,
      whether to send the user back to sign-in. The rule reads as style and is
      not: a caught-and-reshaped error is a failure the user is never told
      about.
    */
    name: "todo-app/services-are-transport",
    files: ["src/service/**/*.ts"],
    rules: {
      "no-restricted-syntax": [
        "error",
        ...CONVENTION_SYNTAX,
        {
          selector: "TryStatement",
          message:
            "docs/CONVENTIONS.md → Services: a service does not catch. Errors propagate to the caller, which is the layer that knows which toast to show and which field to mark invalid. Handle it in the component.",
        },
      ],
    },
  },

  {
    /*
      Route handlers may reach Prisma — that is what makes them the trust
      boundary rather than a layer in front of it. Restating the block above
      without the Prisma pattern is what grants that.
    */
    name: "todo-app/route-handlers-reach-prisma",
    files: ["src/app/api/**/*.ts"],
    rules: {
      "no-restricted-imports": [
        "error",
        {
          patterns: [
            {
              /*
                `docs/REVIEW.md` §1.3 / E-3 — the API must not import its trust
                boundary out of a route's presentation folder.

                The dependency arrow has to point UI → API, never back. When it
                pointed back, "the form's schema" and "the API's contract" were
                one object living three directories inside a screen's
                `components/` folder, where nobody looks for a security-relevant
                module — and it stayed that way through a second producer of the
                same payload being written. Shared contracts live in `src/lib`.
              */
              group: ["@/app/*", "@/app/**"],
              message:
                "docs/REVIEW.md §1.3: a route handler must not import from a route's UI folder — the dependency arrow points UI → API, never back. Put the shared contract in src/lib (see src/lib/todo.schema.ts).",
            },
          ],
        },
      ],
    },
  },

  {
    /*
      better-auth's `prismaAdapter` needs the client at module scope, and
      `src/lib/auth.ts` is server-only by construction: it throws at import time
      in production when `BETTER_AUTH_URL` is unset, and its only importers are
      `src/lib/session.ts` and the better-auth route handler. The client half of
      auth is a separate module, `src/lib/auth-client.ts`, which imports none of
      this.
    */
    name: "todo-app/auth-adapter-reaches-prisma",
    files: ["src/lib/auth.ts"],
    rules: {
      "no-restricted-imports": "off",
    },
  },
]);

export default eslintConfig;
