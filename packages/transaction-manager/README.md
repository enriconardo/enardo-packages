# @enardo/transaction-manager

The transaction contracts shared by the `@enardo/*` packages and the projects built on them. The package holds types only: implementations live in their own packages, such as [`@enardo/transaction-manager-mongo`](../transaction-manager-mongo/README.md), so that code depending on the contracts doesn't depend on a database driver.

## Exports

| Type | Meaning |
| --- | --- |
| `ITransaction` | An active transaction. It carries an `id`, useful for logging and for assertions in tests. |
| `ITransactionManager<TContext extends ITransaction = ITransaction>` | Runs `work` inside a transaction with `runInTransaction(work)`, and returns its result |

An implementation declares the context it hands to `work`. Code that writes inside the transaction then gets what its driver needs, without a cast:

```ts
import type { ITransaction, ITransactionManager } from "@enardo/transaction-manager";

interface SessionTransaction extends ITransaction {
  readonly session: Session;
}

class SessionTransactionManager implements ITransactionManager<SessionTransaction> {
  async runInTransaction<T>(work: (transaction: SessionTransaction) => Promise<T>): Promise<T> {
    // open a session, start a transaction, run work, commit or roll back
  }
}
```

## Contract

Implementations must:

- Commit when `work` resolves, and roll back and rethrow the original error when it rejects.
- Resolve only after the commit succeeded.
- Hand `work` the same context type they declare. `work` may run more than once, if the driver retries after a transient error.

## Contributing

Run these inside `packages/transaction-manager`:

```sh
pnpm format && pnpm lint && pnpm typecheck && pnpm test
```

The tests check the types with `expectTypeOf`, so `pnpm typecheck` is the command that catches a broken contract.
