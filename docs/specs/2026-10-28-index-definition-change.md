---
status: draft
type: fix
tier: M
implementer: sonnet/medium
packages: ["@enardo/database-mongo"]
branch: fix/database-mongo/index-definition-change
---

# `MongoDatabase.connect()` rejects an index the schema changed, naming it

## Why

From the backlog item *`MongoDatabase` cannot change or rename an index*, found by the architectural review of `@enardo/database` and `@enardo/database-mongo` (2026-10-27).

`connect()` passes every index of a schema to one `createIndexes`, then drops the indexes the schema no longer names. An index that the schema keeps under its name with another definition, or renames with the same key, makes the server reject the batch: `connect()` rejects with a bare `MongoServerError` (85 or 86), and the app fails to start with a message that names neither the collection nor what to do. A change of `hidden` is worse: the server accepts it and leaves the index as it was, so the schema and the database differ in silence. The JSDoc calls the sync idempotent and says it "creates/updates indexes": it never updates one.

The user chose to reject such a change, not to drop and recreate the index (see *Decisions*).

## Probes

All on MongoDB 7.0.24 (the in-memory server of `mongodb-memory-server` 10.4.3), driver `mongodb` 7, in the dev container.

- `createIndexes([after])` on a collection holding `before` (one collection per case):
  - same name, other key → 86 `IndexKeySpecsConflict`, errmsg names both definitions.
  - same key, other name → 85 `IndexOptionsConflict`, errmsg `Index already exists with a different name: i`.
  - same name and key: `unique` added or removed, `sparse` added, `partialFilterExpression` changed, `collation` added, key order or direction changed → 86. `expireAfterSeconds` added or changed, text `weights` changed → 85. Every errmsg of 85 and 86 except the rename names the requested and the existing definition.
  - `hidden: true` added → resolves, the index stays visible. An index created hidden, then requested without `hidden` → resolves, it stays hidden. A fresh index with `hidden: true` is listed with `hidden: true`.
  - `background: true` added → resolves (the option is ignored since 4.2).
  - an identical definition → resolves.
  - another name, another `partialFilterExpression`, same key → resolves: both indexes exist.
- `createIndexes([{z}, {conflicting i}])` → 86, and `z` is not created: one batch is all or nothing.
- The server normalizes what it stores and compares: a `collation: { locale: "en" }` becomes ten fields, a text key `{ a: "text" }` becomes `{ _fts: "text", _ftsx: 1 }` with three more options. A comparison of definitions in the package would have to mirror it; the server's own check does not.
- The rejection is a `MongoServerError` (`name` `MongoServerError`) with a numeric `code`.
- Current sync → `packages/database-mongo/src/mongo.database.ts:141-191`; the JSDoc to correct → `:132-140` and `:166`.
- Test setup to reuse → `packages/transaction-manager-mongo/__tests__/setup/replica-set.ts`, `__tests__/support/fixtures.ts`, and the `test` block of its `vitest.config.ts`. `mongodb-memory-server` is `^10.4.3` there, not in the catalog; `allowBuilds` already has it.
- Not probed: a unique index built over duplicate values rejects with 11000 `DuplicateKey` (test case 12 relies on it; the implementer confirms it when writing the case).

## Decisions

- **Reject, never drop a schema's index.** Taken with the user. A changed index is a schema migration: done by `connect()` it would run on every instance at start, concurrently in a rolling deploy; a `unique` index dropped and rebuilt leaves a window where duplicates enter, and its rebuild then fails with the data already dirty; a build over a large collection holds `connect()` for its duration. Not taken: drop and recreate (as the backlog item's first option), and applying in place, through `collMod`, the changes the server allows (`expireAfterSeconds`, `hidden`, `unique` through `prepareUnique`): no need for it was observed.
- **The server judges whether two definitions differ**, not the package: it already rejects every change but `hidden` and `background`, and its normalization (collation, text keys) would have to be copied.
- **`hidden` is checked by the package**, as the one change the server accepts without applying it. `background` is not: the server ignores the option altogether.
- **One `createIndexes` per index**, so the rejection knows the index. An index created before the one that conflicts stays: the schema names it, and the next `connect()` would create it anyway.
- **A native `Error`**: a schema that the database does not match is a misconfiguration, which the caller cannot handle by a `code` (ADR 0012 point 6). Its `cause` is the server's error.
- **The supported way to change an index** stays a new name with a new key: the new index is created before the old one is dropped. Anything else is dropped by hand, and the next `connect()` creates the schema's definition. The message says so.

## Open questions

- **The version.** The rejection of a conflict changes from a `MongoServerError` with `code` 85 or 86 to a native `Error` with that error as its `cause`: a caller reading `error.code` on `connect()` no longer sees it. The JSDoc promised a `DatabaseError`, so the old form was never documented; and the condition is a misconfiguration no caller should branch on. Recommended: a patch. The other option is a major, which the backlog item *The error contract and the docs of `@enardo/database` and `@enardo/database-mongo`* brings anyway, so this fix could wait to ship with it.

