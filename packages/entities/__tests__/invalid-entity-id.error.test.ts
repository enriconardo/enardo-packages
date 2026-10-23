import { BaseError } from "@enardo/errors";
import { describe, expect, expectTypeOf, it } from "vitest";
import { InvalidEntityIdError } from "~/index";
import type { InvalidEntityIdDetails } from "~/index";

describe("InvalidEntityIdError", () => {
  it("is a BaseError", () => {
    const error = new InvalidEntityIdError("", "empty");

    expect(error).toBeInstanceOf(BaseError);
    expect(error).toBeInstanceOf(Error);
  });

  it("reports its class name as name", () => {
    expect(new InvalidEntityIdError("", "empty").name).toBe(
      "InvalidEntityIdError",
    );
  });

  it("carries the entity id and the reason as details, typed InvalidEntityIdDetails", () => {
    const error = new InvalidEntityIdError("   ", "empty");

    expectTypeOf(error.details).toEqualTypeOf<InvalidEntityIdDetails>();
    expect(error.details).toEqual({ entityId: "   ", reason: "empty" });
  });
});

describe("InvalidEntityIdError code", () => {
  it("has the code INVALID_ENTITY_ID, typed as its literal", () => {
    const error = new InvalidEntityIdError("", "empty");

    expectTypeOf(error.code).toEqualTypeOf<"INVALID_ENTITY_ID">();
    expect(error.code).toBe("INVALID_ENTITY_ID");
  });
});
