/**
 * Base interface for all events.
 *
 * @template Payload - The shape of the event-specific data.
 * @template Name    - The literal event name (defaults to `string`).
 */
export interface Event<Payload = unknown, Name extends string = string> {
  /**
   * Identifies one occurrence: the key handlers deduplicate by under
   * at-least-once delivery. Fixed once, no later than when the event is stored
   * durably, and the same in every delivery; never generated per publish.
   */
  readonly eventId: string;
  /** The event's type, shared by all its occurrences (e.g. `"user.registered"`). */
  readonly eventName: Name;
  /** When the event occurred */
  readonly occurredAt: Date;
  /** Event-specific data */
  readonly payload: Payload;
}
