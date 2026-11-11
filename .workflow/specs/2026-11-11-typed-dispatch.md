---
status: approved
branch: feature/events/typed-dispatch
---

# `@enardo/events` 2.0.0 ties a handler to its event's name, carries an app-typed context and runs every handler

## Why

The queued backlog item *Three doubts on the dispatch of `@enardo/events`* (from the analysis of `@enardo/entities` on `docs/repo/entities-events-backlog`, 2026-11-10). Seen in the code on `main` at `8ed8c51`:

1. **The name is not tied to the handler.** `EventBus.subscribe<EventType extends Event>(eventName: string, handler: EventHandler<EventType>)` (`packages/events/src/event-bus.ts:12-15`) infers `EventType` from the handler alone, and `Event.eventName` is a `string` (`src/event.ts`). `bus.subscribe("user.deleted", userRegisteredHandler)` compiles; the existing test *should not call handlers for different event names* does exactly that.
2. **The context says the bus runs inside the transaction.** `EventContext { session?: unknown; [key: string]: unknown }` is documented as "enables transactional consistency by carrying the database session" (`src/event-context.ts`), and `SyncEventBus`'s JSDoc says handlers run sequentially "so they can participate in the same database transaction via `EventContext.session`" (`src/sync.event-bus.ts`). ADR 0021 decides the other way: the unit of work hands the events to an app hook inside the transaction, to write an outbox; a relay of the app publishes them after the commit, at least once, to idempotent handlers; dispatching in the hook is the app's knowing choice, and was rejected as the package's default (*Alternatives*). `@enardo/uow-repository` carries its transaction as a generic `TContext`, with no `session`.
3. **A failure hides the handlers that did not run.** `SyncEventBus.publish` awaits each handler in a loop with no `try` (`src/sync.event-bus.ts`); the first throw rejects `publish` and the following handlers never run, and `publishAll` skips the following events too. The caller gets the first handler's error and no word of the others. The test *should stop at first handler error (no partial dispatch)* pins it.

No package of this monorepo depends on `@enardo/events` (`git grep`); `2.0.0` is on `main` (`feature/events/drop-mergeable-event`) and, the human confirms, not published: the breaking changes go into it.

## What

`@enardo/events` 2.0.0 exports:

```ts
interface Event<Payload = unknown, Name extends string = string> {
  readonly eventName: Name;
  readonly occurredAt: Date;
  readonly payload: Payload;
}

interface EventHandler<EventType extends Event = Event, Result = void, TContext = undefined> {
  handle(event: EventType, context: TContext): Promise<Result>;
}

/** The member(s) of `Events` that a handler subscribed under `Name` receives. */
type EventNamed<Events extends Event, Name extends string>;

interface EventBus<Events extends Event = Event, TContext = undefined> {
  subscribe<Name extends Events["eventName"]>(
    eventName: Name,
    handler: EventHandler<EventNamed<Events, Name>, unknown, TContext>,
  ): void;
  publish(event: Events, ...context: ContextArgument<TContext>): Promise<void>;
  publishAll(events: readonly Events[], ...context: ContextArgument<TContext>): Promise<void>;
}

/** `[context?: TContext]` when `undefined` is assignable to `TContext`, else `[context: TContext]`. */
type ContextArgument<TContext>;

class SyncEventBus<Events extends Event = Event, TContext = undefined> implements EventBus<Events, TContext>;

class EventHandlersFailedError extends BaseError {
  readonly name: "EventHandlersFailedError";
  declare readonly code: "EVENT_HANDLERS_FAILED";
  declare readonly details: EventHandlersFailedDetails;
  /** Each failure with the value its handler threw, in the order the handlers ran. */
  constructor(
    failures: readonly [
      EventHandlerFailure & { readonly error: unknown },
      ...(EventHandlerFailure & { readonly error: unknown })[],
    ],
  );
}
interface EventHandlersFailedDetails extends Record<string, unknown> {
  /** Each handler that threw, in the order it ran. */
  readonly failures: readonly EventHandlerFailure[];
}
interface EventHandlerFailure {
  /** The event's index in `publishAll`'s array; 0 for `publish`. */
  readonly eventIndex: number;
  readonly eventName: string;
  /** The handler's position among the handlers of `eventName`, in subscription order. */
  readonly handlerIndex: number;
}
```

