import type { Event } from "./event.js";
import type { EventHandler } from "./event-handler.js";
import type { ContextArgument, EventBus, EventNamed } from "./event-bus.js";

/**
 * In-process, synchronous event bus.
 *
 * Handlers are executed sequentially, each awaited before the next. The
 * caller's `TContext` is passed to every handler unchanged; the bus never
 * reads it.
 *
 * The bus is meant to run after the commit, from the app's relay: a handler
 * opens its own transaction if it needs one and is idempotent, since delivery
 * is at least once. An app that puts its transaction in `TContext` and
 * publishes inside a unit of work's hook does it knowingly: handlers run
 * before the commit, run again if the transaction is retried, and a failing
 * handler rolls back the use case.
 *
 * @example
 * ```ts
 * const bus = new SyncEventBus();
 * bus.subscribe("user.registered", myHandler);
 * await bus.publish(event);
 * ```
 */
export class SyncEventBus<
  Events extends Event = Event,
  TContext = undefined,
> implements EventBus<Events, TContext> {
  private readonly handlers = new Map<
    string,
    EventHandler<Events, unknown, TContext>[]
  >();

  subscribe<Name extends Events["eventName"]>(
    eventName: Name,
    handler: EventHandler<EventNamed<Events, Name>, unknown, TContext>,
  ): void {
    const existing = this.handlers.get(eventName) ?? [];
    // Stored among the handlers of `Events` through the bivariance of `handle`.
    existing.push(handler);
    this.handlers.set(eventName, existing);
  }

  async publish(
    event: Events,
    ...context: ContextArgument<TContext>
  ): Promise<void> {
    const handlers = this.handlers.get(event.eventName) ?? [];
    // The tuple guarantees it: when the argument may be left out, `undefined` is a `TContext`.
    const ctx = context[0] as TContext;

    for (const handler of handlers) {
      await handler.handle(event, ctx);
    }
  }

  async publishAll(
    events: readonly Events[],
    ...context: ContextArgument<TContext>
  ): Promise<void> {
    for (const event of events) {
      await this.publish(event, ...context);
    }
  }
}
