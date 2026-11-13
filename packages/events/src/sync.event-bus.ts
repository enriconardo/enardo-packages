import { EventHandlersFailedError } from "./event-handlers-failed.error";
import type { EventHandlerFailure } from "./event-handlers-failed.error";
import type { Event } from "./event";
import type { EventHandler } from "./event-handler";
import type { ContextArgument, EventBus, EventNamed } from "./event-bus";

/**
 * In-process, synchronous event bus.
 *
 * Handlers are executed sequentially, each awaited before the next. The
 * caller's `TContext` is passed to every handler unchanged; the bus never
 * reads it.
 *
 * A handler that throws or rejects does not stop the dispatch: every handler
 * of every event runs, then `publish` and `publishAll` reject with one
 * {@link EventHandlersFailedError} listing each failure, whose `cause` carries
 * the thrown values. Handlers' return values are ignored.
 *
 * A handler subscribed during a dispatch runs from the next dispatch on.
 *
 * Meant to run after the commit: see the README, _Where the bus runs_.
 *
 * @example
 * ```ts
 * const bus = new SyncEventBus();
 * bus.subscribe("user.registered", myHandler);
 * await bus.publish(event);
 * ```
 */
export class SyncEventBus<
  Events extends Event = Event,
  TContext = undefined,
> implements EventBus<Events, TContext> {
  private readonly handlers = new Map<
    string,
    EventHandler<Events, unknown, TContext>[]
  >();

  subscribe<Name extends Events["eventName"]>(
    eventName: Name,
    handler: EventHandler<EventNamed<Events, Name>, unknown, TContext>,
  ): void {
    const existing = this.handlers.get(eventName) ?? [];
    // Stored among the handlers of `Events` through the bivariance of `handle`.
    existing.push(handler);
    this.handlers.set(eventName, existing);
  }

  async publish(
    event: Events,
    ...context: ContextArgument<TContext>
  ): Promise<void> {
    // The tuple guarantees it: when the argument may be left out, `undefined` is a `TContext`.
    const ctx = context[0] as TContext;
    const failures = await this.dispatch(event, 0, ctx);
    throwIfFailed(failures);
  }

  async publishAll(
    events: readonly Events[],
    ...context: ContextArgument<TContext>
  ): Promise<void> {
    // The tuple guarantees it: when the argument may be left out, `undefined` is a `TContext`.
    const ctx = context[0] as TContext;
    const failures: Failure[] = [];

    for (const [index, event] of events.entries()) {
      failures.push(...(await this.dispatch(event, index, ctx)));
    }
    throwIfFailed(failures);
  }

  private async dispatch(
    event: Events,
    eventIndex: number,
    context: TContext,
  ): Promise<Failure[]> {
    // A copy: a handler subscribed while this dispatch runs waits for the next one.
    const handlers = [...(this.handlers.get(event.eventName) ?? [])];
    const failures: Failure[] = [];

    for (const [handlerIndex, handler] of handlers.entries()) {
      try {
        await handler.handle(event, context);
      } catch (error: unknown) {
        failures.push({
          eventIndex,
          eventName: event.eventName,
          handlerIndex,
          error,
        });
      }
    }
    return failures;
  }
}

type Failure = EventHandlerFailure & { readonly error: unknown };

function throwIfFailed(failures: Failure[]): void {
  const [first, ...rest] = failures;
  if (first !== undefined) {
    throw new EventHandlersFailedError([first, ...rest]);
  }
}
