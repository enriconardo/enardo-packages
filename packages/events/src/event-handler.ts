import type { Event } from "./event.js";
import type { EventContext } from "./event-context.js";

/**
 * Handles a specific type of event.
 *
 * @template EventType - The event type this handler processes.
 * @template Result    - Optional return value (defaults to `void`).
 */
export interface EventHandler<EventType extends Event = Event, Result = void> {
  handle(event: EventType, context?: EventContext): Promise<Result>;
}
