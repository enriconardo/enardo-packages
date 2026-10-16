import { BaseError } from "@enardo/errors";

/**
 * Error thrown by database operations.
 *
 * Extends {@link BaseError} with the fixed name `"DatabaseError"`.
 * Use this to signal database-level failures such as connection errors,
 * missing connections, or schema initialization issues.
 *
 * @example
 * ```ts
 * throw new DatabaseError("Database not connected", { code: "NOT_CONNECTED" });
 * ```
 */
export default class DatabaseError extends BaseError {
  override readonly name = "DatabaseError";
}
