import { BaseError } from "@enardo/errors";

const MESSAGES = {
  PASSWORD_MALFORMED: "The password is not a well-formed string",
  PASSWORD_TOO_LONG: "The password is over the maximum length",
} as const;

/**
 * `hash` refuses the password: it holds a lone surrogate
 * (`PASSWORD_MALFORMED`), or is over the maximum length (`PASSWORD_TOO_LONG`).
 * A client can send either, so a caller handles them by `code`.
 *
 * It has no `details`, and never holds the password.
 */
export class InvalidPasswordError extends BaseError {
  override readonly name = "InvalidPasswordError";

  declare readonly code: keyof typeof MESSAGES;

  /** @param code - Why the password was refused. */
  constructor(code: keyof typeof MESSAGES) {
    super(MESSAGES[code], { code });
  }
}
