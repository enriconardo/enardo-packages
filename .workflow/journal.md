# Task journal

branch: chore/vitest-config/widen-mongodb-memory-server-peer
tier: L
command: build
phase: l/chunk-1/implement
base: 278f250
started: 2026-11-26T13:32:54Z
verify_red_streak: 0
spec: .workflow/specs/2026-11-26-widen-mongodb-memory-server-peer.md
approved: ef6d665

## Intent

Build the approved spec .workflow/specs/2026-11-26-widen-mongodb-memory-server-peer.md: its *Why*, *What* and *Decisions* hold the intent.

## Open findings

- database-mongo red on mongod 8.2.6: `syncSchema` "should leave an existing index hidden when the schema does not say so" fails, `createIndex` over the existing hidden index raises 85 (IndexOptionsConflict). Spec *Decisions*: the user decides, database-mongo adapts in its own task or the catalog stays on 10.

## Lesson candidates

## Backlog candidates

## Log

- 2026-11-26T13:32:54Z opened on ef6d665 of main
- 2026-11-26T13:36:27Z implement chunk 1: database-mongo red on mongod 8.2.6 (syncSchema 'should leave an existing index hidden when the schema does not say so': createIndex over hidden index raises 85); transaction-manager-mongo, uow-repository-mongo green; per spec Decisions, goes to the user
- 2026-11-26T13:49:12Z user: stop, fix database-mongo ('Stop, fix database-mongo'): build suspended; database-mongo adapts to MongoDB 8 in its own task, then /overload:build resumes
- 2026-11-26T16:29:49Z resume: database-mongo fix merged on main (278f250); chunk 1 work stashed as 'chunk 1', chunk restarts after taking main in
- 2026-11-26T16:29:50Z sync: took in main at 278f250; base was ef6d665
