import { BaseError } from "@enardo/errors";
import { describe, expect, expectTypeOf, it } from "vitest";
import {
  EntityAlreadyMarkedForRemovalError,
  EntityLifecycleError,
  EntityNotMutableError,
} from "~/index";
import type {
  EntityLifecycleErrorCode,
  EntityLifecycleErrorContext,
} from "~/index";

const context: EntityLifecycleErrorContext = {
  entityType: "user",
  entityId: "user-1",
};

describe("EntityLifecycleError", () => {
  it("cannot be instantiated: the class is abstract", () => {
    const construct = (): unknown =>
      // @ts-expect-error EntityLifecycleError is abstract
      new EntityLifecycleError("message", "ENTITY_NOT_MUTABLE", context);

    expectTypeOf(construct).toBeFunction();
  });
});

describe("EntityNotMutableError", () => {
  it("is an EntityLifecycleError and a BaseError", () => {
    const error = new EntityNotMutableError(context);

    expect(error).toBeInstanceOf(EntityLifecycleError);
    expect(error).toBeInstanceOf(BaseError);
    expect(error).toBeInstanceOf(Error);
  });

  it("reports its class name as name", () => {
    expect(new EntityNotMutableError(context).name).toBe(
      "EntityNotMutableError",
    );
  });

  it("has the code ENTITY_NOT_MUTABLE, typed EntityLifecycleErrorCode", () => {
    const error = new EntityNotMutableError(context);

    expectTypeOf(error.code).toEqualTypeOf<EntityLifecycleErrorCode>();
    expect(error.code).toBe("ENTITY_NOT_MUTABLE");
  });

  it("carries the context as details, typed EntityLifecycleErrorContext", () => {
    const error = new EntityNotMutableError(context);

    expectTypeOf(error.details).toEqualTypeOf<EntityLifecycleErrorContext>();
    expect(error.details).toEqual(context);
  });

  it("exposes details as context, the same object", () => {
    const error = new EntityNotMutableError(context);

    expectTypeOf(error.context).toEqualTypeOf<EntityLifecycleErrorContext>();
    expect(error.context).toBe(error.details);
  });
});

describe("EntityAlreadyMarkedForRemovalError", () => {
  it("is an EntityLifecycleError and a BaseError", () => {
    const error = new EntityAlreadyMarkedForRemovalError(context);

    expect(error).toBeInstanceOf(EntityLifecycleError);
    expect(error).toBeInstanceOf(BaseError);
    expect(error).toBeInstanceOf(Error);
  });

  it("reports its class name as name", () => {
    expect(new EntityAlreadyMarkedForRemovalError(context).name).toBe(
      "EntityAlreadyMarkedForRemovalError",
    );
  });

  it("has the code ENTITY_ALREADY_MARKED_FOR_REMOVAL, typed EntityLifecycleErrorCode", () => {
    const error = new EntityAlreadyMarkedForRemovalError(context);

    expectTypeOf(error.code).toEqualTypeOf<EntityLifecycleErrorCode>();
    expect(error.code).toBe("ENTITY_ALREADY_MARKED_FOR_REMOVAL");
  });

  it("carries the context as details, typed EntityLifecycleErrorContext", () => {
    const error = new EntityAlreadyMarkedForRemovalError(context);

    expectTypeOf(error.details).toEqualTypeOf<EntityLifecycleErrorContext>();
    expect(error.details).toEqual(context);
  });

  it("exposes details as context, the same object", () => {
    const error = new EntityAlreadyMarkedForRemovalError(context);

    expectTypeOf(error.context).toEqualTypeOf<EntityLifecycleErrorContext>();
    expect(error.context).toBe(error.details);
  });
});
