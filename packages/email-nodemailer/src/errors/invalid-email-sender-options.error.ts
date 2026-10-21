import type { EmailErrorCause } from "@enardo/email";
import { BaseError } from "@enardo/errors";

/** Why the constructor of `NodemailerEmailSender` refused its options. */
export type InvalidEmailSenderOptionsReason =
  /** No `transport`. */
  | "no-transport"
  /** nodemailer would build a pooled transporter from `transport`. */
  | "pool"
  /**
   * nodemailer would build from `transport` anything but an SMTP transport,
   * or one that speaks LMTP.
   */
  | "not-smtp"
  /** The address of `defaultFrom` is refused. */
  | "default-from"
  /** nodemailer could not build a transporter from `transport`. */
  | "transport-options";

const MESSAGES: Record<InvalidEmailSenderOptionsReason, string> = {
  "no-transport": "NodemailerEmailSender needs transport options",
  pool: "NodemailerEmailSender does not create a pooled transporter",
  "not-smtp":
    "NodemailerEmailSender creates SMTP transporters only: transport must hold SMTP options",
  "default-from":
    "The address of defaultFrom is not one NodemailerEmailSender accepts",
  "transport-options":
    "nodemailer could not build a transporter from the transport options",
};

/**
 * Thrown by the constructor of `NodemailerEmailSender` when it cannot use its
 * options. `details.reason` says why.
 *
 * Neither the message nor `details` holds the address of `defaultFrom`. The
 * `cause`, when there is one, holds identifiers only (`name` and `code` of what
 * nodemailer threw), never its message: that can hold the URL of `transport`,
 * password included.
 */
export class InvalidEmailSenderOptionsError extends BaseError {
  override readonly name = "InvalidEmailSenderOptionsError";

  declare readonly code: "INVALID_EMAIL_SENDER_OPTIONS";

  declare readonly details: {
    readonly reason: InvalidEmailSenderOptionsReason;
  };

  /**
   * @param reason - Why the options cannot be used.
   * @param options - The identifiers of what nodemailer threw, as `cause`.
   */
  constructor(
    reason: InvalidEmailSenderOptionsReason,
    options?: { cause?: EmailErrorCause },
  ) {
    super(MESSAGES[reason], {
      ...options,
      code: "INVALID_EMAIL_SENDER_OPTIONS",
      details: { reason },
    });
  }
}
