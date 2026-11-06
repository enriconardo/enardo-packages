---
status: draft
type: feature
tier: M
implementer: sonnet/medium
packages: ["@enardo/eslint-config"]
branch: feature/eslint-config/triple-slash-neutral
---

# Report triple-slash `lib` references in `src/`, and `types` ones on `runtimeNeutral`

## Why

From the backlog item on `/// <reference types="node" />` (the review of `chore/http/package-hygiene`), revised at its evaluation on 2026-11-06:

A triple-slash directive in `src/` defeats the `lib` and `types` a preset sets, and no check reports it. A `/// <reference lib="dom" />` in any file of `src/` opens the DOM to the whole program: on `library.json` and `node-app.json`, whose `lib: ["ES2022"]` leaves the DOM out on purpose (the major of `fix/typescript-config/no-dom-in-node-presets`), `document.title` compiles again, and no lint reports it. In a package on `runtimeNeutral`, a `/// <reference types="node" />` opens the Node types to the whole browser program, and the `lib` reference the DOM to the whole Node program: `types: []` and `lib` keep out only what TypeScript loads by itself. There `no-restricted-globals` still reports the values (`process`, `document`); what passes is what it already misses, a type position (`NodeJS.Timeout`, `Buffer`, `HTMLElement`) and a destructuring of `globalThis`. The emitted `.d.ts` drops the directive, so such a type in the public API is `any` for a consumer of the other runtime (`skipLibCheck`).

The sanctioned way to widen `lib` is an override in the package's `tsconfig.json`, with a comment (`@enardo/typescript-config`'s README, line 16); the directive does it from a source file, past the preset. `@typescript-eslint/triple-slash-reference` lets both through with its defaults (`lib: "always"`, `path: "never"`, `types: "prefer-import"`).

No `src/` in the repo's history ever held such a directive (`git log --all -G'reference (types|lib)='`: docs and specs only). Two lint rules were dropped on that ground (`no-restricted-exports`, `naming-convention`, *Dropped* of `docs/backlog.md`); this one goes in because the harm is silent (an `any` in a consumer's types, a `ReferenceError` at run time, not a rename caught at review), and because `@enardo/eslint-config` 2.0.0 is still unpublished: added now it costs no major, added after the publish it does.

## Probes

In the dev container, TypeScript 5.9.3, typescript-eslint 8.68.0, on throwaway files (removed after):

