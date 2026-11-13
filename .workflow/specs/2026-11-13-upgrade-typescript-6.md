---
status: approved
branch: chore/repo/upgrade-typescript-6
---

# Upgrade the repo to TypeScript 6.0.3, with the node types explicit in the presets

## Why

The user asked to move everything to the latest TypeScript, 7.0.2. Probes on throwaway projects and on a clone of this repo (2026-11-13) found:

- TypeScript 7 ships the native `tsc` and no longer exports the JS compiler API: `require('typescript')` holds only `version` and `versionMajorMinor`.
- typescript-eslint 8.72.2, the latest, declares the peer `typescript >=4.8.4 <6.1.0` (as 8.68.0, the version installed, does), and refuses to load under TS 7 ("typescript-eslint does not support TS 7.0"). Its support is tracked in typescript-eslint#10940, for TS ≥ 7.1.
- tsdown 0.19.0's declaration build fails under TS 7 (`Cannot read properties of undefined (reading 'useCaseSensitiveFileNames')`), unless `isolatedDeclarations` is set.
- The one TS 7 layout that works aliases `typescript` to `@typescript/typescript6` and installs TS 7 under another name for `tsc`. Every project that uses `@enardo/eslint-config` would have to copy that alias.

The user chose to wait for typescript-eslint before TS 7, and to move to TypeScript 6 now: the release that brings most of the changes TS 7 keeps, so that TS 7 later is mostly a catalog change.

The trial of TS 6.0.3 on a clone of this repo found one cause of failure. `types` no longer defaults to every `@types/*` package, and `library.json` and `node-app.json` set none. So `@types/node` is no longer loaded, and 9 packages fail `typecheck` (TS2591, TS2304, and errors that follow from them) and `lint` (`no-unsafe-*` on the unresolved types). No option of the presets is deprecated in TS 6, and the builds pass.

## What

- The catalog's `typescript` is `^6.0.3`, the latest 6.x on 2026-11-13. Every package still takes it as `catalog:`.
- `@enardo/typescript-config` 2.0.0, unpublished (the registry holds 1.1.0, so 2.0.0 is already a major): `library.json` and `node-app.json` set `"types": ["node"]`.
  - A project on any TypeScript version gets the Node types from these two presets, and only those. A global from another `@types/*` package, which TS 5 loaded on its own, needs that package in the project's `types`, with `"node"` repeated: a project's `types` replaces the preset's list (`["node", "vitest/globals"]`).
  - A project that extends them needs `@types/node` installed, or `tsc` fails with TS2688, as `runtime-node.json` already says.
  - `base.json`, `react-app.json` and the runtime presets do not change. A config that extends `base.json` directly gets no `@types/*` under TS 6, and the README says so.
  - Its README keeps "TypeScript 5.5+" as the minimum for `${configDir}`, adds that the presets are checked with TypeScript 6.0, and states the two points above. The table rows of `library.json` and `node-app.json` list "the `node` types", as the `runtime-node.json` row does, and the line saying that `runtime-node.json` needs `@types/node` installed names the two presets too.
- `@enardo/database` and `@enardo/id-generator` take `@types/node` (`catalog:`) as a devDependency, as the other 17 packages do. Their published content does not change.
- tsdown is `^0.23.7`, the latest. It declares TS 6 as a peer, and 0.19.0 does not. The `dist/` file names stay `index.mjs` and `index.d.mts`. Their content changes shape: inline `export declare` in the `.d.mts` instead of a closing `export { … }`, and no `//#region` markers. Both forms are plain TypeScript declaration syntax that TS 5 reads; the trial found the output independent of the compiler (TS 6 with tsdown 0.19.0 gave byte-identical files). The new output reaches consumers only when a package is next published.
- typescript-eslint is `^8.72.2`: the lockfile moves from 8.68.0 to 8.72.2, with its `@typescript-eslint/*` packages. TS 6.0.3 does not need it (8.68.0 already accepts `<6.1.0`): it brings lint up to the latest 8.x, in a commit of its own, which also fixes the findings it brings, if any. `@enardo/eslint-config` packs `^8.72.2` through `catalog:`, so its manifest changes: it ships with its 3.0.0, unpublished (the registry holds 1.1.0), with no further bump.
- Out of scope: TypeScript 7; publishing (the `publish` skill, approved by the user); new compiler options that TS 6 adds.

## Decisions

1. **TypeScript 6.0.3, not 7.0.2.**
   - TS 7 with the `@typescript/typescript6` alias was rejected: it is a workaround that every consuming project would have to copy, and later take out again. It would also be a second migration once typescript-eslint supports TS 7.
   - TS 7 without type-aware lint was rejected: it breaks ADR 0002.
   - Doing nothing was rejected: TS 6 does now the preset work that TS 7 needs anyway.
2. **`types: ["node"]` in `library.json` and `node-app.json`, not in each package.**
   - 17 of the 19 TypeScript packages have `@types/node`, and 9 fail without the Node types (measured). Under ADR 0011, a list that a second package needs moves into a preset.
   - The other presets already set `types`.
   - `"types": ["*"]`, TS 6's way back to loading every `@types/*` (from TS 6's documentation, not checked here), was rejected: it keeps the implicit loading TS 6 moves away from, and TS 5 consumers would read `*` as a package name (presumably TS2688, not run).
