import { builtinModules } from "node:module";
import eslint from "@eslint/js";
import { defineConfig } from "eslint/config";
import prettierConfig from "eslint-config-prettier";
import globals from "globals";
import tseslint from "typescript-eslint";

const NODE_ONLY = "Node only: src/ runs in browsers too.";
const BROWSER_ONLY = "Browsers only: src/ runs on Node too.";
const MISSING_ON_NODE = "Node 24 does not define it: src/ runs on Node too.";

// Every package and app is bundled (tsdown, vite) or run by vitest, and
// resolved as `moduleResolution: bundler`: a relative import needs no
// extension, so the repo keeps one style, without it. Code that Node ran
// unbundled would need the extensions instead. Only JS and TS extensions are
// refused: `.json`, `.css` and a role suffix (`./product.entity`) stay.
const RELATIVE_IMPORT_EXTENSION = {
  regex: "^(?:\\.{1,2}|~)/.*\\.[cm]?[jt]sx?$",
  message:
    "Drop the extension: the code is bundled and resolved as moduleResolution bundler.",
};

const browserGlobals = Object.keys(globals.browser);
const nodeGlobals = Object.keys(globals.node);

// The keys of `globals.node` that Node 24 does not define, apart from the
// CommonJS module scope. @types/node declares some of them (Web Storage), so
// they would pass both runtime typechecks. Check the list again when Node,
// `globals` or @types/node change.
const missingOnNode = [
  "ErrorEvent",
  "QuotaExceededError",
  "Temporal",
  "localStorage",
  "sessionStorage",
  "Storage",
];

const browserOnly = browserGlobals.filter(
  (name) => !nodeGlobals.includes(name) && !missingOnNode.includes(name),
);
const nodeOnly = nodeGlobals.filter(
  (name) => !browserGlobals.includes(name) && !missingOnNode.includes(name),
);

/**
 * @param {object} options
 * @param {string} options.rootDir The package directory: pass `import.meta.dirname`.
 * @param {string[]} options.files The globs the TypeScript rules apply to.
 * @param {import("eslint").Linter.Globals} options.globals The runtime's globals.
 * @param {import("eslint").Linter.ParserOptions} [options.parserOptions]
 */
function createConfig({
  rootDir,
  files,
  globals: runtimeGlobals,
  parserOptions,
}) {
  return defineConfig(
    {
      ignores: ["dist", "node_modules", "eslint.config.js"],
    },
    eslint.configs.recommended,
    tseslint.configs.recommendedTypeChecked,
    tseslint.configs.stylisticTypeChecked,
    prettierConfig,
    {
      files,
      languageOptions: {
        parser: tseslint.parser,
        parserOptions: {
          projectService: true,
          tsconfigRootDir: rootDir,
          ...parserOptions,
        },
        globals: runtimeGlobals,
      },
      rules: {
        // With verbatimModuleSyntax, only `import type` is erased from the output.
        "@typescript-eslint/consistent-type-imports": "error",
        "@typescript-eslint/no-import-type-side-effects": "error",
        // An empty string is usually as missing as undefined: `value.trim() || undefined`
        // relies on it, and `??` would keep the empty string.
        "@typescript-eslint/prefer-nullish-coalescing": [
          "error",
          { ignorePrimitives: { string: true } },
        ],
        // `async` on a method with nothing to await keeps its errors as
        // rejections, which is what callers of a Promise-returning interface expect.
        "@typescript-eslint/require-await": "off",
        "no-restricted-imports": [
          "error",
          { patterns: [RELATIVE_IMPORT_EXTENSION] },
        ],
      },
    },
    {
      // An error built by another copy of `@enardo/errors` is not an instance
      // of this one's `BaseError`: `instanceof` loses its `code` silently.
      files: ["src/**"],
      rules: {
        "no-restricted-syntax": [
          "error",
          {
            selector:
              'BinaryExpression[operator="instanceof"]:matches([right.name="BaseError"], [right.property.name="BaseError"])',
            message:
              "Recognize an error with isBaseErrorLike and its code (README of @enardo/errors).",
          },
        ],
      },
    },
    {
      // Asymmetric matchers (`expect.any`, `expect.objectContaining`) are typed
      // `any`, and `expect(mock.method)` passes a method unbound by design.
      files: ["__tests__/**"],
      rules: {
        "@typescript-eslint/no-unsafe-assignment": "off",
        "@typescript-eslint/unbound-method": "off",
      },
    },
  );
}

