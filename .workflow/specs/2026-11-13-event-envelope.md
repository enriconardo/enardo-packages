---
status: done
branch: feature/events/event-envelope
---

# `@enardo/events`' `Event` carries an `eventId`, `EventHandler` loses `Result`, `SyncEventBus` becomes `SequentialEventBus`

## Why

The architectural review of `@enardo/events` (2026-11-13, the intent of `fix/events/dispatch-snapshot-and-docs`) found four flaws in the envelope and the names, queued in `.workflow/backlog.md` as *The envelope of `@enardo/events`' `Event`*. 2.0.0 is unpublished, and no package of the repo depends on `@enardo/events` (no `package.json` nor the lockfile names it), so breaking changes cost no new major and no change in this repo; projects of other repos meet them in the 1.x → 2.0.0 upgrade.

- **No key to deduplicate by.** `src/event.ts:7-14` is `{ eventName, occurredAt, payload }`. The README (*Where the bus runs*) and `EventHandler`'s JSDoc say delivery is at least once and a handler is idempotent, but nothing in the envelope identifies an occurrence: a handler of every event (`EventHandler<Event>`) cannot deduplicate, and each app would invent an id inside its `payload`.
- **`occurredAt: Date` and JSON.** A transport that serializes to JSON gives back a string where the type says `Date`; nothing in the README says who rebuilds it. A Mongo outbox (the example in `@enardo/uow-repository-mongo`'s README) keeps it as a BSON date. The relay is the app's: no code of the repo serializes events.
- **`Result` is unused.** `EventHandler<EventType, Result = void, TContext>` (`src/event-handler.ts:13-19`): the bus ignores return values, and `subscribe` and `SyncEventBus`'s map type it `unknown` (`src/event-bus.ts:33`, `src/sync.event-bus.ts:37, 42`). Every handler with a context writes `EventHandler<X, void, Ctx>` to skip it (README lines 73 and 85, tests).
- **`SyncEventBus` is not synchronous.** Its dispatch is asynchronous and sequential; its JSDoc says "synchronous" (`src/sync.event-bus.ts:8`), the README "sequential".

## What

After the change, for a caller of `@enardo/events` 2.0.0:

- `Event<Payload = unknown, Name extends string = string>` is `{ readonly eventId: string; readonly eventName: Name; readonly occurredAt: Date; readonly payload: Payload }`. `eventId` is required, and its JSDoc says what it is for. The package generates nothing. The invariant: the id is fixed once, no later than when the event is stored durably (by the aggregate that raises it, by the unit of work's hook that writes the outbox, or as the outbox row's own key, which the relay reads back), and every delivery of that occurrence carries the same id; it is never generated per publish. `crypto.randomUUID()` is one way.
- `occurredAt` stays a `Date`. The README says that a transport which serializes to JSON (a JSON outbox column, a message broker) rebuilds it before `publish`, and that a Mongo outbox keeps it as a date.
- `EventHandler<EventType extends Event = Event, TContext = undefined>`, with `handle(event: EventType, context: TContext): Promise<unknown>`. `Promise<unknown>`, not `Promise<void>`: today `subscribe` accepts a handler whose `handle` resolves to a value (`EventHandler<…, unknown, TContext>`), and `Promise<number>` is not assignable to `Promise<void>`; `unknown` keeps that acceptance, and the README's "Return values are ignored" stays true. Its JSDoc loses the `Result` `@template`, and its idempotency line names `eventId` as the key to deduplicate by. `EventBus.subscribe` takes `EventHandler<EventNamed<Events, Name>, TContext>`.
- `SequentialEventBus<Events, TContext>` replaces `SyncEventBus`, same behavior, in `src/sequential.event-bus.ts`; `SyncEventBus` is no longer exported (no alias: 2.0.0 is unpublished). Its JSDoc says "in-process, sequential".
- `EventHandlerFailure` is `{ eventIndex, eventId, eventName, handlerIndex }`: the bus copies the failed event's `eventId` into each failure, so a relay knows which events to retry without mapping `eventIndex` back to its array. `message` stays as it is (indexes and names). An id is no personal data, so `details` still hold no payload nor thrown message.
- Beyond copying it into a failure, the bus neither reads nor checks `eventId`: two events with one id in a `publishAll` both reach the handlers. The README says so.
- README:
  - every occurrence of `SyncEventBus` and of `EventHandler<…, void, …>` (`git grep -n` in `packages/events`, prose and examples alike), every event literal (with `eventId`), the exports table's `Event` and `EventHandler` rows, and the *Context* prose that puts the typed context in "the third parameter of `EventHandler`" (now the second);
  - *Where the bus runs*: a handler deduplicates by `eventId`; the invariant above, in the same words as ADR 0024's Decision 2; `occurredAt` is rebuilt by a JSON transport; the bus does not deduplicate;
  - a new *Upgrading from 1.x* section, as the other packages with a major have (`git grep -n "^## Upgrading" -- 'packages/*/README.md'`), listing every break of 2.0.0 over 1.x: those of this task, and those already on `main`: `MergeableEvent` and `isMergeableEvent` removed; `EventContext` (and its `session`) removed in favor of `TContext`, the bus meant to run after the commit rather than in the transaction; `handle(event, context?: EventContext)` became `handle(event, context: TContext)`, so a direct call writes `handle(event, undefined)`; `EventBus` generic over `<Events, TContext>`, `subscribe<Name extends Events["eventName"]>` instead of `subscribe<EventType>(eventName: string, …)` (an explicit type argument and an app class implementing `EventBus` break); every handler run and the failures reported in one `EventHandlersFailedError`. And the trap: a 1.x `EventHandler<X, void>` still compiles, its `void` now read as the context; drop a 1.x `Result`; a direct `await handler.handle(...)` that read a 1.x `Result` now gets `unknown`. The 1.x surface is `git show 2099677:packages/events/src/` (1.x had no README).

Out of scope:

- An event factory or an id generator in the package (the human's decision: the app generates the id).
- `@enardo/entities`' README examples (flat events, `{ eventName, occurredAt, userId }`): they are an aggregate's events, not this envelope, and that README cannot name `@enardo/events`, which it does not depend on.
- ADR 0023 keeps the name `SyncEventBus`: an ADR is never edited after acceptance (`docs/adr/README.md`), and the rename changes no decision of it.

## Decisions

1. **`eventId: string`, required, generated by the event's creator.** Alternatives: optional (a handler of every event still cannot rely on it); a `createEvent` helper in the package filling `eventId` and `occurredAt` (a new public function, and a choice of id format the app may want to make, such as a UUIDv7 or the outbox's own key); doing nothing (each app puts an id in its payloads, where a generic handler cannot find it). Required and app-generated keeps the package without runtime code for it, and makes the type say what at-least-once delivery needs. The cost: every event literal carries an id, an app that publishes in process with no outbox included, and every test helper of the package changes. A `string`, not a branded type: the app's format is its own. Decided by the human.
2. **`occurredAt` stays a `Date`, documented.** Alternative: an ISO string, which survives any transport but makes every handler parse it to compare or format dates, while a Mongo outbox keeps the `Date` anyway. The relay is the app's code and already maps the stored document to an `Event`; rebuilding the date belongs there. Decided by the human.
3. **`Result` removed**, so `TContext` becomes the second parameter; decided by the human. `handle` returns `Promise<unknown>`: `Promise<void>` would refuse, at `subscribe`, a handler whose `handle` resolves to a value (`async (e) => outbox.insertOne(e)`), which compiles today; that would narrow the API with no use, since the bus ignores the value. Alternative: keep `Result`, defaulted (no use, and the positional `void` in every handler with a context).
4. **`SequentialEventBus`.** Alternatives: `InProcessEventBus` (where it runs, while what a caller must know is the order and the awaiting), keeping `SyncEventBus` with its JSDoc fixed (the name keeps misleading). Decided by the human.
5. **No deprecated alias for `SyncEventBus`.** 2.0.0 is unpublished and nothing in the repo imports it; 1.x users meet the rename in the major they upgrade to, listed in *Upgrading from 1.x*.
6. **`eventId` in `EventHandlerFailure`.** A relay that retries only the failed events of a `publishAll` would otherwise map each `eventIndex` back to the array it passed; the id names the event directly, and is the key the handlers deduplicate by. Alternative: leave `details` as they are (the index is enough when the relay keeps its array). Free while 2.0.0 is unpublished. The `message` keeps indexes and names: ids would lengthen it with nothing a reader needs. Decided by the human.
7. **A decision record**, `docs/adr/0024-an-event-carries-an-id-its-creator-generates.md`: the contract of `eventId` (who generates it, when, that it is the deduplication key) and of `occurredAt` across a JSON transport bind every app that publishes events, beyond this task. It and its index row are `proposed` in the draft, and turn `accepted` in the spec's commit, once the human approves the spec.

## Test cases

Type tests go in `__tests__/event-bus.types.test.ts` (enforced by `pnpm typecheck`); behavior tests in `__tests__/sequential.event-bus.test.ts`.

Fail first:

1. `Event<P, N>["eventId"]` is `string`.
2. An object literal typed `Event<P, N>` without `eventId` does not compile (`@ts-expect-error`).
4. `EventHandler<UserRegistered, AppContext>`: `handle`'s parameters are `[UserRegistered, AppContext]`.
6a. A handler declared `EventHandler<UserRegistered, AppContext>` subscribes to a bus typed `<UserEvents, AppContext>` (the existing *accepts a handler that declares the context*, its handler rewritten from `EventHandler<UserRegistered, void, AppContext>`): today `AppContext` would be read as `Result`.
7. The package's entry exports `SequentialEventBus` and no longer `SyncEventBus`: `import * as entry from "~/index"`, then at runtime `expect(entry).toHaveProperty("SequentialEventBus")` and `expect(entry).not.toHaveProperty("SyncEventBus")`, and in types `expectTypeOf(entry).toHaveProperty("SequentialEventBus")` and `expectTypeOf(entry).not.toHaveProperty("SyncEventBus")` (not `typeof import(...)`, which the preset's `consistent-type-imports` forbids).

