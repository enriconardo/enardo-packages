---
status: draft
type: feature
tier: M
implementer: sonnet/medium
packages: ["@enardo/database-mongo"]
branch: feature/database-mongo/explicit-schema-sync
---

# `MongoDatabase` syncs the schema on request, not at `connect()`

## Why

From two backlog items, both from reviews of `@enardo/database-mongo`:

- *Concurrent `connect()`s of `MongoDatabase` still reject on 12587 and 48* (review of `fix/database-mongo/concurrent-index-drop`, 2026-10-28). Root cause: every instance runs the schema sync (collections, validators, indexes, stale index drops) inside `connect()`, so a rolling deploy or several replicas starting together run concurrent DDL on the same collections. Each race found so far got a tolerance of its own (27); 12587 on `collMod` during another instance's index build and 48 on `createCollection` after another instance's `collMod` are the next ones, and an instance on an older schema undoes the indexes of a newer one at every start (`packages/database-mongo/CLAUDE.md`, *The schema sync*).
- *A second `connect()` of `MongoDatabase` leaks the first `MongoClient`* (architectural review of `@enardo/database` and `@enardo/database-mongo`, 2026-10-27): `connect()` always creates a client and overwrites the field, so after `connect(); connect(); disconnect()` the first client stays open. It is folded in because `connect()` is rewritten here, in the same major.

The established practice, decided with the user at intake, is that schema changes run once per deploy, as a step of their own (a job, an init container, a release phase), and that removals run in a later step, after every instance runs the new code (expand/contract). The package follows it: `connect()` only connects; `syncSchema()` is the expand step, `dropStaleIndexes()` the contract step, both called by the app. Running one at a time is the app's job, and the package tolerates no race.

## Probes

All on the suite's in-memory replica set, MongoDB 7.0.24, driver 7.6.0, through a throwaway test file in `packages/database-mongo/__tests__/` (removed).

- `listIndexes()` of a missing collection → rejects, `MongoServerError`, `code` 26, `NamespaceNotFound`.
- `listIndexes()` while a `createIndexes` of `b_1` runs on 300k documents (seen in `currentOp`) → `["_id_"]`; after the build → `["_id_", "b_1"]`. An index whose build still runs is not listed.
- `createCollection` with a `$jsonSchema` validator, then `listCollections` → `options` is `{ validator: <the same object> }`.
- Published versions of `@enardo/database-mongo` (`pnpm view … --registry https://npm.enriconardo.com`, on the host) → `1.0.0` only. The manifest's `2.0.0` is unpublished: the breaking change ships in it, with no bump.
- No package of the monorepo imports `@enardo/database-mongo` (`git grep` outside the package, the specs and the lockfile: ADRs and the backlog only).
- From the previous spec, not run again: `dropIndex` of a missing index → `MongoServerError` 27; concurrent `createCollection` with the same options is accepted, with other stored options → 48.
- The code to change: `connect()` → `src/mongo.database.ts:95`, `initCollections()` → `:214`, `isIndexNotFound` → `:18`, the conflict message naming `connect()` → `:193`; `IMongoDatabase` → `src/mongo.database.types.ts:11`.

## Decisions

All taken with the user at intake.

1. **`connect()` only connects.** No schema work, no `syncOnConnect` option: an option would keep the model this change leaves.
2. **`syncSchema()`, public, is the expand step**: per schema, creates the collection with its validator when missing, else replaces the validator; creates the missing indexes; an existing index with another definition rejects as today (85/86, native `Error`). It drops nothing.
3. **`dropStaleIndexes()`, public, a method of its own, is the contract step**: per schema's collection, drops the indexes the schema does not name (`_id_` kept). The app runs it after the rollout. A method, not a flag of `syncSchema()`: the two run at different moments of a deploy, and a flag ends up on in the wrong one.
4. **`dropStaleIndexes()` drops nothing while an index of the schema is missing.** It lists every schema's collection first; when one lacks an index its schema names, it rejects with a native `Error` naming the collection and the missing indexes, and no index is dropped in any collection (misuse: `syncSchema()` not run or not finished, ADR 0012 point 6). It keeps the rule of today's sync that stale indexes go only once the schema's are in place, so a renamed index is never dropped before its replacement exists. An index still building is not listed (probe), so it counts as missing.
5. **Every server error is rethrown.** The tolerance of 27 on `dropIndex` goes: with one run at a time, an error is either a real failure or the sign of two runs at once, which the app's pipeline must fix. A missing collection in `dropStaleIndexes()` rejects with the server's 26. A run that fails is run again: in sequence, the sync converges.
6. **`connect()` is idempotent.** Connected → resolves without creating a client; while a `connect()` is pending → the same pending outcome, one client; after a rejection → the next call tries again. Option not taken: a native `Error` for a repeated `connect()`; the driver's own `MongoClient.connect()` is idempotent too.
7. **`syncSchema()` and `dropStaleIndexes()` go on `IMongoDatabase`**, which becomes an interface extending `IDatabase`, as its JSDoc foresees. Before `connect()`, both reject with what `getDb()` throws today (`DatabaseError`, `NOT_CONNECTED`); its form is the backlog item *The error contract and the docs…*.
8. **A failed `syncSchema()` or `dropStaleIndexes()` leaves the instance connected**: the connection belongs to the caller, who disconnects.
9. **Logs stay** (ADR 0014: the methods resolve to `void`, so the caller cannot see what changed): a collection created at `debug` by `syncSchema()`, an index dropped at `warn` by `dropStaleIndexes()`, with `{ index }` as today. Option not taken: returning the changes, which would make the logs go.
10. **Not taken:** a distributed lock (lease, crash recovery, waiting with a timeout: machinery for a case the pipeline solves by running one step), and the backlog's tolerances of 48 and 12587. The lock does not go to the backlog either.

