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

- *Concurrent `connect()`s of `MongoDatabase` still reject on 12587 and 48* (review of `fix/database-mongo/concurrent-index-drop`, 2026-10-28). Root cause: every instance runs the schema sync (collections, validators, indexes, stale index drops) inside `connect()`, so a rolling deploy or several replicas starting together run concurrent DDL on the same collections. Each race found so far got a tolerance of its own (27); 12587 on `collMod` during another instance's index build and 48 on `createCollection` after another instance's `collMod` are the next ones, and an instance on an older schema undoes the indexes of a newer one at every start (`packages/database-mongo/CLAUDE.md`, *The schema sync*). No tolerance fixes the last one.
- *A second `connect()` of `MongoDatabase` leaks the first `MongoClient`* (architectural review of `@enardo/database` and `@enardo/database-mongo`, 2026-10-27): `connect()` always creates a client and overwrites the field, so after `connect(); connect(); disconnect()` the first client stays open. It is folded in because `connect()` is rewritten here, in the same major.

The races were reproduced in probes; whether an app runs several instances is not known from this repo. The established practice, decided with the user at intake, is that schema changes run once per deploy, as a step of their own outside the instances (a job, a release phase), and that removals run in a later step, after every instance runs the new code (expand/contract). The package follows it: `connect()` only connects; `syncSchema(schemas)` is the expand step, `dropStaleIndexes(schemas)` the contract step, both called by the app. Running one at a time is the app's job, and the package tolerates no race.

## Probes

All on the suite's in-memory replica set, MongoDB 7.0.24, driver 7.6.0, through a throwaway test file in `packages/database-mongo/__tests__/` (removed).

- `listIndexes()` of a missing collection → rejects, `MongoServerError`, `code` 26, `NamespaceNotFound`.
- `listIndexes()` while a `createIndexes` of `b_1` runs on 300k documents (seen in `currentOp`) → `["_id_"]`; after the build → `["_id_", "b_1"]`. An index whose build still runs is not listed.
- The same build, its client closed with `close(true)` once the build shows in `currentOp` → the build's promise rejects with `MongoClientClosedError`; `currentOp` still shows the build; a `collMod` of the validator from another client → rejects with 12587; a `createIndexes` of the same spec from that client → resolves after 563 ms, when the build ends; then `["_id_", "b_1"]`. A build outlives its client, and an identical `createIndexes` waits for it.
- `createCollection` with a `$jsonSchema` validator, then `listCollections` → `options` is `{ validator: <the same object> }`.
- `packages/typescript-config/library.json` includes `__tests__/**/*` in the program: a `@ts-expect-error` in a test is checked by `typecheck`.
- Published versions of `@enardo/database-mongo` (`pnpm view … --registry https://npm.enriconardo.com`, on the host) → `1.0.0` only. The manifest's `2.0.0` is unpublished: the breaking change ships in it, with no bump.
- No package of the monorepo imports `@enardo/database-mongo` (`git grep` outside the package, the specs and the lockfile: ADRs and the backlog only).
- From the previous spec, not run again: `dropIndex` of a missing index → `MongoServerError` 27; concurrent `createCollection` with the same options is accepted, with other stored options → 48.
- The code to change: `connect()` → `src/mongo.database.ts:95`, `initCollections()` → `:214`, `isIndexNotFound` → `:18`, the conflict message naming `connect()` → `:193`; `IMongoDatabase` → `src/mongo.database.types.ts:11`, `IMongoSchema`'s JSDoc "on connection" → `:38`, `schemas` "to initialize on connect" → `:51`; the package `CLAUDE.md` intro "at `connect()`" → `CLAUDE.md:3`.

## Decisions

Decisions 1–3, 5, 6, 10 were taken with the user at intake; the others come from the spec and its `critic` run.

