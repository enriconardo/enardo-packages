# @enardo/events

Domain events and an in-process bus that routes them to handlers: `Event`,
`EventHandler`, and `SequentialEventBus`, which runs every handler of an event, in
order, and reports the failures in one error.

## Exports

| Export                                              | Meaning                                                                                                                       |
| --------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------- |
| `Event`                                             | `{ eventId, eventName, occurredAt, payload }`; `Event<Payload, Name>`, `Name` the literal event name (a `string` by default). |
| `EventHandler`                                      | `EventHandler<EventType, TContext>`: `handle(event, context)`.                                                                |
| `EventBus`                                          | The contract: `subscribe`, `publish`, `publishAll`.                                                                           |
| `SequentialEventBus`                                | The in-process, sequential implementation.                                                                                    |
| `EventNamed`                                        | The member(s) of an event union that a handler subscribed under a name receives.                                              |
| `ContextArgument`                                   | The type of the `context` argument of `publish` and `publishAll`.                                                             |
| `EventHandlersFailedError`                          | What a dispatch rejects with when a handler threw.                                                                            |
| `EventHandlerFailure`, `EventHandlersFailedDetails` | The shape of its `details`.                                                                                                   |

## Typing the bus

The bus takes the union of the events it carries, each with a literal
`eventName`:

```ts
import {
  SequentialEventBus,
  type Event,
  type EventHandler,
} from "@enardo/events";

type UserRegistered = Event<{ id: string }, "user.registered">;
type UserDeleted = Event<{ id: string }, "user.deleted">;

const bus = new SequentialEventBus<UserRegistered | UserDeleted>();

const sendWelcome: EventHandler<UserRegistered> = {
  async handle(event) {
    // event is a UserRegistered
  },
};

bus.subscribe("user.registered", sendWelcome);
bus.subscribe("user.deleted", sendWelcome); // does not compile
bus.subscribe("user.renamed", sendWelcome); // does not compile

await bus.publish({
  eventId: "0b9f6c1e-5d1a-4e43-9a53-6f2f4c8d7a10",
  eventName: "user.registered",
  occurredAt: new Date(),
  payload: { id: "u1" },
});
```

- `subscribe` accepts only a name of the union, and a handler of the event(s)
  with that name: a misspelled name, or a handler of another event, does not
  compile. A handler of `Event` itself (one that logs everything) is accepted
  under any name.
- `publish` and `publishAll` accept only members of the union.
- `new SequentialEventBus()` is the loose bus (`Events = Event`): any string, any
  handler. Use it only when you do not type your events.
- `EventNamed<Events, Name>` types a handler by the name it is subscribed under.

## Context

The bus passes the context of the caller to every handler, unchanged; it never
reads it. By default it is `undefined`: `publish(event)` takes no context and
handlers receive `undefined`. A typed context goes in the second parameter of
`EventHandler` and in the second of the bus:

```ts
interface RequestContext {
  correlationId: string;
}

const bus = new SequentialEventBus<UserRegistered, RequestContext>();

const handler: EventHandler<UserRegistered, RequestContext> = {
  async handle(event, context) {
    console.log(context.correlationId);
  },
};

bus.subscribe("user.registered", handler);
await bus.publish(event, { correlationId: "c1" }); // the argument is required
```

When `undefined` is not a valid context, the argument is required. A handler of
every event on such a bus (an `EventHandler<Event>`, say) declares that context
too: `EventHandler<Event, RequestContext>`.

A handler's implementation may omit the `context` parameter. Code that calls
`handle` directly writes `handle(event, undefined)`.

### Where the bus runs

The bus carries no transaction. It is meant to run after the commit, from the
app's relay: a unit of work's hook hands the events over inside the transaction
(to write an outbox, for instance), and the relay publishes them once it is
committed. Delivery is then at least once, so:

- a handler is idempotent, and deduplicates by `eventId`;
- a handler that needs a transaction opens its own.

An app that puts its transaction in `TContext` and publishes inside the unit of
work's hook does it knowingly: the handlers run before the commit, run again
if the transaction is retried, and a failing handler rolls back the use case.

