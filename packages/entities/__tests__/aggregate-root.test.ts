import { isBaseErrorLike } from "@enardo/errors";
import { describe, expect, it } from "vitest";
import type { AggregateRootCommonAttributes } from "~/aggregate-root";
import { AggregateRoot } from "~/aggregate-root";
import { EntityId } from "~/entity-id.vo";

interface UserAttributes extends AggregateRootCommonAttributes {
  name: string;
  email: string;
}

class UserAggregate extends AggregateRoot<UserAttributes> {
  private readonly _modelName = "user";

  protected get modelName(): string {
    return this._modelName;
  }

  rename(name: string): void {
    this.setAttribute("name", name);
  }

  updateProfile(data: Pick<UserAttributes, "name" | "email">): void {
    this.setAttributes(data);
  }
}

class ProtectedCtorUserAggregate extends AggregateRoot<UserAttributes> {
  private readonly _modelName = "user";

  protected constructor(attributes: UserAttributes) {
    super(attributes);
  }

  protected get modelName(): string {
    return this._modelName;
  }
}

class PrivateCtorUserAggregate extends AggregateRoot<UserAttributes> {
  private readonly _modelName = "user";

  private constructor(attributes: UserAttributes) {
    super(attributes);
  }

  protected get modelName(): string {
    return this._modelName;
  }
}

describe("AggregateRoot", () => {
  it("queues a created event on create", () => {
    const aggregate = UserAggregate.create<UserAttributes, UserAggregate>({
      id: EntityId.create("user-1"),
      name: "Ada",
      email: "ada@example.com",
      createdAt: new Date(),
      updatedAt: new Date(),
    });

    const events = aggregate.pullEvents();

    expect(events).toHaveLength(1);
    expect(events[0]?.eventName).toBe("user.created");
  });

  it("queues a deleted event on markForRemoval", () => {
    const aggregate = UserAggregate.rehydrate<UserAttributes, UserAggregate>({
      id: EntityId.create("user-1"),
      name: "Ada",
      email: "ada@example.com",
      createdAt: new Date(),
      updatedAt: new Date(),
    });

    aggregate.markForRemoval("duplicate");

    const events = aggregate.pullEvents();

    expect(aggregate.isMarkedForRemoval()).toBe(true);
    expect(events).toHaveLength(1);
    expect(events[0]?.eventName).toBe("user.deleted");
  });

  it("updates updatedAt when setAttribute changes a value", () => {
    const before = new Date("2026-01-01T00:00:00.000Z");
    const aggregate = UserAggregate.rehydrate<UserAttributes, UserAggregate>({
      id: EntityId.create("user-1"),
      name: "Ada",
      email: "ada@example.com",
      createdAt: new Date("2026-01-01T00:00:00.000Z"),
      updatedAt: before,
    });

    aggregate.rename("Grace");

    expect(aggregate.updatedAt).toBeDefined();
    expect(aggregate.updatedAt!.getTime()).toBeGreaterThanOrEqual(
      before.getTime(),
    );
  });

  it("does not update updatedAt when value does not change", () => {
    const before = new Date("2026-01-01T00:00:00.000Z");
    const aggregate = UserAggregate.rehydrate<UserAttributes, UserAggregate>({
      id: EntityId.create("user-1"),
      name: "Ada",
      email: "ada@example.com",
      createdAt: new Date("2026-01-01T00:00:00.000Z"),
      updatedAt: before,
    });

    aggregate.rename("Ada");

    expect(aggregate.updatedAt?.getTime()).toBe(before.getTime());
  });

  it("updates updatedAt when setAttributes changes at least one value", () => {
    const before = new Date("2026-01-01T00:00:00.000Z");
    const aggregate = UserAggregate.rehydrate<UserAttributes, UserAggregate>({
      id: EntityId.create("user-1"),
      name: "Ada",
      email: "ada@example.com",
      createdAt: new Date("2026-01-01T00:00:00.000Z"),
      updatedAt: before,
    });

    aggregate.updateProfile({
      name: "Grace",
      email: "ada@example.com",
    });

    expect(aggregate.updatedAt).toBeDefined();
    expect(aggregate.updatedAt!.getTime()).toBeGreaterThanOrEqual(
      before.getTime(),
    );
  });

  it("does not update updatedAt when setAttributes values do not change", () => {
    const before = new Date("2026-01-01T00:00:00.000Z");
    const aggregate = UserAggregate.rehydrate<UserAttributes, UserAggregate>({
      id: EntityId.create("user-1"),
      name: "Ada",
      email: "ada@example.com",
      createdAt: new Date("2026-01-01T00:00:00.000Z"),
      updatedAt: before,
    });

    aggregate.updateProfile({
      name: "Ada",
      email: "ada@example.com",
    });

    expect(aggregate.updatedAt?.getTime()).toBe(before.getTime());
  });

  it("create works for aggregates with protected constructors", () => {
    const aggregate = ProtectedCtorUserAggregate.create<
      UserAttributes,
      ProtectedCtorUserAggregate
    >({
      id: EntityId.create("user-1"),
      name: "Ada",
      email: "ada@example.com",
      createdAt: new Date(),
      updatedAt: new Date(),
    });

    const events = aggregate.pullEvents();
    expect(events).toHaveLength(1);
    expect(events[0]?.eventName).toBe("user.created");
  });

  it("rehydrate works for aggregates with private constructors", () => {
    const aggregate = PrivateCtorUserAggregate.rehydrate<
      UserAttributes,
      PrivateCtorUserAggregate
    >({
      id: EntityId.create("user-1"),
      name: "Ada",
      email: "ada@example.com",
      createdAt: new Date("2026-01-01T00:00:00.000Z"),
      updatedAt: new Date("2026-01-02T00:00:00.000Z"),
    });

    expect(aggregate.pullEvents()).toHaveLength(0);
    expect(aggregate.id.toString()).toBe("user-1");
  });
});

