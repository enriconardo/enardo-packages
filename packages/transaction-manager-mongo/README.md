# @enardo/transaction-manager-mongo

The MongoDB implementation of the [`@enardo/transaction-manager`](../transaction-manager/README.md) contracts. `MongoTransactionManager` runs work in a multi-document transaction and hands it the session to write with.

```ts
const transactionManager = new MongoTransactionManager(client);

await transactionManager.runInTransaction(async ({ session }) => {
  await orders.insertOne(order, { session });
  await stock.updateOne({ _id: order.productId }, { $inc: { quantity: -1 } }, { session });
});
```

> Published to the `@enardo` registry, version 0.2.0. MongoDB transactions need a replica set or a sharded cluster, even a single-node replica set. A standalone server doesn't work.

## Exports

| Export | Meaning |
| --- | --- |
| `MongoTransactionManager` | Implements `ITransactionManager<IMongoTransaction>` |
| `IMongoTransaction` | Extends `ITransaction` with the `session: ClientSession` every write in the transaction must pass |
| `MongoTransactionManagerOptions` | The constructor options |

## Usage

Install it from the `@enardo` registry (`https://npm.enriconardo.com`, which needs a token to read), with `@enardo/transaction-manager` and `mongodb`, its peers:

```sh
pnpm add @enardo/transaction-manager-mongo @enardo/transaction-manager mongodb
```

```ts
new MongoTransactionManager(client, options);
```

| Argument | Type | Required |
| --- | --- | --- |
| `client` | a connected `MongoClient` | yes |
| `options.transactionOptions` | `TransactionOptions` from `mongodb`: read concern, write concern, read preference | no: the client's defaults apply |

```ts
const transactionManager = new MongoTransactionManager(client, {
  transactionOptions: { readConcern: { level: "snapshot" }, writeConcern: { w: "majority" } },
});
```

The manager holds no state: create it once and share it.

## Behavior

`runInTransaction(work)` opens a session with `client.withSession` and runs `work` inside `session.withTransaction`:

- **Commit.** When `work` resolves, the transaction commits, and `runInTransaction` resolves with the result of `work` only after the commit succeeded.
- **Rollback.** When `work` rejects, the transaction aborts and `runInTransaction` rejects with the original error.
- **Retries.** After a transient error, such as a write conflict with another transaction, the driver runs `work` again. Every attempt gets the same transaction `id`. Write `work` so that it can run more than once, and don't catch driver errors inside it without rethrowing, or the driver can't tell whether the transaction aborted.
- **Session.** Pass `session` to every operation that belongs to the transaction. An operation without it runs outside the transaction and isn't rolled back.

## Contributing

The tests run against a real single-node replica set. The global setup of `mongoReplicaSet()` from `@enardo/vitest-config` starts it with `mongodb-memory-server`, once per run, and every test uses a database of its own. The first run downloads a `mongod` binary.

```sh
pnpm install
pnpm exec turbo run build --filter=@enardo/transaction-manager-mongo^...   # builds @enardo/transaction-manager
cd packages/transaction-manager-mongo
pnpm format && pnpm lint && pnpm typecheck && pnpm test
```

Commit messages follow `[@enardo/transaction-manager-mongo] <summary>`.
