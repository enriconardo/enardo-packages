---
status: draft
type: chore
tier: L
implementer: sonnet/medium
packages: ["@enardo/vitest-config", "@enardo/transaction-manager-mongo", "@enardo/uow-repository-mongo"]
branch: chore/vitest-config/mongo-replica-set-preset
---

# The in-memory replica set of the Mongo adapters' tests moves into `@enardo/vitest-config`

## Why

From the backlog item *The vitest `test` block of the Mongo adapters*, found by the `critic`'s run on the spec of `docs/repo/narrow-preset-rule` (2026-10-22). `@enardo/transaction-manager-mongo` and `@enardo/uow-repository-mongo` hold the same `test` block (`globalSetup`, `include`, `hookTimeout`, `testTimeout`) and the same global setup file. ADR 0010 point 3 and ADR 0011 point 1 move a block that a second package needs into the preset. The spec of `fix/database-mongo/index-definition-change` would add a third copy: the user chose to move the block first, in this branch, and rebase that one on it.

## Probes

In the dev container, vitest 4, `mongodb-memory-server` 10.4.3.

- `__tests__/setup/replica-set.ts` of the two packages → identical (`diff`). Their `__tests__/support/fixtures.ts` differ beyond `connect()`: they stay local.
- `vitest.config.ts` of the two packages → identical (`diff`).
- `vitest list --filesOnly` in `transaction-manager-mongo`, with the package's `include` and without any → the same file, `__tests__/mongo-transaction-manager.test.ts`. vitest's default `include` covers `__tests__/**/*.test.ts`, and no other file matches it.
- A draft preset in `packages/vitest-config` returning `{ globalSetup: [<absolute path of a setup file beside it>], hookTimeout, testTimeout }`, spread into `transaction-manager-mongo`'s `test` → the preset's setup ran, 6 of 6 tests passed. `globalSetup` takes an absolute path built with `fileURLToPath(new URL("./…", import.meta.url))`.
- `mongodb-memory-server` was not installed in `packages/vitest-config` during that run: `require.resolve` from there fails, and vite resolved the import from the consumer's root. A published preset, installed under `node_modules/.pnpm`, needs it linked beside it: hence a peer.
- `vitest.config.ts` is not in any package's typecheck (`typescript-config/library.json` includes `src` and `__tests__`), and the preset ships JavaScript only: the type of `inject("mongoUri")` comes from a `ProvidedContext` declaration in `__tests__`, today in the setup file at `replica-set.ts:3-7`.
- Every mention of the setup file or of `mongodb-memory-server` outside specs and the lockfile (`git grep`) → root `CLAUDE.md:74`, the two packages' `README.md` (`transaction-manager-mongo:60`, `uow-repository-mongo:307` and `:331`), their `package.json` and `vitest.config.ts`.
- Not probed: an install of the packed preset from the registry, with the optional peer. Its only consumers are this repo's packages (ADR 0010, *Consequences*), which resolve it in the workspace.

## Decisions

- **`mongoReplicaSet()`, a function returning the options to spread into `test`**, not a project: the Mongo packages do not use `projects`. It returns `globalSetup` and the two timeouts. `hookTimeout` and `testTimeout` are scalars, which ADR 0011 point 2 lets into a preset when they fit every package on it: they do, since they are there for the replica set's start and its transactions.
- **`include` goes**, from the packages and from the preset: vitest's default finds the same files.
- **The global setup ships in the preset** as `replica-set.js`, as it is today but in JavaScript, and provides `mongoUri`.
- **`mongodb-memory-server` is an optional peer and a devDependency of the preset**, as `vitest` is a peer and a devDependency: a package that calls only `browserProject()` does not install it. Each Mongo package keeps it in its `devDependencies`. Since three packages now list it, it moves into the catalog.
- **The `ProvidedContext` declaration stays in each package**, in `__tests__/support/fixtures.ts`: it must be in the typecheck, which the preset's JavaScript is not. The README of the preset names the key. Not taken: a `.d.ts` shipped by the preset, which `__tests__` would have to import for its side effect.
- No ADR: the decision applies ADR 0010 and ADR 0011.

## Open questions

None.

## Changes

### `@enardo/vitest-config`

- `replica-set.js`, new: the global setup of today's `replica-set.ts`, in JavaScript with JSDoc, starting one single-node replica set per run and providing its URI as `mongoUri`.
- `index.js`: `mongoReplicaSet()`, with its JSDoc, returning `{ globalSetup: [<absolute path of replica-set.js>], hookTimeout: 60_000, testTimeout: 30_000 }`, each with its comment.
- `package.json`: `replica-set.js` in `files`, and in the `lint` and `format` scripts; `mongodb-memory-server: "catalog:"` in `peerDependencies`, with `peerDependenciesMeta` marking it optional, and in `devDependencies`. The description names both presets.
- `README.md`: the `mongoReplicaSet()` row of *Presets*, its usage, the `mongoUri` key and the `ProvidedContext` declaration a package writes, and that a package installs `mongodb-memory-server` itself.

### `@enardo/transaction-manager-mongo`, `@enardo/uow-repository-mongo`

- `vitest.config.ts`: `test: { ...mongoReplicaSet() }`, and the `~` alias as today.
- `__tests__/setup/` removed; the `ProvidedContext` declaration moves into `__tests__/support/fixtures.ts`.
- `package.json`: `@enardo/vitest-config: "workspace:^"` in `devDependencies`; `mongodb-memory-server` becomes `"catalog:"`.
- `README.md`: the sentences on the global setup say it comes from `@enardo/vitest-config`; `uow-repository-mongo`'s tree of `__tests__` loses `setup/`.

### The repo

- `pnpm-workspace.yaml`: `mongodb-memory-server: ^10.4.3` in the catalog.
- Root `CLAUDE.md`, *Testing*: the replica set comes from `mongoReplicaSet()` of `@enardo/vitest-config`, in place of `__tests__/setup/replica-set.ts`.
- `docs/backlog.md`: the item removed.

## Test cases

The change holds no logic of its own to test-first: the cases are the packages' existing suites.

1. `transaction-manager-mongo`'s suite, on the preset → every test passes, as many as on `main`.
2. `uow-repository-mongo`'s suite, on the preset → every test passes, as many as on `main`.
3. `vitest list --filesOnly` in each package → the same files as on `main`.
4. `pnpm verify` → green, `typecheck` included: `inject("mongoUri")` is typed `string` in both fixtures.
5. `pnpm --filter @enardo/vitest-config exec pnpm pack --dry-run` (or `pnpm pack` into the scratchpad) → the tarball holds `index.js` and `replica-set.js`, and its manifest the optional peer.
6. A package of the preset with no Mongo, `@enardo/env` → its tests pass, and `packages/env/node_modules` holds no `mongodb-memory-server`.

## Out of scope

- `@enardo/database-mongo`, which adopts the preset in its own branch.
- The fixtures' `connect()` and `createDatabase()`, which differ between the packages.

## Plan

1. **The preset**: `replica-set.js`, `mongoReplicaSet()`, the manifest, the catalog, the README of `vitest-config`. Lint and format green.
2. **The two packages on it**: configs, setup removed, the declaration moved, manifests, READMEs. Cases 1–4 and 6 green.
3. **Docs**: the root `CLAUDE.md`. Case 5.
4. The backlog item removed, in a commit of its own.