## Open questions

None.

## Changes

- `src/mongo.database.ts`:
  - `connect()`: a `private connecting: Promise<void> | undefined`; returns at once when connected, returns `connecting` when set; otherwise creates the client, connects, sets `client` and `conn`, clears `connecting` when settled. On a rejection it closes the client, as today. No schema work.
  - `syncSchema()`: today's `initCollections()` without the drop loop, on `this.getDb()` (its own `NOT_CONNECTED` guard goes).
  - `dropStaleIndexes()`: lists each schema's collection; checks that every index the schema names is listed, collecting the misses of every collection, then rejects with one native `Error` naming each collection and its missing indexes, or drops the stale ones, with no `try`/`catch`. `isIndexNotFound` and `INDEX_NOT_FOUND_CODE` go.
  - The conflict message: "drop it, and syncSchema() creates the schema's definition."
  - JSDoc: the class example (`connect()`, `syncSchema()`, `dropStaleIndexes()`), each method's.
- `src/mongo.database.types.ts`: `IMongoDatabase` an interface extending `IDatabase` with `syncSchema(): Promise<void>` and `dropStaleIndexes(): Promise<void>`, with JSDoc; the `logger` option's JSDoc names the method that logs each event.
- `README.md` (new): what the package does; usage (`connect()`, then `syncSchema()` once per deploy before the rollout, `dropStaleIndexes()` after it); one run at a time, a failed run is run again; an existing index is never changed, and what to do on a conflict; `hidden`; the validator replaced by every `syncSchema()`, and that a stricter validator also applies to the instances still on the old code; the logs; upgrading from 1.x: `connect()` no longer syncs.
- `CLAUDE.md` of the package: *The schema sync* rewritten for the two methods; the 27 rule and the concurrency line go, replaced by "one run at a time is the app's job; no race is tolerated"; the rule of decision 4; the paragraph on older-schema instances says it now applies to a `dropStaleIndexes()` run with an older schema.
- `docs/backlog.md`: the two items go; *The error contract and the docs…* says `@enardo/database-mongo` has a README to extend, and that `syncSchema()` and `dropStaleIndexes()` also reject with `DatabaseError` before `connect()`.

## Test cases

In `packages/database-mongo/__tests__/mongo.database.test.ts`, against the replica set. Today's `connect` tests that check the sync move, as listed; "fails today" means on `main`.

**`connect`**

1. **Creates nothing.** `testSchema`, a collection `users` with a stale index → `connect()` resolves; no collection created, `old_idx` still there, no logs. Fails today.
2. **A repeated `connect()` keeps one client.** `MongoClient.prototype.connect` spied (calls through); `connect()`, keep `getClient()`, `connect()` again → spy called once, `getClient()` is the same object; after `disconnect()`, a `ping` on that client rejects. Fails today.
3. **Concurrent `connect()`s share one client.** Spy as in 2; `Promise.all` of two `connect()`s → both fulfilled, spy called once; after `disconnect()`, `isConnected()` is `false`. Fails today.
4. **A rejected `connect()` is tried again.** Spy as in 2; URI `mongodb://127.0.0.1:1/?serverSelectionTimeoutMS=200`; two `connect()`s in sequence → both reject with `MongoServerSelectionError`, spy called twice. Catches a rejected promise kept as `connecting`.
5. **`connect()` after `disconnect()` connects again.** → `isConnected()` `true`, `ping` resolves on the new client.
6. Kept: *should establish a connection*, *should clean up and rethrow an unreachable server without logging*.

