import { isBaseErrorLike } from "@enardo/errors";

export interface RetryOnConflictOptions {
  /** Total number of attempts, including the first one. Defaults to 3. */
  readonly attempts?: number;
}

/**
 * Runs a use case again, from scratch, when it fails with a concurrency conflict.
 *
 * `run` must build a new unit of work and new repositories on every call: a
 * unit of work is single-use, and the entities of a failed attempt were based
 * on the stale version. A conflict is recognized by its `code`, whatever copy
 * of this package threw it. Any other error is rethrown at once, and the last
 * conflict is rethrown once the attempts run out.
 */
export async function retryOnConflict<T>(
  run: (attempt: number) => Promise<T>,
  options: RetryOnConflictOptions = {},
): Promise<T> {
  const attempts = options.attempts ?? 3;

  if (!Number.isInteger(attempts) || attempts < 1) {
    throw new RangeError(
      `attempts must be a positive integer, got ${String(attempts)}.`,
    );
  }

  for (let attempt = 1; ; attempt++) {
    try {
      return await run(attempt);
    } catch (error) {
      const isConflict =
        isBaseErrorLike(error) && error.code === "CONCURRENCY_CONFLICT";

      if (!isConflict || attempt >= attempts) {
        throw error;
      }
    }
  }
}