interface OrderAttributes extends AggregateRootCommonAttributes {
  status: string;
}

/**
 * Two aggregates whose model names differ from each other and from their
 * class names, so that a message fixed to one, or built from the class's
 * name, fails.
 */
class LifecycleUser extends AggregateRoot<UserAttributes> {
  markForRemovalHookCalls = 0;
  beforeMutationCalls = 0;
  afterMutationCalls = 0;
  markForRemovalHookError: Error | undefined;

  private readonly _modelName = "user";

  protected get modelName(): string {
    return this._modelName;
  }

  rename(name: string): void {
    this.setAttribute("name", name);
  }

  updateProfile(data: Pick<UserAttributes, "name" | "email">): void {
    this.setAttributes(data);
  }

  checkMutable(): void {
    this.assertMutable();
  }

  protected override onBeforeAttributeMutation(): void {
    this.beforeMutationCalls += 1;
  }

  protected override onAttributeMutation(changedKey: string): void {
    this.afterMutationCalls += 1;
    this.addEvent(this.createUpdatedEvent(changedKey));
  }

  protected override onMarkedForRemoval(): void {
    this.markForRemovalHookCalls += 1;
    if (this.markForRemovalHookError) {
      throw this.markForRemovalHookError;
    }
  }
}

class LifecycleOrder extends AggregateRoot<OrderAttributes> {
  private readonly _modelName = "order";

  protected get modelName(): string {
    return this._modelName;
  }

  changeStatus(status: string): void {
    this.setAttribute("status", status);
  }

  updateStatus(data: Pick<OrderAttributes, "status">): void {
    this.setAttributes(data);
  }

  checkMutable(): void {
    this.assertMutable();
  }
}

const userUpdatedAt = new Date("2026-01-02T00:00:00.000Z");

function liveUser(): LifecycleUser {
  return LifecycleUser.rehydrate<UserAttributes, LifecycleUser>({
    id: EntityId.create("user-1"),
    name: "Ada",
    email: "ada@example.com",
    createdAt: new Date("2026-01-01T00:00:00.000Z"),
    updatedAt: new Date(userUpdatedAt),
  });
}

function removedUser(): LifecycleUser {
  const user = liveUser();
  user.markForRemoval("duplicate");
  return user;
}

function liveOrder(): LifecycleOrder {
  return LifecycleOrder.rehydrate<OrderAttributes, LifecycleOrder>({
    id: EntityId.create("o-9"),
    status: "open",
  });
}

function removedOrder(): LifecycleOrder {
  const order = liveOrder();
  order.markForRemoval();
  return order;
}

function thrownBy(fn: () => void): unknown {
  try {
    fn();
  } catch (error) {
    return error;
  }
  throw new Error("expected the call to throw");
}

/** Asserts a plain `Error`: a subclass, or a `TypeError`, fails it. */
function expectNativeError(error: unknown, message: string): void {
  expect(error).toBeInstanceOf(Error);
  expect((error as Error).constructor).toBe(Error);
  expect((error as Error).name).toBe("Error");
  expect((error as Error).message).toBe(message);
}

/**
 * Asserts that `actual` is the error another call gets: the same class and
 * message. Cases 1 and 2 pin what that error is.
 */
function expectSameError(actual: unknown, expected: unknown): void {
  expect(actual).toBeInstanceOf(Error);
  expect(expected).toBeInstanceOf(Error);
  expect((actual as Error).constructor).toBe((expected as Error).constructor);
  expect((actual as Error).message).toBe((expected as Error).message);
}

