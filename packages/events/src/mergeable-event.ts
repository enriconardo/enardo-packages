import type { Event } from "./event.js";

/**
 * An event that supports merging with another event of the same kind.
 *
 * When two mergeable events share the same {@link mergeKey}, the entity's
 * `addEvent` will call {@link merge} instead of queuing a duplicate.
 *
 * @template Payload - The shape of the event-specific data.
 *
 * @example
 * ```ts
 * class ProductUpdatedEvent implements MergeableEvent<ProductUpdatedPayload> {
 *   readonly eventName = "product.updated";
 *   readonly occurredAt = new Date();
 *   readonly mergeKey: string;
 *
 *   constructor(readonly payload: ProductUpdatedPayload) {
 *     this.mergeKey = `product.updated:${payload.productId}`;
 *   }
 *
 *   merge(other: ProductUpdatedEvent): ProductUpdatedEvent {
 *     return new ProductUpdatedEvent({ ...this.payload, ...other.payload });
 *   }
 * }
 * ```
 */
export interface MergeableEvent<Payload = unknown> extends Event<Payload> {
  /**
   * Key used to identify events that should be merged together.
   * Events sharing the same key are considered duplicates.
   */
  readonly mergeKey: string;

  /**
   * Return a new event that combines this event's payload with `other`'s.
   * The resulting event should reflect all changes from both events.
   */
  merge(other: MergeableEvent<Payload>): MergeableEvent<Payload>;
}

/**
 * Type guard that checks whether an {@link Event} implements
 * the {@link MergeableEvent} interface.
 */
export function isMergeableEvent(event: Event): event is MergeableEvent {
  return (
    "mergeKey" in event && typeof (event as MergeableEvent).merge === "function"
  );
}
