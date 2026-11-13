# Task journal

branch: fix/events/dispatch-snapshot-and-docs
tier: S
phase: close/review
base: 76ccd20
started: 2026-11-13T09:08:14Z
review_rounds: 0
verify_red_streak: 0
escalations: 0

## Intent

### Intent

From an architectural review of `@enardo/events` (2026-11-13). The package
is sound; three small findings, none visible to a consumer's types:

1. The JSDoc of `Event.eventName` calls it a "unique event identifier": it
   is the event's type (its name), not the identity of one occurrence.
2. `SyncEventBus.dispatch` iterates the live array of handlers of a name, so
   a handler subscribed while a dispatch runs is run by that same dispatch.
   The dispatch takes the handlers subscribed when it reached the event: it
   iterates a copy. A bug fix to the evident intent (handlers run "in
   subscription order", subscribed beforehand), test-first.
3. The after-commit / transaction paragraph is repeated in the README and in
   the JSDoc of `EventBus`, `EventHandler` and `SyncEventBus`: it stays in
   the README, the JSDoc refers to it in one line.

Decisions of the human: 2.0.0 is not published, so breaking changes are
free in it. The envelope findings (an `eventId` for deduplication,
`occurredAt` across an outbox, the unused `Result` parameter, the
`SyncEventBus` name) go to the backlog as one L item, in a commit of their
own on this branch.

## Open findings

## Lesson candidates

## Backlog candidates

## Log

- 2026-11-13T09:08:14Z opened on 76ccd20 of main
- 2026-11-13T09:09:13Z human: 2.0.0 unpublished, majors free; review points 2,7,8 as S, envelope (1,3,5,6) to backlog; point 4 dropped
