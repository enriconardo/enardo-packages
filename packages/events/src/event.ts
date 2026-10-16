/**
 * Base interface for all events.
 *
 * @template Payload - The shape of the event-specific data.
 */
export interface Event<Payload = unknown> {
  /** Unique event identifier (e.g. `"user.registered"`) */
  readonly eventName: string;
  /** When the event occurred */
  readonly occurredAt: Date;
  /** Event-specific data */
  readonly payload: Payload;
}
