import { isBaseErrorLike } from "@enardo/errors";
import { describe, expect, expectTypeOf, it } from "vitest";
import type { Equatable } from "~/equatable";
import { InvalidEntityIdError } from "~/errors";
import { Id } from "~/id.vo";

type UserId = Id<"User">;
type ProductId = Id<"Product">;

function thrownBy(fn: () => unknown): unknown {
  try {
    fn();
  } catch (error) {
    return error;
  }
  throw new Error("expected the call to throw");
}

describe("Id.create", () => {
  it("gives the value through value, toString and JSON, frozen and with no own keys", () => {
    const id = Id.create<"User">("u1");

    expect(id.value).toBe("u1");
    expect(id.toString()).toBe("u1");
    expect(JSON.stringify(id)).toBe('"u1"');
    expect(Object.isFrozen(id)).toBe(true);
    expect(Object.keys(id)).toStrictEqual([]);
  });

  it("keeps the value as given, untrimmed", () => {
    expect(Id.create<"User">(" a ").value).toBe(" a ");
  });

  for (const blank of ["", "   "]) {
    it(`throws an InvalidEntityIdError on ${JSON.stringify(blank)}`, () => {
      const error = thrownBy(() => Id.create<"User">(blank));

      expect(error).toBeInstanceOf(InvalidEntityIdError);
      expect(isBaseErrorLike(error)).toBe(true);
      const invalid = error as InvalidEntityIdError;
      expect(invalid.code).toBe("INVALID_ENTITY_ID");
      expect(invalid.details).toStrictEqual({
        entityId: blank,
        reason: "empty",
      });
      expect(invalid.message).toBe("An entity id cannot be empty");
    });
  }
});

describe("Id.equals", () => {
  it("is true for another id of the same value", () => {
    expect(Id.create<"User">("u1").equals(Id.create<"User">("u1"))).toBe(true);
  });

  it("is false for another value", () => {
    expect(Id.create<"User">("u1").equals(Id.create<"User">("u2"))).toBe(false);
  });

  it("is false for null and undefined", () => {
    const id = Id.create<"User">("u1");

    expect(id.equals(null as unknown as UserId)).toBe(false);
    expect(id.equals(undefined as unknown as UserId)).toBe(false);
  });

  it("compares an id of a second copy of the package by value, without throwing", () => {
    // Another class with the same public shape: a #value read on it throws.
    class ForeignId {
      readonly #value: string;

      constructor(value: string) {
        this.#value = value;
      }

      get value(): string {
        return this.#value;
      }

      equals(other: ForeignId): boolean {
        return other.value === this.#value;
      }

      toString(): string {
        return this.#value;
      }

      toJSON(): string {
        return this.#value;
      }
    }
    const id = Id.create<"User">("u1");
    const foreign = new ForeignId("u1") as unknown as UserId;

    let result: unknown;
    expect(() => {
      result = id.equals(foreign);
    }).not.toThrow();
    expect(result).toBe(true);
  });
});

describe("Id types", () => {
  it("keeps the brand apart, and infers it from a typed target", () => {
    const user: UserId = Id.create("u1");

    expectTypeOf(Id.create<"User">("u1")).toEqualTypeOf<UserId>();
    const asEquatable: Equatable<UserId> = user;
    // @ts-expect-error an Id<"User"> is not an Id<"Product">
    const product: ProductId = user;

    expect(user.value).toBe("u1");
    expect(asEquatable).toBe(user);
    expect(product).toBe(user);
  });
});
