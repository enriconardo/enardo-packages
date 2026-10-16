import eslint from "@eslint/js";
import { defineConfig } from "eslint/config";
import prettierConfig from "eslint-config-prettier";
import globals from "globals";
import tseslint from "typescript-eslint";

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
