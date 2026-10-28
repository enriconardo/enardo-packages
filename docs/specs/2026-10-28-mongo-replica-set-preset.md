---
status: done
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
- An optional peer, in a throwaway pnpm 11.28.9 workspace (`node:24-bookworm`): a packed stand-in preset with `is-odd` as its optional peer, installed from its tarball by a package that also depends on `is-odd` → the preset's own `require.resolve("is-odd")` finds it, from `.pnpm/fake-preset@…_is-odd@3.0.1`. A second package of that workspace without `is-odd` shares the same instance, so it resolves too: within one workspace the peer cannot be shown missing.
- The timeouts: vitest 4.1.12 awaits a global setup with no timeout (`vitest/dist/chunks/cli-api.B0Pz1_R7.js:10809-10816`), and `hookTimeout` bounds `beforeAll`/`beforeEach` only (`:9236`) (the `critic`'s reading). At vitest's defaults (`--hookTimeout=10000 --testTimeout=5000`): `transaction-manager-mongo` 6 of 6 in 974 ms, `uow-repository-mongo` 40 of 40 in 8.2 s, the slowest test 306 ms (the `critic`'s run); and `turbo run test --force -- --hookTimeout=10000 --testTimeout=5000`, every package at once as under `pnpm verify` → 28 of 28 tasks green, 40 s. The timeouts came with the import from `en-monorepo` (2099677), with no reason recorded.
- `vitest.config.ts` is not in any package's typecheck (`typescript-config/library.json` includes `src` and `__tests__`), and the preset ships JavaScript only: the type of `inject("mongoUri")` comes from a `ProvidedContext` declaration in `__tests__`, today in the setup file at `replica-set.ts:3-7`.
- `pnpm view @enardo/vitest-config versions --registry https://npm.enriconardo.com`, on the host outside the repo → `["1.0.0"]`.
- Every mention of the setup file or of `mongodb-memory-server` outside specs and the lockfile (`git grep`) → root `CLAUDE.md:74`, the two packages' `README.md` (`transaction-manager-mongo:60`, `uow-repository-mongo:307` and `:331`), their `package.json` and `vitest.config.ts`.
## Decisions

- **`mongoReplicaSet()`, a function returning the options to spread into `test`**, not a project: the Mongo packages do not use `projects`. It returns `globalSetup` only.
- **`include`, `hookTimeout` and `testTimeout` go**, from the packages and from the preset: vitest's default `include` finds the same files, and every suite passes at the default timeouts, alone and all at once. A timeout comes back, with its measured reason, if a run needs it.
- **The two presets share a package, as ADR 0010 set**: a change to `replica-set.js` re-runs the browser suites of `env`, `errors`, `http-client` and `http-status`, and a change to `browserProject()` the Mongo suites; a package that calls only `mongoReplicaSet()` installs `playwright` and `@vitest/browser-playwright`, and loads them with `index.js`. Both cost little in this workspace; the README says the second. Not taken: a subpath export or a package of its own, for costs no one has met.
- **The global setup ships in the preset** as `replica-set.js`, as it is today but in JavaScript, and provides `mongoUri`.
- **`mongodb-memory-server` is an optional peer and a devDependency of the preset**, as `vitest` is a peer and a devDependency: a package that calls only `browserProject()` does not install it. Each Mongo package keeps it in its `devDependencies`. Since three packages now list it, it moves into the catalog.
- **The `ProvidedContext` declaration stays in each package**, in `__tests__/support/fixtures.ts`: it must be in the typecheck, which the preset's JavaScript is not. The README of the preset names the key. Not taken: a `.d.ts` shipped by the preset, which `__tests__` would have to import for its side effect.
- **`@enardo/vitest-config` 1.1.0**: the change adds an export and an optional peer, and 1.0.0 is on the registry.
- No ADR: the decision applies ADR 0010 and ADR 0011.

## Open questions

None.

## Changes

### `@enardo/vitest-config`

- `replica-set.js`, new: the global setup of today's `replica-set.ts`, in JavaScript with JSDoc, starting one single-node replica set per run and providing its URI as `mongoUri`.
- `index.js`: `mongoReplicaSet()`, with its JSDoc, returning `{ globalSetup: [<absolute path of replica-set.js>] }`.
- `package.json`: `replica-set.js` in `files`, and in the `lint` and `format` scripts; `mongodb-memory-server: "catalog:"` in `peerDependencies`, with `peerDependenciesMeta` marking it optional, and in `devDependencies`. The description names both presets. `version` 1.1.0.
- `README.md`: the `mongoReplicaSet()` row of *Presets*, its usage, the `mongoUri` key and the `ProvidedContext` declaration a package writes, that a package installs `mongodb-memory-server` itself, and that the preset brings the browser tooling with it.

### `@enardo/transaction-manager-mongo`, `@enardo/uow-repository-mongo`

- `vitest.config.ts`: `test: { ...mongoReplicaSet() }`, and the `~` alias as today; `include` and the timeouts go.
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
5. `pnpm pack` of `@enardo/vitest-config` into the scratchpad → the tarball holds `index.js` and `replica-set.js`, and its manifest the optional peer with a range, not `catalog:`.

No case shows the peer missing for a package without Mongo: within the workspace the preset's instance is shared (*Probes*).

## Out of scope

- `@enardo/database-mongo`, which adopts the preset in its own branch: the spec of `fix/database-mongo/index-definition-change`, written before this one, is revised when that branch is rebased.
- The fixtures' `connect()` and `createDatabase()`, which differ between the packages.

## Plan

1. **The preset**: `replica-set.js`, `mongoReplicaSet()`, the manifest, the catalog, the README of `vitest-config`. Lint and format green.
2. **The two packages on it**: configs, setup removed, the declaration moved, manifests, READMEs. Cases 1–4 green.
3. **Docs**: the root `CLAUDE.md`. Case 5.
4. The backlog item removed, in a commit of its own.
