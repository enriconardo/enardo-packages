import { Entity } from "./entity";
import type { Equatable } from "./equatable";

/**
 * An entity that is the root of a consistency boundary. It queues the domain
 * events its methods `raise`; the base raises none itself.
 */
export abstract class AggregateRoot<
  TId extends Equatable<TId>,
  TAttributes extends object,
  TEvent = never,
> extends Entity<TId, TAttributes> {
  readonly #events: TEvent[] = [];

  protected constructor(id: TId, attributes: TAttributes) {
    super(id, attributes);
  }

  protected raise(event: TEvent): void {
    this.#events.push(event);
  }

  /** Returns the queued events in the order raised, and empties the queue. */
  pullEvents(): TEvent[] {
    return this.#events.splice(0);
  }

  clearEvents(): void {
    this.#events.length = 0;
  }
}
