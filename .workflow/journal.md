# Task journal

branch: docs/transaction-manager/contract-edge-cases
tier: S
phase: s/implement
base: fea2a03
started: 2026-11-13T14:22:01Z
review_rounds: 0
verify_red_streak: 0
escalations: 0

## Intent

### Intent: docs/transaction-manager/contract-edge-cases

Backlog item (Queued, first): what the transaction contract leaves unsaid. Docs only, tier S (confirmed), a patch of @enardo/transaction-manager and @enardo/transaction-manager-mongo.

Problem:
- The JSDoc of TransactionManager says commit and rollback, not that `work` may run more than once: only the README does.
- The contract says nothing of a nested runInTransaction: the Mongo adapter opens a new session, so an independent transaction.
- Nor of a failed commit: after UnknownTransactionCommitResult past the driver's 120 s the commit may have happened; a caller that re-runs the use case may write twice.
- The adapter's README: `work` must not call commitTransaction, abortTransaction or endSession on the session. After an abort in `work`, the driver's withTransaction (7.6.0, step 8) returns the result, so runInTransaction resolves with nothing committed. (Verified in node_modules/mongodb/src/sessions.ts 7.6.0, lines ~825-832 and ~878-892.)

Decisions of the human:
- Nesting: the contract leaves a nested runInTransaction undefined ("don't nest": code writing in the transaction receives the transaction as a parameter). The Mongo README says it currently opens an independent transaction (doesn't see the outer one's uncommitted writes, doesn't roll back with it). The possible 120 s hang is not probed and is NOT documented (it belongs to fix/transaction-manager-mongo/nested-run-in-transaction).
- Failed commit: in both. The contract in general terms (a rejection doesn't prove nothing was committed; a caller that re-runs must make it idempotent); the Mongo README the concrete case (UnknownTransactionCommitResult after the driver's 120 s).
- Versions bumped in this branch, each in its package's docs commit (precedent 8c6179b): transaction-manager 2.0.1, transaction-manager-mongo 0.2.1 (README's "version 0.2.0" updated).
- Remove the backlog item in a commit of its own before the merge.

## Open findings

## Lesson candidates

## Backlog candidates

## Log

- 2026-11-13T14:22:01Z opened on fea2a03 of main
