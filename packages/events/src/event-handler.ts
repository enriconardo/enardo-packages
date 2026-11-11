import type { Event } from "./event.js";

/**
 * Handles a specific type of event.
 *
 * @template EventType - The event type this handler processes.
 * @template Result    - Optional return value (defaults to `void`).
 * @template TContext  - The context the bus passes to `handle`, `undefined` by default.
 *
 * The bus is meant to run after the commit, from the app's relay: a handler
 * opens its own transaction if it needs one and is idempotent, since delivery
 * is at least once. An app that puts its transaction in `TContext` and
 * publishes inside a unit of work's hook does it knowingly: the handler then
 * runs before the commit, runs again if the transaction is retried, and a
 * throw rolls back the use case.
 */
export interface EventHandler<
  EventType extends Event = Event,
  Result = void,
  TContext = undefined,
> {
  handle(event: EventType, context: TContext): Promise<Result>;
}
