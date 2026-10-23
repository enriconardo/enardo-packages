---
status: draft
type: feature
tier: L
implementer: sonnet/medium
packages: ["@enardo/database-mongo", "@enardo/email-nodemailer", "@enardo/id-generator-mongo", "@enardo/password-hasher-bcrypt", "@enardo/transaction-manager-mongo", "@enardo/uow-repository-mongo"]
branch: feature/repo/contract-peer-of-adapter
---

# Make a contract a peer of the adapter that implements it

## Why

This is the first *Queued* backlog item, *How a caller recognizes a contract's errors thrown by its adapter*. It comes from the spec of `feature/errors/brand-recognition` and ADR 0012, point 3. Each adapter lists its contract as a `dependency`. An app on another major of the contract gets two copies, silently, and `instanceof` with the contract's class then fails for the errors the adapter throws:
- the `EmailRecipientsRefusedError` and `EmailSendFailedError` of `@enardo/email`, which its README recognizes that way;
- the `ConcurrencyConflictError` that `retryOnConflict` of `@enardo/uow-repository` recognizes that way;
- `DatabaseError` of `@enardo/database`.

At intake the user chose the contract as a peer of its adapter, for all six pairs. ADR 0013, drafted with this spec, records it.

## Probes

All with pnpm 11.1.3 (the `packageManager` of this repo), in a throwaway `node:24-bookworm` container on a copy of `HEAD`, with `publishConfig` stripped. Tarballs were served by Verdaccio 6.1.6 on `127.0.0.1` (pnpm 11 fails on `localhost`, ECONNREFUSED). `@enardo/email-nodemailer` was the adapter under test; a fake `@enardo/email` 2.0.0 was repacked from 3.0.0.

- `@enardo/email` moved to the peer and dev dependencies of `email-nodemailer`, both `workspace:^`, then `pnpm install` and `turbo run build --filter=@enardo/email-nodemailer...` → 3 builds, with `email` before the adapter. `pnpm pack` writes `peerDependencies: { nodemailer: "^10.1.0", "@enardo/email": "^3.0.0" }`, the same range in `devDependencies`, and no `@enardo/email` in `dependencies`.
- App on `@enardo/email ^3.0.0` and the adapter → one `@enardo+email@3.0.0`. The adapter's `node_modules/@enardo/email` and the app's resolve to the same path. `pnpm peers check`: no issues.
- App without `@enardo/email` → one copy, auto-installed (`autoInstallPeers` default). The app cannot import it, the adapter loads, and `pnpm peers check` finds no issues.
- App on `@enardo/email ^2.0.0` → one copy, 2.0.0, which the adapter also resolves. `[WARN] Issues with peer dependencies found`; `pnpm peers check`: `✕ unmet peer @enardo/email  Installed: 2.0.0  Wanted: ^3.0.0: @enardo/email-nodemailer@4.0.0`.
- The current layout (the contract a `dependency`, repacked as 3.99.0) → app on `^2.0.0`: two copies, the adapter on 3.0.0 and the app on 2.0.0, with no warning and no issue in `pnpm peers check`. App on `^3.0.0`: one copy.
- `pnpm --filter app deploy --prod` from a workspace (`injectWorkspacePackages: true`, which `deploy` requires since pnpm 10) → with the contract listed or auto-installed, `out/` holds one copy, which the adapter resolves, and the adapter loads.
- `autoInstallPeers: false`, contract not listed → a peer warning at install, then `ERR_MODULE_NOT_FOUND: Cannot find package '@enardo/email'` when the adapter loads, before and after `deploy`.
- The change applied to all six adapters on a fresh copy, then `pnpm install` → no peer warning, and `pnpm peers check` finds no issues. Each adapter links its contract from `packages/`. `turbo run build typecheck` on the six and their dependencies: 19 of 19 tasks pass.
- Imports from the contract: `database-mongo` takes `DatabaseError` (a value) and `IDatabase`; `email-nodemailer` takes the error classes (values); `uow-repository-mongo` takes values from `@enardo/uow-repository` (`src/`, `git grep 'from "@enardo/'`). `id-generator-mongo`, `password-hasher-bcrypt` and `transaction-manager-mongo` import types only. `uow-repository-mongo` imports only the type `IMongoTransaction` from `@enardo/transaction-manager-mongo`.
- Versions: `database-mongo` 1.0.0, `email-nodemailer` 4.0.0, `id-generator-mongo` 1.0.0, `password-hasher-bcrypt` 1.0.0, `transaction-manager-mongo` 0.1.0, `uow-repository-mongo` 0.1.1. A branch bumps the version of the packages it changes (`git log -- packages/email-nodemailer/package.json`).
- `wc -c CLAUDE.md` → 11 543 bytes of the 12 000 allowed.
- Not probed: npm as the app's package manager; the practice of `@langchain/core`, `@opentelemetry/api` and `@nestjs/common`.

## Decisions

Taken with the user at intake:

1. **The contract as a peer and a dev dependency of its adapter** (ADR 0013, point 1). Not taken: the guard and `code` with `details` checked at runtime; a guard per class (the ADR).
2. **All six pairs**, for one rule, including the three whose contract holds types only.

Taken by this spec. At intake the user left the first one open:

3. **An app lists the contract of every adapter it runs**, as it lists the driver (ADR 0013, point 2). Its own range picks the copy, and pnpm compares it with the adapter's. An app that imports the contract's classes or types must list it anyway. Without it, the install depends on `autoInstallPeers`.
4. **`instanceof` stays** in `retryOnConflict` and in `@enardo/email`'s README. With one copy it is reliable. The README says it holds only while the install has no unmet peer.
5. **A new major for each adapter** (a new minor below 1.0.0): an app on another major of the contract, or with `autoInstallPeers: false` and no contract listed, works today and fails after (probes).
6. **A package that uses a contract or an adapter through types, without implementing it, keeps its `dependency`.** That covers `uow-repository` → `transaction-manager` and `uow-repository-mongo` → `transaction-manager-mongo` (ADR 0013, point 4).
7. **The implementation runs on `sonnet/medium`**, not the `opus/high` of the brief. The probes settled the uncertainty that rated `high`, and what is left is the same edit to six manifests, plus docs.

## Open questions

None.

## Changes

### The six adapters

In `package.json`, the contract moves from `dependencies` to `peerDependencies` and `devDependencies`, as `workspace:^`. The version is bumped:

| Package | Contract | Version |
| --- | --- | --- |
| `@enardo/database-mongo` | `@enardo/database` | 1.0.0 → 2.0.0 |
| `@enardo/email-nodemailer` | `@enardo/email` | 4.0.0 → 5.0.0 |
| `@enardo/id-generator-mongo` | `@enardo/id-generator` | 1.0.0 → 2.0.0 |
| `@enardo/password-hasher-bcrypt` | `@enardo/password-hasher` | 1.0.0 → 2.0.0 |
| `@enardo/transaction-manager-mongo` | `@enardo/transaction-manager` | 0.1.0 → 0.2.0 |
| `@enardo/uow-repository-mongo` | `@enardo/uow-repository` | 0.1.1 → 0.2.0 |

`pnpm-lock.yaml` follows. READMEs:
- `email-nodemailer`, `id-generator-mongo`, `password-hasher-bcrypt`: the published note names the contract and its range as a peer, beside the driver.
- `transaction-manager-mongo`: `pnpm add` takes `@enardo/transaction-manager`, and the version line reads 0.2.0.
- `uow-repository-mongo`: the quick start's `pnpm add` adds `@enardo/transaction-manager`, since the quick start runs `transaction-manager-mongo`. The version line reads 0.2.0.
- `database-mongo` has no README.

### `@enardo/email`

`README.md`, beside the `instanceof` example: an implementation declares this package as a peer, so it throws the classes of the app's copy. Install this package beside it, in the range it asks for. Under an unmet peer, `instanceof` can fail. No implementation is named (root `CLAUDE.md`, *Code conventions*).

### Repo

- Root `CLAUDE.md`, *Architecture conventions*: the driver line also covers the contract an adapter implements (peer and dev dependency; the app lists it), citing ADR 0013. The errors line points to ADR 0013 for a contract's classes. The file stays under 12 000 bytes.
- `docs/adr/0013-contract-peer-of-its-adapter.md`: `proposed` → `accepted` at checkpoint 2. The index gets its row, and 0012's row notes that 0013 settles point 3's open question.
- `docs/backlog.md`:
  - the item leaves, in a commit of its own;
  - *A manifest and README check in `pnpm verify`* adds the rule that an adapter's contract is a peer and a dev dependency, never a `dependency`.

## Test cases

No runtime code changes, so the cases are checks of the install and the packed manifests:

1. `./dev.sh exec pnpm install`, then `./dev.sh exec pnpm peers check` → `No peer dependency issues found`.
2. For each of the six adapters, `pnpm --filter <adapter> pack --pack-destination <dir>` after a fresh build: `peerDependencies` holds the contract at `^<its current version>` and `devDependencies` holds it too, while `dependencies` lacks it. `version` is the one in the table.
3. In each adapter's directory, `node_modules/@enardo/<contract>` links to `packages/<contract>` (one copy in the workspace).
4. The adapters' existing tests and `retryOnConflict`'s pass unchanged (`pnpm verify`).

Cases 2 and 3 are run once, by hand. The rule becomes permanent through the backlog item on the manifest check.

## Risks

- An app that ignores the peer warning runs an adapter against a major of the contract it does not declare. The warning at install and `pnpm peers check` show it.
- An app with `autoInstallPeers: false` that does not list the contract fails when it loads the adapter, with `ERR_MODULE_NOT_FOUND` at startup, after a warning at install.
- The dev container's `node_modules`, installed under the old layout: `pnpm install` relinks it, and case 3 shows it.

## Out of scope

- Publishing the six majors (the `publish` skill, in a session of its own).
- The manifest check itself (its own backlog item).
- `@enardo/errors` stays a `dependency` (ADR 0012, point 3).
- The form of `DatabaseError` (the architectural review of the database packages).

## Plan

No step is test-first: no behavior is added, and case 4 shows that none changes.

1. The six manifests, their versions and the lockfile, with cases 1–3 checked; `pnpm verify` green. Commit `[repo] build: make each contract a peer of its adapter`.
2. The READMEs of the five adapters and of `@enardo/email`. Commit.
3. Root `CLAUDE.md`, ADR 0013 accepted, the ADR index. Commit.
4. The backlog: the item leaves, and the manifest check gets the rule. Commit.
