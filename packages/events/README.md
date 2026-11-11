# @enardo/events

Domain events and an in-process bus that routes them to handlers: `Event`,
`EventHandler`, and `SyncEventBus`, which runs every handler of an event, in
order, and reports the failures in one error.

## Exports

| Export                                              | Meaning                                                                                                              |
| --------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------- |
| `Event`                                             | `{ eventName, occurredAt, payload }`; `Event<Payload, Name>`, `Name` the literal event name (a `string` by default). |
| `EventHandler`                                      | `EventHandler<EventType, Result, TContext>`: `handle(event, context)`.                                               |
| `EventBus`                                          | The contract: `subscribe`, `publish`, `publishAll`.                                                                  |
| `SyncEventBus`                                      | The in-process, sequential implementation.                                                                           |
| `EventNamed`                                        | The member(s) of an event union that a handler subscribed under a name receives.                                     |
| `ContextArgument`                                   | The type of the `context` argument of `publish` and `publishAll`.                                                    |
| `EventHandlersFailedError`                          | What a dispatch rejects with when a handler threw.                                                                   |
| `EventHandlerFailure`, `EventHandlersFailedDetails` | The shape of its `details`.                                                                                          |

## Typing the bus

The bus takes the union of the events it carries, each with a literal
`eventName`:

```ts
import { SyncEventBus, type Event, type EventHandler } from "@enardo/events";

type UserRegistered = Event<{ id: string }, "user.registered">;
type UserDeleted = Event<{ id: string }, "user.deleted">;

const bus = new SyncEventBus<UserRegistered | UserDeleted>();

const sendWelcome: EventHandler<UserRegistered> = {
  async handle(event) {
    // event is a UserRegistered
  },
};

bus.subscribe("user.registered", sendWelcome);
bus.subscribe("user.deleted", sendWelcome); // does not compile
bus.subscribe("user.renamed", sendWelcome); // does not compile

await bus.publish({
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
- `new SyncEventBus()` is the loose bus (`Events = Event`): any string, any
  handler. Use it only when you do not type your events.
- `EventNamed<Events, Name>` types a handler by the name it is subscribed under.

## Context

The bus passes the context of the caller to every handler, unchanged; it never
reads it. By default it is `undefined`: `publish(event)` takes no context and
handlers receive `undefined`. A typed context goes in the third parameter of
`EventHandler` and in the second of the bus:

```ts
interface RequestContext {
  correlationId: string;
}

const bus = new SyncEventBus<UserRegistered, RequestContext>();

const handler: EventHandler<UserRegistered, void, RequestContext> = {
  async handle(event, context) {
    console.log(context.correlationId);
  },
};

bus.subscribe("user.registered", handler);
await bus.publish(event, { correlationId: "c1" }); // the argument is required
```

When `undefined` is not a valid context, the argument is required. A handler of
every event on such a bus (an `EventHandler<Event>`, say) declares that context
too: `EventHandler<Event, void, RequestContext>`.

A handler's implementation may omit the `context` parameter. Code that calls
`handle` directly writes `handle(event, undefined)`.

### Where the bus runs

The bus carries no transaction. It is meant to run after the commit, from the
app's relay: a unit of work's hook hands the events over inside the transaction
(to write an outbox, for instance), and the relay publishes them once it is
committed. Delivery is then at least once, so:

- a handler is idempotent;
- a handler that needs a transaction opens its own.

An app that puts its transaction in `TContext` and publishes inside the unit of
work's hook does it knowingly: the handlers run before the commit, run again
if the transaction is retried, and a failing handler rolls back the use case.

## Dispatch and failures

`SyncEventBus` is sequential and in-process: events in array order, the
handlers of each event in subscription order, each awaited before the next.
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
  `{ eventIndex, eventName, handlerIndex }`. `eventIndex` is the event's index in
  `publishAll`'s array (0 for `publish`); `handlerIndex` is the handler's
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
