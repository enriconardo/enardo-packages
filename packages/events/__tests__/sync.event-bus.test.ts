import { describe, it, expect, vi } from "vitest";
import { SyncEventBus } from "~/sync.event-bus";
import type { Event } from "~/event";
import type { EventHandler } from "~/event-handler";

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

  it("should propagate handler errors", async () => {
    const bus = new SyncEventBus<UserEvents>();
    const handler: EventHandler<UserRegisteredEvent> = {
      handle: async () => {
        throw new Error("handler failed");
      },
    };

    bus.subscribe("user.registered", handler);

    await expect(
      bus.publish(createEvent({ userId: "u1", email: "a@b.com" })),
    ).rejects.toThrow("handler failed");
  });

  it("should stop at first handler error (no partial dispatch)", async () => {
    const bus = new SyncEventBus<UserEvents>();
    const secondHandlerFn = vi.fn();

    const handler1: EventHandler<UserRegisteredEvent> = {
      handle: async () => {
        throw new Error("first failed");
      },
    };
    const handler2: EventHandler<UserRegisteredEvent> = {
      handle: secondHandlerFn,
    };

    bus.subscribe("user.registered", handler1);
    bus.subscribe("user.registered", handler2);

    await expect(
      bus.publish(createEvent({ userId: "u1", email: "a@b.com" })),
    ).rejects.toThrow("first failed");
    expect(secondHandlerFn).not.toHaveBeenCalled();
  });

  describe("publishAll", () => {
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
