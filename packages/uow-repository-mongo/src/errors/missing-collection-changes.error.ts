import { BaseError, type BaseErrorOptions } from "@enardo/errors";

type MissingCollectionChangesErrorOptions = Omit<BaseErrorOptions, "code">;

/**
 * Thrown when a write's change set has no entry for a collection the store
 * maps. A ChangeSet carries every collection of its record set, even those
 * with nothing to write, so a missing entry is a bug in the caller, not an
 * empty set of changes.
 */
export class MissingCollectionChangesError extends BaseError {
  override readonly name = "MissingCollectionChangesError";
  declare readonly code: "MISSING_COLLECTION_CHANGES";

  constructor(
    collection: string,
    options?: MissingCollectionChangesErrorOptions,
  ) {
    super(`The change set has no entry for collection "${collection}".`, {
      ...options,
      code: "MISSING_COLLECTION_CHANGES",
      details: { collection },
    });
  }
}
