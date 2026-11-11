# Task journal

branch: feature/events/typed-dispatch
tier: L
phase: close/write
base: 8ed8c51
started: 2026-11-11T15:53:03Z
review_rounds: 2
verify_red_streak: 0
escalations: 0

spec: .workflow/specs/2026-11-11-typed-dispatch.md

spec_review_rounds: 1

step_review_rounds: 1

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

- chunk 1 step review (non-blocking): no test checks the `EventBus` interface's own `publish`/`publishAll` types; `EventBus.publish(event: Event)` would stay green via method bivariance. Spec silent; for the human at the checkpoint.

## Lesson candidates

## Backlog candidates

- (code-reviewer) `@enardo/events` has nothing Node-only in `src/` but no browser test project nor runtime-neutral presets, unlike `http-client`: decide whether it runs in browsers.
- (code-reviewer) failure tests of `sync.event-bus.test.ts` other than the first check the class with `toBeInstanceOf`; asserting `code` (and `isBaseErrorLike`) there would follow the rule more strictly.
- (code-reviewer) `packages/events/src/index.ts` imports without `.js`, the other files of `src/` with it: align when next touched.

## Log

- 2026-11-11T15:53:03Z opened on 8ed8c51 of main
- 2026-11-11T15:53:07Z map: /tmp/claude-1000/-workspaces-enardo-packages/db6993b4-693f-4a39-8a08-66a043400f37/scratchpad/map.md
- 2026-11-11T15:58:39Z spec review 1: holds, 9 minor objections accepted and fixed; gaps fixed (backlog removal goes in the chunks); case 10 (EventContext absent) dropped
- 2026-11-11T16:00:42Z checkpoint 1: human approved the spec ("si")
- 2026-11-11T16:05:36Z chunk 1 stubs written (Event Name, EventBus/SyncEventBus Events); stub error renamed NotImplemented to match red_types
- 2026-11-11T16:14:26Z red check rounds 1-2 refused: suite.sh check lists recorded files with git diff (rename detection on) but working-tree changes with --no-renames, so the renamed test file's old path always looks unrecorded; suite 2 does hold the deletion. Plugin bug, asked the human
- 2026-11-11T16:18:58Z human: set local git config diff.renames false until chunk 1 is committed, then unset it
- 2026-11-11T16:19:06Z red check round 3: valid red; 11 type tests pass already (runtime-erased), listed in red-check-green.txt
- 2026-11-11T16:21:54Z step review 1 of chunk 1: ok, mutation check holds; one non-blocking test gap noted under Open findings
- 2026-11-11T16:22:12Z chunk 1 committed c4a4fcf; diff.renames unset
- 2026-11-11T16:22:53Z chunk 2 stubs written (EventHandler/EventBus/SyncEventBus TContext, ContextArgument); subscribe body kept
- 2026-11-11T16:25:04Z chunk 2 red check round 1: valid red; 7 type tests pass already
- 2026-11-11T16:27:54Z chunk 2 step review 1: changes required, EventHandler JSDoc lacks the knowing in-hook case and states after-commit as fact; back to implementer
- 2026-11-11T16:28:56Z chunk 2 step review 2: ok
- 2026-11-11T16:29:13Z chunk 2 committed 5fd450e
- 2026-11-11T16:34:23Z chunk 3 suite 4 used a dynamic import of @enardo/errors (not yet a dependency); decided: add the dependency as stub-like prep, then the test-author switches to a static import and records again
- 2026-11-11T16:35:02Z chunk 3: @enardo/errors dependency added (package.json, lockfile), resolves from events
- 2026-11-11T16:35:49Z chunk 3 red check on suite 5: valid red, no test passes already
- 2026-11-11T16:37:25Z chunk 3 step review 1: changes required, publish's context cast lost its comment; back to implementer
- 2026-11-11T16:38:14Z chunk 3 step review 2: ok
- 2026-11-11T16:38:27Z chunk 3 committed 81f625b
- 2026-11-11T16:40:29Z chunk 4 step review 1: ok (README snippets compiled against src)
- 2026-11-11T16:40:39Z chunk 4 committed aee488f
- 2026-11-11T16:41:30Z chunk 5 step review 1: ok
- 2026-11-11T16:41:41Z chunk 5 committed 2c2be33; all chunks done
- 2026-11-11T16:42:48Z review round 1 on 2c2be33: 0 blocking
- 2026-11-11T16:42:54Z lessons: none (the problems met were workflow defects, for the checkpoint)
- 2026-11-11T16:46:08Z checkpoint: human asks the EventBus interface test gap as chunk 6; backlog: candidate 1 dropped (@enardo/events is not for browsers), candidates 2 and 3 kept
- 2026-11-11T16:48:05Z chunk 6 tests recorded (suite 6), pass already; @ts-expect-error lines shown in force against mutated EventBus
- 2026-11-11T16:49:26Z chunk 6 step review 1: ok, mutation check holds
- 2026-11-11T16:49:39Z chunk 6 committed 26c1c76
- 2026-11-11T16:50:07Z review round 2 on 26c1c76: 0 blocking
- 2026-11-11T16:54:43Z checkpoint 2: human gave the go ("procedi")
- 2026-11-11T16:54:54Z backlog: 2 items added; spec status done
