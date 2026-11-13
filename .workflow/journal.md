# Task journal

branch: feature/events/event-envelope
tier: L
phase: l/chunk-3/commit
base: a09dc99
started: 2026-11-13T09:16:04Z
review_rounds: 0
verify_red_streak: 0
escalations: 1

spec: .workflow/specs/2026-11-13-event-envelope.md

spec_review_rounds: 3

step_review_rounds: 8

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

- (plugin, Workflow Overload) A test-first chunk made only of types has no red `red-check.sh` can see: the stub step writes its whole code, and its type tests fail only under `tsc`, which the red check does not run (`red_types` has no compile error). Evidence: chunk 1 of this task, refused with "no recorded test fails"; its red was observed with `typecheck` against the old signatures (cases 1, 2, 4, 6a). Fix in the plugin: a type red (run the project's typecheck against the stash of the chunk's signatures), or the splitter marks a type-only chunk no test-first.
- (project/spec) A spec that says a chunk "has no runtime red" contradicts that chunk being test-first with signatures to stub; the splitter and three spec reviews let it through. A spec reviewer or splitter checks the two agree.

## Backlog candidates

- (events) Type tests of `EventBus.subscribe` through the interface, not only through the class: the step review of chunk 1 mutated `src/event-bus.ts:33` (context `any` or `TContext | undefined`, `handle` returning `Promise<void>`) and the typecheck stayed green, since the class satisfies the interface bivariantly. Cases 6 and 8 for `EventBus`.

## Log

- 2026-11-13T09:16:04Z opened on a09dc99 of main
- 2026-11-13T09:16:10Z map: /tmp/claude-1000/-workspaces-enardo-packages/c4089e52-b477-463b-a37e-6e1c51363923/scratchpad/map.md
- 2026-11-13T09:21:00Z spec review 1: B1, B2 accepted (handle returns Promise<unknown>), M1-M5, M7 and gaps fixed; M6 (eventId in EventHandlerFailure) left to the human at checkpoint 1
- 2026-11-13T09:23:52Z spec review 2: B1 (one invariant for when the id is fixed, spec+ADR), B2 (no 1.x README), M1-M5 accepted and fixed; eventId in EventHandlerFailure still for the human
- 2026-11-13T10:09:33Z human: add eventId to EventHandlerFailure (details.failures); spec gains decision 6, cases 9-10, chunk 2
- 2026-11-13T10:12:49Z spec review 3: holds; four minors and three gaps fixed without another round
- 2026-11-13T10:16:49Z human at checkpoint 1: "approvo"
- 2026-11-13T10:35:14Z red check chunk 1: refused (no runtime red: the chunk is type-only and the stubs are its whole code); typecheck against the old signatures fails cases 1, 2, 4, 6a as expected (TS2339, TS2578, TS2344, TS2345); asked the human
- 2026-11-13T10:42:18Z human: accept the typecheck red for chunk 1 (type-only, the stubs are its whole code); skip the implementer, go to verify; report the lessons at close
- 2026-11-13T10:43:57Z step review chunk 1 round 1: 2 findings (JSDoc of EventHandler's idempotency line and of eventId)
- 2026-11-13T10:46:00Z step review chunk 1 round 2: 0 findings (ok); noted: EventBus.subscribe's context and return type untested through the interface (bivariance), beyond the spec's cases
- 2026-11-13T10:48:31Z red check chunk 2: valid red, 8 AssertionError; 27 pass already (renamed tests, case 7, case 10's no-id half)
- 2026-11-13T10:50:54Z step review chunk 2 round 1: 1 code finding (EventHandlersFailedError's JSDoc says details hold indexes and names only); minor test note (toEqual vs toStrictEqual for eventId: undefined) left: the spec does not require the key, the JSON is the same
- 2026-11-13T10:53:27Z step review chunk 2 round 2: 0 findings (ok)
- 2026-11-13T10:56:35Z step review chunk 3 round 1: 4 findings in Upgrading from 1.x (1.x EventHandler had no TContext; a 1.x Result of void or unknown compiles as the context; an implementing class breaks only on a typed EventBus or through EventContext, the spec's wording too broad; thrown values in cause.errors)
- 2026-11-13T10:59:08Z step review chunk 3 round 2: 1 finding (Upgrading omits the per-dispatch snapshot of handlers, fcf8f38: in 1.x a handler subscribed during a dispatch ran in it)
- 2026-11-13T11:01:19Z step review chunk 3 round 3: 1 finding (README:116 says the bus neither reads nor checks eventId, dropping the spec's 'beyond copying it into a failure'); third round, to the human
- 2026-11-13T11:13:09Z human at escalation 1 (chunk 3 review round 3): retry, one round
- 2026-11-13T11:15:14Z step review chunk 3 round 4 (granted by the human): 0 findings (ok); README narrows the spec's 'an implementing class breaks', accurately
