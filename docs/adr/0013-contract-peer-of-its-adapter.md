# 0013. A contract is a peer of the adapter that implements it

- Status: accepted
- Date: 2026-10-23
- Spec: docs/specs/2026-10-23-contract-peer-of-adapter.md

## Context

ADR 0012, point 3, left one question open: how a caller recognizes the errors that a contract declares and its adapter throws. The six adapters of this repo list their contract as a `dependency`. The adapter throws the classes of the copy it resolves, so `instanceof` with the caller's class fails silently when the caller resolves another copy:
- `@enardo/email`'s README advises `instanceof` for the errors an implementation throws;
- `retryOnConflict` of `@enardo/uow-repository` recognizes the `ConcurrencyConflictError` that `@enardo/uow-repository-mongo` throws the same way;
- `@enardo/database-mongo` throws `DatabaseError` of `@enardo/database`.

Probed with pnpm 11.1.3, on tarballs served by a local registry:

- **The contract as a `dependency`.** An app on another major of the contract gets two copies, with no warning at install and no issue in `pnpm peers check`.
- **The contract as a peer of its adapter, in a one-package app:**
  - on the adapter's range: one copy, which the app and the adapter share;
  - not listed: one copy anyway, since `autoInstallPeers` is on by default, and `pnpm deploy --prod` keeps it;
  - on another major: one copy, with a warning at install and an `unmet peer` from `pnpm peers check`; the adapter then runs against that major;
  - not listed, with `autoInstallPeers: false`: a warning at install, and `ERR_MODULE_NOT_FOUND` when the app loads the adapter.
- **The contract as a peer, in a workspace app.** Two packages: one runs the adapter, the other imports the contract and catches its errors.
  - Each package resolves the contract from its own specifier. With the second package on another major, or on the same major locked at an older version (3.0.0 against 3.1.0), there are two copies, no warning at install and no issue in `pnpm peers check`. `instanceof` fails.
  - With both packages on one `catalog:` entry, there is one copy, and `instanceof` holds.

The ecosystem uses a peer where one copy matters: an adapter declares its core as a peer, as `@langchain/core` and `@opentelemetry/api` ask of the packages that build on them (not probed).

## Decision

1. **An adapter declares the contract it implements as a peer and a dev dependency**, both `workspace:^`, as it declares its driver. `pack` turns the peer into a caret range on the contract's current version. The rule holds for every contract and adapter, including the contracts that throw no errors: one rule covers all six.
2. **The app picks the copy.** The package of an app that runs an adapter lists the adapter's contract in its own `dependencies`, as it lists the driver. Every package of the app that imports the contract takes it on the same specifier: a pnpm catalog entry in a workspace.
3. **`instanceof` with a contract's class is reliable for the errors its adapter throws only where the caller resolves the same copy as the adapter**: every package that imports the contract on one specifier (point 2), and no unmet peer. The peer guarantees one copy for each package that installs the adapter, not for the whole app. pnpm reports neither a split across packages nor a drift within a major.
4. **Where the caller needs no typed `details`, it recognizes the error by `isBaseErrorLike` and its `code`**, which holds whatever copy threw it (ADR 0012). `retryOnConflict` does so. `instanceof` stays where the caller reads typed `details`, as in `@enardo/email`'s README, under point 3's condition.
5. **A package that uses a contract or an adapter without implementing it keeps its `dependency`.** `@enardo/uow-repository` uses `@enardo/transaction-manager`, and `@enardo/uow-repository-mongo` uses `@enardo/transaction-manager-mongo`, through types only. Such a package, if it caught a contract's errors with `instanceof`, would be the second copy of point 3: it recognizes them by `code` (point 4).

## Consequences

- One copy per installing package is guaranteed by the install. One copy per app depends on the app keeping one specifier, which nothing in this repo checks.
- A mismatched major between the app's specifier and the adapter's range shows at install, as a warning and in `pnpm peers check`. It stays a warning unless the app sets `strictPeerDependencies`. An app that ignores it runs the adapter against a major the adapter does not declare, as with a driver.
- A new major of a contract needs a release of each adapter that widens its peer range. The dependency had the same cost.
- Moving the contract to a peer is a breaking change for each adapter: an app on another major of the contract, or with `autoInstallPeers: false` and no contract listed, works today and fails after. Each adapter takes a new major (a new minor below 1.0.0).
- npm, which installs peers since npm 7 and refuses a conflicting one by default, was not probed.

## Alternatives considered

- **The guard and `code` everywhere, with `details` checked at runtime.** It works across copies, but a caller that reads `details` writes the check the class's type already states. Point 4 takes it where `details` are not read.
- **A guard per class, exported by the contract.** It works across copies, but each class needs a brand or a check of its own, and every contract adds one function per error class to its public API.
- **Peers for the contracts that throw errors only.** `id-generator`, `password-hasher` and `transaction-manager` hold types only and would stay dependencies. That makes two rules where one covers all six.
