import { BaseError } from "@enardo/errors";
import type { EmailErrorOptions } from "./email-error.types";

/** The `details` of `EmailSendFailedError`. */
export interface EmailSendFailedDetails extends Record<string, unknown> {
  /**
   * Whether the same send, later and with nothing changed, may succeed: the
   * relay was out of reach, its answer was lost, or it refused the message
   * for now.
   */
  readonly retryable: boolean;
}

/**
 * Sending failed for any reason but the message's own (`InvalidEmailMessageError`)
 * or a refusal of recipients that the implementation can name
 * (`EmailRecipientsRefusedError`): the relay out of reach, the sender or the
 * message refused, an authentication that failed, an answer lost.
 *
 * The message may have been delivered all the same, when the relay's answer
 * was lost: a retry, even a `retryable` one, can send it twice.
 *
 * `cause` holds the identifiers of the driver's failure, which the
 * implementation documents.
 */
export class EmailSendFailedError extends BaseError {
  override readonly name = "EmailSendFailedError";

  declare readonly code: "EMAIL_SEND_FAILED";

  declare readonly details: EmailSendFailedDetails;

  /** @param details - Whether a later retry may succeed. */
  constructor(details: EmailSendFailedDetails, options?: EmailErrorOptions) {
    super(
      details.retryable
        ? "Sending the email failed; a later retry may succeed"
        : "Sending the email failed",
      {
        ...options,
        code: "EMAIL_SEND_FAILED",
        details: { retryable: details.retryable },
      },
    );
  }
}
