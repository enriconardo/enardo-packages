import addressparser from "nodemailer/lib/addressparser";
import type { MailboxAddress } from "nodemailer/lib/addressparser";
import { expect } from "vitest";
import { decodeEncodedWords } from "./encoded-words";

// Readers of a raw message's headers, as the SMTP server received it.

/**
 * The header section of `raw`, unfolded: one entry per header. Any line
 * break ends a line, a bare CR or LF included, so that a header injected
 * through one shows up as a header of its own.
 */
export function unfoldedHeaders(raw: string): string[] {
  const headers: string[] = [];
  for (const line of raw.split(/\r\n|\r|\n/)) {
    if (line === "") {
      break;
    }
    const last = headers.length - 1;
    if (/^[ \t]/.test(line) && last >= 0) {
      headers[last] = `${headers[last] ?? ""}${line}`;
    } else {
      headers.push(line);
    }
  }
  return headers;
}

/**
 * The values of every header of `raw` named `name` (in any case), unfolded,
 * without the name and the colon, and trimmed.
 */
export function headerValues(raw: string, name: string): string[] {
  const prefix = `${name.toLowerCase()}:`;
  return unfoldedHeaders(raw)
    .filter((line) => line.toLowerCase().startsWith(prefix))
    .map((line) => line.slice(prefix.length).trim());
}

/**
 * The mailboxes of an address header's value, parsed back with nodemailer's
 * `addressparser`, each name with its encoded words decoded. A bare address
 * has the name `""`.
 */
export function parseMailboxes(value: string): MailboxAddress[] {
  return addressparser(value, { flatten: true }).map((mailbox) => ({
    ...mailbox,
    name: decodeEncodedWords(mailbox.name),
  }));
}

/**
 * The mailboxes of the one header of `raw` named `name`, parsed back, names
 * decoded. Fails unless there is exactly one such header.
 */
export function mailboxesOf(raw: string, name: string): MailboxAddress[] {
  const values = headerValues(raw, name);
  expect(values, `the ${name} headers`).toHaveLength(1);
  return parseMailboxes(values[0] ?? "");
}
