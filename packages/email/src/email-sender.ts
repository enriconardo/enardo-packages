import type { EmailMessage, SendEmailOptions } from "~/email.types";

/**
 * Sends email through a relay: the service, or the SMTP server, that an
 * implementation hands each message to.
 */
export interface EmailSender {
  /**
   * Sends `message`.
   *
   * Resolves once the relay has accepted the message for every recipient.
   * Delivery comes later, and a bounce never reaches the caller.
   *
   * Rejects when the relay refuses the message or any of its recipients, and
   * when the relay's answer is lost: a rejected call may have reached some of
   * its recipients, or all of them. It rejects with:
   * - `InvalidEmailMessageError`, before anything is sent, for an empty `to`,
   *   no sender, or an address the implementation refuses;
   * - `EmailRecipientsRefusedError` when the relay refused recipients, each
   *   named by its index in `to`;
   * - `EmailSendFailedError` for any other failure, a refusal of recipients
   *   it cannot name included;
   * - or what a value of the caller's threw when read.
   *
   * None holds an address, name, subject or body, so they can be logged.
   *
   * Never modifies `message` or `options`.
   */
  send(message: EmailMessage, options?: SendEmailOptions): Promise<void>;
}
