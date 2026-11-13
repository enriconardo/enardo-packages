# Task journal

branch: feature/events/event-envelope
tier: L
phase: l/checkpoint
base: a09dc99
started: 2026-11-13T09:16:04Z
review_rounds: 0
verify_red_streak: 0
escalations: 0

spec: .workflow/specs/2026-11-13-event-envelope.md

spec_review_rounds: 3

## Intent

### Intent: the envelope of @enardo/events' Event

Problem: backlog item "The envelope of `@enardo/events`' `Event`, while 2.0.0 is unpublished and breaking changes are free in it" (from the architectural review of @enardo/events, 2026-11-13). The package asks for idempotent handlers under at-least-once delivery but the envelope gives no key to deduplicate by; `occurredAt: Date` does not survive a JSON transport and the README does not say so; `EventHandler`'s `Result` parameter has no use; `SyncEventBus` is asynchronous and sequential.

Goal: fix the envelope and the names in @enardo/events 2.0.0 (unpublished, so breaking changes need no new major). No other package of the repo depends on @enardo/events.

Decisions of the human (2026-11-13):
1. `eventId`: required (`readonly eventId: string`) on `Event`; the app generates it (whoever creates the event, e.g. `crypto.randomUUID()`). No helper in the package, the README says so.
2. `occurredAt`: stays a `Date`; the README documents that a transport serializing to JSON rebuilds it before `publish` (a Mongo outbox keeps it as BSON).
3. `EventHandler`'s `Result` parameter is removed: `EventHandler<EventType, TContext>`, `handle()` returns `Promise<void>`.
4. `SyncEventBus` is renamed `SequentialEventBus` (file `sequential.event-bus.ts`); its JSDoc no longer says "synchronous". ADR 0023 is not edited (ADRs are immutable except status).

Constraints: the tests of the package change with the API (rename, required eventId, Result removed): the spec says so. README updated (exports table, examples, idempotency section mentions dedup by eventId). Remove the backlog item in its own commit.
Tier: L, confirmed by the human.

## Open findings

## Lesson candidates

## Backlog candidates

## Log

- 2026-11-13T09:16:04Z opened on a09dc99 of main
- 2026-11-13T09:16:10Z map: /tmp/claude-1000/-workspaces-enardo-packages/c4089e52-b477-463b-a37e-6e1c51363923/scratchpad/map.md
- 2026-11-13T09:21:00Z spec review 1: B1, B2 accepted (handle returns Promise<unknown>), M1-M5, M7 and gaps fixed; M6 (eventId in EventHandlerFailure) left to the human at checkpoint 1
- 2026-11-13T09:23:52Z spec review 2: B1 (one invariant for when the id is fixed, spec+ADR), B2 (no 1.x README), M1-M5 accepted and fixed; eventId in EventHandlerFailure still for the human
- 2026-11-13T10:09:33Z human: add eventId to EventHandlerFailure (details.failures); spec gains decision 6, cases 9-10, chunk 2
- 2026-11-13T10:12:49Z spec review 3: holds; four minors and three gaps fixed without another round
- 2026-11-13T10:16:49Z human at checkpoint 1: "approvo"
