---
status: draft
type: feature
tier: L
implementer: sonnet/medium
packages: ["@enardo/vitest-config", "@enardo/eslint-config", "@enardo/typescript-config", "@enardo/http-client"]
branch: feature/repo/runtime-neutral-presets
---

# Presets for packages that run in browsers and on Node

## Why

The first *Queued* item of `docs/backlog.md`, `@enardo/env` 2.0, makes `@enardo/env` run in browsers and on Node, with its tests in browsers too. `@enardo/http-client` is the only package with those checks today, all in its own files:

- the `browser` test project of `vitest.config.ts`;
- `tsconfig.browser.json` and `tsconfig.node.json`, which typecheck `src/` as each runtime sees it;
- the `src/**` block of `eslint.config.js`, which restricts the imports and globals of one runtime.

The rules say that the second package to need them moves them into presets: the browser project by `packages/http-client/CLAUDE.md` (*Checks*), the other two by the root `CLAUDE.md` (an override two packages need moves into the preset). `@enardo/env` would be that second package, so the move comes first, in a task of its own, decided with the user at the intake of `@enardo/env` 2.0. `@enardo/http-client` moves onto the presets; `@enardo/env` adopts them in its own task.

## Probes

In the dev container (Node 24.21.0, turbo 2.10.12, vitest 4.1.11):

