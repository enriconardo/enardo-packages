---
status: draft
type: feature
tier: M
implementer: sonnet/medium
packages: ["@enardo/eslint-config"]
branch: feature/eslint-config/triple-slash-neutral
---

# Report triple-slash `types` and `lib` references in `runtimeNeutral`'s `src/`

## Why

From the backlog item on `/// <reference types="node" />` (the review of `chore/http/package-hygiene`), revised at its evaluation on 2026-11-06:

A triple-slash directive in `src/` defeats a runtime program, and no check reports it. In a package on `runtimeNeutral`, a `/// <reference types="node" />` in any file of `src/` opens the Node types to the whole browser program, and a `/// <reference lib="dom" />` the DOM to the whole Node program: `types: []` and `lib` keep out only what TypeScript loads by itself. `no-restricted-globals` still reports the values (`process`, `document`); what passes is what it already misses, a type position (`NodeJS.Timeout`, `Buffer`, `HTMLElement`) and a destructuring of `globalThis`. The emitted `.d.ts` drops the directive, so such a type in the public API is `any` for a consumer of the other runtime (`skipLibCheck`).

The directive is a one-line way past a failing runtime typecheck (TS2591 suggests adding `node` to the types), which is what the root `CLAUDE.md` forbids: fix findings, don't suppress them. `@typescript-eslint/triple-slash-reference` lets both through with its defaults (`lib: "always"`, `path: "never"`, `types: "prefer-import"`).

## Probes

In the dev container, TypeScript 5.9.3, typescript-eslint 8.68.0, on throwaway files in `packages/http-client` (removed after):

- browser program (`tsconfig.browser.json`) on two files, one with `/// <reference types="node" />`, the other using `process.env`, `NodeJS.Timeout`, `Buffer` without it → exit 0; the second file alone → TS2591 (`process`, `Buffer`), TS2503 (`NodeJS`). One directive opens the whole program.
- Node program (`tsconfig.node.json`), the same with `/// <reference lib="dom" />`, `document.title`, `HTMLElement` → exit 0; alone → TS2584, TS2304.
- `emitDeclarationOnly` of those files → the `.d.ts` keeps `NodeJS.Timeout`, `Buffer`, `HTMLElement` and drops the directive.
- `eslint` with the current `runtimeNeutral`, on a `src/` file with both directives, `process.env`, `document.title`, `NodeJS.Timeout`, `Buffer` and `HTMLElement` as types, `const { process: p } = globalThis` → only `no-restricted-globals` on `process` and `document`.
- `eslint --print-config` on `src/` → `"@typescript-eslint/triple-slash-reference": [2]`, from `recommendedTypeChecked`, with the rule's defaults: `dist/rules/triple-slash-reference.js:40` of the plugin.
- the same file with an extra entry `["error", { lib: "never", types: "never" }]` on `src/**/*.ts` → reports `types="node"`, `lib="dom"`, and still `path="./index.ts"`: the rule merges its options with its defaults, so `path: "never"` stays.
- `git grep -n 'reference types\|reference lib' -- 'packages/*/src/*' '*.d.ts'` → nothing; `git ls-files 'packages/*/src/*.d.ts'` → nothing. No package on the preset breaks.
- `pnpm view @enardo/eslint-config versions` on the registry → `1.0.0`, `1.1.0`. The manifest's `2.0.0` (the `instanceof BaseError` rule, `2956213`) is unpublished, so this change ships in it, with no new bump.
- packages on `runtimeNeutral`: `env`, `errors`, `http-client`, `http-status` (`git grep -l runtimeNeutral`).
- the docs that state the gap: `packages/typescript-config/README.md:56`, `packages/http-client/CLAUDE.md:69`.

## Decisions

1. **`lib` with `types`.** Proposed at the evaluation: the item named `types` only, and `lib` defeats the Node program in the same way.
2. **In `runtimeNeutral` only, on `src/**/*.ts`.** On `node`, a reference to `node` changes nothing; on `react`, a `types` reference is the common setup (`/// <reference types="vite/client" />`). `__tests__/` is not restricted, as for the preset's other rules. The glob matches a `.d.ts` in `src/`, which is in both programs too.
3. **In `2.0.0`**, unpublished: no version bump.
4. **No automated test.** The config packages have no test runner (root `CLAUDE.md`: at most lint and format), as for the `instanceof BaseError` rule; the cases run as lint checks on throwaway files, before the change (red) and after.
5. **The rewritten item lives in this spec**, not on `main`: the branch removes the item (the user, at intake).

## Open questions

None.

## Changes

- `packages/eslint-config/index.js`: in `runtimeNeutral`'s block, `"@typescript-eslint/triple-slash-reference": ["error", { lib: "never", types: "never" }]`, with a comment saying why (a reference opens one runtime's types to the whole other program); the JSDoc names it.
- `packages/eslint-config/README.md`, *`runtimeNeutral`*: a row for `triple-slash-reference` (catches a `types` or `lib` reference, also in a `.d.ts`; misses Node types that a dependency's declarations bring). The paragraph on the typechecks says what the rule adds.
- `packages/typescript-config/README.md:56`: the browser program still misses them after a reference, and `runtimeNeutral` reports the directive.
- `packages/http-client/CLAUDE.md`, *Checks*: the `tsconfig.browser.json` row's *Misses* says the lint reports the directive; a row for the new rule.
- `docs/backlog.md`: the item leaves, in a commit of its own.

## Test cases

Lint runs in the dev container on throwaway files, removed after, in `packages/http-client` (on `runtimeNeutral`) unless said otherwise:

1. `src/` file with `/// <reference types="node" />` → `@typescript-eslint/triple-slash-reference` error on line 1. On `main`: no error (red).
2. `src/` file with `/// <reference lib="dom" />` → the same error. On `main`: no error (red).
3. `src/` file with `/// <reference path="./index.ts" />` → the same error, on `main` as after: the default is kept.
4. `src/` file `zz-probe.d.ts` with `/// <reference types="node" />` → the same error. On `main`: no error (red).
5. `__tests__/` file with `/// <reference types="node" />` and `/// <reference lib="dom" />` → no `triple-slash-reference` error.
6. A package on `node` (`packages/logger`), `src/` file with `/// <reference types="node" />` → no `triple-slash-reference` error.
7. `pnpm verify:all` → green: the four packages on the preset lint clean.

## Out of scope

- Node types brought into the browser program by a dependency's declarations: `undici` stays restricted by `no-restricted-imports`; no other dependency of the four packages references `node` in its `dist/`.
- A `types` entry added to a `tsconfig.browser.json`: a config change, visible at review.
- A test runner for `@enardo/eslint-config`.

## Plan

1. The spec (this commit).
2. Cases 1, 2, 4 on `main`'s preset: red. The rule, its comment and JSDoc, and the three docs; cases 1–6 green. `[@enardo/eslint-config] feat: report triple-slash types and lib in src`.
3. The backlog item leaves: `[repo] docs: remove the triple-slash backlog item`.
4. `pnpm verify:all`, case 7.