describe("AggregateRoot lifecycle misuse", () => {
  describe("a second markForRemoval", () => {
    it("throws a native Error naming the user aggregate", () => {
      const user = removedUser();

      expectNativeError(
        thrownBy(() => {
          user.markForRemoval();
        }),
        "Cannot mark user user-1 for removal: it already is",
      );
    });

    it("throws a native Error naming the order aggregate", () => {
      const order = removedOrder();

      expectNativeError(
        thrownBy(() => {
          order.markForRemoval();
        }),
        "Cannot mark order o-9 for removal: it already is",
      );
    });
  });

  describe("a mutation of a removed aggregate", () => {
    it("setAttribute throws a native Error naming the user aggregate", () => {
      const user = removedUser();

      expectNativeError(
        thrownBy(() => {
          user.rename("Grace");
        }),
        "Cannot mutate user user-1: it is marked for removal",
      );
    });

    it("setAttributes throws a native Error naming the user aggregate", () => {
      const user = removedUser();

      expectNativeError(
        thrownBy(() => {
          user.updateProfile({ name: "Grace", email: "grace@example.com" });
        }),
        "Cannot mutate user user-1: it is marked for removal",
      );
    });

    it("setAttribute throws a native Error naming the order aggregate", () => {
      const order = removedOrder();

      expectNativeError(
        thrownBy(() => {
          order.changeStatus("shipped");
        }),
        "Cannot mutate order o-9: it is marked for removal",
      );
    });

    it("setAttributes throws a native Error naming the order aggregate", () => {
      const order = removedOrder();

      expectNativeError(
        thrownBy(() => {
          order.updateStatus({ status: "shipped" });
        }),
        "Cannot mutate order o-9: it is marked for removal",
      );
    });

    it("setAttribute to the value already held throws the same error as with a new value", () => {
      const user = removedUser();

      const sameValue = thrownBy(() => {
        user.rename("Ada");
      });
      const newValue = thrownBy(() => {
        user.rename("Grace");
      });

      expectSameError(sameValue, newValue);
    });
  });

  describe("assertMutable called by a subclass", () => {
    it("throws the mutation error on a removed user aggregate", () => {
      const user = removedUser();

      expectNativeError(
        thrownBy(() => {
          user.checkMutable();
        }),
        "Cannot mutate user user-1: it is marked for removal",
      );
    });

    it("throws the mutation error on a removed order aggregate", () => {
      const order = removedOrder();

      expectNativeError(
        thrownBy(() => {
          order.checkMutable();
        }),
        "Cannot mutate order o-9: it is marked for removal",
      );
    });

    it("does not throw on a live aggregate", () => {
      expect(() => {
        liveUser().checkMutable();
      }).not.toThrow();
      expect(() => {
        liveOrder().checkMutable();
      }).not.toThrow();
    });
  });

  describe("the errors carry no code", () => {
    const errors = {
      "the second markForRemoval": () => {
        const user = removedUser();
        return thrownBy(() => {
          user.markForRemoval();
        });
      },
      "the refused mutation": () => {
        const user = removedUser();
        return thrownBy(() => {
          user.rename("Grace");
        });
      },
    };

    for (const [label, errorOf] of Object.entries(errors)) {
      it(`${label}: no own code, details or cause, and not BaseError-like`, () => {
        const error = errorOf();

        expect(error).toBeInstanceOf(Error);
        const record = error as object;
        expect(Object.hasOwn(record, "code")).toBe(false);
        expect(Object.hasOwn(record, "details")).toBe(false);
        expect(Object.hasOwn(record, "cause")).toBe(false);
        expect("code" in record).toBe(false);
        expect("context" in record).toBe(false);
        expect(isBaseErrorLike(error)).toBe(false);
      });
    }
  });

  it("a refused second markForRemoval runs the hook once and queues one deleted event", () => {
    const user = removedUser();

    expect(() => {
      user.markForRemoval();
    }).toThrow();

    expect(user.markForRemovalHookCalls).toBe(1);
    const events = user.pullEvents();
    expect(events).toHaveLength(1);
    expect(events[0]?.eventName).toBe("user.deleted");
    expect(user.isMarkedForRemoval()).toBe(true);
  });

  it("a refused setAttribute runs no hook and changes nothing", () => {
    const user = removedUser();
    user.pullEvents();

    expect(() => {
      user.rename("Grace");
    }).toThrow();

    expect(user.beforeMutationCalls).toBe(0);
    expect(user.afterMutationCalls).toBe(0);
    expect(user._attributes.name).toBe("Ada");
    expect(user.updatedAt?.getTime()).toBe(userUpdatedAt.getTime());
    expect(
      user.pullEvents().some((event) => event.eventName === "user.updated"),
    ).toBe(false);
  });

  it("an onMarkedForRemoval that throws: its error reaches the caller, the flag stays set", () => {
    const user = liveUser();
    const hookError = new RangeError("hook failed");
    user.markForRemovalHookError = hookError;

    expect(
      thrownBy(() => {
        user.markForRemoval();
      }),
    ).toBe(hookError);
    expect(user.isMarkedForRemoval()).toBe(true);
    expect(user.pullEvents()).toHaveLength(0);

    const plainlyRemoved = removedUser();
    expectSameError(
      thrownBy(() => {
        user.markForRemoval();
      }),
      thrownBy(() => {
        plainlyRemoved.markForRemoval();
      }),
    );
  });

  it("has no buildLifecycleErrorContext", () => {
    expect("buildLifecycleErrorContext" in liveUser()).toBe(false);
  });
});
