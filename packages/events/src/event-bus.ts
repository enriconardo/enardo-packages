import type { Event } from "./event";
import type { EventHandler } from "./event-handler";

/** The member(s) of `Events` that a handler subscribed under `Name` receives. */
export type EventNamed<
  Events extends Event,
  Name extends string,
> = Events extends Event
  ? Name extends Events["eventName"]
    ? Events
    : never
  : never;

/** `[context?: TContext]` when `undefined` is assignable to `TContext`, else `[context: TContext]`. */
export type ContextArgument<TContext> = undefined extends TContext
  ? [context?: TContext]
  : [context: TContext];

/**
 * Mediator that routes events to their registered handlers.
 *
 * @template Events   - The union of the events the bus carries.
 * @template TContext - The app's context, passed to every handler unchanged.
 *
 * The bus is meant to run after the commit, from the app's relay: a handler
 * opens its own transaction if it needs one and is idempotent, since delivery
 * is at least once. An app that puts its transaction in `TContext` and
 * publishes inside a unit of work's hook does it knowingly: handlers run
 * before the commit, run again if the transaction is retried, and a failing
 * handler rolls back the use case.
 */
export interface EventBus<Events extends Event = Event, TContext = undefined> {
  /**
   * Register a handler for a specific event name.
   */
  subscribe<Name extends Events["eventName"]>(
    eventName: Name,
    handler: EventHandler<EventNamed<Events, Name>, unknown, TContext>,
  ): void;

  /**
   * Dispatch a single event to all subscribed handlers (sequentially).
   */
  publish(event: Events, ...context: ContextArgument<TContext>): Promise<void>;

  /**
   * Dispatch multiple events to all subscribed handlers (sequentially).
   */
  publishAll(
    events: readonly Events[],
    ...context: ContextArgument<TContext>
  ): Promise<void>;
}
