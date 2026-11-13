# Task journal

branch: test/events/event-bus-subscribe-type-tests
tier: S
phase: s/implement
base: 8abf7b0
started: 2026-11-13T11:49:52Z
review_rounds: 0
verify_red_streak: 0
escalations: 0

## Intent

### Intent: type tests of @enardo/events' EventBus.subscribe through the interface

Problem: every `subscribe` type test in packages/events/__tests__/event-bus.types.test.ts goes through `SequentialEventBus`. A mutation of `src/event-bus.ts` alone (the handler's context `any` or `TContext | undefined`, `handle` returning `Promise<void>`) leaves the typecheck green, since the class satisfies the interface bivariantly.

Goal: add `subscribe` cases to the `describe("EventBus")` block, written against `EventBus<...>`, so those mutations turn the typecheck red.

Decisions of the human:
- "Specchio completo": the two backlog cases (reject a handler whose context is undefined under AppContext; accept a handler whose handle resolves to a value) plus the subscribe cases that the class tests cover: the handler gets the context's type (AppContext; undefined by default), the event of its name, and a name outside the union is rejected (plus a handler of another event).
- Tier S. Test-only, no change to src/.

Check: each listed mutation of src/event-bus.ts must make `pnpm --filter @enardo/events typecheck` fail; restore afterwards.

## Open findings

## Lesson candidates

## Backlog candidates

## Log

- 2026-11-13T11:49:52Z opened on 8abf7b0 of main