/**
 * Preset for code that runs on Node: shared packages, project packages and
 * the API server.
 *
 * @param {string} rootDir The package directory: pass `import.meta.dirname`.
 */
export function node(rootDir) {
  return defineConfig(
    createConfig({
      rootDir,
      files: ["**/*.ts"],
      globals: globals.node,
    }),
    {
      // A `/// <reference lib="…" />` widens the `lib` of the whole program
      // past the preset's (the DOM, in a Node package), and nothing else
      // reports it. A package widens `lib` in its own tsconfig.json, with a
      // comment. The message is the plugin's and cannot be set.
      files: ["src/**/*.ts"],
      rules: {
        "@typescript-eslint/triple-slash-reference": [
          "error",
          { lib: "never" },
        ],
      },
    },
  );
}

/**
 * Preset for React apps running in the browser.
 *
 * @param {string} rootDir The package directory: pass `import.meta.dirname`.
 */
export function react(rootDir) {
  return createConfig({
    rootDir,
    files: ["**/*.{ts,tsx}"],
    globals: globals.browser,
    parserOptions: {
      ecmaVersion: "latest",
      sourceType: "module",
      ecmaFeatures: { jsx: true },
    },
  });
}

/**
 * Preset for packages whose `src/` runs unchanged in browsers and on Node:
 * `node(rootDir)`, then a block on `src/**\/*.ts` that lets it use only what
 * both runtimes have. No import of `node:*`, of a builtin module or of
 * `undici`; no global that one runtime lacks, also through `globalThis`,
 * and none that Node 24 lacks though `@types/node` declares it.
 *
 * No `/// <reference types="…" />` or `lib` in `src/` either: one opens a
 * runtime's types to the whole program of the other, and the emitted
 * declarations drop it.
 *
 * A package's two runtime typechecks (browser and Node) catch the rest.
 * `undici` is restricted here for its message, and because, installed, it
 * would pull `@types/node` into the browser program through its types,
 * leaving this lint as the only check. The block sets each rule's options
 * whole: a later entry replaces them, it does not merge them.
 *
 * @param {string} rootDir The package directory: pass `import.meta.dirname`.
 */
export function runtimeNeutral(rootDir) {
  return defineConfig(node(rootDir), {
    files: ["src/**/*.ts"],
    rules: {
      // `node()` sets `lib`; `types` is added here, and the options are
      // restated because an entry replaces a rule's options. A `types`
      // reference opens Node's types to the whole browser program, past
      // `types: []`. The message is the plugin's: widen in tsconfig.json.
      "@typescript-eslint/triple-slash-reference": [
        "error",
        { lib: "never", types: "never" },
      ],
      "no-restricted-imports": [
        "error",
        {
          paths: [
            { name: "undici", message: NODE_ONLY },
            ...builtinModules
              .filter((name) => !name.startsWith("node:"))
              .map((name) => ({ name, message: NODE_ONLY })),
          ],
          patterns: [
            { group: ["node:*"], message: NODE_ONLY },
            { group: ["undici/*"], message: NODE_ONLY },
            // Restated: this entry replaces the options of createConfig's.
            RELATIVE_IMPORT_EXTENSION,
          ],
        },
      ],
      "no-restricted-globals": [
        "error",
        {
          globals: [
            ...browserOnly.map((name) => ({ name, message: BROWSER_ONLY })),
            ...nodeOnly.map((name) => ({ name, message: NODE_ONLY })),
            ...missingOnNode.map((name) => ({
              name,
              message: MISSING_ON_NODE,
            })),
          ],
          checkGlobalObject: true,
        },
      ],
    },
  });
}
