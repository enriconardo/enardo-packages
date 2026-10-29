# @enardo/database-mongo

`MongoDatabase`: the connection to MongoDB, and the sync of each schema's collection, validator and indexes, which the app runs on request.

```ts
import { MongoDatabase, type IMongoSchema } from "@enardo/database-mongo";

const usersSchema: IMongoSchema = {
  collectionName: "users",
  validation: { $jsonSchema: { bsonType: "object", required: ["email"] } },
  indexes: [{ name: "email_unique", key: { email: 1 }, unique: true }],
};

const db = new MongoDatabase({ dbUri: "mongodb://localhost:27017", dbName: "app" });

await db.connect();
const users = db.getDb().collection("users");
```

The schema is synced by a step of the deploy, not by the instances: see [The schema sync](#the-schema-sync).

> `mongodb` `^7.5.0` and `@enardo/database` are peer dependencies: install them beside the package.

## The connection

`connect()` only connects: it touches no collection.

- **One client per instance.** The first `connect()` creates the `MongoClient`; `disconnect()` closes it, and a later `connect()` reopens that same client. `getClient()` returns it across reconnects, so what an app builds on `getClient()` or `getDb()` (a transaction manager, a store, a `Db`) works again after `connect()`. Between a `disconnect()` and the next `connect()`, an operation on it rejects with `MongoNotConnectedError`. An unparseable URI creates no client, and the next `connect()` tries again.
- **The calls run one at a time, in the order made; the last one wins.** Each `connect()` and `disconnect()` waits for the call before it to settle, then runs. Connected with nothing in line, `connect()` resolves at once. A call made while the last in line is of the same kind shares its promise: two `connect()`s share one attempt, and its rejection; two `disconnect()`s share one `close()`. `disconnect(); connect(); disconnect()` ends disconnected.
- **A `disconnect()` made during a `connect()` waits for it**, up to `serverSelectionTimeoutMS` on an unreachable server: 30 s by default. An app that needs a quick shutdown during startup lowers it in the URI (`mongodb://host/?serverSelectionTimeoutMS=2000`).
- **A client closed by hand counts as closed.** After `await db.getClient().close()`, `isConnected()` is `false` and the next `connect()` reopens the client. A hand close counts from its end: a `connect()` made during a `close()` not yet awaited resolves on the closing client, and `isConnected()` turns `false` when the close ends.
- **`isConnected()` is `true` from the resolution of `connect()` until the client closes**, through `disconnect()` or `getClient().close()`. It never checks the server: with the server down it stays `true`, and an operation rejects with the driver's error.
- **`connect()` rejects with the driver's error as it is**: `MongoParseError` for an unparseable URI, `MongoServerSelectionError` for an unreachable server, and the others the driver throws.
- **Not connected** means never connected, a `connect()` in progress or rejected, or after the close. `getDb()` and `getClient()` throw a native `Error` then, and `syncSchema()` and `dropStaleIndexes()` reject with one, before any call to the server.

## The schema sync

Schema changes run once per deploy, as a step of their own outside the instances, and removals run in a later step, after every instance runs the new code.

| Method | Step | What it does |
| --- | --- | --- |
| `syncSchema(schemas)` | expand | Per schema, in order: creates the collection with its validator when missing, creates the missing indexes, replaces the validator of a collection that existed. Drops nothing. |
| `dropStaleIndexes(schemas)` | contract | Per schema's collection, drops the indexes the schema does not name (`_id_` is kept). |

Both reject with a native `Error` when not connected, and leave the instance connected when they reject: the connection is the caller's to close.

### In a deploy

- Run `syncSchema(schemas)` **once, before the rollout**, as a job or a release phase, never in each instance's startup (an init container is one). Run `dropStaleIndexes(schemas)` **after the rollout**, when no instance runs the old code: it drops indexes the old instances still use.
- **One run at a time is the app's job.** The package tolerates no race: two runs at once can reject on the server's errors (a `collMod` during another run's index build, a `createCollection` after another run's `collMod`), and so can a drop of an index that another run dropped first.
- **A failed run is run again.** In sequence the sync converges. A build a killed run left on the server is waited for by the identical `createIndexes` of the next run.
- `dropStaleIndexes()` drops nothing while a schema's collection or index is missing (an index still building counts as missing): it rejects with an `Error` that names each collection missing, or with the indexes it lacks. A renamed index is so never dropped before its replacement exists. `syncSchema()` was not run or not finished.

### The results

`syncSchema()` resolves to `SchemaSyncResult`, `{ createdCollections: string[] }`, in the order of the schemas. `dropStaleIndexes()` resolves to `StaleIndexDropResult`, `{ droppedIndexes: { collection, index }[] }`, each index with the definition the server listed. The package logs nothing: the job logs these.

A call that rejects reports nothing it changed. A job that needs the definitions of the indexes `dropStaleIndexes()` drops lists them before the call: after a rejection, a rerun reports only the indexes still there.

### A single process

Local development and an app's integration tests run the three in sequence:

```ts
await db.connect();
await db.syncSchema(schemas);
await db.dropStaleIndexes(schemas);
```

## What the sync leaves alone

- **An existing index is never changed.** One the schema names with another definition (its key, its options, or the same key under another name, unless `unique`, `sparse`, `collation` or `partialFilterExpression` also differ: the server then keeps both) makes `syncSchema()` reject with an `Error` that names the index and the collection, with the server's error as `cause`, before the validator is replaced. Drop the index by hand, and `syncSchema()` creates the schema's definition. A changed index is a schema migration, and a dropped `unique` index leaves a window for duplicates.
- **`hidden` applies when an index is created.** It changes through `collMod`; a difference in it is not a conflict.
- **The validator is replaced by every `syncSchema()`**, whatever the collection holds. A stricter validator also applies to the instances still on the old code.

## Upgrading from 1.x

- `connect()` no longer syncs: call `syncSchema(schemas)` and `dropStaleIndexes(schemas)`.
- `Logger` and `LoggerMetadata` are no longer exported, and `IMongoDatabase` declares the two methods: a fake of it adds them.
- `getDb()` and `getClient()` throw a native `Error` where they threw `DatabaseError` (`NOT_CONNECTED`), and `@enardo/database` `^2.0.0` is the peer.
- `schemas` moves from the options to the two calls; `logger` goes, and the results take its place. Both are compile errors where the options are an object literal; from a variable they compile and sync nothing, so check the calls.
- During the first rollout, the 1.x instances that start still sync at `connect()` with their schema and drop the indexes it does not name: the release that upgrades changes no schema, and schema changes start with the next one.
