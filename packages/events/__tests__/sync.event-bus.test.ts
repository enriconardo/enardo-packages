import { describe, it, expect, vi } from "vitest";
import { isBaseErrorLike } from "@enardo/errors";
import { SyncEventBus } from "~/sync.event-bus";
import type { Event } from "~/event";
import type { EventHandler } from "~/event-handler";
import { EventHandlersFailedError } from "~/index";

/** What `promise` rejects with; fails the test if it resolves. */
async function rejectionOf(promise: Promise<unknown>): Promise<unknown> {
  return promise.then(
    () => expect.fail("expected the promise to reject"),
    (error: unknown) => error,
  );
}

/** Both handlers of "user.registered" failed: `thrown`, then "boom". */
function expectBothHandlersFailed(error: unknown, thrown: Error): void {
  expect(error).toBeInstanceOf(EventHandlersFailedError);
  const failed = error as EventHandlersFailedError;
  expect(failed.details).toEqual({
    failures: [
      { eventIndex: 0, eventName: "user.registered", handlerIndex: 0 },
      { eventIndex: 0, eventName: "user.registered", handlerIndex: 1 },
    ],
  });
  const cause = failed.cause as AggregateError;
  expect(cause.errors).toHaveLength(2);
  expect(cause.errors[0]).toBe(thrown);
  expect(cause.errors[1]).toBe("boom");
  expect(failed.message).toBe(
    "Event handlers failed: #0 user.registered[0], #0 user.registered[1]",
  );
  expect(failed.message).not.toContain("first failed");
  expect(failed.message).not.toContain("boom");
}

interface UserRegisteredPayload {
  userId: string;
  email: string;
}

type UserRegisteredEvent = Event<UserRegisteredPayload, "user.registered">;
type UserDeletedEvent = Event<{ userId: string }, "user.deleted">;
type UserEvents = UserRegisteredEvent | UserDeletedEvent;

interface AppContext {
  correlationId: string;
}

function createEvent(payload: UserRegisteredPayload): UserRegisteredEvent {
  return {
    eventName: "user.registered",
    occurredAt: new Date(),
    payload,
  };
}