Cases 1, 2, 4 and 6a are type tests: `vitest run` erases types, so their red is observed with `pnpm --filter @enardo/events typecheck`, not with the runtime suite; chunk 1 has no runtime red. Case 7's runtime half fails with an `AssertionError`.

Regression guards, green before the change too:

3. `Event<P, N>["occurredAt"]` is `Date`.
5. `EventHandler<UserRegistered>`: `handle`'s context parameter is `undefined`.
6. A handler declared `EventHandler<UserRegistered>` (context `undefined`) does not compile on that bus (`@ts-expect-error`).
8. A handler whose `handle` resolves to a value (`{ handle: async () => 1 }`) subscribes, as today.

Fail first, for the failures:

9. `new EventHandlersFailedError([...])` with failures carrying `eventId`: `details.failures` lists `{ eventIndex, eventId, eventName, handlerIndex }`, in order, and `toJSON()` serializes them; `message` is unchanged.
10. A `publishAll` of two events whose handlers throw rejects with `details.failures` carrying each event's `eventId` (the existing failure tests' expected `details`, with `eventId` added). The test helper `createEvent` gives each event a distinct id (derived from `userId`, say), so that a failure is shown to carry its own event's id. An event that reaches the bus without `eventId` at runtime (an untyped caller) gives a failure with `eventId: undefined`: the bus checks nothing.

