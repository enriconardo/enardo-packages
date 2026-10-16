import { BaseError, type BaseErrorOptions } from "@enardo/errors";

type DuplicateEntityErrorOptions = Omit<BaseErrorOptions, "code">;

/** Thrown when `add()` targets an identity that is already tracked. */
export class DuplicateEntityError extends BaseError {
  override readonly name = "DuplicateEntityError";

  constructor(key: string, options?: DuplicateEntityErrorOptions) {
    super(`An entity with identity "${key}" is already tracked.`, {
      ...options,
      code: "DUPLICATE_ENTITY",
      details: { key },
    });
  }
}