**`syncSchema`**

7. **Before `connect()`** → rejects with `DatabaseError`, `code` `NOT_CONNECTED`.
8. **Moved from `connect`, with `connect()` then `syncSchema()`:** *should default schemas to empty array* (nothing created), *should create a missing collection…*, *should replace the validator…*, *should leave the indexes unchanged when another instance connects…* (as two `syncSchema()` runs in sequence), *should reject with the server's error when a unique index meets duplicates* (now `isConnected()` stays `true`, decision 8), the five of *an index the schema changed* (`expectConflict` runs `syncSchema()` and asserts `isConnected()` `true`, and the message names `syncSchema()`), the two `hidden` cases, *should log a created collection at debug…*.
9. **Drops nothing.** `users` with stale `old_idx` → `syncSchema()` resolves; `old_idx` still there, the schema's indexes created, no `warn`. Catches a drop loop left in the sync.

**`dropStaleIndexes`**

10. **Before `connect()`** → rejects with `DatabaseError`, `NOT_CONNECTED`.
11. **Moved from `connect`, each preceded by `syncSchema()` where the case needs the schema's indexes:** *should drop an index the schema does not name, and log it* (the `warn` with `{ index }`), *should keep only _id_ for a schema without indexes*, *should create the schema's index and drop the one it replaced by name* (`syncSchema()` creates `b_1`, `dropStaleIndexes()` drops `a_1`), *should reject with a failed drop of a stale index, logging nothing*.
12. **A schema index missing drops nothing anywhere.** Two schemas: `users` (`testSchema`, synced, plus stale `old_idx`) first, `logs` with schema index `a_1` not created second → rejects with an `Error`, not a `MongoServerError`, whose message names `'logs'` and `'a_1'`; `old_idx` still on `users`; no logs. Catches a check made collection by collection, interleaved with the drops.
13. **The message names every miss.** `users` lacking `email_unique` and `logs` lacking `a_1` → the message names both collections and both indexes.
14. **A stale index dropped by someone else rejects.** The `dropFirstElsewhere` helper of today's suite on `old_idx` → rejects with `MongoServerError`, `code` 27; no logs. Catches the tolerance left in. Replaces the four cases of *a stale index dropped concurrently*, which go.
15. **A missing collection rejects.** Schema `users`, no collection → rejects with `MongoServerError`, `code` 26.
16. **Other collections are untouched.** `other` with an index `x_1`, not in any schema; `users` synced → after `dropStaleIndexes()`, `x_1` still on `other`.
17. **Leaves the validator alone.** `users` synced, then its validator replaced through `setupDb` → after `dropStaleIndexes()`, the validator is the replaced one. Catches a `syncSchema()` run inside it.

## Risks

Risk `medium`:

- An app that upgrades without calling `syncSchema()` runs with no new collection, validator or index, silently, and a missing `unique` index lets duplicates in. Shown by: the major, the README's upgrade note. Nothing in the package can tell.
- `dropStaleIndexes()` run before the rollout ends drops indexes the old instances still use. Shown by: the README; decision 4 covers only the reverse order.

## Out of scope

- The error contract (`DatabaseError` before `connect()`), the README of `@enardo/database`, `IDatabase`'s JSDoc that allows a `connect()` with initialization tasks: the backlog item *The error contract and the docs of `@enardo/database` and `@enardo/database-mongo`*.
- `disconnect()` while a `connect()` is pending: it finds no client and resolves; the pending `connect()` then connects. Unchanged from today.
- A lock, and any tolerance of a concurrent run (decision 10).

## Plan

1. Test-first (`test-author`): cases 2–5. Then the idempotent `connect()`, still syncing; the suite green. Commit `[@enardo/database-mongo] fix: reuse the client on a repeated connect`.
2. Test-first (`test-author`): cases 1 and 7–17, the moved cases rewritten as listed, the four concurrent-drop cases removed. Then `syncSchema()`, `dropStaleIndexes()`, `connect()` without the sync, `IMongoDatabase`, the JSDoc; the suite green. Commit `[@enardo/database-mongo] feat: sync the schema on request` (body: the why, and that `connect()` no longer syncs, a breaking change).
3. `README.md` and the package `CLAUDE.md`. Commit `[@enardo/database-mongo] docs: …`.
4. `docs/backlog.md`, in a commit of its own.
5. `pnpm verify`.
