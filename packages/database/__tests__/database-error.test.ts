import { describe, it, expect, expectTypeOf } from "vitest";
import DatabaseError from "~/errors/database-error";
import { BaseError } from "@enardo/errors";

/** Hands `construct` to the compiler without running it. */
const compileOnly = (construct: () => unknown): void => {
  expectTypeOf(construct).toBeFunction();
};

describe("DatabaseError", () => {
  it("is an Error and a BaseError carrying the given message", () => {
    const error = new DatabaseError("something went wrong", {
      code: "NOT_CONNECTED",
    });

    expect(error).toBeInstanceOf(Error);
    expect(error).toBeInstanceOf(BaseError);
    expect(error).toBeInstanceOf(DatabaseError);
    expect(error.message).toBe("something went wrong");
  });

  it('is named "DatabaseError", in name and in the stack', () => {
    const error = new DatabaseError("something went wrong", {
      code: "NOT_CONNECTED",
    });

    expect(error.name).toBe("DatabaseError");
    expect(error.stack?.split("\n")[0]).toBe(
      "DatabaseError: something went wrong",
    );
  });

  it("keeps the given code", () => {
    const error = new DatabaseError("something went wrong", {
      code: "NOT_CONNECTED",
    });

    expect(error.code).toBe("NOT_CONNECTED");
  });

  it("propagates object details and the cause", () => {
    const cause = new Error("connect ECONNREFUSED");
    const error = new DatabaseError("something went wrong", {
      code: "NOT_CONNECTED",
      details: { host: "localhost", port: 27017 },
      cause,
    });

    expect(error.details).toEqual({ host: "localhost", port: 27017 });
    expect(error.cause).toBe(cause);
  });

  it("requires a code", () => {
    // @ts-expect-error code is required
    compileOnly(() => new DatabaseError("something went wrong", {}));
    // @ts-expect-error the options carry the code, so they are required
    compileOnly(() => new DatabaseError("something went wrong"));
  });

  it("rejects name in the options", () => {
    compileOnly(
      () =>
        new DatabaseError("something went wrong", {
          code: "NOT_CONNECTED",
          // @ts-expect-error the name is declared by the class, not passed
          name: "OtherError",
        }),
    );
  });
});
