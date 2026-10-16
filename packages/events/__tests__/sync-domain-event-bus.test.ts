import { describe, it, expect, vi } from "vitest";
import { SyncEventBus } from "~/sync.event-bus";
import type { Event } from "~/event";
import type { EventHandler } from "~/event-handler";
import type { EventContext } from "~/event-context";

interface UserRegisteredPayload {
  userId: string;
  email: string;
}

type UserRegisteredEvent = Event<UserRegisteredPayload>;

function createEvent(payload: UserRegisteredPayload): UserRegisteredEvent {
  return {
    eventName: "user.registered",
    occurredAt: new Date(),
    payload,
  };
}

describe("SyncEventBus", () => {
  it("should call subscribed handler when event is published", async () => {
    const bus = new SyncEventBus();
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

  it("should pass context to handlers", async () => {
    const bus = new SyncEventBus();
    const handleFn = vi.fn();
    const handler: EventHandler<UserRegisteredEvent> = {
      handle: handleFn,
    };

    bus.subscribe("user.registered", handler);

    const event = createEvent({ userId: "u1", email: "a@b.com" });
    const context: EventContext = { session: "fake-session" };
    await bus.publish(event, context);

    expect(handleFn).toHaveBeenCalledWith(event, context);
  });

  it("should call multiple handlers in subscription order", async () => {
    const bus = new SyncEventBus();
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
    const bus = new SyncEventBus();
    const handleFn = vi.fn();
    const handler: EventHandler<UserRegisteredEvent> = {
      handle: handleFn,
    };

    bus.subscribe("user.deleted", handler);

    await bus.publish(createEvent({ userId: "u1", email: "a@b.com" }));

    expect(handleFn).not.toHaveBeenCalled();
  });

  it("should do nothing when no handlers are subscribed", async () => {
    const bus = new SyncEventBus();
    // Should not throw
    await bus.publish(createEvent({ userId: "u1", email: "a@b.com" }));
  });

  it("should propagate handler errors", async () => {
    const bus = new SyncEventBus();
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
    const bus = new SyncEventBus();
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
      const bus = new SyncEventBus();
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

    it("should pass context to all events", async () => {
      const bus = new SyncEventBus();
      const contexts: (EventContext | undefined)[] = [];

      const handler: EventHandler<UserRegisteredEvent> = {
        handle: async (_event, ctx) => {
          contexts.push(ctx);
        },
      };

      bus.subscribe("user.registered", handler);

      const context: EventContext = { session: "s1" };
      await bus.publishAll(
        [
          createEvent({ userId: "u1", email: "a@b.com" }),
          createEvent({ userId: "u2", email: "c@d.com" }),
        ],
        context,
      );

      expect(contexts).toEqual([context, context]);
    });
  });
});
