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
 * Meant to run after the commit: see the README, _Where the bus runs_.
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
