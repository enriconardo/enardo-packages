import { BaseError } from "@enardo/errors";
import type { EmailErrorOptions } from "./email-error.types";

/** Which field of the message the email sender refused, and why. */
export type InvalidEmailMessageDetails =
  /** `to` is an empty list. */
  | { readonly field: "to"; readonly reason: "empty" }
  /** The address at `index` of `to` (0 for a single recipient) is refused. */
  | { readonly field: "to"; readonly reason: "address"; readonly index: number }
  /** The address of `from` or `replyTo` is refused. */
  | { readonly field: "from" | "replyTo"; readonly reason: "address" }
  /** There is no `from`, and the email sender has no default sender. */
  | { readonly field: "from"; readonly reason: "missing" };

function messageOf(details: InvalidEmailMessageDetails): string {
  switch (details.reason) {
    case "empty":
      return "The email has no recipient: to is an empty list";
    case "missing":
      return "The email has no sender: no from, and no default sender";
    case "address": {
      const field = "index" in details ? `to[${details.index}]` : details.field;
      return `The email sender refuses the address of ${field}`;
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
  constructor(
    details: InvalidEmailMessageDetails,
    options?: EmailErrorOptions,
  ) {
    super(messageOf(details), {
      ...options,
      code: "INVALID_EMAIL_MESSAGE",
      details,
    });
  }
}