- **Typing.** `Events` is the union of the events the bus carries, each with a literal `eventName` (`Event<Payload, "user.registered">`, or an interface that narrows `eventName`). `subscribe` accepts only a name of `Events`, and a handler of the event(s) with that name: a misspelled name, or a handler of another event, does not compile. `publish` accepts only a member of `Events`. With the default `Events = Event`, any string and any handler of `Event` compile, as today.
- **Context.** `EventContext` is removed. The bus passes the caller's `TContext` through to every handler, unchanged; it never reads it. With the default `TContext = undefined`, `publish(event)` takes no context and handlers receive `undefined`. A `TContext` that does not admit `undefined` makes the argument required. The JSDoc of `EventBus`, `SyncEventBus` and `EventHandler` describes the model of ADR 0021: the bus is meant to run after the commit, from the app's relay; a handler opens its own transaction if it needs one and is idempotent, since delivery is at least once; an app that puts its transaction in `TContext` and publishes inside the unit of work's hook does it knowingly (handlers before the commit, re-run on a retried transaction, the use case rolled back by a failing handler).
- **Dispatch.** `SyncEventBus` stays in-process and sequential: events in array order, the handlers of each event in subscription order, each awaited before the next. A handler that throws (or rejects) does not stop the dispatch: every handler of every event runs. When at least one threw, `publish` and `publishAll` reject, after the last handler, with one `EventHandlersFailedError`:
  - `code` `"EVENT_HANDLERS_FAILED"`, recognized with `isBaseErrorLike`;
  - `details.failures`: one entry per throw, in the order the handlers ran;
  - `cause`: an `AggregateError` whose `errors` are the thrown values, as they are (an `Error` or not), at the same positions as `details.failures`, and whose `message` is `"Errors thrown by the event handlers"`;
  - `message`: `` `Event handlers failed: ${failures.map((f) => `#${f.eventIndex} ${f.eventName}[${f.handlerIndex}]`).join(", ")}` ``, e.g. `"Event handlers failed: #0 user.registered[0], #1 user.registered[0]"`: indexes and names only (no payload, no thrown message).
  The handlers' return values are ignored. No handler: nothing happens, as today.
- **Implementation notes.** Inside the generic class `ContextArgument<TContext>` stays deferred: the bus reads the context as `context[0] as TContext`, with a comment saying the tuple guarantees it (`undefined` is a `TContext` whenever the argument may be left out). Storing a handler of `EventNamed<Events, Name>` among handlers of `Events` relies on the method's bivariance; a cast there, if the compiler wants one, gets a comment too.
- **`handle`'s context parameter is required in the type** (`context: TContext`, `undefined` by default): the bus always passes it, an implementation may omit the parameter, and code that calls a handler directly writes `handle(event, undefined)`. A rest tuple there too would make every handler's implementation generic over it, for a direct call only tests make.
- **Package.** `@enardo/errors` (`workspace:^`) becomes a dependency of `@enardo/events`, as in `@enardo/cqrs`. `version` stays 2.0.0. A README is added: what the package is for; the typing, including that a typed context goes in `EventHandler`'s third parameter (`EventHandler<E, void, Ctx>`) and that a handler of every event on a bus with a required context declares that context; the context and the after-commit model, naming "a unit of work's hook" and no package (root `CLAUDE.md`, *Code conventions*); the failure error, saying that `handlerIndex` is for diagnosis (a relay retries the whole event) and that its `cause` carries the handlers' thrown values, so whatever logs it logs them: a handler whose error may hold personal data keeps it out of its own error (`@enardo/errors` README, *Accept a `cause`*).
- **Out of scope:** parallel dispatch, a timeout per handler, a retry, logging (the error reaches the caller: ADR 0014), subscribing or unsubscribing during a dispatch, renaming `SyncEventBus`, publishing 2.0.0.

## Decisions

