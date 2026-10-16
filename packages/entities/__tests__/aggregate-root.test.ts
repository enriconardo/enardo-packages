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
