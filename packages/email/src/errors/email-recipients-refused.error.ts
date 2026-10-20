import { BaseError } from "@enardo/errors";
import type { EmailErrorCause } from "./email-error.types";

/** A recipient that the relay refused, by its position in `to`. */
export interface RefusedEmailRecipient {
  /** Its index in `to`: 0 for a single recipient. */
  readonly index: number;
  /**
   * Whether a later send to this recipient, with nothing changed, may
   * succeed: the relay refused it for now (an SMTP `4xx`), not for good.
   */
  readonly retryable: boolean;
}

/** The `details` of `EmailRecipientsRefusedError`. */
export interface EmailRecipientsRefusedDetails extends Record<string, unknown> {
  /** Each refused recipient once, in ascending order of `index`. */
  readonly refused: readonly RefusedEmailRecipient[];
}

/**
 * The relay refused the message for at least one recipient. It took the
 * message for every recipient that `details.refused` does not list, if any:
 * those may already have received it.
 *
 * Retry the recipients whose `retryable` is true, and only them: retrying the
 * whole message sends it twice to the others. Such a retry is a message of
 * its own, whose `To` header lists them alone.
 *
 * Neither the message nor `details` holds an address: each recipient is named
 * by its index in `to`.
 */
export class EmailRecipientsRefusedError extends BaseError {
  override readonly name = "EmailRecipientsRefusedError";

  declare readonly code: "EMAIL_RECIPIENTS_REFUSED";

  declare readonly details: EmailRecipientsRefusedDetails;

  /**
   * @param refused - Each refused recipient once. The error keeps a copy,
   * sorted by `index`.
   */
  constructor(
    refused: readonly [RefusedEmailRecipient, ...RefusedEmailRecipient[]],
    options?: { cause?: EmailErrorCause },
  ) {
    const sorted = refused
      .map(({ index, retryable }) => ({ index, retryable }))
      .sort((a, b) => a.index - b.index);

    super(
      `The relay refused the email for ${sorted.map(({ index }) => `to[${index}]`).join(", ")}`,
      {
        ...options,
        code: "EMAIL_RECIPIENTS_REFUSED",
        details: { refused: sorted },
      },
    );
  }
}
