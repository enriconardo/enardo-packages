import { BaseError } from "@enardo/errors";

/** One handler that threw during a dispatch. */
export interface EventHandlerFailure {
  /** The event's index in `publishAll`'s array; 0 for `publish`. */
  readonly eventIndex: number;
  /** The `eventId` of the event whose handler threw. */
  readonly eventId: string;
  readonly eventName: string;
  /** The handler's position among the handlers of `eventName`, in subscription order. */
  readonly handlerIndex: number;
}

/** The `details` of an {@link EventHandlersFailedError}. */
export interface EventHandlersFailedDetails extends Record<string, unknown> {
  /** Each handler that threw, in the order it ran. */
  readonly failures: readonly EventHandlerFailure[];
}

/**
 * Thrown by a dispatch after every handler ran, when at least one threw.
 *
 * `details.failures` hold indexes, names and each event's `eventId` (an id is
 * no personal data); `message` holds indexes and names only. Neither holds a
 * payload or a thrown message: the thrown values may carry personal data, so
 * they are in the `cause`, an `AggregateError` at the same positions as
 * `details.failures`, for whoever logs the error.
 */
export class EventHandlersFailedError extends BaseError {
  override readonly name = "EventHandlersFailedError";
  declare readonly code: "EVENT_HANDLERS_FAILED";
  declare readonly details: EventHandlersFailedDetails;

  /** Each failure with the value its handler threw, in the order the handlers ran. */
  constructor(
    failures: readonly [
      EventHandlerFailure & { readonly error: unknown },
      ...(EventHandlerFailure & { readonly error: unknown })[],
    ],
  ) {
    const listed = failures.map(
      ({ eventIndex, eventId, eventName, handlerIndex }) => ({
        eventIndex,
        eventId,
        eventName,
        handlerIndex,
      }),
    );
    const message = `Event handlers failed: ${listed
      .map((f) => `#${f.eventIndex} ${f.eventName}[${f.handlerIndex}]`)
      .join(", ")}`;
    super(message, {
      code: "EVENT_HANDLERS_FAILED",
      details: { failures: listed },
      cause: new AggregateError(
        failures.map((f) => f.error),
        "Errors thrown by the event handlers",
      ),
    });
  }
}
