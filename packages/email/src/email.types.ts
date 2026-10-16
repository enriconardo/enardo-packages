/**
 * A mailbox: an address, with an optional display name. `from` and `replyTo`
 * use it too, despite its name.
 */
export interface EmailRecipient {
  /**
   * One address, `local@domain`: never a list, nor the `Name <address>` form.
   *
   * The caller validates it. An implementation hands it to its transport as
   * one address, never inside a string that the transport parses, so a
   * malformed address can be refused, but never turned into other recipients.
   */
  address: string;
  /**
   * Display text, which may hold any character: quotes, commas, angle
   * brackets, line breaks. The implementation encodes it for the header; it
   * never becomes header syntax.
   */
  name?: string;
}

/** A message to send, with a plain-text body and an optional HTML one. */
export interface EmailMessage {
  /**
   * One recipient, or a list of at least one: an implementation rejects an
   * empty list.
   *
   * Every recipient of a list is in the `To` header, so each sees the others'
   * addresses: people who must not see each other get a message each.
   */
  to: EmailRecipient | readonly EmailRecipient[];
  /**
   * Plain text. The implementation encodes it, and a line break in it never
   * starts a header.
   */
  subject: string;
  /** The plain-text body, which every client can show. */
  text: string;
  /**
   * An HTML version of the same content, sent with `text`.
   *
   * It is sent as given: the caller escapes every value it puts into it.
   */
  html?: string;
  /**
   * The sender. When absent, the implementation's default sender, set when it
   * is created; an implementation without one rejects the call.
   */
  from?: EmailRecipient;
  /** Where replies go, instead of `from`. */
  replyTo?: EmailRecipient;
}

/**
 * Options of a send. An implementation does with each option what its
 * comment below says, or rejects the call: it never ignores one silently.
 *
 * TypeScript cannot check it: a `send` that declares no `options` parameter
 * still implements `EmailSender`.
 */
export interface SendEmailOptions {
  /**
   * Names and values for the provider, which shows them in its logs and
   * reports and returns them with its delivery events. They never reach the
   * recipient.
   *
   * An implementation whose provider keeps no such data drops them, and its
   * documentation says so: a dropped tag loses no mail.
   */
  tags?: Record<string, string>;
}
