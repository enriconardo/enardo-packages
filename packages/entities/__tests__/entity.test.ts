import { describe, expect, expectTypeOf, it } from "vitest";
import { Entity } from "~/entity";
import type { Equatable } from "~/equatable";
import { Id } from "~/id.vo";

// The type cases are enforced by `tsc --noEmit` (`pnpm typecheck`): `vitest
// run` erases the types. Each `@ts-expect-error` sits on the line the error
// is reported on, so that another error elsewhere does not satisfy it.

type UserId = Id<"User">;
type ProductId = Id<"Product">;

const tier: unique symbol = Symbol("tier");

interface UserAttributes {
  name: string;
  score: number;
  tags: string[];
  [tier]: string;
}

class User extends Entity<UserId, UserAttributes> {
  public constructor(id: UserId, attributes: UserAttributes) {
    super(id, attributes);
  }

  set<K extends keyof UserAttributes>(key: K, value: UserAttributes[K]): void {
    this.setAttribute(key, value);
  }

  change<K extends keyof UserAttributes>(
    values: Pick<UserAttributes, K>,
  ): void {
    this.setAttributes(values);
  }
}

// Another concrete class, on the same id type.
class Customer extends Entity<UserId, UserAttributes> {
  public constructor(id: UserId, attributes: UserAttributes) {
    super(id, attributes);
  }
}

// Records every mutation that reaches setAttributes.
class AuditedUser extends Entity<UserId, UserAttributes> {
  readonly seen: PropertyKey[][] = [];

  public constructor(id: UserId, attributes: UserAttributes) {
    super(id, attributes);
  }

  rename(name: string): void {
    this.setAttribute("name", name);
  }

  retag(tags: string[], score: number): void {
    this.setAttributes({ tags, score });
  }

  protected override setAttributes<K extends keyof UserAttributes>(
    values: Pick<UserAttributes, K>,
  ): void {
    this.seen.push(Reflect.ownKeys(values));
    super.setAttributes(values);
  }
}

// An id of the domain's own: equal case-insensitively.
class Email implements Equatable<Email> {
  constructor(readonly raw: string) {}

  equals(other: Email): boolean {
    return other.raw.toLowerCase() === this.raw.toLowerCase();
  }
}

class Account extends Entity<Email, { active: boolean }> {
  public constructor(id: Email, attributes: { active: boolean }) {
    super(id, attributes);
  }
}

function userAttributes(): UserAttributes {
  return { name: "Ada", score: 1, tags: ["a"], [tier]: "regular" };
}

function newUser(value = "u1"): User {
  return new User(Id.create<"User">(value), userAttributes());
}

describe("Entity construction", () => {
  it("returns the id passed, and a frozen copy of the attributes", () => {
    const id = Id.create<"User">("u1");
    const attributes = userAttributes();

    const user = new User(id, attributes);

    expect(user.id).toBe(id);
    expect(user.attributes).toStrictEqual(attributes);
    expect(user.attributes).not.toBe(attributes);
    expect(Object.isFrozen(user.attributes)).toBe(true);
  });

  it("keeps a symbol-keyed attribute in the copy", () => {
    expect(newUser().attributes[tier]).toBe("regular");
  });

  it("does not see a later change to a top-level key of the object passed", () => {
    const attributes = userAttributes();
    const user = new User(Id.create<"User">("u1"), attributes);

    attributes.name = "Grace";
    attributes.tags = ["b"];

    expect(user.attributes.name).toBe("Ada");
    expect(user.attributes.tags).toStrictEqual(["a"]);
  });

  it("has no own enumerable keys, and serializes to {}", () => {
    const user = newUser();

    expect(Object.keys(user)).toStrictEqual([]);
    expect(JSON.stringify(user)).toBe("{}");
  });

  it("is built with new through a subclass's public constructor", () => {
    const user = new User(Id.create<"User">("u1"), userAttributes());

    expect(user).toBeInstanceOf(User);
    expect(user).toBeInstanceOf(Entity);
    expect(user.attributes.name).toBe("Ada");
  });
});

describe("Entity.equals", () => {
  it("is true for the same instance", () => {
    const user = newUser();

    expect(user.equals(user)).toBe(true);
  });

  it("is true for the same class with an equal id", () => {
    const other = new User(Id.create<"User">("u1"), {
      ...userAttributes(),
      name: "Grace",
    });

    expect(newUser("u1").equals(other)).toBe(true);
  });

  it("is false for the same class with another id", () => {
    expect(newUser("u1").equals(newUser("u2"))).toBe(false);
  });

  it("is false for another class with an equal id", () => {
    const customer = new Customer(Id.create<"User">("u1"), userAttributes());

    expect(newUser("u1").equals(customer)).toBe(false);
  });

  it("is false for null, undefined and a plain object with the same id", () => {
    const user = newUser("u1");

    expect(user.equals(null)).toBe(false);
    expect(user.equals(undefined)).toBe(false);
    expect(user.equals({ id: user.id, attributes: user.attributes })).toBe(
      false,
    );
  });

  it("compares the ids with the TId's own equals", () => {
    const upper = new Account(new Email("ADA@example.com"), { active: true });
    const lower = new Account(new Email("ada@example.com"), { active: true });

    expect(upper.equals(lower)).toBe(true);
    expect(
      upper.equals(new Account(new Email("x@y.z"), { active: true })),
    ).toBe(false);
  });
});

