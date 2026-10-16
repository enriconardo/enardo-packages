import type { Event } from "./event.js";
import type { EventHandler } from "./event-handler.js";
import type { EventBus } from "./event-bus.js";
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
export class SyncEventBus implements EventBus {
  private readonly handlers = new Map<string, EventHandler<Event>[]>();

  subscribe<EventType extends Event>(
    eventName: string,
    handler: EventHandler<EventType>,
  ): void {
    const existing = this.handlers.get(eventName) ?? [];
    existing.push(handler);
    this.handlers.set(eventName, existing);
  }

  async publish(event: Event, context?: EventContext): Promise<void> {
    const handlers = this.handlers.get(event.eventName) ?? [];

    for (const handler of handlers) {
      await handler.handle(event, context);
    }
  }

  async publishAll(events: Event[], context?: EventContext): Promise<void> {
    for (const event of events) {
      await this.publish(event, context);
    }
  }
}
