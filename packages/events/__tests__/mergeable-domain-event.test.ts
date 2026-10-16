import { describe, it, expect } from "vitest";
import type { Event } from "~/event";
import type { MergeableEvent } from "~/mergeable-event";
import { isMergeableEvent } from "~/mergeable-event";

// ── Fixtures ──────────────────────────────────────────────────────────

interface ItemUpdatedPayload {
  itemId: string;
  name?: string;
  quantity?: number;
}

class ItemUpdatedEvent implements MergeableEvent<ItemUpdatedPayload> {
  readonly eventName = "item.updated";
  readonly occurredAt = new Date();
  readonly mergeKey: string;

  constructor(readonly payload: ItemUpdatedPayload) {
    this.mergeKey = `item.updated:${payload.itemId}`;
  }

  merge(
    other: MergeableEvent<ItemUpdatedPayload>,
  ): MergeableEvent<ItemUpdatedPayload> {
    return new ItemUpdatedEvent({
      ...this.payload,
      ...other.payload,
    });
  }
}

function createPlainEvent(): Event {
  return {
    eventName: "plain.event",
    occurredAt: new Date(),
    payload: { foo: "bar" },
  };
}

// ── Tests ─────────────────────────────────────────────────────────────

describe("isMergeableEvent", () => {
  it("should return true for an event with mergeKey and merge()", () => {
    const event = new ItemUpdatedEvent({ itemId: "1", name: "Apple" });
    expect(isMergeableEvent(event)).toBe(true);
  });

  it("should return false for a plain Event", () => {
    const event = createPlainEvent();
    expect(isMergeableEvent(event)).toBe(false);
  });

  it("should return false when mergeKey exists but merge is not a function", () => {
    const event = {
      ...createPlainEvent(),
      mergeKey: "k",
      merge: "not-a-function",
    };
    expect(isMergeableEvent(event as unknown as Event)).toBe(false);
  });
});

describe("MergeableEvent", () => {
  it("should produce a mergeKey that includes the event name and identity", () => {
    const event = new ItemUpdatedEvent({ itemId: "42", name: "Milk" });
    expect(event.mergeKey).toBe("item.updated:42");
  });

  it("should merge payloads preserving all fields", () => {
    const first = new ItemUpdatedEvent({ itemId: "1", name: "Apple" });
    const second = new ItemUpdatedEvent({ itemId: "1", quantity: 5 });

    const merged = first.merge(second);

    expect(merged.payload).toEqual({
      itemId: "1",
      name: "Apple",
      quantity: 5,
    });
  });

  it("should let later values override earlier ones on conflict", () => {
    const first = new ItemUpdatedEvent({ itemId: "1", name: "Apple" });
    const second = new ItemUpdatedEvent({ itemId: "1", name: "Banana" });

    const merged = first.merge(second);

    expect(merged.payload.name).toBe("Banana");
  });

  it("should return a new event instance (immutable)", () => {
    const first = new ItemUpdatedEvent({ itemId: "1", name: "Apple" });
    const second = new ItemUpdatedEvent({ itemId: "1", quantity: 3 });

    const merged = first.merge(second);

    expect(merged).not.toBe(first);
    expect(merged).not.toBe(second);
  });
});
