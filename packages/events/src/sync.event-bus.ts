import type { Event } from "./event.js";
import type { EventHandler } from "./event-handler.js";
import type { EventBus, EventNamed } from "./event-bus.js";
import type { EventContext } from "./event-context.js";

/**
 * In-process, synchronous event bus.
 *
 * Handlers are executed sequentially with `await` so they can participate
 * in the same database transaction via {@link EventContext.session}.
 *
 * @example
 * ```ts
 * const bus = new SyncEventBus();
 * bus.subscribe("user.registered", myHandler);
 * await bus.publish(event, { session });
 * ```
 */
export class SyncEventBus<
  Events extends Event = Event,
> implements EventBus<Events> {
  private readonly handlers = new Map<string, EventHandler<Events>[]>();

  subscribe<Name extends Events["eventName"]>(
    eventName: Name,
    handler: EventHandler<EventNamed<Events, Name>>,
  ): void {
    const existing = this.handlers.get(eventName) ?? [];
    // Stored among the handlers of `Events` through the bivariance of `handle`.
    existing.push(handler);
    this.handlers.set(eventName, existing);
  }

  async publish(event: Events, context?: EventContext): Promise<void> {
    const handlers = this.handlers.get(event.eventName) ?? [];

    for (const handler of handlers) {
      await handler.handle(event, context);
    }
  }

  async publishAll(
    events: readonly Events[],
    context?: EventContext,
  ): Promise<void> {
    for (const event of events) {
      await this.publish(event, context);
    }
  }
}