1. **`connect()` only connects.** No schema work, no `syncOnConnect` option: an option would keep the model this change leaves.
2. **The schemas are an argument of the two methods, not an option.** `schemas` leaves `IMongoDatabaseOptions`. A 1.x call `new MongoDatabase({ dbUri, dbName, schemas })` then fails to compile (excess property) at the call site, instead of compiling and silently syncing nothing: the worst risk of the upgrade becomes a type error where the options are an object literal. It also fits the model: the schema is an input of the deploy step, not configuration of every instance.
3. **`syncSchema(schemas)`, public, is the expand step**: per schema, in order, creates the collection with its validator when missing; creates the missing indexes; replaces the validator of a collection that existed. An existing index with another definition rejects as today (85/86, native `Error`), before the validator is replaced. It drops nothing. The indexes come before `collMod` because a build outlives its client (probe): a run killed mid-build and run again waits on the identical `createIndexes`, where a `collMod` first would reject with 12587 until the build ends.
4. **`dropStaleIndexes(schemas)`, public, a method of its own, is the contract step**: per schema's collection, drops the indexes the schema does not name (`_id_` kept). The app runs it after the rollout. A method, not a flag of `syncSchema()`: the two run at different moments of a deploy, and a flag ends up on in the wrong one.
5. **`dropStaleIndexes()` drops nothing while a schema's collection or index is missing.** It lists every schema's collection first; when a collection is missing (`listIndexes` rejects with 26, the one server code it reads) or lacks an index its schema names, it rejects with a native `Error` naming each such collection, as missing or with its missing indexes, and no index is dropped in any collection (misuse: `syncSchema()` not run or not finished, ADR 0012 point 6). It keeps the rule of today's sync that stale indexes go only once the schema's are in place, so a renamed index is never dropped before its replacement exists. An index still building is not listed (probe), so it counts as missing.
6. **Every other server error is rethrown.** The tolerance of 27 on `dropIndex` goes: with one run at a time, an error is either a real failure or the sign of two runs at once, which the app's pipeline must fix. A run that fails is run again: in sequence, the sync converges (decision 3).
7. **`connect()` is idempotent.** Connected → resolves without creating a client; while a `connect()` is pending → the same pending outcome, one client; after a rejection → the next call tries again. Option not taken: a native `Error` for a repeated `connect()`; the driver's own `MongoClient.connect()` is idempotent too.
8. **`syncSchema()` and `dropStaleIndexes()` go on `IMongoDatabase`**, which becomes an interface extending `IDatabase`, as its JSDoc foresees. Before `connect()`, both reject with what `getDb()` throws today (`DatabaseError`, `NOT_CONNECTED`); its form is the backlog item *The error contract and the docs…*.
9. **A failed `syncSchema()` or `dropStaleIndexes()` leaves the instance connected**: the connection belongs to the caller, who disconnects. Today a failed sync closes the client, being inside `connect()`.
10. **Not taken:** a distributed lock (lease, crash recovery, waiting with a timeout: machinery for a case the pipeline solves by running one step), and the backlog's tolerances of 48 and 12587. The lock does not go to the backlog either.
11. **Logs stay** (ADR 0014: the methods resolve to `void`, so the caller cannot see what changed): a collection created at `debug` by `syncSchema()`, an index dropped at `warn` by `dropStaleIndexes()`, with `{ index }` as today. Option not taken: returning the changes, which would make the logs go.

## Open questions

None.

## Changes

- `src/mongo.database.ts`:
  - The constructor no longer reads `schemas`; the field goes.
  - `connect()`: a `private connecting: Promise<void> | undefined`; returns at once when connected, returns `connecting` when set; otherwise creates the client, connects, sets `client` and `conn`, clears `connecting` when settled. On a rejection it closes the client, as today. No schema work.
  - `syncSchema(schemas: readonly IMongoSchema[])`: today's `initCollections()` without the drop loop, on `this.getDb()` (its own `NOT_CONNECTED` guard goes), with the order of decision 3.
  - `dropStaleIndexes(schemas: readonly IMongoSchema[])`: lists each schema's collection, a 26 on the list recorded as a missing collection; checks that every index the schema names is listed; then rejects with one native `Error` naming every miss, or drops the stale indexes, with no `try`/`catch` around the drops. `isIndexNotFound` and `INDEX_NOT_FOUND_CODE` go.
  - The conflict message: "drop it, and syncSchema() creates the schema's definition."
  - JSDoc: the class example (`connect()`, `syncSchema(schemas)`, `dropStaleIndexes(schemas)`), each method's.
