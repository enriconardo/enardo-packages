import { BaseError } from "@enardo/errors";

/**
 * A variable is set but is not of the type the reader expects.
 *
 * Neither the message nor `details` holds the value, which can be a secret:
 * `details` holds the key and the type expected.
 *
 * @example
 * ```ts
 * try {
 *   env.number("PORT");
 * } catch (error) {
 *   if (error instanceof EnvMalformedError) {
 *     // error.details.key === "PORT", error.details.expected === "number"
 *   }
 *   throw error;
 * }
 * ```
 */
export class EnvMalformedError extends BaseError {
  override readonly name = "EnvMalformedError";

  declare readonly code: "ENV_MALFORMED";

  declare readonly details: {
    /** The key of the variable. */
    readonly key: string;
    /** The type the reader expected. */
    readonly expected: "string" | "number" | "boolean";
  };

  /**
   * @param key - The key of the malformed variable.
   * @param expected - The type the reader expected.
   */
  constructor(key: string, expected: "string" | "number" | "boolean") {
    super(`Environment variable "${key}" is not a valid ${expected}`, {
      code: "ENV_MALFORMED",
      details: { key, expected },
    });
  }
}
