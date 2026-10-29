# @enardo/database

The contract of a database connection's lifecycle. The package holds one interface: implementations live in their own packages, so that code which opens and closes a connection doesn't depend on a driver.

## Exports

| Type | Meaning |
| --- | --- |
| `IDatabase` | Opens a connection with `connect()`, closes it with `disconnect()`, and tells whether it is open with `isConnected()` |

A caller depends on `IDatabase` only, and gets an implementation from its composition root:

```ts
import type { IDatabase } from "@enardo/database";

async function run(database: IDatabase, work: () => Promise<void>) {
  await database.connect();
  try {
    await work();
  } finally {
    await database.disconnect();
  }
}
```

## Contract

- `connect()` resolves when the database can be used, and rejects with an error its implementation documents.
- `disconnect()` releases the resources, and resolves at once when there is nothing to release.
- `isConnected()` is `true` between a `connect()` that resolved and the close of the connection. It checks no server: with the server down it can stay `true`.
- How calls made while another is in progress behave (a `disconnect()` during a `connect()`, two `connect()`s at once) is each implementation's to document.

## Contributing

Run these inside `packages/database`:

```sh
pnpm format && pnpm lint && pnpm typecheck
```

The package has no tests: an interface has no runtime, and each implementation checks it with `implements` when it typechecks.
