import { describe, expect, it } from "vitest";
import { isBaseErrorLike } from "@enardo/errors";
import { EventHandlersFailedError } from "~/index";

describe("EventHandlersFailedError", () => {
  const thrown = new Error("first failed");
  const boom: unknown = "boom";

  const create = (): EventHandlersFailedError =>
    new EventHandlersFailedError([
      {
        eventIndex: 0,
        eventId: "event-1",
        eventName: "user.registered",
        handlerIndex: 0,
        error: thrown,
      },
      {
        eventIndex: 1,
        eventId: "event-2",
        eventName: "user.deleted",
        handlerIndex: 2,
        error: boom,
      },
    ]);

  it("is a BaseError named EventHandlersFailedError, with its code", () => {
    const error = create();

    expect(error.name).toBe("EventHandlersFailedError");
    expect(isBaseErrorLike(error)).toBe(true);
    expect(error.code).toBe("EVENT_HANDLERS_FAILED");
  });

  it("lists the failures by indexes and names, without the thrown values", () => {
    const error = create();

    expect(error.details).toEqual({
      failures: [
        {
          eventIndex: 0,
          eventId: "event-1",
          eventName: "user.registered",
          handlerIndex: 0,
        },
        {
          eventIndex: 1,
          eventId: "event-2",
          eventName: "user.deleted",
          handlerIndex: 2,
        },
      ],
    });
    expect(error.message).toBe(
      "Event handlers failed: #0 user.registered[0], #1 user.deleted[2]",
    );
    expect(error.message).not.toContain("first failed");
    expect(error.message).not.toContain("boom");
  });

  it("carries the thrown values, as they are, in an AggregateError cause", () => {
    const error = create();

    expect(error.cause).toBeInstanceOf(AggregateError);
    const cause = error.cause as AggregateError;
    expect(cause.message).toBe("Errors thrown by the event handlers");
    expect(cause.errors).toHaveLength(2);
    expect(cause.errors[0]).toBe(thrown);
    expect(cause.errors[1]).toBe("boom");
  });

  it("serializes its code, details and cause in toJSON()", () => {
    const error = create();
    const cause = error.cause as AggregateError;

    expect(error.toJSON()).toMatchObject({
      name: "EventHandlersFailedError",
      code: "EVENT_HANDLERS_FAILED",
      details: {
        failures: [
          {
            eventIndex: 0,
            eventId: "event-1",
            eventName: "user.registered",
            handlerIndex: 0,
          },
          {
            eventIndex: 1,
            eventId: "event-2",
            eventName: "user.deleted",
            handlerIndex: 2,
          },
        ],
      },
      cause: {
        name: "AggregateError",
        message: "Errors thrown by the event handlers",
        stack: cause.stack,
        errors: [
          { name: "Error", message: "first failed", stack: thrown.stack },
          "boom",
        ],
      },
    });
  });
});
