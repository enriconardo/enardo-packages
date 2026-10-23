import { describe, expect, expectTypeOf, it } from "vitest";
import {
  ConcurrencyConflictError,
  DuplicateEntityError,
  UnitOfWorkAlreadyUsedError,
  UnsupportedIdentityError,
} from "~/index";

describe("the codes of the errors", () => {
  it("DuplicateEntityError has the code DUPLICATE_ENTITY", () => {
    const error = new DuplicateEntityError("a");

    expectTypeOf(error.code).toEqualTypeOf<"DUPLICATE_ENTITY">();
    expect(error.code).toBe("DUPLICATE_ENTITY");
  });

  it("UnsupportedIdentityError has the code UNSUPPORTED_IDENTITY", () => {
    const error = new UnsupportedIdentityError("object");

    expectTypeOf(error.code).toEqualTypeOf<"UNSUPPORTED_IDENTITY">();
    expect(error.code).toBe("UNSUPPORTED_IDENTITY");
  });

  it("UnitOfWorkAlreadyUsedError has the code UOW_ALREADY_USED", () => {
    const error = new UnitOfWorkAlreadyUsedError();

    expectTypeOf(error.code).toEqualTypeOf<"UOW_ALREADY_USED">();
    expect(error.code).toBe("UOW_ALREADY_USED");
  });

  it("ConcurrencyConflictError has the code CONCURRENCY_CONFLICT", () => {
    const error = new ConcurrencyConflictError("a", 1);

    expectTypeOf(error.code).toEqualTypeOf<"CONCURRENCY_CONFLICT">();
    expect(error.code).toBe("CONCURRENCY_CONFLICT");
  });
});