3. **A major of `@enardo/typescript-config`.** A consumer project relying on an `@types/*` package other than node, or lacking `@types/node`, breaks on upgrade, on TS 5 as on TS 6. The unpublished 2.0.0 is that major: the registry holds 1.1.0 (the user, at checkpoint 1), so the version does not change.
4. **`@types/node` in `database` and `id-generator`, not `types: []` in their tsconfig.**
   - It keeps "a package on `library.json` has the Node types" without an exception.
   - The override would be the one list that only two packages repeat, and `src/` of neither runs in browsers (they have no runtime programs).
   - `database` and `id-generator` do not use Node today: they get the types only so that the preset holds without an exception.
   - Not yet run in the trial, which tried only the override: the chunk's check proves it.
5. **tsdown 0.23.7 now, in a commit of its own.**
   - Keeping 0.19.0 gives byte-identical output, measured, but an unmet peer warning on every install.
   - TS 7 needs a newer tsdown anyway.
   - Its own commit keeps the output change apart from the compiler change.
6. **typescript-eslint 8.72.2, in a commit of its own.** Not needed by TS 6; the latest 8.x, kept apart so that a lint finding it brings is traced to it. Doing nothing (8.68.0) is the alternative; the user confirmed 8.72.2 at checkpoint 1, knowing TS 6 does not need it.
7. **No `typescript` peer in the presets.** A consumer project's TypeScript is chosen in its own repo. typescript-eslint, a dependency of `@enardo/eslint-config`, already states its range through its own peer.

## Test cases

No test-first: config and tooling only. The checks prove it:

- `pnpm install` with TS 6.0.3, tsdown 0.23.7 and typescript-eslint 8.72.2: `pnpm peers check` reports no issue.
- `pnpm verify:all --force`: green on every package. In the trial: `typecheck` and `lint` 48/48, `test` 25/25 with the browser tests. Under TS 6 a deprecated option is an error, so this also proves no preset option the packages extend is deprecated.
- `database` and `id-generator` typecheck with `@types/node` installed and `library.json`'s `types: ["node"]`.
- After tsdown 0.23.7, every package's `exports` paths exist (`dist/index.mjs`, `dist/index.d.mts`). That the declarations still say the same things is proven only by the build and by the dependents' `typecheck` and `lint`, which read them through `dist/`; a leaf package's declarations have no consumer here.
- `pnpm --filter @enardo/errors dev` (tsdown 0.23.7 `--watch`) starts and builds once; it is stopped after the first build.
- `node-app.json`, which no package here extends: a throwaway `tsconfig.json` extending it, in a package with `@types/node` (not committed), typechecks under TS 6 a file using `process`. `react-app.json` and `base.json` do not change; the trial typechecked a file against `react-app.json` under TS 6 with no deprecation.

## Chunks

Constraints of the split, from the trial:

- `types: ["node"]` without `@types/node` in `database` and `id-generator` fails TS2688: they go in one commit.
- TS 6 before the `types` change fails 9 packages: the presets change first (on TS 5, where `types: ["node"]` only narrows what loads) or with it.
- tsdown 0.23.7 on TS 5.9.3 was not probed: tsdown goes after TS 6.
- Order: presets with `@types/node`, then TS 6, then tsdown, then typescript-eslint. No version changes: `@enardo/typescript-config` 2.0.0 and `@enardo/eslint-config` 3.0.0 are unpublished majors over the registry's 1.1.0.
- tsdown 0.19.0 declares `typescript` as an optional peer and no `strictPeerDependencies` is set: TS 6 before the tsdown commit gives a peer warning, not a failure.
- Every chunk is no test-first: config and tooling only.

- [x] 1. Node types explicit in the presets (no test-first: config): packages/typescript-config/library.json, packages/typescript-config/node-app.json, packages/typescript-config/README.md (the two table rows, the `runtime-node.json` line naming both presets, the `types` replacement and `@types/node` points, the `base.json` note), packages/database/package.json, packages/id-generator/package.json, pnpm-lock.yaml; cases: `database` and `id-generator` typecheck with `@types/node` installed and `library.json`'s `types: ["node"]`, `pnpm verify:all --force` green on TS 5.9.3, throwaway `node-app.json` typecheck of a file using `process`
- [x] 2. TypeScript 6.0.3 (no test-first: tooling): pnpm-workspace.yaml (catalog `typescript: ^6.0.3`), pnpm-lock.yaml, packages/typescript-config/README.md ("checked with TypeScript 6.0", keeping "TypeScript 5.5+" for `${configDir}`); cases: `pnpm verify:all --force` green on every package (no deprecated option under TS 6), `react-app.json` and `base.json` typecheck under TS 6 with no deprecation
- [x] 3. tsdown 0.23.7 (no test-first: tooling): pnpm-workspace.yaml (catalog `tsdown: ^0.23.7`), pnpm-lock.yaml; cases: `pnpm peers check` reports no issue, every package's `exports` paths exist after the build, dependents' `typecheck` and `lint` pass on the new `dist/`, `pnpm --filter @enardo/errors dev` starts and builds once, `pnpm verify:all --force` green
- [ ] 4. typescript-eslint 8.72.2 (no test-first: tooling): pnpm-workspace.yaml (catalog `typescript-eslint: ^8.72.2`), pnpm-lock.yaml, and the source files of the findings it brings, if any (one commit; past about 6 files, back to the user); cases: `pnpm peers check` reports no issue, `pnpm verify:all --force` green
