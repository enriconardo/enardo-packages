import { BaseError } from "@enardo/errors";

/**
 * A required variable is unset: its key is not an own key of the source, or
 * its value is `undefined` or `""`.
 *
 * `details` holds the key.
 *
 * @example
 * ```ts
 * try {
 *   env.requireString("DATABASE_URL");
 * } catch (error) {
 *   if (error instanceof EnvMissingError) {
 *     // error.details.key === "DATABASE_URL"
 *   }
 *   throw error;
 * }
 * ```
 */
export class EnvMissingError extends BaseError {
  override readonly name = "EnvMissingError";

  declare readonly code: "ENV_MISSING";

  declare readonly details: {
    /** The key of the variable. */
    readonly key: string;
  };

  /**
   * @param key - The key of the missing variable.
   */
  constructor(key: string) {
    super(`Environment variable "${key}" is required but not set`, {
      code: "ENV_MISSING",
      details: { key },
    });
  }
}