- `src/mongo.database.types.ts`: `IMongoDatabase` an interface extending `IDatabase` with the two methods, with JSDoc; `schemas` leaves `IMongoDatabaseOptions`; `IMongoSchema`'s JSDoc names the two methods instead of "on connection"; the `logger` option's JSDoc names the method that logs each event.
- `README.md` (new):
  - what the package does;
  - the deploy flow: `syncSchema(schemas)` once per deploy, before the rollout, as a step outside the instances (a job, a release phase), never in each instance's startup, which an init container is; `dropStaleIndexes(schemas)` after the rollout; one run at a time; a failed run is run again, and waits for a build it left running;
  - a single process, local development, an app's integration tests: `connect()`, `syncSchema(schemas)`, `dropStaleIndexes(schemas)` in sequence;
  - an existing index is never changed, and what to do on a conflict; `hidden`; the validator replaced by every `syncSchema()`, and that a stricter validator also applies to the instances still on the old code; the logs;
  - upgrading from 1.x: `connect()` no longer syncs, and `schemas` moves to the calls; during the first rollout the 1.x instances that start still sync at `connect()` with their schema and drop the indexes it does not name, so the release that upgrades changes no schema, and schema changes start with the next one.
- `CLAUDE.md` of the package: the intro and *The schema sync* rewritten for the two methods; the 27 rule and the concurrency line go, replaced by "one run at a time is the app's job; no race is tolerated"; the order of decision 3 with its reason; the rule of decision 5; the paragraph on older-schema instances says it now applies to a `dropStaleIndexes()` run with an older schema.
- `docs/backlog.md`: the two items go; *The error contract and the docs…* says `@enardo/database-mongo` has a README to extend, and that `syncSchema()` and `dropStaleIndexes()` also reject with `DatabaseError` before `connect()`.

## Test cases

In `packages/database-mongo/__tests__/mongo.database.test.ts`, against the replica set. Today's `connect` tests that check the sync move, as listed, with `schemas` passed to the call instead of `createDatabase`; "fails today" means on `main`.

**Options**

1. **`schemas` is not an option.** `new MongoDatabase({ dbUri, dbName, schemas: [testSchema] })` with `// @ts-expect-error` on the `schemas` line: `typecheck` fails if the property is accepted. Fails today (the directive is unused).

**`connect`**

2. **A repeated `connect()` keeps one client.** `MongoClient.prototype.connect` spied (calls through); `connect()`, keep `getClient()`, `connect()` again → spy called once, `getClient()` is the same object; after `disconnect()`, a `ping` on that client rejects. Fails today.
3. **Concurrent `connect()`s share one client.** Spy as in 2; `Promise.all` of two `connect()`s → both fulfilled, spy called once; after `disconnect()`, `isConnected()` is `false`. Fails today.
4. **A rejected `connect()` is tried again.** Spy as in 2; URI `mongodb://127.0.0.1:1/?serverSelectionTimeoutMS=200`; two `connect()`s in sequence → both reject with `MongoServerSelectionError`, spy called twice. Catches a rejected promise kept as `connecting`.
5. **`connect()` after `disconnect()` connects again.** → `isConnected()` `true`, `ping` resolves on the new client.
6. Kept: *should establish a connection*, *should clean up and rethrow an unreachable server without logging*. *should default schemas to empty array* goes with the option.

**`syncSchema`**

7. **Before `connect()`** → rejects with `DatabaseError`, `code` `NOT_CONNECTED`.
8. **Moved from `connect`, with `connect()` then `syncSchema(schemas)`:** *should create a missing collection…*, *should replace the validator…*, *should leave the indexes unchanged when another instance connects…* (as two `syncSchema()` runs in sequence), *should reject with the server's error when a unique index meets duplicates* (now `isConnected()` stays `true`, decision 9), the five of *an index the schema changed* (`expectConflict` runs `syncSchema()` and asserts `isConnected()` `true`, and the message names `syncSchema()`), the two `hidden` cases, *should log a created collection at debug…*.
9. **An empty list creates nothing.** `syncSchema([])` → no collection.
10. **Drops nothing.** `users` with stale `old_idx` → `syncSchema([testSchema])` resolves; `old_idx` still there, the schema's indexes created, no `warn`. Catches a drop loop left in the sync.
11. **A conflict leaves the validator as it was.** `users` with an old validator and index `i` on `{ a: 1 }`; schema with another validator and `i` on `{ b: 1 }` → rejects with the conflict; the validator is the old one. Catches `collMod` before the indexes.

