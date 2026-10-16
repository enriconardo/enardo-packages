import nodemailer from "nodemailer";
import type { SendMailOptions, Transporter } from "nodemailer";
import SMTPPool from "nodemailer/lib/smtp-pool";
import SMTPTransport from "nodemailer/lib/smtp-transport";
import type {
  EmailMessage,
  EmailRecipient,
  EmailSender,
  SendEmailOptions,
} from "@enardo/email";
import { isAcceptedAddress } from "./address";
import {
  EmailRecipientsRefusedError,
  InvalidEmailMessageError,
  InvalidEmailSenderOptionsError,
} from "./errors";
import {
  createNoopLogger,
  type Logger,
  type LoggerMetadata,
  withLoggerContext,
} from "./logger";

/**
 * nodemailer's SMTP options, from which the sender creates its transporter.
 * A pool is refused: it keeps a connection open after a send, which nothing
 * would close.
 */
export type NodemailerSmtpOptions = Omit<SMTPTransport.Options, "pool"> & {
  pool?: false;
};

/** Options of `NodemailerEmailSender`. */
export interface NodemailerEmailSenderOptions {
  /** The SMTP options of the transporter that the sender creates. */
  transport: NodemailerSmtpOptions;
  /** The sender of a message without `from`. Its address is checked here. */
  defaultFrom?: EmailRecipient;
  logger?: Logger;
}

/**
 * Sends email through nodemailer, with an SMTP transporter that it creates
 * from `transport` and that holds no connection between sends.
 *
 * It accepts only the addresses that nodemailer hands to the relay unchanged
 * (see the README), and logs no address, name, subject or body.
 */
export class NodemailerEmailSender implements EmailSender {
  private readonly transporter: Transporter<SMTPTransport.SentMessageInfo>;
  private readonly defaultFrom?: Mailbox;
  private readonly logger: Logger;

  /**
   * @throws {InvalidEmailSenderOptionsError} when there is no `transport`,
   * when nodemailer would build from it a pool or anything but an SMTP
   * transport, or when the address of `defaultFrom` is refused.
   */
  constructor(options: NodemailerEmailSenderOptions) {
    this.transporter = transporterOf(options.transport);

    if (options.defaultFrom) {
      this.defaultFrom = toMailbox(
        options.defaultFrom,
        () => new InvalidEmailSenderOptionsError("default-from"),
      );
    }

    this.logger = withLoggerContext(
      options.logger ?? createNoopLogger(),
      "NodemailerEmailSender",
    );
  }

  /**
   * Sends `message`, as `@enardo/email`'s contract says. `tags` are dropped:
   * SMTP has nowhere to keep them.
   *
   * @throws {InvalidEmailMessageError} (rejects) when `to` is empty, when
   * an address is refused, or when there is no sender.
   * @throws {EmailRecipientsRefusedError} (rejects) when the relay took the
   * message for some recipients only.
   *
   * When nodemailer rejects, `send` rejects with its error, as it is.
   */
  send(message: EmailMessage, options?: SendEmailOptions): Promise<void>;
  // `options` holds `tags` only, which SMTP has nowhere to keep: the
  // implementation never reads it.
  async send(message: EmailMessage): Promise<void> {
    const mailOptions = this.toMailOptions(message);
    const recipientsCount = mailOptions.to.length;

    // Counts and flags only: no address, name, subject or body.
    this.logger.debug("Sending email.", {
      recipientsCount,
      hasHtmlBody: Boolean(mailOptions.html),
      hasTextBody: Boolean(mailOptions.text),
    });

    let refused: number;
    try {
      // SMTPTransport lists every recipient the relay refused in `rejected`.
      const info = await this.transporter.sendMail(mailOptions);
      refused = info.rejected.length;
    } catch (error) {
      this.logger.warn("Email send failed.", {
        recipientsCount,
        ...identifiersOf(error),
      });
      throw error;
    }

    if (refused > 0) {
      this.logger.warn("Email refused for some recipients.", {
        recipientsCount,
        refused,
      });
      throw new EmailRecipientsRefusedError(refused);
    }

    this.logger.info("Email sent.", { recipientsCount });
  }

  // Every field of the message is read once, and the list of recipients is
  // copied once: a getter, or a list whose length changes, could answer
  // differently to the check and to the copy. The copy also turns a hole
  // into an entry, which `map` would skip.
  private toMailOptions(message: EmailMessage) {
    const { to, from, replyTo, subject, text, html } = message;
    const recipients = isRecipientList(to) ? Array.from(to) : [to];

    if (recipients.length === 0) {
      throw new InvalidEmailMessageError({ field: "to", reason: "empty" });
    }

    const mailboxes = recipients.map((recipient, index) =>
      toMailbox(
        recipient,
        () =>
          new InvalidEmailMessageError({
            field: "to",
            reason: "address",
            index,
          }),
      ),
    );
    // An optional field is absent when it is `undefined` only: any other
    // value, a falsy one included, goes through the check of a mailbox.
    const sender =
      from !== undefined
        ? toMailbox(from, () => addressRefused("from"))
        : this.defaultFrom && { ...this.defaultFrom };

    // Without a sender, nodemailer writes no From header and sends
    // `MAIL FROM:<>`, the null sender of bounces.
    if (!sender) {
      throw new InvalidEmailMessageError({ field: "from", reason: "missing" });
    }

    return {
      to: mailboxes,
      from: sender,
      replyTo:
        replyTo !== undefined
          ? toMailbox(replyTo, () => addressRefused("replyTo"))
          : undefined,
      subject,
      text,
      html,
    } satisfies SendMailOptions;
  }
}

