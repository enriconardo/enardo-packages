import { describe, expect, expectTypeOf, it } from "vitest";
import { SequentialEventBus } from "~/index";
import * as entry from "~/index";
import type { Event, EventBus, EventHandler, EventNamed } from "~/index";

// These tests are enforced by `tsc --noEmit` (`pnpm typecheck`): `vitest run`
// erases the types. The calls sit in functions that are never called, so
// that only their types are checked, not the bus's behavior.

type UserRegistered = Event<
  { userId: string; email: string },
  "user.registered"
>;
type UserDeleted = Event<{ userId: string }, "user.deleted">;
type UserRenamed = Event<{ userId: string; name: string }, "user.renamed">;
type UserEvents = UserRegistered | UserDeleted;

declare const userRegistered: UserRegistered;
declare const userRenamed: UserRenamed;
declare const anyEvent: Event;
declare const userRegisteredHandler: EventHandler<UserRegistered>;
declare const handlerOfEvent: EventHandler<Event>;

describe("Event", () => {
  it("types eventName as its Name", () => {
    expectTypeOf<
      Event<{ id: string }, "user.registered">["eventName"]
    >().toEqualTypeOf<"user.registered">();
  });

  it("types eventName as a string by default", () => {
    expectTypeOf<Event<{ id: string }>["eventName"]>().toEqualTypeOf<string>();
  });

  it("types eventId as a string", () => {
    expectTypeOf<
      Event<{ id: string }, "user.registered">["eventId"]
    >().toEqualTypeOf<string>();
  });

  it("requires eventId", () => {
    void (() => {
      // @ts-expect-error eventId is required
      const event: Event<{ id: string }, "user.registered"> = {
        eventName: "user.registered",
        occurredAt: new Date(),
        payload: { id: "1" },
      };
      return event;
    });
  });

  it("types occurredAt as a Date", () => {
    expectTypeOf<
      Event<{ id: string }, "user.registered">["occurredAt"]
    >().toEqualTypeOf<Date>();
  });
});

describe("EventHandler", () => {
  interface AppContext {
    correlationId: string;
  }

  it("takes the context as its second type parameter", () => {
    expectTypeOf<
      EventHandler<UserRegistered, AppContext>["handle"]
    >().parameters.toEqualTypeOf<[UserRegistered, AppContext]>();
  });

  it("gives handle an undefined context by default", () => {
    expectTypeOf<EventHandler<UserRegistered>["handle"]>()
      .parameter(1)
      .toEqualTypeOf<undefined>();
  });
});

describe("EventNamed", () => {
  it("picks the member of a union by its name", () => {
    expectTypeOf<
      EventNamed<UserEvents, "user.registered">
    >().toEqualTypeOf<UserRegistered>();
  });

  it("keeps a member whose eventName is a string", () => {
    expectTypeOf<EventNamed<Event, "anything">>().toEqualTypeOf<Event>();
  });
});

describe("SequentialEventBus", () => {
  describe("typed by an event union", () => {
    const bus = (): SequentialEventBus<UserEvents> =>
      new SequentialEventBus<UserEvents>();

    it("rejects a name outside the union", () => {
      void (() => {
        // @ts-expect-error "user.renamed" is not a name of UserEvents
        bus().subscribe("user.renamed", handlerOfEvent);
      });
    });

    it("rejects a handler of another event", () => {
      void (() => {
        // @ts-expect-error a handler of UserRegistered under "user.deleted"
        bus().subscribe("user.deleted", userRegisteredHandler);
      });
    });

    it("gives the handler the event of its name", () => {
      void (() => {
        bus().subscribe("user.registered", {
          handle: async (event) => {
            expectTypeOf(event).toEqualTypeOf<UserRegistered>();
          },
        });
      });
    });

    it("accepts a handler of every event", () => {
      void (() => {
        bus().subscribe("user.registered", handlerOfEvent);
      });
    });

    it("rejects publishing an event outside the union", () => {
      void (async () => {
        await bus().publish(userRegistered);
        // @ts-expect-error UserRenamed is not a member of UserEvents
        await bus().publish(userRenamed);
        // @ts-expect-error UserRenamed is not a member of UserEvents
        await bus().publishAll([userRegistered, userRenamed]);
      });
    });
  });

  describe("by default", () => {
    const bus = (): SequentialEventBus => new SequentialEventBus();

    it("accepts any name and a handler of every event", () => {
      void (() => {
        bus().subscribe("anything", handlerOfEvent);
      });
    });

    it("accepts publishing any event", () => {
      void (async () => {
        await bus().publish(anyEvent);
        await bus().publishAll([anyEvent, userRenamed]);
      });
    });
  });

  describe("with an app-typed context", () => {
    interface AppContext {
      correlationId: string;
    }
    const bus = (): SequentialEventBus<UserEvents, AppContext> =>
      new SequentialEventBus<UserEvents, AppContext>();
    const correlationId = "c1";
    const appContextHandler = {} as EventHandler<UserRegistered, AppContext>;

    it("requires the context on publish and publishAll", () => {
      void (async () => {
        // @ts-expect-error the context is required by AppContext
        await bus().publish(userRegistered);
        // @ts-expect-error the context is required by AppContext
        await bus().publishAll([userRegistered]);
      });
    });

    it("accepts the context on publish and publishAll", () => {
      void (async () => {
        await bus().publish(userRegistered, { correlationId });
        await bus().publishAll([userRegistered], { correlationId });
      });
    });

    it("gives the handler the context's type", () => {
      void (() => {
        bus().subscribe("user.registered", {
          handle: async (_event, context) => {
            expectTypeOf(context).toEqualTypeOf<AppContext>();
          },
        });
      });
    });

    it("accepts a handler that declares the context", () => {
      void (() => {
        bus().subscribe("user.registered", appContextHandler);
      });
    });

    it("rejects a handler whose context is undefined", () => {
      void (() => {
        // @ts-expect-error the handler's context is undefined, not AppContext
        bus().subscribe("user.registered", userRegisteredHandler);
      });
    });

    it("accepts a handler whose handle resolves to a value", () => {
      void (() => {
        bus().subscribe("user.registered", { handle: async () => 1 });
      });
    });
  });

  describe("with the default context", () => {
    const bus = (): SequentialEventBus<UserEvents> =>
      new SequentialEventBus<UserEvents>();

    it("accepts publish without a context", () => {
      void (async () => {
        await bus().publish(userRegistered);
        await bus().publishAll([userRegistered]);
      });
    });

    it("rejects a context", () => {
      void (async () => {
        // @ts-expect-error the default context is undefined
        await bus().publish(userRegistered, {});
        // @ts-expect-error the default context is undefined
        await bus().publishAll([userRegistered], {});
      });
    });

    it("gives the handler an undefined context", () => {
      void (() => {
        bus().subscribe("user.registered", {
          handle: async (_event, context) => {
            expectTypeOf(context).toEqualTypeOf<undefined>();
          },
        });
      });
    });
  });
});

