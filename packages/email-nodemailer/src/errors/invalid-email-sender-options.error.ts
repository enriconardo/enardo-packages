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
  | "default-from";

const MESSAGES: Record<InvalidEmailSenderOptionsReason, string> = {
  "no-transport": "NodemailerEmailSender needs transport options",
  pool: "NodemailerEmailSender does not create a pooled transporter",
  "not-smtp":
    "NodemailerEmailSender creates SMTP transporters only: transport must hold SMTP options",
  "default-from":
    "The address of defaultFrom is not one NodemailerEmailSender accepts",
};

/**
 * Thrown by the constructor of `NodemailerEmailSender` when it cannot use its
 * options. `details.reason` says why.
 *
 * Neither the message nor `details` holds the address of `defaultFrom`.
 */
export class InvalidEmailSenderOptionsError extends BaseError {
  override readonly name = "InvalidEmailSenderOptionsError";

  declare readonly code: "INVALID_EMAIL_SENDER_OPTIONS";

  declare readonly details: {
    readonly reason: InvalidEmailSenderOptionsReason;
  };

  /** @param reason - Why the options cannot be used. */
  constructor(reason: InvalidEmailSenderOptionsReason) {
    super(MESSAGES[reason], {
      code: "INVALID_EMAIL_SENDER_OPTIONS",
      details: { reason },
    });
  }
}
