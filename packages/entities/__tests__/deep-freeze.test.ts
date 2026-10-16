import { describe, expect, it } from "vitest";
import { deepFreeze } from "~/utils";

describe("deepFreeze", () => {
  it("deeply freezes nested plain objects", () => {
    const value = {
      user: {
        name: "Ada",
      },
      tags: ["a", "b"],
    };

    const frozen = deepFreeze(value);

    expect(Object.isFrozen(frozen)).toBe(true);
    expect(Object.isFrozen(frozen.user)).toBe(true);
    expect(Object.isFrozen(frozen.tags)).toBe(true);
  });

  it("freezes map keys and values", () => {
    const key = { id: 1 };
    const nested = { value: "x" };
    const map = new Map<object, object>([[key, nested]]);

    deepFreeze(map);

    expect(Object.isFrozen(map)).toBe(true);
    expect(Object.isFrozen(key)).toBe(true);
    expect(Object.isFrozen(nested)).toBe(true);
  });

  it("freezes set entries", () => {
    const entry = { id: 1 };
    const set = new Set<object>([entry]);

    deepFreeze(set);

    expect(Object.isFrozen(set)).toBe(true);
    expect(Object.isFrozen(entry)).toBe(true);
  });

  it("handles circular references without throwing", () => {
    const root: Record<string, unknown> = {};
    root.self = root;
    root.child = { parent: root };

    expect(() => deepFreeze(root)).not.toThrow();
    expect(Object.isFrozen(root)).toBe(true);
    expect(Object.isFrozen(root.child)).toBe(true);
  });
});
