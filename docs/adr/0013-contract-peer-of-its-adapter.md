# 0013. A contract is a peer of the adapter that implements it

- Status: proposed
- Date: 2026-10-23
- Spec: docs/specs/2026-10-23-contract-peer-of-adapter.md

## Context

ADR 0012, point 3, left one question open: how a caller recognizes the errors that a contract declares and its adapter throws. The six adapters of this repo list their contract as a `dependency`. An app whose range on the contract leaves out the adapter's gets two copies, with nothing to warn it: the adapter throws the classes of its own copy, and `instanceof` with the app's class fails silently. `@enardo/email`'s README advises `instanceof` for the errors an implementation throws. `retryOnConflict` of `@enardo/uow-repository` recognizes the `ConcurrencyConflictError` that `@enardo/uow-repository-mongo` throws the same way. `@enardo/database-mongo` throws `DatabaseError` of `@enardo/database`.

Probed with pnpm 11.1.3, on packed tarballs served by a local registry:

- With the contract a `dependency`, an app on another major of the contract gets two copies. The install gives no warning, and `pnpm peers check` finds no issue.
- With the contract a peer of its adapter:
  - an app on the adapter's range gets one copy, which the app and the adapter share;
  - an app that does not list the contract gets one copy anyway, since `autoInstallPeers` is on by default, and `pnpm deploy --prod` keeps it;
  - an app on another major gets one copy, with a warning at install and an `unmet peer` from `pnpm peers check`. The adapter then runs against that major;
  - with `autoInstallPeers: false`, an app that does not list the contract gets a warning at install, and `ERR_MODULE_NOT_FOUND` when it loads the adapter.

The ecosystem uses the second layout where one copy matters: an adapter declares its core as a peer, as `@langchain/core` and `@opentelemetry/api` ask of the packages that build on them (their practice was not probed).

## Decision

1. **An adapter declares the contract it implements as a peer and a dev dependency**, both `workspace:^`, as it declares its driver. `pack` turns the peer into a caret range on the contract's current version. The rule holds for every contract and adapter, including those whose contract throws no errors, so that one rule covers them all.
2. **An app lists the contract of every adapter it runs in its own `dependencies`**, as it lists the driver: its own range picks the copy, and the install compares that range with the adapter's.
3. **`instanceof` with a contract's class is reliable for the errors its adapter throws, while the install has no unmet peer.** The adapter throws the classes of the app's copy, the only one. `retryOnConflict` and `@enardo/email`'s README keep `instanceof`.
4. **A package that uses a contract without implementing it is outside this rule.** `@enardo/uow-repository` uses `@enardo/transaction-manager`, and `@enardo/uow-repository-mongo` uses `@enardo/transaction-manager-mongo`, through types only. Both keep their `dependency`.

## Consequences

- A mismatched major shows up at install, as a warning and in `pnpm peers check`. It stays a warning unless the app sets `strictPeerDependencies`. An app that ignores it runs the adapter against a major the adapter does not declare: correctness depends on the install, as with a driver.
- A new major of a contract needs a release of each adapter that widens its peer range. The dependency had the same cost.
- Moving the contract to a peer is a breaking change for each adapter: an app on another major of the contract, or with `autoInstallPeers: false` and no contract listed, works today and fails after. Each adapter takes a new major (a new minor below 1.0.0).
- npm, which installs peers since npm 7 and refuses a conflicting one by default, was not probed.

## Alternatives considered

- **The guard and `code`, with `details` checked at runtime.** It works across copies, but every caller writes the check of `details` that the class's type already states, and loses the typed `details` that ADR 0012 leaves to `instanceof`.
- **A guard per class, exported by the contract.** It works across copies, but each class needs a brand or a check of its own, and every contract adds one function per error class to its public API.
- **Peers for the contracts that throw errors only.** It covers the classes that need one copy and leaves `id-generator`, `password-hasher` and `transaction-manager`, which hold types only, as dependencies. Two rules where one covers all six.
