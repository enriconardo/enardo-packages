import { BaseError, type BaseErrorOptions } from "@enardo/errors";

type InvalidDataStoreOptionsErrorOptions = Omit<BaseErrorOptions, "code">;

/**
 * Thrown when the collections given to a MongoDataStore don't name exactly one
 * root: the root holds the version, so without one no write could be checked,
 * and with two the aggregate would have two versions.
 */
export class InvalidDataStoreOptionsError extends BaseError {
  override readonly name = "InvalidDataStoreOptionsError";

  constructor(
    roots: readonly string[],
    options?: InvalidDataStoreOptionsErrorOptions,
  ) {
    super(
      `Exactly one collection must be the root, but ${roots.length === 0 ? "none is" : `${roots.length} are: ${roots.join(", ")}`}.`,
      {
        ...options,
        code: "INVALID_DATA_STORE_OPTIONS",
        details: { roots },
      },
    );
  }
}
