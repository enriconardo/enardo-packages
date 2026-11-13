import type { Event } from "./event";

/**
 * Handles a specific type of event.
 *
 * @template EventType - The event type this handler processes.
 * @template TContext  - The context the bus passes to `handle`, `undefined` by default.
 *
 * Delivery is at least once, so a handler is idempotent: it deduplicates by
 * the event's `eventId`. It opens its own transaction if it needs one: see the
 * README, _Where the bus runs_.
 */
export interface EventHandler<
  EventType extends Event = Event,
  TContext = undefined,
> {
  handle(event: EventType, context: TContext): Promise<unknown>;
}