- **Everything in 2.0.0** (the human's call: it is unpublished). A 3.0.0 would publish a 2.0.0 already known to be wrong; doing nothing keeps the three doubts.
- **The bus stays**, though no package depends on it. Shipping only `Event` and `EventHandler` would leave every app's relay to write the same dispatch (routing by name, order, failure reporting) that this task fixes; the analysis was asked to fix the bus, not to drop it.
- **Typing by an event union on the bus**, not by a free `EventType` on `subscribe` (today: no check), nor by a handler that declares its name (a runtime field on every handler, and a duplicate of the event's own literal). The default `Event` keeps a loose bus available for an app that does not type its events. `Event` gains a second parameter `Name`, after `Payload`, so `Event<P>` still means what it meant.
- **`EventNamed`, not `Extract<Events, { eventName: Name }>`.** `Extract<Event, { eventName: "x" }>` is `never`, since `Event`'s `eventName` is `string`: the loose default would accept no handler. `EventNamed` distributes over `Events` and keeps each member whose `eventName` admits `Name` (`Name extends Member["eventName"]`), so a literal member is picked by its name and a `string` member is kept. It is exported, since an app types its handlers with it.
- **Checked before the spec** with the repo's `tsc` (`--strict`), on a sketch of these declarations: test cases 2-9 hold (each `@ts-expect-error` is used), and the loose bus also accepts a handler of a literal event under any name, as today.
- **`handle` keeps the method syntax** (bivariant parameter). Two events with different literal names are unrelated types, so a handler of one is refused for the other in either direction; a property syntax would add contravariance only for handlers of a wider type, which are legitimate (a handler of `Event` logs everything), at the cost of a cast in the bus.
- **The context is the app's type, the bus carries no transaction** (the human, from the outbox practice and ADR 0021). Keeping `session` would keep the package's suggestion that ADR 0021 rejected; only correcting the JSDoc would leave an untyped bag (`[key: string]: unknown`) where the app knows its type. A rest tuple, not `context?: TContext`, so a handler of a required context does not receive `TContext | undefined`.
- **Every handler runs, then one error** (the human). Stopping at the first throw (today, or documented) lets a secondary handler's failure deny the event to the others, and a relay that retries the event re-runs the handlers that succeeded anyway: with idempotent handlers, running all of them loses nothing. Parallel dispatch would change the order handlers rely on (out of scope). A native `AggregateError` alone carries no `code` (root `CLAUDE.md`, *Architecture conventions*): the relay recognizes the `BaseError` and finds the thrown values in its `cause`, which `toJSON()` serializes with their stacks (`@enardo/errors` README, *Logging*).
- **One error even for one failure**, so the caller handles one shape; the old *should propagate handler errors* test changes with it.
- **Failures named by indexes and names, not by the handler.** A handler has no identity the bus could report; its position in subscription order is stable for a bus built once at startup. The `message` and `details` hold no payload and no thrown message: those may carry personal data, and they are in the `cause` for whoever logs it.
- **`publishAll` reports one error for all its events**, with `eventIndex`, rather than stopping at the first failing event: the same reasoning as for handlers.
- **ADR 0023** records that `@enardo/events` carries no transaction and runs every handler: it bounds later changes to the package (an async or outbox bus would follow it).
- **The test file is renamed** `sync-domain-event-bus.test.ts` → `sync.event-bus.test.ts`, mirroring `src/` (root `CLAUDE.md`, *Testing*); the type tests go in `event-bus.types.test.ts`, as `email.types.test.ts` does. The existing runtime tests are kept where the behavior stays (call, order, other names, no handler, `publishAll` order and context) with `{ session }` replaced by an app context; *should propagate handler errors* and *should stop at first handler error* are replaced by the cases below.

## Test cases

Types (`expectTypeOf`, `@ts-expect-error`; checked by `typecheck`):

1. `Event<{ id: string }, "user.registered">["eventName"]` is `"user.registered"`; `Event<{ id: string }>["eventName"]` is `string`.
2. A typed bus (`SyncEventBus<UserRegistered | UserDeleted>`): `subscribe("user.renamed", …)` does not compile.
3. Typed bus: `subscribe("user.deleted", userRegisteredHandler)` does not compile.
4. Typed bus: in `subscribe("user.registered", { handle: async (event) => … })`, `event` is `UserRegistered`.
5. Typed bus: `subscribe("user.registered", handlerOfEvent)` (an `EventHandler<Event>`) compiles.
6. Typed bus: `publish(eventNotInTheUnion)` does not compile.
7. Default bus (`SyncEventBus`): `subscribe("anything", handlerOfEvent)` and `publish(anyEvent)` compile, as today.
8. `SyncEventBus<E, { correlationId: string }>`: `publish(event)` does not compile, `publish(event, { correlationId })` compiles, and the handler's `context` is `{ correlationId: string }`.
9. `SyncEventBus<E>` (default context): `publish(event)` compiles; `publish(event, {})` does not.
Runtime:

10. A subscribed handler is called once with the event and the context (`undefined` when none is given); another context object is passed as the same reference.
11. Two handlers of one name run in subscription order; a handler of another name is not called; no handler: `publish` resolves.
12. Handlers run sequentially: the second starts after the first's promise settles.
13. The first of two handlers throws: the second still runs; `publish` rejects with an `EventHandlersFailedError` that `isBaseErrorLike` recognizes, `code` `"EVENT_HANDLERS_FAILED"`, `details.failures` `[{ eventIndex: 0, eventName: "user.registered", handlerIndex: 0 }]`, `cause` an `AggregateError` whose `errors` is `[the thrown error]`.
14. Both handlers throw, the second a non-`Error` value (`const boom: unknown = "boom"; throw boom;`, the form `@typescript-eslint/only-throw-error` allows): `details.failures` has handler indexes `[0, 1]`, `cause.errors` is `[error, "boom"]`, and the `message` is `"Event handlers failed: #0 user.registered[0], #0 user.registered[1]"`, holding neither thrown message.
15. A handler rejects asynchronously (not a synchronous throw): treated like 14.
16. `publishAll` of two events, a handler failing on the first: the second event is still dispatched, and the error's failure has `eventIndex: 0`; failing on both: two failures, `eventIndex` 0 and 1, and the `message` is `"Event handlers failed: #0 user.registered[0], #1 user.registered[0]"`.
17. `publishAll` passes the same context to every handler of every event, and dispatches the events in array order.
18. `new EventHandlersFailedError(...)`'s `name` is `"EventHandlersFailedError"` and `toJSON()` holds `code`, `details` and the serialized `cause` with its `message` `"Errors thrown by the event handlers"` and its `errors`.

## Chunks

- [ ] 1. Event name tied to the handler: `Event` gains `Name`, `EventNamed`, and `EventBus`/`SyncEventBus` take `Events` (test-first): `packages/events/src/event.ts`, `src/event-bus.ts`, `src/sync.event-bus.ts`, `src/index.ts`, `__tests__/event-bus.types.test.ts` (new), `__tests__/sync-domain-event-bus.test.ts` renamed to `__tests__/sync.event-bus.test.ts` (existing runtime cases kept, `{ session }` context still in place); cases 1-7, 11, 12; signatures: `Event` (second type parameter `Name`), `EventBus` (type parameter `Events`, `subscribe`), `SyncEventBus` (type parameter `Events`, its `subscribe`/`publish`/`publishAll`).
- [ ] 2. App-typed context replaces `EventContext`; `EventHandler`, `EventBus` and `SyncEventBus` take `TContext`; the after-commit JSDoc (test-first): `src/event-context.ts` (deleted), `src/event-handler.ts`, `src/event-bus.ts`, `src/sync.event-bus.ts`, `src/index.ts`, `__tests__/event-bus.types.test.ts`, `__tests__/sync.event-bus.test.ts`; cases 8, 9, 10, 17; signatures: `EventHandler` (type parameter `TContext`, `handle`'s `context`), `EventBus.publish` and `publishAll` (rest `ContextArgument<TContext>` in place of `context?: EventContext`), `EventBus` and `SyncEventBus` (type parameter `TContext`).
- [ ] 3. Every handler runs, then one `EventHandlersFailedError` (test-first): `src/event-handlers-failed.error.ts` (new), `src/sync.event-bus.ts` (its JSDoc on failures too), `src/index.ts`, `package.json` (dependency `@enardo/errors` `workspace:^`), `pnpm-lock.yaml`, `__tests__/event-handlers-failed.error.test.ts` (new), `__tests__/sync.event-bus.test.ts` (*should propagate handler errors* and *should stop at first handler error* replaced); cases 13-16, 18.
- [ ] 4. README of `@enardo/events` (no test-first, docs): `packages/events/README.md`.
- [ ] 5. Remove the backlog item *Three doubts on the dispatch of `@enardo/events`* (no test-first, docs): `.workflow/backlog.md`, in a commit of its own.
