import { describe, expect, it } from "vitest";
import { EntityId } from "~/entity-id.vo";

describe("EntityId", () => {
  it("creates an id from a non-empty string", () => {
    const id = EntityId.create("abc-123");

    expect(id.value).toBe("abc-123");
  });

  it("rejects an empty string", () => {
    expect(() => EntityId.create("")).toThrow("EntityId cannot be empty");
  });

  it("rejects a whitespace-only string", () => {
    expect(() => EntityId.create("   \n\t")).toThrow(
      "EntityId cannot be empty",
    );
  });

  it("compares by value", () => {
    const first = EntityId.create("same");
    const second = EntityId.create("same");
    const third = EntityId.create("other");

    expect(first.equals(second)).toBe(true);
    expect(first.equals(third)).toBe(false);
  });

  it("serializes as the raw value", () => {
    const id = EntityId.create("json-id");

    expect(id.toString()).toBe("json-id");
    expect(id.toJSON()).toBe("json-id");
  });
});