## Changes

### `@enardo/database-mongo`

- `src/mongo.database.ts`, the index sync of each schema, in this order:
  1. each schema index goes to its own `createIndexes([index])`, in the schema's order. A rejection with `code` 85 or 86 becomes `new Error(message, { cause })`:
     `Index '<name>' of collection '<collection>' conflicts with an existing index: <the server's errmsg>. MongoDatabase never changes an existing index: drop it to apply the schema's definition, or give the new definition a new name and key.`
     Any other rejection passes through as it is.
  2. `listIndexes` once. A schema index whose `hidden === true` differs from the listed index's `hidden === true` rejects with an `Error` naming the index, the collection, and both values, with the same advice. No `cause`.
  3. the stale indexes are dropped and logged, as today. A rejection in 1 or 2 drops nothing.
  The connection cleanup of `connect()` is unchanged: the client is closed and `isConnected()` is `false`.
- The JSDoc of `initCollections` and `connect()`: indexes are created when missing, an existing one is never changed, and `connect()` rejects when one differs from the schema. The `@throws {DatabaseError}` of `connect()` is left to the backlog item on the error contract. The `// Always update/create indexes (idempotent)` comment goes. `IMongoIndex`'s JSDoc says the name is how the sync matches an index.
- `__tests__/mongo.database.test.ts`: the suite moves from the mock of `mongodb` to the in-memory replica set, one database per test (`test_<uuid>`). The existing cases keep what they assert, against the real server: the cases below replace those of `connect`, `schema without indexes` and `logging`; `disconnect`, `isConnected`, `getDb`, `getClient` and the constructor keep theirs. The logger stays a set of `vi.fn()`.
- `__tests__/setup/replica-set.ts` and `__tests__/support/fixtures.ts`: as in `@enardo/transaction-manager-mongo`, reduced to what this suite uses. `vitest.config.ts` gets the same `test` block. The duplication is the backlog item *The vitest `test` block of the Mongo adapters*, which now counts three packages: the item is updated to say so.
- `package.json`: `mongodb-memory-server` `^10.4.3` in `devDependencies`.
- `CLAUDE.md`, new: the rules of the schema sync (an existing index is never changed; the server judges a conflict, the package checks `hidden`; stale indexes are dropped only after every schema index is in place; a collection's validator is replaced on every `connect()`), and that the tests run against the in-memory replica set, one database per test, with no mock of `mongodb`.

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
11. `hidden`:
    a. a schema index `hidden: true` on a missing index → created hidden, resolves;
    b. an existing visible `i`, a schema with `hidden: true` → rejects with an `Error` whose message names `i`, the collection and `hidden`; `i` is still visible;
    c. an existing hidden `i`, a schema without `hidden` → rejects the same way; `i` is still hidden.
12. Two documents with the same `a`, a schema naming a `unique` index on `{ a: 1 }` → rejects with the server's error itself, `code` 11000, not wrapped.
13. A schema naming `z` on `{ z: 1 }` then `i` on `{ b: 1 }`, over an existing `i` on `{ a: 1 }` → rejects with a conflict; `z` exists.
14. Any rejection of 7–13 → `isConnected()` is `false` and `getDb()` throws; nothing is logged.
15. A failed drop of a stale index (`Collection.prototype.dropIndex` spied to reject) → `connect()` rejects with that error, nothing is logged.
16. An unreachable server (`serverSelectionTimeoutMS` short in the URI) → rejects with the driver's error, `isConnected()` is `false`, nothing is logged.
17. A schema with a created collection → logged at `debug` once, `Collection 'users' created.`, nothing else.

Cases 7–11b/c and 13 are written first, and fail on `main`'s code for the wrapping or the `hidden` check: on 7–10 and 13 with a bare `MongoServerError`, on 11b/c by resolving.

## Risks

- **A case passing on a cached index.** Each test has its own database; a test that reuses one would see another's indexes. Shown by the cases asserting what is listed.
- **A startup that rejected before now rejects with another error:** an app's log of the failed start changes form. Its content grows: the server's text stays in the message.

## Out of scope

- Concurrent `connect()`s and `IndexNotFound` (27) on a stale index, a second `connect()` leaking a client, `DatabaseError` and the `@throws` of `connect()`, the README: each is a backlog item of its own, after this one.
- Applying changes in place through `collMod`.

## Plan

1. **Tests on the replica set, no behavior change.** Setup, fixtures, `vitest.config.ts`, the devDependency; the suite rewritten on the real server with the cases that hold on today's code (1–6, 12, 15–17, and 11a). Green. The backlog item on the vitest block updated.
2. **Test-first: the conflicts.** Cases 7–10, 13, 14 fail on today's code; then one `createIndexes` per index and the wrapping. Green.
3. **Test-first: `hidden`.** Cases 11b and 11c fail; then the check. Green.
4. **Docs.** The JSDoc, and the package's `CLAUDE.md`.
5. The backlog item removed, in a commit of its own.
