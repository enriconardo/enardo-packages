/**
 * Base interface for all events.
 *
 * @template Payload - The shape of the event-specific data.
 * @template Name    - The literal event name (defaults to `string`).
 */
export interface Event<Payload = unknown, Name extends string = string> {
  /** Unique event identifier (e.g. `"user.registered"`) */
  readonly eventName: Name;
  /** When the event occurred */
  readonly occurredAt: Date;
  /** Event-specific data */
  readonly payload: Payload;
}