/**
 * A mailbox as nodemailer gets it: always a new object of the sender's, never
 * a string, which nodemailer would parse as an address list, nor the
 * caller's object, which it would write into (a frozen one makes it throw).
 */
interface Mailbox {
  name?: string;
  address: string;
}

// The types do not reach every caller, so the recipient is checked as a
// value: an entry that is not an object, or an address that is not a string,
// is refused. A string is read once, so the address checked is the one sent;
// anything else nodemailer would convert again, and could get another
// answer. A name that is not a string is left out, and so is a blank one,
// which nodemailer would write as an empty phrase.
function toMailbox(recipient: unknown, refuse: () => Error): Mailbox {
  if (typeof recipient !== "object" || recipient === null) {
    throw refuse();
  }

  const { address, name } = recipient as { address?: unknown; name?: unknown };

  if (typeof address !== "string" || !isAcceptedAddress(address)) {
    throw refuse();
  }

  const trimmed = typeof name === "string" ? name.trim() : "";
  return trimmed ? { name: trimmed, address } : { address };
}

// nodemailer's identifiers of a failure, never its message or its other
// fields, which echo addresses. The rejection is a value the sender does not
// control: each field is read on its own, and a read that throws, or a value
// of another type, counts as missing. A throw here would replace the error
// being reported.
function identifiersOf(error: unknown): LoggerMetadata {
  const identifiers: LoggerMetadata = {};
  const code = readField(error, "code");
  const command = readField(error, "command");
  const responseCode = readField(error, "responseCode");

  if (typeof code === "string") {
    identifiers.code = code;
  }
  if (typeof command === "string") {
    identifiers.command = command;
  }
  if (typeof responseCode === "number") {
    identifiers.responseCode = responseCode;
  }
  return identifiers;
}

function readField(value: unknown, key: string): unknown {
  if (typeof value !== "object" || value === null) {
    return undefined;
  }

  try {
    return (value as Record<string, unknown>)[key];
  } catch {
    return undefined;
  }
}

function addressRefused(field: "from" | "replyTo"): InvalidEmailMessageError {
  return new InvalidEmailMessageError({ field, reason: "address" });
}

// The types refuse what this refuses, but a caller the types do not reach
// can pass anything: `transport` counts as present when it is truthy.
function transporterOf(
  transport: NodemailerSmtpOptions,
): Transporter<SMTPTransport.SentMessageInfo> {
  if (!transport) {
    throw new InvalidEmailSenderOptionsError("no-transport");
  }

  // Before nodemailer sees it: `Mail` writes `mailer` into a transport object
  // it takes, and listens to its `error`, so a refusal after createTransport
  // would leave the caller's object changed, and wired to an orphan `Mail`.
  if (!isTransportOptions(transport)) {
    throw new InvalidEmailSenderOptionsError("not-smtp");
  }

  // `transport` goes to nodemailer as it is: createTransport reads `url`,
  // `pool` and the transport flags through the prototype chain, which a copy
  // of own properties would lose. The checks are on what nodemailer built, so
  // they read nothing nodemailer did not. They refuse:
  // - a pool, from `pool` or a `url` with `?pool=true` (which wins over
  //   `pool: false`). It connects on its first send, so the refused one has
  //   nothing to close;
  // - anything but an SMTPTransport: a stream, JSON or sendmail transport,
  //   from flags the types let through in a variable, would not hand the
  //   message to the relay the way `send` reports. A stream transport
  //   resolves without sending anything;
  // - `transport` itself, taken as the transporter: a `send` getter can
  //   answer one way to the check above and another to nodemailer.
  const created = nodemailer.createTransport(transport);
  if (created.transporter instanceof SMTPPool) {
    throw new InvalidEmailSenderOptionsError("pool");
  }
  if (
    !(created.transporter instanceof SMTPTransport) ||
    created.transporter === transport
  ) {
    throw new InvalidEmailSenderOptionsError("not-smtp");
  }
  return created;
}

// What createTransport reads as options, by its own rule: an object without a
// `send` function, or an SMTP URL. Anything else it takes as a transport
// object, or fails on with a native error. Its rule also reads a `direct:`
// URL as options, which nodemailer 10 turns into an unused `direct: true`,
// and sends to `localhost:587`: the sender refuses one.
function isTransportOptions(transport: unknown): boolean {
  if (typeof transport === "string") {
    return /^smtps?:/i.test(transport);
  }

  return (
    typeof transport === "object" &&
    transport !== null &&
    typeof (transport as { send?: unknown }).send !== "function"
  );
}

// `Array.isArray` narrows to `any[]`, which a readonly array is not, so its
// false branch would keep `readonly EmailRecipient[]`.
function isRecipientList(
  recipients: EmailRecipient | readonly EmailRecipient[],
): recipients is readonly EmailRecipient[] {
  return Array.isArray(recipients);
}
