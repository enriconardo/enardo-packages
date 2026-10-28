# @enardo/database-mongo

`MongoDatabase`: the connection lifecycle to MongoDB, and the sync of each schema's collection, validator and indexes at `connect()`. This file holds the rules for changing the package.

## The schema sync

- **An existing index is never changed.** `connect()` creates the indexes that are missing. One the schema names with another definition (its key, its options, or the same key under another name, unless `unique`, `sparse`, `collation` or `partialFilterExpression` also differ: the server then keeps both indexes) makes the sync reject with a native `Error` that names the index and the collection, with the server's error (85 or 86) as `cause`. Dropping it by hand is the fix: `connect()` then creates the schema's definition. A changed index is a schema migration: done at start it would run on every instance at once, and a dropped `unique` index leaves a window for duplicates.
- **The server judges the conflict**, not the package: it normalizes what it stores (collation, text keys), and a comparison here would have to copy that. One `createIndexes` per collection; one per index only after it rejects with 85 or 86, to find the one at fault.
- **`hidden` applies when an index is created.** It changes through `collMod`, and a difference in it is not a conflict: a hidden index is still maintained, and hiding one before dropping it is a standard step.
- **Stale indexes are dropped after every index of the schema is in place**, and a rejection drops no index of its collection (the schemas before it have synced). An instance on an older schema drops the indexes a newer one created: in a rolling deploy, a new name with a new key is undone by the old instance, which recreates the old index and drops the new one. A new name with the same key is rejected (85) while the old index exists, unless `unique`, `sparse`, `collation` or `partialFilterExpression` also differ: the server keeps both, and the old instance undoes that rename too, dropping a `unique` index the new schema added. After the hand drop, an instance on the old schema rejects at start: a rollback, or a restart during the rollout, fails until the index is dropped again.
- **A stale index another instance dropped first is skipped:** a `dropIndex` rejecting with 27 does not reject `connect()`, and only the drop that happened is logged. Concurrent `connect()`s are otherwise not made safe: a `collMod` during another instance's index build rejects with 12587, and a `createCollection` after another instance's `collMod` rejects with 48, even on one schema (probed on 7.0.24); both are in the backlog.
- **A collection's validator is replaced on every `connect()`**, whatever the collection holds.

## Tests

The suite runs against the in-memory replica set (`mongoReplicaSet()` of `@enardo/vitest-config`), one database per test, with no mock of `mongodb`: what the server does with an index is the behavior under test. The logger is a set of `vi.fn()`.
