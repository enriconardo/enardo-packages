import { BaseError, type BaseErrorOptions } from "@enardo/errors";

type ConcurrencyConflictErrorOptions = Omit<BaseErrorOptions, "code">;

/**
 * Thrown by a data store when an aggregate's stored version no longer matches
 * the version read when it was loaded: someone else changed it in between.
 */
export class ConcurrencyConflictError extends BaseError {
  override readonly name = "ConcurrencyConflictError";
  declare readonly code: "CONCURRENCY_CONFLICT";

  constructor(
    id: unknown,
    expectedVersion: unknown,
    options?: ConcurrencyConflictErrorOptions,
  ) {
    super(
      `The aggregate was changed after it was loaded: expected version ${String(expectedVersion)}.`,
      {
        ...options,
        code: "CONCURRENCY_CONFLICT",
        details: { id, expectedVersion },
      },
    );
  }
}