The existing tests change only as the API does: `SyncEventBus` → `SequentialEventBus` (file `sync.event-bus.test.ts` → `sequential.event-bus.test.ts`), `eventId` in every event literal and test helper (`createEvent`, the `deleted` literal), `EventHandler<X, void, Ctx>` → `EventHandler<X, Ctx>`. No assertion is removed.

## Chunks

- [x] 1. The envelope and the handler (test-first): `packages/events/src/event.ts`, `packages/events/src/event-handler.ts`, `packages/events/src/event-bus.ts`, `packages/events/src/sync.event-bus.ts`, `packages/events/__tests__/event-bus.types.test.ts`, `packages/events/__tests__/sync.event-bus.test.ts`; cases 1, 2, 3, 4, 5, 6, 6a, 8; signatures: `Event`, `EventHandler`, `EventBus.subscribe`, `SyncEventBus.subscribe`.
- [x] 2. `eventId` in the failures, and `SyncEventBus` → `SequentialEventBus` (test-first): `packages/events/src/event-handlers-failed.error.ts`, `packages/events/src/sync.event-bus.ts` → `packages/events/src/sequential.event-bus.ts` (its JSDoc `@example` included), `packages/events/src/index.ts`, `packages/events/__tests__/event-handlers-failed.error.test.ts`, `packages/events/__tests__/sync.event-bus.test.ts` → `packages/events/__tests__/sequential.event-bus.test.ts`, `packages/events/__tests__/event-bus.types.test.ts`; cases 7, 9, 10; signatures: `EventHandlerFailure`, the class `SyncEventBus` (renamed `SequentialEventBus`).
- [x] 3. README (no test-first), the failures' `details` bullet included: `packages/events/README.md`.
- [x] 4. Two precisions from the final review, asked by the human at the checkpoint (no test-first: documentation only): `packages/events/README.md`, *Upgrading from 1.x*, the `Result` bullet: a 1.x `Result` that `undefined` does not fit (`number`) fails at `subscribe` only for a handler typed through the interface; a class `implements EventHandler<X, number>` passed as an instance subscribes silently, its structural type having no context parameter, so its stale `Result` survives: drop it there too. `packages/events/src/event-handlers-failed.error.ts`, `EventHandlerFailure.eventId`'s JSDoc: the bus copies it as it is, so an event that reaches the bus without `eventId` (an untyped caller) gives `undefined`, as the README says.

The backlog item *The envelope of `@enardo/events`' `Event`* leaves `.workflow/backlog.md` in a commit of its own before the merge.
