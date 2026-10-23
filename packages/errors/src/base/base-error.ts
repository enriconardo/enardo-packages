import type {
  BaseErrorOptions,
  ErrorDetails,
  SerializedError,
} from "./base-error.types";
import { serializeError } from "./serialize-error";

/**
 * Root of the error hierarchy.
 *
 * Every error carries a `name` its class declares, a machine-readable `code`
 * and optional structured `details`; all of them are read-only. `code` is for
 * code that handles the error, `message` for the humans who read it.
 *
 * @example
 * ```ts
 * export class UserNotFoundError extends BaseError {
 *   override readonly name = "UserNotFoundError";
 *   declare readonly code: "USER_NOT_FOUND";
 *   declare readonly details: { readonly userId: string };
 *
 *   constructor(userId: string, options?: Pick<BaseErrorOptions, "cause">) {
 *     super(`User "${userId}" was not found`, {
 *       ...options,
 *       code: "USER_NOT_FOUND",
 *       details: { userId },
 *     });
 *   }
 * }
 * ```
 */
export abstract class BaseError extends Error {
  // The brand, on the prototype: `toJSON` never serializes it and a subclass's
  // fields cannot collide with it. `Symbol.for` is shared by every copy of
  // this package and every realm, so `isBaseErrorLike` recognizes the errors
  // of a copy that `instanceof` cannot. Its key is a contract between majors
  // (ADR 0012).
  static {
    Object.defineProperty(
      this.prototype,
      Symbol.for("@enardo/errors.BaseError"),
      {
        value: true,
        writable: false,
        enumerable: false,
        configurable: false,
      },
    );
  }

  /**
   * The name of the concrete class, declared by it as a field
   * (`override readonly name = "UserNotFoundError"`), so that minifiers
   * cannot change it. A class meant to be extended types it `string`.
   */
  abstract override readonly name: string;

  /** Machine-readable identity of the error. */
  readonly code: string;

  /** Structured data about this occurrence of the error. */
  readonly details: ErrorDetails | undefined;

  constructor(message: string, options: BaseErrorOptions) {
    super(message, options);

    this.code = options.code;
    this.details = options.details;
  }

  /**
   * The error as a plain object, for logs: its own enumerable fields, plus
   * `name`, `message`, `stack` and the whole `cause` chain, which
   * `JSON.stringify` would otherwise drop. Keys whose value is `undefined`
   * are left out.
   *
   * Never send it in an HTTP response: it carries `details` and the stack.
   */
  toJSON(): SerializedError {
    return serializeError(this);
  }
}
