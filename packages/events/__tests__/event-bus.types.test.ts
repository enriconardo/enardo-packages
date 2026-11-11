import { describe, expectTypeOf, it } from "vitest";
import { SyncEventBus } from "~/index";
import type { Event, EventHandler, EventNamed } from "~/index";

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

describe("SyncEventBus", () => {
  describe("typed by an event union", () => {
    const bus = (): SyncEventBus<UserEvents> => new SyncEventBus<UserEvents>();

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
    const bus = (): SyncEventBus => new SyncEventBus();

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
});
