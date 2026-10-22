import { builtinModules } from "node:module";
import eslint from "@eslint/js";
import { defineConfig } from "eslint/config";
import prettierConfig from "eslint-config-prettier";
import globals from "globals";
import tseslint from "typescript-eslint";

const NODE_ONLY = "Node only: src/ runs in browsers too.";
const BROWSER_ONLY = "Browsers only: src/ runs on Node too.";
const MISSING_ON_NODE = "Node 24 does not define it: src/ runs on Node too.";

const browserGlobals = Object.keys(globals.browser);
const nodeGlobals = Object.keys(globals.node);

// The keys of `globals.node` that Node 24 does not define, apart from the
// CommonJS module scope. @types/node declares some of them (ErrorEvent, Web
// Storage), so they would pass both runtime typechecks. Check the list again
// when Node, `globals` or @types/node change.
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
  return createConfig({
    rootDir,
    files: ["**/*.ts"],
    globals: globals.node,
  });
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
