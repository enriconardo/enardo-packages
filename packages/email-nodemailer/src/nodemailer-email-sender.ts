import nodemailer from "nodemailer";
import type { SendMailOptions, Transporter } from "nodemailer";
import SMTPPool from "nodemailer/lib/smtp-pool";
import SMTPTransport from "nodemailer/lib/smtp-transport";
import {
  EmailRecipientsRefusedError,
  EmailSendFailedError,
  InvalidEmailMessageError,
} from "@enardo/email";
import type {
  EmailErrorCause,
  EmailMessage,
  EmailRecipient,
  EmailSender,
  RefusedEmailRecipient,
  SendEmailOptions,
} from "@enardo/email";
import { envelopeFormOf, isAcceptedAddress } from "./address";
import { InvalidEmailSenderOptionsError } from "./errors";
import { createNoopLogger, type Logger, withLoggerContext } from "./logger";

/**
 * nodemailer's SMTP options, from which the sender creates its transporter.
 * A pool is refused: it keeps a connection open after a send, which nothing
 * would close. So is LMTP, which hands the message to its final mailbox
 * store rather than to a relay.
 */
export type NodemailerSmtpOptions = Omit<
  SMTPTransport.Options,
  "pool" | "lmtp"
> & {
  pool?: false;
  lmtp?: false;
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
   * when nodemailer would build from it a pool, anything but an SMTP
   * transport, or one that speaks LMTP, or when the address of `defaultFrom`
   * is refused, or when nodemailer throws while it reads `transport` (the
   * `cause` holds its `name` and `code` only).
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
   * an address is refused, when there is no sender, or when `subject`,
   * `text` or `html` is not a string (`html` is absent only when
   * `undefined`).
   * @throws {EmailRecipientsRefusedError} (rejects) when the relay refused
   * recipients, some or all.
   * @throws {EmailSendFailedError} (rejects) for any other rejection of
   * nodemailer, with its identifiers in `cause`, and for a refusal whose
   * recipients the sender cannot name.
   */
  send(message: EmailMessage, options?: SendEmailOptions): Promise<void>;
  // `options` holds `tags` only, which SMTP has nowhere to keep: the
  // implementation never reads it.
  async send(message: EmailMessage): Promise<void> {
    const mailOptions = this.toMailOptions(message);
    const recipientsCount = mailOptions.to.length;
    // Taken before the send: nodemailer writes into the mailboxes it gets.
    const envelope = mailOptions.to.map(({ address }) =>
      envelopeFormOf(address),
    );

    // Counts and flags only: no address, name, subject or body.
    this.logger.debug("Sending email.", {
      recipientsCount,
      hasHtmlBody: Boolean(mailOptions.html),
      hasTextBody: Boolean(mailOptions.text),
    });

    let info: SMTPTransport.SentMessageInfo;
    try {
      info = await this.transporter.sendMail(mailOptions);
    } catch (rejection) {
      // nodemailer rejects with the refusal when the relay refused every
      // recipient, and resolves with it when it took the message for some.
      const identifiers = identifiersOf(rejection);
      const refusal =
        identifiers.code === "EENVELOPE" && identifiers.command === "RCPT TO"
          ? refusalOf(rejection, envelope)
          : undefined;
      throw refusal
        ? this.refused(refusal, recipientsCount)
        : this.failed(identifiers, recipientsCount);
    }

    // SMTPTransport lists every recipient the relay refused in `rejected`.
    if (info.rejected.length > 0) {
      const refusal = refusalOf(info, envelope);
      throw refusal
        ? this.refused(refusal, recipientsCount)
        : this.failed({}, recipientsCount);
    }

    this.logger.info("Email sent.", { recipientsCount });
  }

  private refused(
    refusal: EmailRecipientsRefusedError,
    recipientsCount: number,
  ): EmailRecipientsRefusedError {
    this.logger.warn("Email recipients refused.", {
      recipientsCount,
      refused: refusal.details.refused.length,
    });
    return refusal;
  }

  private failed(
    identifiers: Identifiers,
    recipientsCount: number,
  ): EmailSendFailedError {
    this.logger.warn("Email send failed.", { recipientsCount, ...identifiers });
    const cause = causeOf(identifiers);
    return new EmailSendFailedError(
      { retryable: isRetryable(identifiers) },
      cause && { cause },
    );
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

    const replyToMailbox =
      replyTo !== undefined
        ? toMailbox(replyTo, () => addressRefused("replyTo"))
        : undefined;

    // nodemailer reads an object body as a file (`path`) or a URL (`href`),
    // and an object subject with `prepared` as raw header text, whose line
    // breaks start new headers. Only a string is encoded. The values checked
    // here are the ones passed on.
    const content = { subject, text, html };
    for (const field of ["subject", "text", "html"] as const) {
      const value: unknown = content[field];
      if (
        typeof value !== "string" &&
        !(field === "html" && value === undefined)
      ) {
        throw new InvalidEmailMessageError({ field, reason: "type" });
      }
    }

    return {
      to: mailboxes,
      from: sender,
      replyTo: replyToMailbox,
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

/** nodemailer's identifiers of a failure: the logs and the cause carry them. */
interface Identifiers {
  code?: string;
  command?: string;
  responseCode?: number;
  originalCode?: string;
}

// nodemailer's identifiers of a failure, never its message or its other
// fields, which echo addresses. The rejection is a value the sender does not
// control: each field is read on its own, and a read that throws, or a value
// of another type, counts as missing. A throw here would replace the error
// being reported.
function identifiersOf(error: unknown): Identifiers {
  const identifiers: Identifiers = {};
  const code = readField(error, "code");
  const command = readField(error, "command");
  const responseCode = readField(error, "responseCode");
  const originalCode = readField(error, "originalCode");

  if (typeof code === "string") {
    identifiers.code = code;
  }
  if (typeof command === "string") {
    identifiers.command = command;
  }
  if (typeof responseCode === "number") {
    identifiers.responseCode = responseCode;
  }
  if (typeof originalCode === "string") {
    identifiers.originalCode = originalCode;
  }
  return identifiers;
}

// The cause of an error of the sender: the identifiers, when there are any.
// A copy, since an interface has no index signature to match EmailErrorCause.
function causeOf(identifiers: Identifiers): EmailErrorCause | undefined {
  return Object.keys(identifiers).length > 0 ? { ...identifiers } : undefined;
}

// A connection failed, timed out or was lost: an outage, which a later send
// may get past. A wrong host or port gives the same codes.
// - nodemailer's, on its socket to the relay, and EFETCH on a request it
//   could not complete, such as the OAuth2 token one;
// - the system's, which an HTTP proxy's socket rejects with as they are.
// EPROXY and ETLS are left out: each covers misconfigurations (a proxy that
// refuses its credentials, a missing socks module, a certificate) too.
const CONNECTION_FAILURES = new Set([
  "ECONNECTION",
  "ESOCKET",
  "ETIMEDOUT",
  "EDNS",
  "EFETCH",
  "ECONNREFUSED",
  "ECONNRESET",
  "ENOTFOUND",
  "EAI_AGAIN",
  "EHOSTUNREACH",
  "ENETUNREACH",
  "EPIPE",
]);

// A reply of the relay decides: 5xx is permanent, 4xx transient. Without
// one, a connection that failed is retryable, by nodemailer's code or by the
// one it replaced (`originalCode`, as `EAUTH` keeps `EFETCH`), and anything
// else is not.
function isRetryable({
  code,
  originalCode,
  responseCode,
}: Identifiers): boolean {
  if (responseCode !== undefined && responseCode >= 500 && responseCode < 600) {
    return false;
  }
  if (isTransientReply(responseCode)) {
    return true;
  }
  return [code, originalCode].some(
    (failure) => failure !== undefined && CONNECTION_FAILURES.has(failure),
  );
}

function isTransientReply(responseCode: number | undefined): boolean {
  return (
    responseCode !== undefined && responseCode >= 400 && responseCode < 500
  );
}

// The refusal in `source`, a result or a rejection of nodemailer: each
// address of `rejected`, matched to every index of `to` with that envelope
// form, retryable when its entry of `rejectedErrors` holds a 4xx. LMTP would
// put a refusal after the data in `rejected` alone, so `rejected` decides who
// was refused. `undefined` when the refusal cannot be read: an address that
// is not a string, or names no recipient of `to`, would make the error lie
// about who got the message.
function refusalOf(
  source: unknown,
  envelope: readonly string[],
): EmailRecipientsRefusedError | undefined {
  const addresses = refusedAddressesOf(source);
  if (!addresses?.every((address) => envelope.includes(address))) {
    return undefined;
  }

  const replies = replyCodesOf(source);
  const refused: RefusedEmailRecipient[] = [];
  envelope.forEach((form, index) => {
    if (addresses.includes(form)) {
      refused.push({ index, retryable: isTransientReply(replies.get(form)) });
    }
  });

  const [first, ...rest] = refused;
  return first && new EmailRecipientsRefusedError([first, ...rest]);
}

// `rejected` of `source`, when it is a list of strings with at least one.
function refusedAddressesOf(source: unknown): string[] | undefined {
  const rejected = readField(source, "rejected");

  // `Array.isArray` throws on a revoked Proxy.
  try {
    if (!Array.isArray(rejected)) {
      return undefined;
    }
    const addresses: unknown[] = Array.from(rejected);
    return addresses.length > 0 && addresses.every(isString)
      ? addresses
      : undefined;
  } catch {
    return undefined;
  }
}

// The reply code of each refused address, from `rejectedErrors`: an entry's
// `recipient` and `responseCode`, each read on its own. A list that cannot be
// read gives none, which leaves every recipient not retryable.
function replyCodesOf(source: unknown): Map<string, number> {
  const entries = readField(source, "rejectedErrors");
  const replies = new Map<string, number>();

  // `Array.isArray` throws on a revoked Proxy.
  try {
    if (!Array.isArray(entries)) {
      return replies;
    }
    for (const entry of Array.from(entries as unknown[])) {
      const recipient = readField(entry, "recipient");
      const responseCode = readField(entry, "responseCode");
      if (typeof recipient === "string" && typeof responseCode === "number") {
        replies.set(recipient, replies.get(recipient) ?? responseCode);
      }
    }
  } catch {
    return new Map();
  }
  return replies;
}

function isString(value: unknown): value is string {
  return typeof value === "string";
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
  //   answer one way to the check above and another to nodemailer;
  // - LMTP, from `lmtp` or a `url` with `?lmtp=true` (which wins over
  //   `lmtp: false`), read on the transporter's own copy of the options. LMTP
  //   delivers to a mailbox store with no queue behind it, and nodemailer
  //   keeps the reply of a refusal after the data only when another
  //   recipient was refused before.
  let created: Transporter<SMTPTransport.SentMessageInfo>;
  try {
    created = nodemailer.createTransport(transport);
  } catch (error) {
    // Never the error itself: an option error of nodemailer's can hold the URL,
    // password included (`input` of the URL parser's TypeError).
    const name = readField(error, "name");
    const code = readField(error, "code");
    const cause = causeOf({
      ...(typeof name === "string" && { name }),
      ...(typeof code === "string" && { code }),
    });
    throw new InvalidEmailSenderOptionsError(
      "transport-options",
      cause && { cause },
    );
  }
  if (created.transporter instanceof SMTPPool) {
    throw new InvalidEmailSenderOptionsError("pool");
  }
  if (
    !(created.transporter instanceof SMTPTransport) ||
    created.transporter === transport ||
    created.transporter.options.lmtp
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
