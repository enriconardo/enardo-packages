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
   * its recipients, or all of them. What it rejects with is not part of the
   * contract yet: each implementation documents its errors.
   *
   * Never modifies `message` or `options`.
   */
  send(message: EmailMessage, options?: SendEmailOptions): Promise<void>;
}