- `packages/http-client`, browser program (`tsconfig.browser.json`) on two files, one with `/// <reference types="node" />`, the other using `process.env`, `NodeJS.Timeout`, `Buffer` without it → exit 0; the second file alone → TS2591 (`process`, `Buffer`), TS2503 (`NodeJS`). One directive opens the whole program.
- the same, Node program (`tsconfig.node.json`), with `/// <reference lib="dom" />`, `document.title`, `HTMLElement` → exit 0; alone → TS2584, TS2304.
- `emitDeclarationOnly` of those files → the `.d.ts` keeps `NodeJS.Timeout`, `Buffer`, `HTMLElement` and drops the directive.
- `eslint` with the current `runtimeNeutral`, on a `src/` file with both directives, `process.env`, `document.title`, `NodeJS.Timeout`, `Buffer` and `HTMLElement` as types, `const { process: p } = globalThis` → only `no-restricted-globals` on `process` and `document`.
- `packages/logger` (on `node`), `/// <reference lib="dom" />` + `document.title` in `src/` → `eslint` exit 0; its `tsconfig.json` program: no diagnostic, TS2584 without the reference (the `critic`'s run).
- `eslint --print-config` on `src/` → `"@typescript-eslint/triple-slash-reference": [2]`, from `recommendedTypeChecked`, with the rule's defaults: `dist/rules/triple-slash-reference.js:40` of the plugin.
- an extra entry `["error", { lib: "never", types: "never" }]` on `src/**/*.ts` → reports `types="node"`, `lib="dom"`, and still `path="./index.ts"`: the rule merges its options with its defaults, so `path: "never"` stays. Its message is fixed: "Do not use a triple slash reference for dom, use `import` style instead".
- `git grep -n 'reference types\|reference lib' -- 'packages/*/src/*' '*.d.ts'` → nothing; `git ls-files 'packages/*/src/*.d.ts'` → nothing. No package here breaks.
- the projects (`~/Projects/*`, `git grep 'reference \(types\|lib\)='`): only `cambusa/apps/web/src/vite-env.d.ts`, `/// <reference types="vite/client" />`, on `react`; `cambusa/apps/api-server` is on `node`, with none.
- `pnpm view @enardo/eslint-config versions` on the registry → `1.0.0`, `1.1.0`. The manifest's `2.0.0` (the `instanceof BaseError` rule, `2956213`) is unpublished, so this change ships in it, with no new bump.
- packages on `runtimeNeutral`: `env`, `errors`, `http-client`, `http-status` (`git grep -l runtimeNeutral`).
- the docs that state the gap: `packages/typescript-config/README.md:56`, `packages/http-client/CLAUDE.md:69`.

## Decisions

1. **`lib: "never"` on `src/**/*.ts` in `node()`**, which `runtimeNeutral` inherits. It refuses every `lib` reference, the ES ones too (`esnext.disposable`): a wider `lib` goes in the package's `tsconfig.json`, as the presets' README says. Not on `react`, where a `lib` reference can be legitimate (`webworker`).
2. **`types: "never"` in `runtimeNeutral` only**, which restates `lib: "never"` (a later entry replaces a rule's options). On `node`, a reference to `node` changes nothing; on `react`, a `types` reference is the common setup (`vite/client`).
3. **`src/` only.** `__tests__/` is not restricted, as for the presets' other rules. The glob matches a `.d.ts` in `src/`, which is in the programs too.
4. **In `2.0.0`**, unpublished: no version bump.
5. **No automated test.** The config packages have no test runner (root `CLAUDE.md`: at most lint and format), as for the `instanceof BaseError` rule; the cases run as lint checks on throwaway files, before the change (red) and after.
6. **The rule's message stays the plugin's**, which cannot be set: the comment in `index.js` and the README say why, and that the fix is a `lib` or `types` override in the package's `tsconfig.json`.
7. **The rewritten item lives in this spec**, not on `main`: the branch removes the item (the user, at intake).

## Open questions

None.

## Changes

- `packages/eslint-config/index.js`:
  - `node()`: a block on `src/**/*.ts` with `"@typescript-eslint/triple-slash-reference": ["error", { lib: "never" }]`, and a comment: a `lib` reference widens the whole program past the preset's `lib`; a package widens it in its `tsconfig.json`.
  - `runtimeNeutral`: the same rule with `{ lib: "never", types: "never" }` in its block, and a comment: a `types` reference opens one runtime's types to the whole other program; the options are restated because the entry replaces them. The JSDoc names it.
  - `react` unchanged.
- `packages/eslint-config/README.md`: a row in *Rule choices* for the `node` setting; a row in the *`runtimeNeutral`* table (catches a `types` or `lib` reference, also in a `.d.ts`; misses Node types a dependency's declarations bring). Both say the message is the plugin's and what to do instead.
- `packages/typescript-config/README.md:56`: the browser program still misses them after a reference, and a lint rule reports the directive. No package named: the README names only its dependencies (root `CLAUDE.md`), and line 54 says "lint rules" already.
- `packages/http-client/CLAUDE.md`, *Checks*: the `tsconfig.browser.json` row's *Misses* says the lint reports the directive; a row for the rule.
- `docs/backlog.md`: the item leaves, in a commit of its own.

## Test cases

Lint runs in the dev container on throwaway files in `src/` or `__tests__/`, removed after. In `packages/http-client` (on `runtimeNeutral`):

1. `/// <reference types="node" />` in `src/` → `@typescript-eslint/triple-slash-reference` on line 1. On `main`: none (red).
2. `/// <reference lib="dom" />` in `src/` → the same. On `main`: none (red).
3. `/// <reference path="./index.ts" />` in `src/` → the same, on `main` as after: the default is kept.
4. `/// <reference types="node" />` in `src/zz-probe.d.ts` → the same. On `main`: none (red).
5. `/// <reference types="node" />` and `/// <reference lib="dom" />` in `__tests__/` → no `triple-slash-reference`.

In `packages/logger` (on `node`):

6. `/// <reference lib="dom" />` in `src/` → `triple-slash-reference`. On `main`: none (red).
7. `/// <reference lib="esnext.disposable" />` in `src/` → the same: every `lib` is refused. On `main`: none (red).
8. `/// <reference types="node" />` in `src/` → no `triple-slash-reference`.
9. `/// <reference lib="dom" />` in `__tests__/` → no `triple-slash-reference`.

And:

10. `pnpm verify:all` → green: no package here holds a reference.

No package here is on `react`: its preset is unchanged in the diff, and not probed.

## Out of scope

- `"types": ["node"]` added to a `tsconfig.browser.json`, the route TS2591 suggests: a lint rule does not read a `tsconfig.json`, and closing it needs a check of its own.
- Node types brought into the browser program by a dependency's declarations: `undici` stays restricted by `no-restricted-imports`; no other dependency of the four packages references `node` in its `dist/`.
- `react`.
- A test runner for `@enardo/eslint-config`.

## Plan

1. The spec (its commits).
2. Cases 1, 2, 4, 6, 7 on `main`'s presets: red. The two rule entries, their comments and the JSDoc, and the three docs; cases 1–9 green. `[@enardo/eslint-config] feat: report triple-slash lib and types in src`.
3. The backlog item leaves: `[repo] docs: remove the triple-slash backlog item`.
4. `pnpm verify:all`, case 10.
