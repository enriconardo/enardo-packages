import type { Event } from "./event.js";
import type { EventHandler } from "./event-handler.js";
import type { EventContext } from "./event-context.js";

/** The member(s) of `Events` that a handler subscribed under `Name` receives. */
export type EventNamed<
  Events extends Event,
  Name extends string,
> = Events extends Event
  ? Name extends Events["eventName"]
    ? Events
    : never
  : never;

/**
 * Mediator that routes events to their registered handlers.
 *
 * @template Events - The union of the events the bus carries.
 */
export interface EventBus<Events extends Event = Event> {
  /**
   * Register a handler for a specific event name.
   */
  subscribe<Name extends Events["eventName"]>(
    eventName: Name,
    handler: EventHandler<EventNamed<Events, Name>>,
  ): void;

  /**
   * Dispatch a single event to all subscribed handlers (sequentially).
   */
  publish(event: Events, context?: EventContext): Promise<void>;

  /**
   * Dispatch multiple events to all subscribed handlers (sequentially).
   */
  publishAll(events: readonly Events[], context?: EventContext): Promise<void>;
}
