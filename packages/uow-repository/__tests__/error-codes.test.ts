import { isBaseErrorLike } from "@enardo/errors";
import { describe, expect, expectTypeOf, it } from "vitest";
import * as api from "~/index";
import { ConcurrencyConflictError } from "~/index";

describe("the codes of the errors", () => {
  it.each([
    "UnitOfWorkAlreadyUsedError",
    "UnsupportedIdentityError",
    "InvalidRecordSetError",
    "DuplicateRecordKeyError",
    "DuplicateEntityError",
  ])("%s, a misuse, is not exported", (name) => {
    expect(api).not.toHaveProperty(name);
  });

  it("ConcurrencyConflictError has the code CONCURRENCY_CONFLICT", () => {
    const error = new ConcurrencyConflictError("a", 1);

    expectTypeOf(error.code).toEqualTypeOf<"CONCURRENCY_CONFLICT">();
    expect(error.code).toBe("CONCURRENCY_CONFLICT");
  });

  it("ConcurrencyConflictError passes isBaseErrorLike, with its code", () => {
    const error: unknown = new ConcurrencyConflictError("a", 1);

    expect(isBaseErrorLike(error)).toBe(true);
    expect(isBaseErrorLike(error) && error.code).toBe("CONCURRENCY_CONFLICT");
  });
});
