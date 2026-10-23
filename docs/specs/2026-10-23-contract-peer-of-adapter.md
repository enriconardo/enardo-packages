---
status: done
type: feature
tier: L
implementer: sonnet/medium
packages: ["@enardo/database-mongo", "@enardo/email-nodemailer", "@enardo/id-generator-mongo", "@enardo/password-hasher-bcrypt", "@enardo/transaction-manager-mongo", "@enardo/uow-repository-mongo", "@enardo/uow-repository", "@enardo/email"]
branch: feature/repo/contract-peer-of-adapter
---

# Make a contract a peer of the adapter that implements it

## Why

This is the first *Queued* backlog item, *How a caller recognizes a contract's errors thrown by its adapter*. It comes from the spec of `feature/errors/brand-recognition` and ADR 0012, point 3. Each adapter lists its contract as a `dependency`, and throws the classes of the copy it resolves. A caller that resolves another copy fails silently with `instanceof`:
- for the `EmailRecipientsRefusedError` and `EmailSendFailedError` of `@enardo/email`, which its README recognizes that way;
- for the `ConcurrencyConflictError` that `retryOnConflict` of `@enardo/uow-repository` recognizes that way;
- for `DatabaseError` of `@enardo/database`.

Two copies come from another major of the contract. In a workspace app they also come from two packages locked at different versions of one major (probes). No app has hit it yet. Contract majors are frequent here, though: `email-nodemailer` went to 3.0.0 on 2026-10-21 and to 4.0.0 on 2026-10-22.

At intake the user chose the contract as a peer of its adapter, for all six pairs. ADR 0013, drafted with this spec, records it.

## Probes

All with pnpm 11.1.3 (the `packageManager` of this repo), in a throwaway `node:24-bookworm` container. Tarballs were served by Verdaccio 6.1.6 on `127.0.0.1` (pnpm 11 fails on `localhost`, ECONNREFUSED).

A copy of `HEAD`, with `publishConfig` stripped and `@enardo/email-nodemailer` as the adapter under test. A fake `@enardo/email` 2.0.0 was repacked from 3.0.0.

- `@enardo/email` moved to the peer and dev dependencies of `email-nodemailer`, both `workspace:^`, then `pnpm install` and `turbo run build --filter=@enardo/email-nodemailer...` → 3 builds, with `email` before the adapter. `pnpm pack` writes `peerDependencies: { nodemailer: "^10.1.0", "@enardo/email": "^3.0.0" }`, the same range in `devDependencies`, and no `@enardo/email` in `dependencies`.
- One-package app on `@enardo/email ^3.0.0` and the adapter → one `@enardo+email@3.0.0`. The adapter's `node_modules/@enardo/email` and the app's resolve to the same path. `pnpm peers check`: no issues.
- One-package app without `@enardo/email` → one copy, auto-installed (`autoInstallPeers` default). The app cannot import it, the adapter loads, and `pnpm peers check` finds no issues.
- One-package app on `@enardo/email ^2.0.0` → one copy, 2.0.0, which the adapter also resolves. `[WARN] Issues with peer dependencies found`; `pnpm peers check`: `✕ unmet peer @enardo/email  Installed: 2.0.0  Wanted: ^3.0.0: @enardo/email-nodemailer@4.0.0`.
- The current layout (the contract a `dependency`, repacked as 3.99.0) → app on `^2.0.0`: two copies, the adapter on 3.0.0 and the app on 2.0.0, with no warning and no issue in `pnpm peers check`. App on `^3.0.0`: one copy.
- `pnpm --filter app deploy --prod` from a workspace (`injectWorkspacePackages: true`, which `deploy` requires since pnpm 10) → with the contract listed or auto-installed, `out/` holds one copy, which the adapter resolves, and the adapter loads.
- `autoInstallPeers: false`, contract not listed → a peer warning at install, then `ERR_MODULE_NOT_FOUND: Cannot find package '@enardo/email'` when the adapter loads, before and after `deploy`.
- The change applied to all six adapters on a fresh copy, then `pnpm install` → no peer warning, and `pnpm peers check` finds no issues. Each adapter links its contract from `packages/`. `turbo run build typecheck` on the six and their dependencies: 19 of 19 tasks pass.