The `eventId` is the key a handler deduplicates by. The package generates none
(`crypto.randomUUID()` is one way) and the format is the app's. The id is fixed
once, no later than when the event is stored durably (by the aggregate that
raises it, by the unit of work's hook that writes the outbox, or as the outbox
row's own key, which the relay reads back), and every delivery of that
occurrence carries the same id; it is never generated per publish.

The bus does not deduplicate: beyond copying it into a failure, it neither
reads nor checks `eventId`, so two events with one id in a `publishAll` both
reach the handlers.

`occurredAt` is a `Date`. A Mongo outbox keeps it as a date; a transport that
serializes to JSON (a JSON outbox column, a message broker) gives back a string,
and the relay rebuilds it (`new Date(value)`) before `publish`.

## Dispatch and failures

`SequentialEventBus` is sequential and in-process: events in array order, the
handlers of each event in subscription order, each awaited before the next.
A dispatch runs the handlers subscribed when it reaches the event: one
subscribed meanwhile runs from the next dispatch on.
Return values are ignored. With no handler for an event, nothing happens.

A handler that throws or rejects does not stop the dispatch: every handler of
every event runs. If at least one failed, `publish` and `publishAll` then
reject, after the last handler, with one `EventHandlersFailedError`:

```ts
import { isBaseErrorLike } from "@enardo/errors";

try {
  await bus.publishAll(events);
} catch (error) {
  if (isBaseErrorLike(error) && error.code === "EVENT_HANDLERS_FAILED") {
    // error.details.failures
  }
}
```

- `code` is `"EVENT_HANDLERS_FAILED"`, the same for one failure or many.
- `details.failures` has one entry per throw, in the order the handlers ran:
  `{ eventIndex, eventId, eventName, handlerIndex }`. `eventIndex` is the event's
  index in `publishAll`'s array (0 for `publish`); `eventId` is that event's
  `eventId`, copied as it is, so a relay knows which events to retry without
  mapping the index back to its array; `handlerIndex` is the handler's
  position among those of the name, in subscription order. `handlerIndex` is for
  diagnosis: a relay retries the whole event, not one handler.
- `message` lists indexes and names only, e.g.
  `Event handlers failed: #0 user.registered[0], #1 user.registered[0]`.
- `cause` is an `AggregateError` whose `errors` are the thrown values as they
  are (an `Error` or not), at the same positions as `details.failures`.

The `message` and `details` hold neither payload nor thrown message, since
those may carry personal data; they are in the `cause`. Whatever logs the error
(`toJSON()` serializes the `cause`, stacks included) logs the thrown values
too. A handler whose error may hold personal data keeps it out of its own
error (`@enardo/errors` README, _Accept a `cause`_).

## Upgrading from 1.x

- `SyncEventBus` is `SequentialEventBus`, with no alias: rename the import and
  every use. Its behavior is the sequential dispatch described above, except for
  the failures (below) and one more break: 1.x iterated the live handler list,
  so a handler subscribed meanwhile (to the event's name, by a running handler)
  ran in that same dispatch; now it runs from the next dispatch on.
- `Event` requires `eventId: string`: every event literal and test helper adds
  it, an app that publishes in process with no outbox included. See _Where the
  bus runs_ for when it is fixed.
- `EventHandler<EventType, Result>` is `EventHandler<EventType, TContext>`:
  `Result` is gone, and `handle` returns `Promise<unknown>`. A 1.x `Result`
  that `undefined` fits (`void`, `unknown`) still compiles and subscribes, now
  read as the context; one it does not fit (`number`, say) fails at
  `subscribe`. Drop a 1.x `Result`. A direct `await handler.handle(...)` that
  read a 1.x `Result` now gets `unknown`.
- `handle(event, context?: EventContext)` is `handle(event, context: TContext)`:
  a direct call writes `handle(event, undefined)`.
- `EventContext` and its `session` are gone, in favor of `TContext`: the bus is
  meant to run after the commit, not in the transaction (_Where the bus runs_).
- `MergeableEvent` and `isMergeableEvent` are removed.
- `EventBus` is generic over `<Events, TContext>`, and
  `subscribe<Name extends Events["eventName"]>(eventName, handler)` replaces
  `subscribe<EventType>(eventName: string, handler)`: an explicit type argument
  stops compiling. An app class implementing `EventBus` with the 1.x shape still
  compiles against the default generics; it breaks once it is typed as
  `EventBus<Events, TContext>`, or through its import of the removed
  `EventContext`.
- A dispatch runs every handler and reports the failures in one
  `EventHandlersFailedError` (`code` `"EVENT_HANDLERS_FAILED"`, `details.failures`
  with `eventId`), where 1.x stopped at the first handler that threw and
  rethrew its error. A `catch` that read that error now reads it in `cause.errors`.
