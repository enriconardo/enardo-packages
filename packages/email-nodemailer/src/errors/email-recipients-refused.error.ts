import { BaseError } from "@enardo/errors";

/**
 * The relay took the message for some recipients, and refused the others,
 * permanently or for now. The others may have received it.
 *
 * `details.refused` counts the recipients it did not accept. The error names
 * none of them: the relay's answers echo their addresses.
 */
export class EmailRecipientsRefusedError extends BaseError {
  override readonly name = "EmailRecipientsRefusedError";

  declare readonly code: "EMAIL_RECIPIENTS_REFUSED";

  declare readonly details: { readonly refused: number };

  /** @param refused - How many recipients the relay did not accept. */
  constructor(refused: number) {
    super(
      `The relay did not accept the email for ${refused} ${refused === 1 ? "recipient" : "recipients"}; the others may have received it`,
      { code: "EMAIL_RECIPIENTS_REFUSED", details: { refused } },
    );
  }
}