- Turbo's key: `echo "// probe" >> packages/eslint-config/index.js`, then `turbo run test lint typecheck --filter=@enardo/http-client --dry=json` → the hashes of `http-client#lint`, `#test` and `#typecheck` change. A config package with no `build` script still invalidates the tasks of the packages that depend on it.
- Runtime presets of `typescript-config`, written temporarily with `${configDir}/src/**/*` as `include` and added to its `exports`; `http-client`'s program `{ "extends": ["./tsconfig.json", "@enardo/typescript-config/runtime-browser.json"] }` → `--listFilesOnly` lists `src/` only (and the `dist/` declarations it imports), `--showConfig` keeps the package's `isolatedDeclarations` and takes the preset's `lib` and `types`; both programs pass; `process.env` in `src/` fails the browser one (TS2591), `document.title` the Node one (TS2584).
- A vitest preset package, in a throwaway clone (`git clone` into the container's `/tmp`, `pnpm install` there): `packages/vitest-config` with `@vitest/browser-playwright` and `playwright` (`catalog:`) as `dependencies` and a `browserProject()` returning the project of `http-client`'s config; `http-client` without those two devDependencies, with `projects: [{ node }, browserProject()]` → 28 files, 1171 tests passed in `node`, Chromium, Firefox and WebKit. The same clone on `main` → 28 files, 1171 tests.
- `@vitest/browser-playwright` 4.1.11 → peers `vitest: "4.1.11"`, `playwright: "*"`.
- Two flat-config entries setting `no-restricted-imports` on `src/**/*.ts`, the first with `paths: [a]`, the second with `paths: [b]` → `--print-config` gives `[2, { paths: [b] }]`. The later entry replaces the options; it does not merge them.
- `docker/playwright/check-version.sh` compares the Dockerfile, the catalog and every `playwright@` the lockfile installs: a dependency of another package through `catalog:` keeps one version.
- What names the rules that move: `git grep -n -i "shared preset\|opts in\|the reference\|missingOnNode"` → root `CLAUDE.md:73`, `docs/backlog.md:31,36`, `packages/http-client/CLAUDE.md:79,85`, `packages/http-client/eslint.config.js`. ADR 0001, *Alternatives considered*: "A third package for vitest configs: 13 lines in two variants did not justify it; vitest configs stay local."

## Decisions

Taken with the user at intake:

1. **The browser project goes in a new package, `@enardo/vitest-config`**, as the spec of `chore/repo/browser-tests` foresaw (its decision 10), and not in a root file: turbo sees no root file as a dependency of a package (ADR 0001), and a package is judged as if published alone, where a relative import out of it resolves to nothing. It overturns what ADR 0001 left out, so ADR 0010 records it, drafted with this spec.
2. **The runtime typechecks go in `@enardo/typescript-config`**, as two presets laid over a package's own `tsconfig.json` through an `extends` array, so the package keeps its overrides.

Taken in this spec:

3. **`@enardo/eslint-config` gets a preset, `runtimeNeutral(rootDir)`**: `node(rootDir)`, then the `src/**/*.ts` block of `http-client`'s `eslint.config.js` (imports of `node:*`, of the builtin modules and of `undici`; globals of one runtime, and those Node 24 lacks, also through `globalThis`). The list of the globals Node 24 lacks moves with it. Since a later entry replaces a rule's options (*Probes*), the preset holds every restriction: `undici` gets the generic Node-only message, and `http-client`'s *Node transport settings go through `fetchImpl`* stays in its `CLAUDE.md`. Not taken: an option for extra restrictions, which no package needs today.
4. **`@enardo/vitest-config` carries `@vitest/browser-playwright` and `playwright`** as `dependencies` (`catalog:`), and `vitest` as a peer, as `@enardo/eslint-config` carries the lint plugins and peers `eslint`: a package that opts in adds one devDependency. Not taken: both as peers, which every package would list for code it never imports.
5. **`browserProject()` checks `PLAYWRIGHT_WS_ENDPOINT` when called**, with the message `http-client`'s config throws today, so a package's config fails at load outside the dev container, as now.
6. **Versions**: `@enardo/eslint-config` and `@enardo/typescript-config` 1.1.0 (a new preset each), `@enardo/vitest-config` 1.0.0, like every other package's first version. `@enardo/http-client` keeps 1.0.0: its `dist/` and its `dependencies` do not change.

## Open questions

None.

## Changes

`packages/vitest-config` (new): `package.json` (`files: ["index.js"]`, scripts `lint`, `lint:fix`, `format`, `format:check`, as `eslint-config`), `eslint.config.js` as `eslint-config`'s, `index.js` exporting `browserProject()` with JSDoc and the comments `http-client`'s config has today, `README.md` (the preset, usage, `*.node.test.ts`, the `playwright` service of `docker/README.md`).

`packages/typescript-config`: `runtime-browser.json` (`lib` ES2022, DOM, DOM.Iterable; `types: []`; `include` `${configDir}/src/**/*`) and `runtime-node.json` (`lib` ES2022; `types: ["node"]`; the same `include`), in `exports`; the README: both presets, that they are laid over a package's own `tsconfig.json` and are no base of their own, and the `typecheck` script that runs them.

`packages/eslint-config`: `runtimeNeutral(rootDir)` in `index.js`, with JSDoc and the comment on `missingOnNode`; the README: the preset in the table, what it restricts and misses (the table of `http-client`'s *Checks*, for the lint rows), and to check `missingOnNode` again when Node, `globals` or `@types/node` change.

`packages/http-client`:
- `vitest.config.ts`: `projects: [{ extends: true, test: { name: "node" } }, browserProject()]`;
- `tsconfig.browser.json`, `tsconfig.node.json`: an `extends` array, `./tsconfig.json` then the preset, with their one-line comments;
- `eslint.config.js`: `export default runtimeNeutral(import.meta.dirname);`;
- `package.json`: `@enardo/vitest-config` (`workspace:^`) in, `@vitest/browser-playwright`, `playwright` and `globals` out of `devDependencies`;
- `CLAUDE.md`, *Checks*: the checks come from the three presets; the `undici` message line; the opt-in paragraph says how a package opts in (the presets, `*.node.test.ts`, `__tests__/support/`), the list of globals points to `@enardo/eslint-config`'s README.

Root `CLAUDE.md`: *Layout* names `packages/vitest-config`; *Testing* points to the presets for opting in, `http-client` staying the example.

`docs/backlog.md`: the item *Runtime checks for `@enardo/errors` and `@enardo/http-status`* says that the presets exist (no move left for them to make); the item *`@types/node` is ahead of the runtime* names `runtimeNeutral`'s list instead of `http-client`'s `missingOnNode`.

`docs/adr/`: `0010-a-vitest-preset-package.md`, accepted at checkpoint 1; ADR 0001's status names it; the index.

`pnpm-lock.yaml`: from `pnpm install`.

## Test cases

The config packages have no test runner: each case is a check run in the dev container, recorded in the step's commit body. "Same as on `main`" compares with the output of the same command run on `main` first.

1. `pnpm --filter @enardo/http-client test` → 28 files, 1171 tests, in the `node` project and in `browser` on Chromium, Firefox and WebKit: the same as on `main`.
2. `pnpm exec eslint --print-config src/index.ts` in `packages/http-client` → `no-restricted-imports` and `no-restricted-globals` the same as on `main`, but the message of `undici` and `undici/*`; `--print-config __tests__/index.test.ts` → neither rule set, as on `main`.
3. `tsc -p tsconfig.browser.json --showConfig` and `-p tsconfig.node.json --showConfig` in `packages/http-client` → the same `compilerOptions` and `files` as on `main`.
4. In `packages/http-client/src`, a probe file, removed afterwards: `process.env` fails `tsconfig.browser.json`; `document.title` fails `tsconfig.node.json`; `import "node:fs"`, `import "fs"`, `import "undici"`, `window`, `globalThis.process` and `localStorage` each fail `lint`, `localStorage` with the Node 24 message.
5. Turbo's key: a comment appended to `packages/vitest-config/index.js` changes the `--dry=json` hash of `@enardo/http-client#test`; one in `runtime-node.json` changes `#typecheck`; one in `packages/eslint-config/index.js` changes `#lint`.
6. `PLAYWRIGHT_WS_ENDPOINT= pnpm --filter @enardo/http-client exec vitest run` → fails at config load with the message of decision 5.
7. `docker/playwright/check-version.sh` passes, and `pnpm-lock.yaml` installs one `playwright` version.
8. `pnpm verify:all` → green.

## Risks

- **A preset that checks less than the files it replaces**: the browser project on fewer files, a global or an import no longer restricted, a typecheck over fewer files. Cases 1 to 4 compare with `main`.
- **A preset change that re-runs nothing**: case 5.

## Out of scope

- `@enardo/env` adopting the presets: its own task, the next in *Queued*.
- `isolatedDeclarations`, an override of `http-client`'s `tsconfig.json`: the task of the second package that needs it moves it.
- `@enardo/errors` and `@enardo/http-status`, which stay in *To evaluate*.
- Publishing: a session of its own.

## Plan

Not test-first: the config packages have no test runner, and no behavior a consumer sees changes. Each step ends with its cases, run against `main`'s output, and `pnpm verify`.

1. `@enardo/vitest-config`, and `http-client`'s `vitest.config.ts` and `package.json` on it; `pnpm install`. Cases 1, 6, 7, and 5 for `#test`.
2. The runtime presets of `@enardo/typescript-config`, and `http-client`'s two programs on them. Cases 3, 4 (typecheck), and 5 for `#typecheck`.
3. `runtimeNeutral` in `@enardo/eslint-config`, and `http-client`'s `eslint.config.js` on it; `globals` out of its `devDependencies`. Cases 2, 4 (lint), and 5 for `#lint`.
4. The docs: the three READMEs, `http-client`'s `CLAUDE.md`, the root `CLAUDE.md`, the backlog, ADR 0001's status and the index.
5. The versions of decision 6. Case 8.