describe("SyncEventBus", () => {
  it("should call subscribed handler when event is published", async () => {
    const bus = new SyncEventBus<UserEvents>();
    const handleFn = vi.fn();
    const handler: EventHandler<UserRegisteredEvent> = {
      handle: handleFn,
    };

    bus.subscribe("user.registered", handler);

    const event = createEvent({ userId: "u1", email: "a@b.com" });
    await bus.publish(event);

    expect(handleFn).toHaveBeenCalledOnce();
    expect(handleFn).toHaveBeenCalledWith(event, undefined);
  });

  it("should pass the caller's context to handlers as the same reference", async () => {
    const bus = new SyncEventBus<UserEvents, AppContext>();
    const handleFn =
      vi.fn<(event: UserEvents, context: AppContext) => Promise<void>>();
    const handler: EventHandler<UserRegisteredEvent, void, AppContext> = {
      handle: handleFn,
    };

    bus.subscribe("user.registered", handler);

    const event = createEvent({ userId: "u1", email: "a@b.com" });
    const context: AppContext = { correlationId: "c1" };
    await bus.publish(event, context);

    expect(handleFn).toHaveBeenCalledOnce();
    expect(handleFn.mock.calls[0]?.[0]).toBe(event);
    expect(handleFn.mock.calls[0]?.[1]).toBe(context);
  });

  it("should call multiple handlers in subscription order", async () => {
    const bus = new SyncEventBus<UserEvents>();
    const order: number[] = [];

    const handler1: EventHandler<UserRegisteredEvent> = {
      handle: async () => {
        order.push(1);
      },
    };
    const handler2: EventHandler<UserRegisteredEvent> = {
      handle: async () => {
        order.push(2);
      },
    };

    bus.subscribe("user.registered", handler1);
    bus.subscribe("user.registered", handler2);

    await bus.publish(createEvent({ userId: "u1", email: "a@b.com" }));

    expect(order).toEqual([1, 2]);
  });

  it("should not call handlers for different event names", async () => {
    const bus = new SyncEventBus<UserEvents>();
    const handleFn = vi.fn();
    const handler: EventHandler<UserDeletedEvent> = {
      handle: handleFn,
    };

    bus.subscribe("user.deleted", handler);

    await bus.publish(createEvent({ userId: "u1", email: "a@b.com" }));

    expect(handleFn).not.toHaveBeenCalled();
  });

  it("should do nothing when no handlers are subscribed", async () => {
    const bus = new SyncEventBus<UserEvents>();

    await expect(
      bus.publish(createEvent({ userId: "u1", email: "a@b.com" })),
    ).resolves.toBeUndefined();
  });

  it("should start a handler after the previous one's promise settles", async () => {
    const bus = new SyncEventBus<UserEvents>();
    const steps: string[] = [];

    bus.subscribe("user.registered", {
      handle: async () => {
        steps.push("first started");
        await new Promise((resolve) => setTimeout(resolve, 10));
        steps.push("first settled");
      },
    });
    bus.subscribe("user.registered", {
      handle: async () => {
        steps.push("second started");
      },
    });

    await bus.publish(createEvent({ userId: "u1", email: "a@b.com" }));

    expect(steps).toEqual(["first started", "first settled", "second started"]);
  });

  describe("when handlers throw", () => {
    it("should run the next handler, then reject with one EventHandlersFailedError", async () => {
      const bus = new SyncEventBus<UserEvents>();
      const thrown = new Error("first failed");
      const secondHandlerFn = vi.fn();

      bus.subscribe("user.registered", {
        handle: () => {
          throw thrown;
        },
      });
      bus.subscribe("user.registered", { handle: secondHandlerFn });

      const error = await rejectionOf(
        bus.publish(createEvent({ userId: "u1", email: "a@b.com" })),
      );

      expect(secondHandlerFn).toHaveBeenCalledOnce();
      expect(error).toBeInstanceOf(EventHandlersFailedError);
      expect(isBaseErrorLike(error)).toBe(true);
      const failed = error as EventHandlersFailedError;
      expect(failed.code).toBe("EVENT_HANDLERS_FAILED");
      expect(failed.details).toEqual({
        failures: [
          { eventIndex: 0, eventName: "user.registered", handlerIndex: 0 },
        ],
      });
      expect(failed.cause).toBeInstanceOf(AggregateError);
      const cause = failed.cause as AggregateError;
      expect(cause.errors).toHaveLength(1);
      expect(cause.errors[0]).toBe(thrown);
    });

    it("should report every handler that threw, a non-Error value as it is", async () => {
      const bus = new SyncEventBus<UserEvents>();
      const thrown = new Error("first failed");

      bus.subscribe("user.registered", {
        handle: () => {
          throw thrown;
        },
      });
      bus.subscribe("user.registered", {
        handle: () => {
          const boom: unknown = "boom";
          throw boom;
        },
      });

      const error = await rejectionOf(
        bus.publish(createEvent({ userId: "u1", email: "a@b.com" })),
      );

      expectBothHandlersFailed(error, thrown);
    });

    it("should treat a handler that rejects asynchronously like one that throws", async () => {
      const bus = new SyncEventBus<UserEvents>();
      const thrown = new Error("first failed");

      bus.subscribe("user.registered", {
        handle: async () => {
          await Promise.resolve();
          throw thrown;
        },
      });
      bus.subscribe("user.registered", {
        handle: async () => {
          await Promise.resolve();
          const boom: unknown = "boom";
          throw boom;
        },
      });

      const error = await rejectionOf(
        bus.publish(createEvent({ userId: "u1", email: "a@b.com" })),
      );

      expectBothHandlersFailed(error, thrown);
    });
  });

  describe("publishAll", () => {
    it("should dispatch the next event when a handler fails on the first", async () => {
      const bus = new SyncEventBus<UserEvents>();
      const received: string[] = [];

      bus.subscribe("user.registered", {
        handle: async (event) => {
          received.push(event.payload.userId);
          if (event.payload.userId === "u1") {
            throw new Error("failed on u1");
          }
        },
      });

      const error = await rejectionOf(
        bus.publishAll([
          createEvent({ userId: "u1", email: "a@b.com" }),
          createEvent({ userId: "u2", email: "c@d.com" }),
        ]),
      );

      expect(received).toEqual(["u1", "u2"]);
      expect(error).toBeInstanceOf(EventHandlersFailedError);
      expect((error as EventHandlersFailedError).details).toEqual({
        failures: [
          { eventIndex: 0, eventName: "user.registered", handlerIndex: 0 },
        ],
      });
    });

    it("should report the failures of every event, with their indexes", async () => {
      const bus = new SyncEventBus<UserEvents>();
      const first = new Error("failed on u1");
      const second = new Error("failed on u2");

      bus.subscribe("user.registered", {
        handle: async (event) => {
          throw event.payload.userId === "u1" ? first : second;
        },
      });

      const error = await rejectionOf(
        bus.publishAll([
          createEvent({ userId: "u1", email: "a@b.com" }),
          createEvent({ userId: "u2", email: "c@d.com" }),
        ]),
      );

      expect(error).toBeInstanceOf(EventHandlersFailedError);
      const failed = error as EventHandlersFailedError;
      expect(failed.details).toEqual({
        failures: [
          { eventIndex: 0, eventName: "user.registered", handlerIndex: 0 },
          { eventIndex: 1, eventName: "user.registered", handlerIndex: 0 },
        ],
      });
      expect(failed.message).toBe(
        "Event handlers failed: #0 user.registered[0], #1 user.registered[0]",
      );
      const cause = failed.cause as AggregateError;
      expect(cause.errors).toHaveLength(2);
      expect(cause.errors[0]).toBe(first);
      expect(cause.errors[1]).toBe(second);
    });

    it("should publish multiple events sequentially", async () => {
      const bus = new SyncEventBus<UserEvents>();
      const receivedPayloads: string[] = [];

      const handler: EventHandler<UserRegisteredEvent> = {
        handle: async (event) => {
          receivedPayloads.push(event.payload.userId);
        },
      };

      bus.subscribe("user.registered", handler);

      const events = [
        createEvent({ userId: "u1", email: "a@b.com" }),
        createEvent({ userId: "u2", email: "c@d.com" }),
      ];

      await bus.publishAll(events);

      expect(receivedPayloads).toEqual(["u1", "u2"]);
    });

    it("should pass the same context to every handler of every event, in array order", async () => {
      const bus = new SyncEventBus<UserEvents, AppContext>();
      const calls: { step: string; context: AppContext }[] = [];

      bus.subscribe("user.registered", {
        handle: async (event, context) => {
          calls.push({ step: `registered#1 ${event.payload.userId}`, context });
        },
      });
      bus.subscribe("user.registered", {
        handle: async (event, context) => {
          calls.push({ step: `registered#2 ${event.payload.userId}`, context });
        },
      });
      bus.subscribe("user.deleted", {
        handle: async (event, context) => {
          calls.push({ step: `deleted ${event.payload.userId}`, context });
        },
      });

      const context: AppContext = { correlationId: "c1" };
      const deleted: UserDeletedEvent = {
        eventName: "user.deleted",
        occurredAt: new Date(),
        payload: { userId: "u2" },
      };
      await bus.publishAll(
        [
          createEvent({ userId: "u1", email: "a@b.com" }),
          deleted,
          createEvent({ userId: "u3", email: "c@d.com" }),
        ],
        context,
      );

      expect(calls.map((call) => call.step)).toEqual([
        "registered#1 u1",
        "registered#2 u1",
        "deleted u2",
        "registered#1 u3",
        "registered#2 u3",
      ]);
      for (const call of calls) {
        expect(call.context).toBe(context);
      }
    });
  });
});
