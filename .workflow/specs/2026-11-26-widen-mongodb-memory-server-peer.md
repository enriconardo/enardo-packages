---
status: done
branch: chore/vitest-config/widen-mongodb-memory-server-peer
inputs: none
depends_on: pnpm-workspace.yaml, pnpm-lock.yaml, packages/vitest-config/package.json, packages/vitest-config/README.md, packages/vitest-config/replica-set.js, packages/database-mongo/package.json, packages/transaction-manager-mongo/package.json, packages/uow-repository-mongo/package.json, CLAUDE.md
---

# `@enardo/vitest-config` accepts `mongodb-memory-server` 10 and 11, and the repo tests on 11

## Why

`@enardo/vitest-config` 1.0.0 declares `mongodb-memory-server` as an optional peer through `catalog:`, which `pack` turns into `^10.4.3` (`packages/vitest-config/package.json:29`, `pnpm-workspace.yaml:16`). A project that installs `mongodb-memory-server` 11 to call `mongoReplicaSet()` gets an unmet peer at install and in `pnpm peers check`. The user needs the peer to accept 11 (request of 2026-11-26).

## What

- `@enardo/vitest-config` declares the peer `mongodb-memory-server` as `^10.4.3 || ^11.0.0`, still optional. Its published manifest carries that range as it is.
- Its `version` becomes `1.1.0`: a peer that accepts more is a minor.
- The workspace catalog entry `mongodb-memory-server` becomes `^11.4.0`. The devDependencies of `vitest-config`, `database-mongo`, `transaction-manager-mongo` and `uow-repository-mongo`, all `catalog:`, resolve to 11.4.x. Their tests start the replica set on the default `mongod` of 11.4.0 (8.2.6), not on 10.4.3's (7.0.24).
- `mongoReplicaSet()` and `replica-set.js` do not change: the calls they make (`MongoMemoryReplSet.create({ replSet: { count: 1 } })`, `getUri()`, `stop()`) behave the same on 11.
- The README of `vitest-config` states the range the peer accepts.
- Out of scope: testing on 10 after the change (one version in the lockfile); pinning a `mongod` version (`MONGOMS_*`); the adapters' `mongodb` driver ranges; the publish, which follows the merge through the `publish` skill.

## Decisions

- **The peer accepts 10 and 11: `^10.4.3 || ^11.0.0`.** The user's decision (2026-11-26, "1 sì"): "allargare" keeps the projects on 10 without a warning. Alternatives: `^11.0.0` only, a breaking change (a new major) for the projects on 10, for no gain, since the three calls are the same on both; doing nothing leaves an unmet peer for a project on 11.
- **The peer leaves `catalog:` for a range written in `package.json`.** The catalog holds one range, and the peer needs two majors while the devDependency needs one. CLAUDE.md's "a package references `catalog:`, never a range of its own" covers the versions of the shared dev tooling; a peer range is the package's contract with its consumers. No package has yet written out a peer beside a `catalog:` devDependency of the same name (the adapters' `mongodb` is outside the catalog on both sides), so a later reader could set it back to `catalog:`: CLAUDE.md gains the exception (*Docs*), and the README states the range, since JSON takes no comment. The `vitest` peer stays on `catalog:`: it covers one major.
- **The suites move from `mongod` 7.0.24 to 8.2.6.** `database-mongo` tests what the server does with indexes (errors 85, 86, 12587, 26, 27): a change of the server's behavior there shows as a red suite, not as a code change in this spec. A red suite stops the build and goes to the user: whether the package adapts (its own task) or the catalog stays on 10 is theirs to decide.
- **The catalog moves to `^11.4.0`.** The user's decision (2026-11-26, "2 sì"): the repo tests on the newest major the peer declares; 10 stays declared, no longer tested. Alternative: the catalog stays on 10, and the 11 the peer declares is never run here.
- **`1.1.0`, published after the merge.** The user's decision (2026-11-26, "3 sì"), through the `publish` skill.
- **Probed (2026-11-26), in a throwaway folder on Node 24.21.0:**
  - 11.0.0's breaking changes (CHANGELOG): default `mongod` 8.2.x, `target` es2023, no `mongod` below 4.2.0, no `-global-4.0` package, Node ≥ 20.19.0. None touches the three calls. The dev container runs Node 24.
  - 11.4.0 downloads `mongod` 8.2.6 (`DEFAULT_VERSION` in `resolveConfig.js`); 10.4.3 downloads 7.0.24. The 8.2.6 binary downloads through the firewall (fastdl.mongodb.org is allowed).
  - On 11.4.0 with driver 7.9.1, `create({ replSet: { count: 1 } })`, a `withTransaction` that inserts one document, a count and `stop()` succeed, with no `mongod` left running.
  - 11 keeps its `postinstall`, which downloads the binary: `allowBuilds` keeps `mongodb-memory-server: true`.
  - `mongodb-memory-server-core` 11.4.0 depends on `mongodb` `~7.5.0` (10.4.3: `^6.9.0`), as a dependency, not a peer. The lockfile holds a copy of the driver for it beside the adapters' own; it uses its copy internally only, so the adapters' code and tests do not share it. This holds outside the repo too: a project gets that copy whatever driver it runs.
- **What no file holds:** the behavior of `mongodb-memory-server` 11 and of `mongod` 8.2.6, settled by the probe above. A build that finds main moved shows it to the user.

## Test cases

`vitest-config` has no tests of its own: the three adapters' suites, which call `mongoReplicaSet()`, are the proof.

- `pnpm install` after the change: the lockfile resolves `mongodb-memory-server` to 11.4.x for the four packages, and `pnpm peers check` reports no issue for `mongodb-memory-server`.
- `pnpm verify:all --force`: the suites of `database-mongo`, `transaction-manager-mongo` and `uow-repository-mongo` pass on `mongod` 8.2.6, with no test changed.
- `pnpm --filter @enardo/vitest-config pack` into a temporary folder: the tarball's `package.json` has `"version": "1.1.0"` and the peer `"mongodb-memory-server": "^10.4.3 || ^11.0.0"`, still optional in `peerDependenciesMeta`.

## Docs

- `packages/vitest-config/README.md`: the paragraph on the optional peer (line 69) states that it accepts `mongodb-memory-server` 10 and 11, both running the same calls.
- `CLAUDE.md`, *Layout* (the `catalog:` rule): a peer range, the package's contract with its consumers, is written in its `package.json` when it differs from the catalog's.

## Chunks

- [x] 1. Widen the peer and move the catalog to 11 (no test-first): config and docs, which the existing suites prove; `pnpm-workspace.yaml`, `pnpm-lock.yaml`, `packages/vitest-config/package.json`, `packages/vitest-config/README.md`, `CLAUDE.md`; all three test cases.
