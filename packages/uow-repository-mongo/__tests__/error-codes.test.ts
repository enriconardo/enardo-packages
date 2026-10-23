import { describe, expect, expectTypeOf, it } from "vitest";
import { InvalidDataStoreOptionsError } from "~/index";

describe("the codes of the errors", () => {
  it("InvalidDataStoreOptionsError has the code INVALID_DATA_STORE_OPTIONS", () => {
    const error = new InvalidDataStoreOptionsError(["a"]);

    expectTypeOf(error.code).toEqualTypeOf<"INVALID_DATA_STORE_OPTIONS">();
    expect(error.code).toBe("INVALID_DATA_STORE_OPTIONS");
  });
});
