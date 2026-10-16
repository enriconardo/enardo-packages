import type { Event } from "./event.js";
import type { EventHandler } from "./event-handler.js";
import type { EventContext } from "./event-context.js";

/**
 * Mediator that routes events to their registered handlers.
 */
export interface EventBus {
  /**
   * Register a handler for a specific event name.
   */
  subscribe<EventType extends Event>(
    eventName: string,
    handler: EventHandler<EventType>,
  ): void;

  /**
   * Dispatch a single event to all subscribed handlers (sequentially).
   */
  publish(event: Event, context?: EventContext): Promise<void>;

  /**
   * Dispatch multiple events to all subscribed handlers (sequentially).
   */
  publishAll(events: Event[], context?: EventContext): Promise<void>;
}
