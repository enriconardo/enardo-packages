# Task journal

branch: feature/events/typed-dispatch
tier: L
phase: l/checkpoint
base: 8ed8c51
started: 2026-11-11T15:53:03Z
review_rounds: 0
verify_red_streak: 0
escalations: 0

spec: .workflow/specs/2026-11-11-typed-dispatch.md

spec_review_rounds: 1

## Intent

### Intent: typed dispatch of @enardo/events

Backlog item (Queued): "Three doubts on the dispatch of `@enardo/events`" (from the analysis of `@enardo/entities` on `docs/repo/entities-events-backlog`, 2026-11-10).

#### Problem
1. `EventBus.subscribe(eventName: string, handler: EventHandler<E>)` does not tie the name to the handler's event type: a handler of one event subscribes to another and compiles.
2. `EventContext { session?: unknown; [key: string]: unknown }` and the JSDoc of `SyncEventBus` tell the caller to publish inside the transaction through `session`. ADR 0021 says the opposite: a relay of the app publishes after the commit, at least once, to idempotent handlers; dispatching inside the unit of work's hook is the app's knowing choice.
3. `SyncEventBus.publish` runs handlers sequentially and stops at the first that throws, without saying the others did not run; `publishAll` also skips the following events.

#### Decisions of the human (2026-11-11)
- 2.0.0 of `@enardo/events` is not published yet: the breaking changes go into 2.0.0, no 3.0.0.
- Failures: every handler of every event runs, in order; at the end one error lists which failed. It is a `BaseError` of `@enardo/errors` with a `code` and the failures in `details` (new dependency on `@enardo/errors`), so a relay can recognize it and retry. (Human: "accolgo la tua proposta".)
- Context: remove `session` and the index signature; the context becomes a generic `TContext` the app fills (correlation id, tenant...), default such that without a context the parameter stays optional as today; JSDoc rewritten around the after-commit model of ADR 0021 (outbox best practice: the bus does not carry the caller's transaction; handlers open their own and are idempotent). Human: "mi sembra corretta la tua proposta".
- Typing: `EventBus<Events extends Event, TContext>` with `subscribe<N extends Events['eventName']>(name: N, handler: EventHandler<Extract<Events, { eventName: N }>, ...>)`; events declare `eventName` as a literal; default `Event` keeps today's loose behavior. Human: "ok".
- Tier L, confirmed.

#### Constraints
- No consumer in the monorepo; external consumers unknown.
- Existing tests pin the stop-at-first behavior (sync-domain-event-bus.test.ts:113): the spec changes them.
- Test-first for the public API.

## Open findings

## Lesson candidates

## Backlog candidates

## Log

- 2026-11-11T15:53:03Z opened on 8ed8c51 of main
- 2026-11-11T15:53:07Z map: /tmp/claude-1000/-workspaces-enardo-packages/db6993b4-693f-4a39-8a08-66a043400f37/scratchpad/map.md
- 2026-11-11T15:58:39Z spec review 1: holds, 9 minor objections accepted and fixed; gaps fixed (backlog removal goes in the chunks); case 10 (EventContext absent) dropped
- 2026-11-11T16:00:42Z checkpoint 1: human approved the spec ("si")
