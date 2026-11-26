# Task journal

branch: fix/database-mongo/keep-hidden-on-mongo-8
tier: S
command: task
phase: close/check
base: ef6d665
started: 2026-11-26T16:14:39Z
verify_red_streak: 0

## Intent

### Intent: syncSchema conflicts on `hidden` on MongoDB 8+

#### Problem
@enardo/database-mongo `syncSchema` passes the schema's indexes to `collection.createIndexes` as they are
(packages/database-mongo/src/mongo.database.ts, private `createIndexes`). The package promises
(packages/database-mongo/CLAUDE.md, README.md, the JSDoc of `syncSchema`) that on an existing index
`hidden` is neither applied nor checked: a difference in `hidden` is not a conflict, it changes through `collMod`.
mongod 7.0.24 kept that promise on its own; mongod 8.2.6 and 9.0.8 do not: createIndexes with the same key and
name but a different `hidden` fails with 85 IndexOptionsConflict, in both directions:
- existing index hidden, schema without `hidden` -> 85 (the red test "MongoDatabase > syncSchema > should leave
  an existing index hidden when the schema does not say so", packages/database-mongo/__tests__/mongo.database.test.ts);
- existing index visible, schema `hidden: true` -> 85, index stays visible;
- existing hidden, schema `hidden: true` -> ok, no-op.
It affects every project on a MongoDB 8+ server, not only the tests.

#### Goal
Bring syncSchema back to its documented behavior on mongod 7.0.24, 8.2.6 and 9.x.

#### Decisions (human)
- Fix: before createIndexes, on an existing collection, syncSchema reads its indexes (`listIndexes`) and gives each
  schema index that has the name of an existing one the existing index's `hidden`, so the server compares only the rest.
  Every other option stays judged by the server: a real difference is still a conflict. Human: "sì".
- Cover the inverse direction too (schema `hidden: true`, existing index visible: no error, stays visible).
- The red test is shown by hand on 8.2.6 with MONGOMS_VERSION=8.2.6 (the catalog on main is mongodb-memory-server
  10.4.3, default mongod 7.0.24; 10.4.3 cannot start a replica set on 9.x). No fixed check on other mongod versions
  is added to the repo. Human: "sì".
- Tier S. Human: "vai con S".
- The fix must stay green on 7.0.24 (the default verify) until the catalog moves to 11.

#### Context
This task blocks the suspended build of .workflow/specs/2026-11-26-widen-mongodb-memory-server-peer.md
(branch chore/vitest-config/widen-mongodb-memory-server-peer, work in stash@{0}), which resumes after the merge.

## Open findings

## Lesson candidates

## Backlog candidates

## Log

- 2026-11-26T16:14:39Z opened on ef6d665 of main
- 2026-11-26T16:14:43Z candidate backlog: the test suite cannot run on mongod 9.x with mongodb-memory-server 10.4.3 (electionTimeoutMillis 500 < heartbeat 2000, code 93); 11.4.0 works. Decide whether the suite should also run on 9.x.
