---
status: draft
type: feature
tier: M
implementer: sonnet/medium
packages: ["@enardo/database-mongo"]
branch: feature/database-mongo/log-per-adr-0014
---

# `database-mongo` logs only a collection it creates

## Why

The first Queued item of the backlog, *What `database-mongo` logs*, from the spec of `feature/repo/what-a-package-logs` (2026-10-26). ADR 0014 lets a package log only what its caller cannot see in the outcome of its call, at `debug` or `warn`. `MongoDatabase` logs at `error` a failed `connect()` that it rethrows, and at `debug` the start and end of `connect()` and `disconnect()`, which the caller awaits. Its `debug` logs sit behind a `debug` flag of its own, which duplicates the logger's level, and take their context from a `debugNamespace` named after that flag.

Of the events the caller cannot see (a collection created, a validator applied, indexes ensured, an index dropped), the user keeps one: a collection created. The others go, and may come back when an app needs them (ADR 0014 point 5: a log is allowed, not required).

## Probes

- Every log call, `git grep -nE '\.(debug|info|warn|error)\(' -- packages/database-mongo/src` → `mongo.database.ts`: `debug` at `:69`, `:78`, `:99`, `:105` (connect, disconnect), `:179` (collection created), `:187` (validator updated), `:193` (indexes ensured), `:216` (index dropped), all behind `this.debug`; `error` at `:82`, before the rethrow.
- The options, `mongo.database.types.ts:55` → `debug?: boolean`, `debugNamespace?: string`, `logger?: Logger`. `debugNamespace` is the `context` of the child logger (`mongo.database.ts:47`), default `"MongoDatabase"`, with `{ dbName }` as metadata.
- The local `Logger`, `src/logger.ts` → `debug`, `error`, optional `child`; exported with `LoggerMetadata` from `src/index.ts`.
- Who builds a `MongoDatabase` in the repo, `git grep -n "MongoDatabase(" -- ':!docs/specs'` → only its own source and `__tests__/mongo.database.test.ts`.
- The tests that pin the current logging (`__tests__/mongo.database.test.ts`) → "should default debug to false" (`:124`), "should log debug messages when debug is enabled" (`:205`), "should not log debug messages when debug is disabled" (`:214`), "should log errors when connection fails" (`:223`).
- `@enardo/logger`'s `child()` → an inner child's `context` replaces its parent's (`packages/logger/src/logger.ts:18`).
- The package has no README.
- Version: the repo has 2.0.0; the registry has 1.0.0 only (`pnpm view @enardo/database-mongo versions --registry https://npm.enriconardo.com`, on the host, 2026-10-27).

## Decisions

- **Only "collection created" stays**, at `debug`, unconditionally: the logger's level filters it. Not kept: the validator updated and the indexes ensured, which run on every `connect()` and do not say whether anything changed (whether they can tell is not probed, and is left to the branch that brings them back); the index dropped, at `debug` or `warn`, set aside by the user for now.
- **`debug` and `debugNamespace` are removed.** The context is fixed, `"MongoDatabase"`, with `{ dbName }` as metadata: two instances are told apart by `dbName`.
- **No log of a failed `connect()`**: the caller gets the rejection (ADR 0014 point 2).
- **The local `Logger` keeps `debug` and the optional `child`**; `error` goes. A logger that still has `error` stays assignable.
- **The README** is left to the architectural review of the package (*To evaluate* in the backlog), which has not run.
- **The version stays 2.0.0**: unpublished, it takes the change as it is.

## Open questions

None.

## Changes

- `src/mongo.database.ts`: no `debug` field; the child logger's context fixed to `"MongoDatabase"`; one `debug` call, `Collection '<name>' created.`, after `createCollection`; every other log call removed, the `catch` of `connect()` included (cleanup and rethrow stay). The class JSDoc example loses `debug` and `debugNamespace`.
- `src/mongo.database.types.ts`: `debug` and `debugNamespace` removed, with their `@property` lines.
- `src/logger.ts`: `error` removed from `Logger` and from the no-op logger.
- `docs/backlog.md`: the item removed.

## Test cases

In `__tests__/mongo.database.test.ts`; the mock logger keeps spies for `debug`, `info`, `warn`, `error`, `child`.

1. A schema whose collection does not exist: `connect()` → `debug` called once, with `"Collection 'users' created."`; no other logger method called.
2. A schema whose collection exists (`listCollections` returns it), with indexes, and an extra index `old_idx` that gets dropped: `connect()` → `collMod`, `createIndexes` and `dropIndex("old_idx")` called, no logger method called.
3. `connect()` with no schemas, then `disconnect()` → no logger method called.
4. `client.connect()` rejects with an `Error("Connection refused")`: `connect()` rejects with that same error instance, `close()` called once, no logger method called.
5. The child logger → `child` called once with `{ context: "MongoDatabase", metadata: { dbName: "test-db" } }`.
6. No `logger` option, a collection created → `connect()` resolves (the no-op default).

The four tests listed under *Probes* go: 1 and 4 replace two of them, the two others pin the flag.

## Out of scope

- The README, and the rest of the package's design: its architectural review.
- Logging the validator, the indexes and an index dropped.

## Plan

1. **Tests first** (cases 1–6): 1 and 4 fail on `main` (1: no log without the flag; 4: the `error` call); 2, 3, 5 and 6 pass on `main` and guard what stays. Then the changes of `src/`; `pnpm verify` green; one commit.
2. **Backlog**: the item removed, in a commit of its own.
