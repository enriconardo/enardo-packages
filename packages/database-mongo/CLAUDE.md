# @enardo/database-mongo

`MongoDatabase`: the connection lifecycle to MongoDB, and the sync of each schema's collection, validator and indexes, which the app calls: `syncSchema(schemas)` (expand) and `dropStaleIndexes(schemas)` (contract). `connect()` only connects. This file holds the rules for changing the package.

## The schema sync

- **An existing index is never changed.** `syncSchema()` creates the indexes that are missing. One the schema names with another definition (its key, its options, or the same key under another name, unless `unique`, `sparse`, `collation` or `partialFilterExpression` also differ: the server then keeps both indexes) makes it reject with a native `Error` that names the index and the collection, with the server's error (85 or 86) as `cause`. Dropping it by hand is the fix: `syncSchema()` then creates the schema's definition. A changed index is a schema migration: a dropped `unique` index leaves a window for duplicates.
- **The server judges the conflict**, not the package: it normalizes what it stores (collation, text keys), and a comparison here would have to copy that. One `createIndexes` per collection; one per index only after it rejects with 85 or 86, to find the one at fault.
- **`hidden` applies when an index is created.** It changes through `collMod`, and a difference in it is not a conflict: a hidden index is still maintained, and hiding one before dropping it is a standard step.
- **The indexes come before `collMod`.** A build outlives its client: a run killed mid-build and run again waits on the identical `createIndexes`, where a `collMod` first would reject with 12587 until the build ends. A conflict also leaves the validator as it was.
- **`syncSchema()` drops nothing; `dropStaleIndexes()` drops nothing while a schema's collection or index is missing.** It lists every collection first (a 26 is a missing collection, the one code it reads) and rejects with one native `Error` naming every miss, so a renamed index is never dropped before its replacement exists. An index still building is not listed, so it counts as missing. A `dropStaleIndexes()` run with an older schema (or a 1.x instance at its `connect()`) drops the indexes a newer one created; after the hand drop of a conflicting index, a run on the old schema rejects until it is dropped again.
- **One run at a time is the app's job; no race is tolerated.** Every other server error is rethrown, a `dropIndex` rejecting with 27 included: it is a real failure or two runs at once. A failed method leaves the instance connected.
- **The package logs nothing**: the results carry what changed (ADR 0014).
- **A collection's validator is replaced on every `syncSchema()`**, whatever the collection holds.

## Tests

The suite runs against the in-memory replica set (`mongoReplicaSet()` of `@enardo/vitest-config`), one database per test, with no mock of `mongodb`: what the server does with an index is the behavior under test.