describe("Entity.setAttribute and setAttributes", () => {
  it("setAttribute with a new value gives a new frozen snapshot, and leaves the previous one", () => {
    const user = newUser();
    const before = user.attributes;

    user.set("name", "Grace");

    expect(user.attributes.name).toBe("Grace");
    expect(user.attributes).not.toBe(before);
    expect(Object.isFrozen(user.attributes)).toBe(true);
    expect(before.name).toBe("Ada");
    expect(user.attributes.score).toBe(1);
    expect(user.attributes[tier]).toBe("regular");
  });

  it("setAttribute with an Object.is-equal value keeps the same snapshot", () => {
    const user = new User(Id.create<"User">("u1"), {
      ...userAttributes(),
      score: Number.NaN,
    });
    const before = user.attributes;

    user.set("name", "Ada");
    user.set("score", Number.NaN);

    expect(user.attributes).toBe(before);
  });

  it("setAttribute compares with Object.is, so -0 differs from 0", () => {
    const user = new User(Id.create<"User">("u1"), {
      ...userAttributes(),
      score: 0,
    });
    const before = user.attributes;

    user.set("score", -0);

    expect(user.attributes).not.toBe(before);
    expect(Object.is(user.attributes.score, -0)).toBe(true);
  });

  it("setAttributes with every value equal keeps the same snapshot", () => {
    const user = newUser();
    const before = user.attributes;

    user.change({ name: "Ada", tags: before.tags, [tier]: "regular" });

    expect(user.attributes).toBe(before);
  });

  it("setAttributes with two keys, one changed, gives one new snapshot holding both", () => {
    const user = newUser();
    const before = user.attributes;

    user.change({ name: "Grace", tags: before.tags });

    expect(user.attributes).not.toBe(before);
    expect(Object.isFrozen(user.attributes)).toBe(true);
    expect(user.attributes.name).toBe("Grace");
    expect(user.attributes.tags).toBe(before.tags);
    expect(before.name).toBe("Ada");
  });

  it("setAttributes changes a symbol-keyed attribute", () => {
    const user = newUser();
    const before = user.attributes;

    user.change({ [tier]: "vip" });

    expect(user.attributes[tier]).toBe("vip");
    expect(user.attributes).not.toBe(before);
    expect(before[tier]).toBe("regular");
  });

  it("lets a subclass overriding setAttributes see both setAttribute and setAttributes", () => {
    const user = new AuditedUser(Id.create<"User">("u1"), userAttributes());

    user.rename("Grace");
    user.retag(["b"], 2);

    expect(user.seen).toStrictEqual([["name"], ["tags", "score"]]);
    expect(user.attributes.name).toBe("Grace");
    expect(user.attributes.tags).toStrictEqual(["b"]);
    expect(user.attributes.score).toBe(2);
  });
});

describe("Entity types", () => {
  it("types id as the TId, kept apart from another brand", () => {
    const user = newUser();
    const takesProduct = (id: ProductId): string => id.value;

    expectTypeOf(user.id).toEqualTypeOf<UserId>();
    expectTypeOf(user.attributes).toEqualTypeOf<Readonly<UserAttributes>>();
    // @ts-expect-error TS2345: a UserId is not a ProductId
    const misuse = (): string => takesProduct(user.id);

    expect(misuse).toBeTypeOf("function");
  });

  it("refuses a TId with no equals", () => {
    // @ts-expect-error TS2344: a string is not Equatable
    const stringId: Entity<string, { a: number }> | undefined = undefined;

    expect(stringId).toBeUndefined();
  });

  it("refuses a construction with a required attribute missing", () => {
    // Checks Entity's own constructor: a subclass's would check its own
    // parameter type, whatever Entity's says.
    class Incomplete extends Entity<UserId, UserAttributes> {
      public constructor(id: UserId) {
        // @ts-expect-error TS2345: name, score and the tier are missing
        super(id, { tags: [] });
      }
    }

    expect(Incomplete).toBeTypeOf("function");
  });

  it("keeps the setters protected, and their keys within TAttributes", () => {
    class Strict extends Entity<UserId, UserAttributes> {
      public constructor(id: UserId, attributes: UserAttributes) {
        super(id, attributes);
      }

      setUnknown(): void {
        // @ts-expect-error TS2345: age is not an attribute
        this.setAttribute("age", 1);
      }
    }
    const user = new Strict(Id.create<"User">("u1"), userAttributes());
    const misuse = (): void => {
      // @ts-expect-error TS2445: setAttribute is protected
      user.setAttribute("name", "Grace");
      // @ts-expect-error TS2445: setAttributes is protected
      user.setAttributes({ name: "Grace" });
    };

    expect(misuse).toBeTypeOf("function");
    expect(user.attributes.name).toBe("Ada");
  });
});
