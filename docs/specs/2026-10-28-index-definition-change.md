---
status: done
type: fix
tier: M
implementer: sonnet/medium
packages: ["@enardo/database-mongo"]
branch: fix/database-mongo/index-definition-change
---

# `MongoDatabase.connect()` rejects an index the schema changed, naming it

## Why

From the backlog item *`MongoDatabase` cannot change or rename an index*, found by the architectural review of `@enardo/database` and `@enardo/database-mongo` (2026-10-27).

`connect()` passes every index of a schema to one `createIndexes`, then drops the indexes the schema no longer names. An index that the schema keeps under its name with another definition, or renames with the same key, makes the server reject the batch: `connect()` rejects with a bare `MongoServerError` (85 or 86). Its message names the index but not the collection, nor what to do, and the JSDoc calls the sync idempotent and says it "creates/updates indexes": it never updates one. No app is known to have met it yet; the first index an app changes will.

The user chose to reject such a change, not to drop and recreate the index (see *Decisions*).

## Probes

All on MongoDB 7.0.24 (the in-memory server of `mongodb-memory-server` 10.4.3), driver `mongodb` 7, in the dev container.

- `createIndexes([after])` on a collection holding `before` (one collection per case):
  - same name, other key → 86 `IndexKeySpecsConflict`, errmsg names both definitions.
  - same key, other name → 85 `IndexOptionsConflict`, errmsg `Index already exists with a different name: i`.
  - same name and key: `unique` added or removed, `sparse` added, `partialFilterExpression` changed, `collation` added, key order or direction changed → 86. `expireAfterSeconds` added or changed, text `weights` changed → 85. Every errmsg of 85 and 86 except the rename names the requested and the existing definition.
  - `hidden: true` added → resolves, the index stays visible. An index created hidden, then requested without `hidden` → resolves, it stays hidden. A fresh index with `hidden: true` is listed with `hidden: true`.
  - `background: true` added → resolves (the option is ignored since 4.2). `version: 1`, `textIndexVersion: 2`, `2dsphereIndexVersion: 2` → resolve, the index keeps v2, 3 and 3 (the `critic`'s probe).
  - `default_language` added or changed, `language_override` added, `bits` added or changed, `min`/`max` added or changed, `storageEngine` added, `bucketSize` added to a `2d` index → 85. `wildcardProjection` added or changed → 86. A fresh `geoHaystack` index with `bucketSize` → 67 `CannotCreateIndex` (removed in 5.0).
  - With these, every option of the driver's `IndexDescription` (`mongodb.d.ts`: `key`, `name`, `collation` and the 18 picked from `CreateIndexesOptions`) is probed: each change rejects with 85 or 86, but `hidden`, `background`, `version`, `textIndexVersion` and `2dsphereIndexVersion`, which resolve.
  - an identical definition → resolves.
  - another name, another `partialFilterExpression`, same key → resolves: both indexes exist.
- A hidden `unique` index still rejects a duplicate with 11000, and the planner ignores it (`find({ a: 1 })` plans a `COLLSCAN`); an index hidden with `collMod`, then requested without `hidden`, resolves (the `critic`'s probe).
- `createIndexes([{z}, {conflicting i}])` → 86, and `z` is not created: one batch is all or nothing.
- The server normalizes what it stores and compares: a `collation: { locale: "en" }` becomes ten fields, a text key `{ a: "text" }` becomes `{ _fts: "text", _ftsx: 1 }` with three more options. A comparison of definitions in the package would have to mirror it; the server's own check does not.
- The rejection is a `MongoServerError` (`name` `MongoServerError`) with a numeric `code`.
- Current sync → `packages/database-mongo/src/mongo.database.ts:141-191`; the JSDoc to correct → `:132-140` and `:166`.
- Test setup to reuse → `mongoReplicaSet()` of `@enardo/vitest-config` (its README, *The Mongo replica set*), as `packages/transaction-manager-mongo/vitest.config.ts` and `__tests__/support/fixtures.ts` use it; `mongodb-memory-server` is in the catalog and in `allowBuilds`.
- The registry has `@enardo/database-mongo` 1.0.0 only (`pnpm view`, 2026-10-28): the manifest's 2.0.0 is unpublished, and this change ships in it.
- Not probed: a unique index built over duplicate values rejects with 11000 `DuplicateKey` (test case 11 relies on it; the implementer confirms it when writing the case).

## Decisions

- **Reject, never drop a schema's index.** Taken with the user. A changed index is a schema migration: done by `connect()` it would run on every instance at start, concurrently in a rolling deploy; a `unique` index dropped and rebuilt leaves a window where duplicates enter, and its rebuild then fails with the data already dirty; a build over a large collection holds `connect()` for its duration. Not taken: drop and recreate (as the backlog item's first option), and applying in place, through `collMod`, the changes the server allows (`expireAfterSeconds`, `hidden`, `unique` through `prepareUnique`): no need for it was observed.
- **The server judges whether two definitions differ**, not the package: it rejects every change that alters what an index holds or enforces, and its normalization (collation, text keys) would have to be copied.
- **`hidden` is not checked.** A hidden index is still maintained and enforces `unique`, so a difference costs query plans, not correctness; and hiding an index with `collMod` before dropping it is a standard step that a check would turn into a failed start. The JSDoc and the package's `CLAUDE.md` say that `hidden` applies when an index is created, and changes through `collMod`. Not taken: a rejection, or a `warn`, until a schema uses `hidden`.
- **One batch per collection, as today; one `createIndexes` per index only after the batch rejects with 85 or 86**, to find the index: the batch is all or nothing, so the per-index pass starts from the same state. A `connect()` without conflict keeps one round trip per collection. An index created by the per-index pass before the one that conflicts stays: the schema names it.
- **A native `Error`**: a schema that the database does not match is a misconfiguration, which the caller cannot handle by a `code` (ADR 0012 point 6). Its `cause` is the server's error.
- **The message advises dropping the index by hand**, after which `connect()` creates the schema's definition. A new name with a new key also works (the new index is created before the old one is dropped), but in a rolling deploy an instance on the old schema rebuilds the old index and drops the new one: the package's `CLAUDE.md` records it, the message does not offer it.

## Open questions

None.

## Changes

### `@enardo/database-mongo`

- `src/mongo.database.ts`, the index sync of each schema:
  1. the schema's indexes go to one `createIndexes`, as today. When it rejects with `code` 85 or 86, each index goes to its own `createIndexes([index])`, in the schema's order, and the first that rejects with 85 or 86 becomes `new Error(message, { cause })`:
     `Index '<name>' of collection '<collection>' conflicts with an existing index: <the server's errmsg>. MongoDatabase never changes an existing index: drop it, and connect() creates the schema's definition.`
     Any other rejection, of the batch or of the per-index pass, passes through as it is.
  2. the stale indexes are dropped and logged, as today. A rejection in 1 drops nothing.
  The connection cleanup of `connect()` is unchanged: the client is closed and `isConnected()` is `false`.
- The JSDoc of `initCollections` and `connect()`: indexes are created when missing, an existing one is never changed, `connect()` rejects when one conflicts with the schema, and `hidden` applies at creation only. The `@throws {DatabaseError}` of `connect()` is left to the backlog item on the error contract. The `// Always update/create indexes (idempotent)` comment goes. `IMongoIndex`'s JSDoc says the name is how the sync matches an index.
- `__tests__/mongo.database.test.ts`: the suite moves from the mock of `mongodb` to the in-memory replica set, one database per test (`test_<uuid>`). The cases of `connect`, `schema without indexes` and the log points of `logging` become the cases below; every other existing case keeps what it asserts, on the real server: `disconnect`, `isConnected`, `getDb`, `getClient`, the constructor, the child logger with its context and `dbName`, and `connect()` without a logger. The logger stays a set of `vi.fn()`.
- `vitest.config.ts`: `...mongoReplicaSet()` in `test`, as in `@enardo/transaction-manager-mongo`. `__tests__/support/fixtures.ts`: the `mongoUri` declaration, `connect()`, and a database per test, as there, reduced to what this suite uses.
- `package.json`: `@enardo/vitest-config` (`workspace:^`) and `mongodb-memory-server` (`catalog:`) in `devDependencies`.
- `CLAUDE.md`, new: the rules of the schema sync (an existing index is never changed, the server judges a conflict; `hidden` applies at creation only; stale indexes are dropped only after every schema index is in place, and an instance on an older schema drops the newer indexes; a collection's validator is replaced on every `connect()`), and that the tests run against the in-memory replica set, one database per test, with no mock of `mongodb`.

## Test cases

Each case runs `connect()` of a new `MongoDatabase` on its own database, after any setup made through a separate `MongoClient`. "Rejects with a conflict" means: a native `Error` that is not a `MongoServerError`, whose message contains the collection's and the index's name, and whose `cause` is a `MongoServerError` with the given `code`.

1. A schema on a missing collection → the collection exists with the schema's validator, and every schema index is listed with its name, key and `unique`.
2. A schema on an existing collection with another validator → the validator is the schema's.
3. `connect()`, `disconnect()`, then `connect()` of another instance with the same schema → resolves, the indexes are unchanged, nothing is logged by the second.
4. An existing index the schema does not name, `{ legacy: 1 }` `unique` → dropped, and logged at `warn` once, `Index 'old_idx' dropped from collection 'users'.` with its listed definition as `index`; nothing else is logged.
5. A schema without indexes on an existing collection → only `_id_` is left, and it is never dropped.
6. An existing `a_1` on `{ a: 1 }`, a schema naming `b_1` on `{ b: 1 }` only → `b_1` exists, `a_1` is dropped.
7. An existing `i` on `{ a: 1 }`, a schema naming `i` on `{ b: 1 }`, and a stale `old` → rejects with a conflict, `code` 86; `i` is still on `{ a: 1 }`, and `old` still exists.
8. An existing `i` on `{ a: 1 }`, a schema naming `j` on `{ a: 1 }` → rejects with a conflict, `code` 85; `i` exists, `j` does not.
9. An existing `i` on `{ a: 1 }`, a schema naming `i` on `{ a: 1 }` with `unique: true` → rejects with a conflict, `code` 86; `i` is not unique.
10. An existing `i` with `expireAfterSeconds: 10`, a schema with `20` → rejects with a conflict, `code` 85.
11. Two documents with the same `a`, a schema naming a `unique` index on `{ a: 1 }` → rejects with the server's error itself, `code` 11000, not wrapped.
12. A schema naming `z` on `{ z: 1 }` then `i` on `{ b: 1 }`, over an existing `i` on `{ a: 1 }` → rejects with a conflict naming `i`, not `z`; `z` exists.
13. `hidden`: a schema index `hidden: true` on a missing index → created hidden; an existing `i` hidden through `collMod`, a schema without `hidden` → resolves, `i` stays hidden.
14. Any rejection of 7–12 → `isConnected()` is `false` and `getDb()` throws; nothing is logged.
15. A failed drop of a stale index (`Collection.prototype.dropIndex` spied to reject) → `connect()` rejects with that error, nothing is logged.
16. An unreachable server (`serverSelectionTimeoutMS` short in the URI) → rejects with the driver's error, `isConnected()` is `false`, nothing is logged.
17. A schema with a created collection → logged at `debug` once, `Collection 'users' created.`, nothing else.

Cases 7–10, 12 and 14 are written first, and fail on `main`'s code with a bare `MongoServerError`.

## Risks

- **A case passing on a cached index.** Each test has its own database; a test that reuses one would see another's indexes. Shown by the cases asserting what is listed.
- **A startup that rejected before now rejects with another error:** an app's log of the failed start changes form. Its content grows: the server's text stays in the message.

## Out of scope

- Concurrent `connect()`s and `IndexNotFound` (27) on a stale index, a second `connect()` leaking a client, `DatabaseError` and the `@throws` of `connect()`, the README: each is a backlog item of its own, after this one.
- Applying changes in place through `collMod`, and checking `hidden`.

## Plan

1. **Tests on the replica set, no behavior change.** Fixtures, `vitest.config.ts`, the devDependency; the suite rewritten on the real server with the cases that hold on today's code (1–6, 11, 13, 15–17, and the other existing cases). Green.
2. **Test-first: the conflicts.** Cases 7–10, 12, 14 fail on today's code; then the per-index pass and the wrapping. Green.
3. **Docs.** The JSDoc, and the package's `CLAUDE.md`.
4. The backlog item removed, in a commit of its own.