**`dropStaleIndexes`**

12. **Before `connect()`** → rejects with `DatabaseError`, `NOT_CONNECTED`.
13. **Moved from `connect`, each preceded by `syncSchema()` where the case needs the schema's indexes:** *should drop an index the schema does not name, and log it* (the `warn` with `{ index }`), *should keep only _id_ for a schema without indexes*, *should create the schema's index and drop the one it replaced by name* (`syncSchema()` creates `b_1`, `dropStaleIndexes()` drops `a_1`), *should reject with a failed drop of a stale index, logging nothing*.
14. **A schema index missing drops nothing anywhere.** Two schemas: `users` (`testSchema`, synced, plus stale `old_idx`) first, `logs` with schema index `a_1` not created second → rejects with an `Error`, not a `MongoServerError`, whose message names `'logs'` and `'a_1'`; `old_idx` still on `users`; no logs. Catches a check made collection by collection, interleaved with the drops.
15. **A missing collection is a miss, reported with the others.** Schemas: `orders`, no collection, first; `users` lacking `email_unique`, with stale `old_idx`, second → rejects with an `Error`, not a `MongoServerError`, whose message names `'orders'` as missing and `'users'` with `'email_unique'`; `old_idx` still there. Catches a 26 rethrown, and a check that stops at the first miss.
16. **A stale index dropped by someone else rejects.** The `dropFirstElsewhere` helper of today's suite on `old_idx` → rejects with `MongoServerError`, `code` 27; no logs. Catches the tolerance left in. Replaces the four cases of *a stale index dropped concurrently*, which go.
17. **Other collections are untouched.** `other` with an index `x_1`, not in the list; `users` synced → after `dropStaleIndexes([testSchema])`, `x_1` still on `other`.
18. **Leaves the validator alone.** `users` synced, then its validator replaced through `setupDb` → after `dropStaleIndexes([testSchema])`, the validator is the replaced one. Catches a `syncSchema()` run inside it.

No case for a re-run during a leftover build (decision 3): it needs a build slow enough to catch, as the probe's 300k documents; case 11 pins the order it relies on.

## Risks

Risk `medium`:

- An app that upgrades with its options in a variable, not a literal, compiles, and runs with no new collection, validator or index; a missing `unique` index lets duplicates in. Shown by: decision 2 for literals, the README's upgrade note otherwise.
- The first rollout from 1.x: 1.x instances that start during it drop the indexes `syncSchema()` created for a changed schema. Shown by: the README's upgrade note (no schema change in the upgrading release); a later `dropStaleIndexes()` rejects while one is missing (decision 5).
- `dropStaleIndexes()` run before the rollout ends drops indexes the old instances still use. Shown by: the README; decision 5 covers only the reverse order.

## Out of scope

- The error contract (`DatabaseError` before `connect()`), the README of `@enardo/database`, `IDatabase`'s JSDoc that allows a `connect()` with initialization tasks: the backlog item *The error contract and the docs of `@enardo/database` and `@enardo/database-mongo`*.
- `disconnect()` while a `connect()` is pending: it finds no client and resolves; the pending `connect()` then connects. Unchanged from today.
- A lock, and any tolerance of a concurrent run (decision 10).

## Plan

1. Test-first (`test-author`): cases 2–5. Then the idempotent `connect()`, still syncing; the suite green. Commit `[@enardo/database-mongo] fix: reuse the client on a repeated connect`.
2. Test-first (`test-author`): cases 1 and 7–18, the moved cases rewritten as listed, the four concurrent-drop cases and *should default schemas to empty array* removed. Then `syncSchema()`, `dropStaleIndexes()`, `connect()` without the sync, the options without `schemas`, `IMongoDatabase`, the JSDoc; the suite and `typecheck` green. Commit `[@enardo/database-mongo] feat: sync the schema on request` (body: the why, and that `connect()` no longer syncs and `schemas` moved to the calls, a breaking change).
3. `README.md` and the package `CLAUDE.md`. Commit `[@enardo/database-mongo] docs: …`.
4. `docs/backlog.md`, in a commit of its own.
5. `pnpm verify`.
