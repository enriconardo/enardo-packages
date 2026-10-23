import { BaseError, type BaseErrorOptions } from "@enardo/errors";

// The brand's key is a contract between the majors of `@enardo/errors`
// (ADR 0012, point 2): the tests spell it out instead of importing it.
const BRAND = Symbol.for("@enardo/errors.BaseError");

/** A `BaseError` whose code is given to its constructor. */
export class TestError extends BaseError {
  override readonly name = "TestError";

  constructor(code: string, options?: Omit<BaseErrorOptions, "code">) {
    super(`Test error ${code}`, { ...options, code });
  }
}

/** An `Error` with a `code` and no brand, as Node's system errors are. */
export function unbrandedError(code: string): Error {
  return Object.assign(new Error(`Unbranded ${code}`), { code });
}

/**
 * A plain object with the brand and the shape of a `BaseError`: what an error
 * built on another copy of `@enardo/errors` looks like to this one.
 */
export function brandedObject(code: string): object {
  return { [BRAND]: true, name: "ForeignError", code };
}

/** An object with the brand whose `code` getter throws. */
export function brandedObjectWithThrowingCode(): object {
  return {
    [BRAND]: true,
    name: "ForeignError",
    get code(): string {
      throw new Error("code read failed");
    },
  };
}
