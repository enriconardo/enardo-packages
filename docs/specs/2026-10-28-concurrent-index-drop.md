---
status: draft
type: fix
tier: M
implementer: sonnet/medium
packages: ["@enardo/database-mongo"]
branch: fix/database-mongo/concurrent-index-drop
---

# Concurrent `connect()`s of `MongoDatabase` tolerate a stale index already dropped

## Why

From the backlog item *Concurrent `connect()`s of `MongoDatabase` fail on a stale index*, found by the architectural review of `@enardo/database` and `@enardo/database-mongo` (2026-10-27).

Root cause: `initCollections()` lists a collection's indexes, then drops each one the schema does not name (`packages/database-mongo/src/mongo.database.ts`, the loop after `listIndexes`). Several instances connecting at once each list the same stale index; the first `dropIndex` removes it, and every later one rejects with `IndexNotFound` (27), which rejects that instance's `connect()`. A rolling deploy with replicas, or several processes starting together, meets it. The index those instances wanted gone is gone: the rejection reports a state that is already the one sought.

## Probes

- 4 `MongoDatabase` on one database holding two stale indexes, `connect()`ed together, 5 runs, on the in-memory replica set of the suite (MongoDB 7.0.24, driver 7.6.0) → 3 of 4 rejected in every run, `MongoServerError`, `code` 27, `index not found with name [old1]` (or `[old2]`).
- `dropIndex` of a missing index on that server → `MongoServerError`, `code` 27, `codeName` `IndexNotFound`.
- 4 `MongoDatabase` on an empty database, one schema, `connect()`ed together, 5 runs → all 4 resolved in every run: a concurrent `createCollection` and `createIndexes` with the same definition are accepted.
- `create` of an existing collection: same validator → accepted; another validator, or none → `code` 48 `NamespaceExists`, `already exists, but with different options`.
- `MONGODB_ERROR_CODES` of the driver is not exported by the ESM entry (`import * as m from "mongodb"` → `undefined`): the code is a local constant, as `INDEX_CONFLICT_CODES` is (`mongo.database.ts:13`).
- `new MongoServerError({ code: 26, errmsg: "ns not found" })` (driver 7.6.0) → `instanceof MongoServerError`, `code` 26, `name` `MongoServerError`: the input of case 4.
- Only MongoDB 7.0.24 was probed, the suite's server; another version, or `mongos`, is not probed.
- Published versions of `@enardo/database-mongo` (registry) → `1.0.0` only: the manifest's `2.0.0` is unpublished, and the fix ships in it with no bump.

## Decisions

- **A `dropIndex` that rejects with `MongoServerError` code 27 is the outcome sought**: the loop goes on to the next stale index, and nothing is logged for it, since the instance that dropped it logged it. Any other rejection still rejects `connect()`, as today.
- **A concurrent `createCollection` stays as it is** (taken with the user at intake, on the condition of the probe): the server accepts two concurrent creates with the same options. It rejects with 48 with other options, and, found by the reviewer, also with the same validator after another instance's `collMod` (which stores `validationLevel` and `validationAction`), on one schema; and `collMod` rejects with 12587 during another instance's index build. Out of scope: this fix makes only the stale index drop safe, and the docs say so; the two go to the backlog.

## Open questions

None.

## Changes

- `packages/database-mongo/src/mongo.database.ts`: an `isIndexNotFound(error)` guard beside `isIndexConflict` (`MongoServerError`, `code === 27`), and the drop loop catches that rejection and skips the `warn`; the JSDoc of `initCollections()` says a stale index another instance dropped first is skipped.
- `connect()`'s JSDoc: it drops the indexes the schema no longer names, and one that another instance dropped first does not reject `connect()`.
- `packages/database-mongo/CLAUDE.md`, *The schema sync*: the stale-index rule says that a stale index another instance dropped first is skipped and only the drop that happened is logged; and that concurrent `connect()`s are otherwise not made safe: 12587 on a `collMod` during an index build, 48 on a `createCollection` after another instance's `collMod`, even on one schema (probed on 7.0.24), left as they are.

## Test cases

In `packages/database-mongo/__tests__/mongo.database.test.ts`, `describe("connect")`, against the replica set.

1. **A stale index dropped by someone else between the list and the drop.** Collection `users` with stale `old_idx`; `Collection.prototype.dropIndex` spied with `mockImplementationOnce` that drops `old_idx` through `setupDb`, then calls the original. → `connect()` resolves, `isConnected()` is `true`, `old_idx` absent, nothing logged (`expectNoLogsBut()`). Fails today with the symptom: `MongoServerError` 27.
2. **The drops after a missing one still happen.** Stale `old_a` and `old_b`, the first `dropIndex` call made to miss as in 1. → `connect()` resolves, neither index left, `warn` called once, for the index that the instance dropped, with the message and `{ index }` of the existing test. Catches a loop that stops at the first 27.
3. **Concurrent instances.** Stale `old_a` and `old_b`; 4 instances on the same schema (`testSchema`), `Promise.allSettled` of their `connect()`s. → all 4 fulfilled; only `_id_` and the schema's indexes left; `warn` called exactly twice in all, once naming `old_a`, once `old_b`. Fails today in most runs (probe: every run of 5).
4. **Another server error still rejects.** `dropIndex` spied to reject with a `MongoServerError` of another code (`new MongoServerError({ code: 26, errmsg: "ns not found" })`). → `connect()` rejects with that very error, nothing logged. Catches a guard that tolerates every `MongoServerError`; the existing *should reject with a failed drop of a stale index* keeps covering a non-server error.

## Risks

Risk `medium`: the guard is the only line between a tolerated race and a hidden failure. A guard wider than code 27 (case 4) or a `continue` placed before the `warn` of a drop that happened (case 2: the `warn`, case 3: its count) shows in the cases.

## Out of scope

- `NamespaceExists` (48) on a concurrent `createCollection`, and `BackgroundOperationInProgressForNamespace` (12587) on a `collMod` during an index build (*Decisions*).
- A repeated or concurrent `connect()` on one instance: the backlog item *A second `connect()` of `MongoDatabase` leaks the first `MongoClient`*.
- The error contract and the README: the backlog item *The error contract and the docs of `@enardo/database` and `@enardo/database-mongo`*.

## Plan

1. Test-first: cases 1–4 (`test-author`); 1, 2 and 3 fail with code 27, 4 passes today and pins the boundary. Then the guard and the loop change; the suite green. One commit, `[@enardo/database-mongo] fix: tolerate a stale index already dropped`.
2. `packages/database-mongo/CLAUDE.md` and the JSDocs, if not in step 1.
3. Remove the item from `docs/backlog.md`, in a commit of its own.
4. `pnpm verify`.