The `critic`'s run, with fake packages: the adapter peers `@enardo/email ^3.0.0` and throws the contract's class. The workspace has two packages: `apps/server` lists the adapter and `@enardo/email ^3.0.0`; `packages/identity` lists `@enardo/email` and catches with `instanceof`.
- identity on `^2.0.0` → no warning at install, no issue in `pnpm peers check`, `{"identityCopy":"2.0.0","thrownBy":"3.0.0","instanceofOk":false}`.
- identity on `^3.0.0`, locked at 3.0.0, then 3.1.0 published and server moved to `^3.1.0` → no warning, no issue, `{"identityCopy":"3.0.0","thrownBy":"3.1.0","instanceofOk":false}`.
- Both on `catalog:`, the catalog moved from `^3.0.0` to `^3.1.0` → both resolve 3.1.0, `instanceofOk: true`.
- The first two hold with `injectWorkspacePackages: true` too.

The code:
- Imports from the contract (`src/`, `git grep 'from "@enardo/'`):
  - `database-mongo` takes `DatabaseError` (a value) and `IDatabase`;
  - `email-nodemailer` takes the error classes (values);
  - `uow-repository-mongo` takes values from `@enardo/uow-repository`;
  - `id-generator-mongo`, `password-hasher-bcrypt` and `transaction-manager-mongo` import types only;
  - `uow-repository-mongo` imports only the type `IMongoTransaction` from `@enardo/transaction-manager-mongo`.
- `retryOnConflict` reads nothing of the error but its class (`packages/uow-repository/src/retry-on-conflict.ts:32`). `ConcurrencyConflictError` declares `code: "CONCURRENCY_CONFLICT"` (`src/errors/concurrency-conflict.error.ts:11`). `@enardo/uow-repository` already depends on `@enardo/errors`, which exports `isBaseErrorLike` from 1.1.0.
- `vi.resetModules()` then `await import("~/index")` gives a second class, whose instances are not `instanceof` the first (the spec of `feature/errors/brand-recognition`).
- Versions: `database-mongo` 1.0.0, `email-nodemailer` 4.0.0, `id-generator-mongo` 1.0.0, `password-hasher-bcrypt` 1.0.0, `transaction-manager-mongo` 0.1.0, `uow-repository-mongo` 0.1.1, `uow-repository` 0.1.1. A branch bumps the version of the packages it changes (`git log -- packages/email-nodemailer/package.json`).
- `wc -c CLAUDE.md` → 11 543 bytes of the 12 000 allowed.

Not probed:
- npm as the app's package manager;
- the practice of `@langchain/core`, `@opentelemetry/api` and `@nestjs/common`;
- whether `pnpm dedupe` merges the same-major drift.

## Decisions

Taken with the user at intake:

1. **The contract as a peer and a dev dependency of its adapter** (ADR 0013, point 1). Not taken: the guard and `code` everywhere; a guard per class (the ADR).
2. **All six pairs**, for one rule, including the three whose contract holds types only.

Taken by this spec. At intake the user left the first one open:

3. **The app picks the copy** (ADR 0013, point 2). The package that runs an adapter lists the contract, as it lists the driver. Every package of the app that imports the contract takes it on one specifier, a pnpm catalog entry in a workspace. A peer alone gives one copy for each package that installs the adapter, not for the app (the `critic`'s probes).
4. **`instanceof` holds only where the caller resolves the adapter's copy** (ADR 0013, point 3). `@enardo/email`'s README keeps it, since the example reads the typed `details.refused`, and states that condition.
5. **`retryOnConflict` recognizes the conflict by `isBaseErrorLike` and `code === "CONCURRENCY_CONFLICT"`** (ADR 0013, point 4). It reads no `details`, so it then works whatever copy threw the error, in any layout. It is a fix, so `uow-repository` goes to 0.1.2. Its README needs no change: it never said how the error is recognized.
6. **A new major for each adapter** (a new minor below 1.0.0): an app on another major of the contract, or with `autoInstallPeers: false` and no contract listed, works today and fails after (probes).
7. **A package that uses a contract or an adapter through types, without implementing it, keeps its `dependency`.** That covers `uow-repository` → `transaction-manager` and `uow-repository-mongo` → `transaction-manager-mongo` (ADR 0013, point 5).
8. **The implementation runs on `sonnet/medium`**, not the `opus/high` of the brief. The probes settled the uncertainty that rated `high`. What is left is the same edit to six manifests, one test-first line, and docs.

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
- `uow-repository-mongo`: the version line reads 0.2.0.
  - The quick start's `pnpm add` stays as it is: it already takes `@enardo/uow-repository`.
  - It cannot name `@enardo/transaction-manager`, which is not in its manifest (root `CLAUDE.md`, *Code conventions*). One sentence sends the reader to `transaction-manager-mongo`'s install line for its peer.
- `database-mongo` has no README.

### `@enardo/uow-repository` (0.1.1 → 0.1.2)

`src/retry-on-conflict.ts:32`: `isBaseErrorLike(error) && error.code === "CONCURRENCY_CONFLICT"` in place of `instanceof ConcurrencyConflictError`. Its JSDoc says a conflict is recognized by its `code`, whatever copy of the package threw it.

### `@enardo/email`

`README.md`, beside the `instanceof` example:
- An implementation declares this package as a peer, so it throws the classes of the copy that the package installing it resolves.
- `instanceof` holds where the catching code resolves that copy too: every package of the app takes this package on one specifier, and the install has no unmet peer.
- Where `details` are not needed, `isBaseErrorLike` and `code` hold in any layout.

No implementation is named (root `CLAUDE.md`, *Code conventions*).

### Repo

- Root `CLAUDE.md`, *Architecture conventions*:
  - the driver line also covers the contract an adapter implements: peer and dev dependency, which the app lists on one specifier across its packages (ADR 0013);
  - the errors line points to ADR 0013 for a contract's classes.
  
  The file stays under 12 000 bytes.
- `docs/adr/0013-contract-peer-of-its-adapter.md`: `proposed` → `accepted` at checkpoint 2. The index gets its row, and 0012's row notes that 0013 settles point 3's open question.
- `docs/backlog.md`:
  - the item leaves, in a commit of its own;
  - *A manifest and README check in `pnpm verify`* adds the rule that an adapter's contract is a peer and a dev dependency, never a `dependency`.

## Test cases

`retryOnConflict`, in `__tests__/retry-on-conflict.test.ts`:

1. A `ConcurrencyConflictError` from a second copy of the module (`vi.resetModules()`, then `await import("~/errors")`), thrown by the first attempt → `run` is called twice, and the result of the second attempt is returned. It fails today: the second copy's instance is not `instanceof` the first's class.
2. A native `Error` with `code = "CONCURRENCY_CONFLICT"` set on it, which has no brand → rethrown as it is (`rejects.toBe`), `run` called once.
3. A `BaseError` subclass with another `code` → rethrown as it is, `run` called once.
4. The existing cases pass unchanged: a conflict of the same copy is retried, the last one rethrown, three attempts by default, a native error rethrown, a bad `attempts` refused.

The install and the packed manifests, run once by hand:

5. `./dev.sh exec pnpm install`, then `./dev.sh exec pnpm peers check` → `No peer dependency issues found`.
6. For each of the six adapters, `pnpm --filter <adapter> pack --pack-destination <dir>` after a fresh build:
   - `peerDependencies` holds the contract at `^<its current version>`, and `devDependencies` holds it too;
   - `dependencies` lacks it;
   - `version` is the one in the table.
7. In each adapter's directory, `node_modules/@enardo/<contract>` links to `packages/<contract>` (one copy in the workspace).
8. The adapters' existing tests pass unchanged (`pnpm verify`).

Cases 6 and 7 become permanent through the backlog item on the manifest check.

## Risks

- **A split across an app's packages.** Two packages of an app on different specifiers of a contract get two copies with no warning, and `instanceof` in one of them fails. Nothing in the install shows it. `@enardo/email`'s README states the condition, and `retryOnConflict` no longer depends on it.
- **An ignored peer warning.** An app that ignores it runs an adapter against a major of the contract it does not declare. The warning at install and `pnpm peers check` show it.
- **`autoInstallPeers: false`.** An app with it that does not list the contract fails when it loads the adapter, with `ERR_MODULE_NOT_FOUND` at startup, after a warning at install.
- **The dev container's `node_modules`**, installed under the old layout: `pnpm install` relinks it, and case 7 shows it.

## Out of scope

- Publishing the seven releases (the `publish` skill, in a session of its own).
- The manifest check itself (its own backlog item).
- A check that an app keeps one specifier per contract: it belongs to the app's repo.
- `@enardo/errors` stays a `dependency` (ADR 0012, point 3).
- The form of `DatabaseError` (the architectural review of the database packages).

## Plan

1. `retryOnConflict` by `code`, test-first (cases 1–3 fail first, case 1 for want of the brand check), `uow-repository` 0.1.2; its tests green. Commit `[@enardo/uow-repository] fix: recognize a conflict by its code`.
2. The six manifests, their versions and the lockfile, with cases 5–7 checked; `pnpm verify` green. Commit `[repo] build: make each contract a peer of its adapter`.
3. The READMEs of the five adapters and of `@enardo/email`. Commit.
4. Root `CLAUDE.md`, ADR 0013 accepted, the ADR index. Commit.
5. The backlog: the item leaves, and the manifest check gets the rule. Commit.
