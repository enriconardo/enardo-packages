import { BaseError } from "@enardo/errors";

/** Which field of the message `NodemailerEmailSender` refused, and why. */
export type InvalidEmailMessageDetails =
  /** `to` is an empty list. */
  | { readonly field: "to"; readonly reason: "empty" }
  /** The address at `index` of `to` (0 for a single recipient) is refused. */
  | { readonly field: "to"; readonly reason: "address"; readonly index: number }
  /** The address of `from` or `replyTo` is refused. */
  | { readonly field: "from" | "replyTo"; readonly reason: "address" }
  /** There is no `from`, and the sender has no `defaultFrom`. */
  | { readonly field: "from"; readonly reason: "missing" };

function messageOf(details: InvalidEmailMessageDetails): string {
  switch (details.reason) {
    case "empty":
      return "The email has no recipient: to is an empty list";
    case "missing":
      return "The email has no sender: no from, and no defaultFrom";
    case "address": {
      const field = "index" in details ? `to[${details.index}]` : details.field;
      return `The address of ${field} is not one NodemailerEmailSender accepts`;
    }
  }
}

/**
 * The message cannot be sent as it is: `send` rejects with it before
 * anything is sent. `details` says which field, and why.
 *
 * Neither the message nor `details` holds an address or a name.
 */
export class InvalidEmailMessageError extends BaseError {
  override readonly name = "InvalidEmailMessageError";

  declare readonly code: "INVALID_EMAIL_MESSAGE";

  declare readonly details: InvalidEmailMessageDetails;

  /** @param details - Which field was refused, and why. */
  constructor(details: InvalidEmailMessageDetails) {
    super(messageOf(details), {
      code: "INVALID_EMAIL_MESSAGE",
      details,
    });
  }
}