// The class alone would not prove these: `SequentialEventBus` still satisfies an
// `EventBus` whose `publish` takes any `Event` and an optional context, or
// whose `subscribe` takes a handler of any context, through method
// bivariance. These calls go through the interface.
describe("EventBus", () => {
  describe("typed by an event union", () => {
    const bus = (): EventBus<UserEvents> =>
      new SequentialEventBus<UserEvents>();

    it("rejects a name outside the union", () => {
      void (() => {
        // @ts-expect-error "user.renamed" is not a name of UserEvents
        bus().subscribe("user.renamed", handlerOfEvent);
      });
    });

    it("rejects a handler of another event", () => {
      void (() => {
        // @ts-expect-error a handler of UserRegistered under "user.deleted"
        bus().subscribe("user.deleted", userRegisteredHandler);
      });
    });

    it("gives the handler the event of its name", () => {
      void (() => {
        bus().subscribe("user.registered", {
          handle: async (event) => {
            expectTypeOf(event).toEqualTypeOf<UserRegistered>();
          },
        });
      });
    });

    it("accepts a handler of every event", () => {
      void (() => {
        bus().subscribe("user.registered", handlerOfEvent);
      });
    });

    it("rejects publishing an event outside the union", () => {
      void (async () => {
        await bus().publish(userRegistered);
        // @ts-expect-error UserRenamed is not a member of UserEvents
        await bus().publish(userRenamed);
        // @ts-expect-error UserRenamed is not a member of UserEvents
        await bus().publishAll([userRenamed]);
      });
    });
  });

  describe("with an app-typed context", () => {
    interface AppContext {
      correlationId: string;
    }
    const bus = (): EventBus<UserEvents, AppContext> =>
      new SequentialEventBus<UserEvents, AppContext>();
    const correlationId = "c1";
    const appContextHandler = {} as EventHandler<UserRegistered, AppContext>;

    it("requires the context on publish and publishAll", () => {
      void (async () => {
        // @ts-expect-error the context is required by AppContext
        await bus().publish(userRegistered);
        // @ts-expect-error the context is required by AppContext
        await bus().publishAll([userRegistered]);
      });
    });

    it("accepts the context on publish and publishAll", () => {
      void (async () => {
        await bus().publish(userRegistered, { correlationId });
        await bus().publishAll([userRegistered], { correlationId });
      });
    });

    it("gives the handler the context's type", () => {
      void (() => {
        bus().subscribe("user.registered", {
          handle: async (_event, context) => {
            expectTypeOf(context).toEqualTypeOf<AppContext>();
          },
        });
      });
    });

    it("accepts a handler that declares the context", () => {
      void (() => {
        bus().subscribe("user.registered", appContextHandler);
      });
    });

    it("rejects a handler whose context is undefined", () => {
      void (() => {
        // @ts-expect-error the handler's context is undefined, not AppContext
        bus().subscribe("user.registered", userRegisteredHandler);
      });
    });

    it("accepts a handler whose handle resolves to a value", () => {
      void (() => {
        bus().subscribe("user.registered", { handle: async () => 1 });
      });
    });
  });

  describe("with the default context", () => {
    const bus = (): EventBus<UserEvents> =>
      new SequentialEventBus<UserEvents>();

    it("accepts publish without a context", () => {
      void (async () => {
        await bus().publish(userRegistered);
        await bus().publishAll([userRegistered]);
      });
    });

    it("rejects a context", () => {
      void (async () => {
        // @ts-expect-error the default context is undefined
        await bus().publish(userRegistered, {});
        // @ts-expect-error the default context is undefined
        await bus().publishAll([userRegistered], {});
      });
    });

    it("gives the handler an undefined context", () => {
      void (() => {
        bus().subscribe("user.registered", {
          handle: async (_event, context) => {
            expectTypeOf(context).toEqualTypeOf<undefined>();
          },
        });
      });
    });
  });
});

describe("the package's entry", () => {
  it("exports SequentialEventBus and no longer SyncEventBus", () => {
    expect(entry).toHaveProperty("SequentialEventBus");
    expect(entry).not.toHaveProperty("SyncEventBus");
    expectTypeOf(entry).toHaveProperty("SequentialEventBus");
    expectTypeOf(entry).not.toHaveProperty("SyncEventBus");
  });
});
