# @enardo/email-nodemailer

The nodemailer implementation of [`@enardo/email`](../email/README.md)'s `EmailSender`. `NodemailerEmailSender` sends through an SMTP server that it connects to for each message.

```ts
import { NodemailerEmailSender } from "@enardo/email-nodemailer";

const emailSender = new NodemailerEmailSender({
  transport: { host: "smtp.example.com", port: 587, auth: { user, pass } },
  defaultFrom: { address: "noreply@example.com", name: "Example" },
  logger,
});

await emailSender.send({
  to: { address: "anna@example.com", name: "Anna Rossi" },
  subject: "Welcome",
  text: "Hello Anna",
});
```

> Published to the `@enardo` registry. `nodemailer` `^10.1.0` is a peer dependency: install it beside the package.

## Exports

| Export | Meaning |
| --- | --- |
| `NodemailerEmailSender` | Implements `EmailSender` |
| `NodemailerEmailSenderOptions` | The constructor options: `transport`, `defaultFrom`, `logger` |
| `NodemailerSmtpOptions` | nodemailer's SMTP options, with no pool |
| `InvalidEmailSenderOptionsError`, `InvalidEmailMessageError`, `EmailRecipientsRefusedError` | What the constructor throws and `send` rejects with: see [Errors](#errors) |
| `InvalidEmailSenderOptionsReason`, `InvalidEmailMessageDetails` | The type of `InvalidEmailSenderOptionsError`'s `details.reason`, and of `InvalidEmailMessageError`'s `details` |
| `Logger`, `LoggerMetadata` | What `logger` must implement |

## Options

- **`transport`** (required): nodemailer's SMTP options. The sender creates its transporter from them, which opens a connection for each message and closes it once the message is sent. The constructor throws `InvalidEmailSenderOptionsError` when `transport` is missing (counted as missing when falsy), and when nodemailer would build from it anything but that:
  - a pool (`pool: true`, or a `url` with `?pool=true`): it keeps a connection open after a send, and nothing would close it. The types refuse `pool: true` too;
  - another transport, from flags the types let through in a variable (`streamTransport`, `jsonTransport`, `sendmail`): a stream transport, for one, resolves without sending anything;
  - anything nodemailer would not read as options: a transport object (an object with a `send` function, an `SMTPTransport` instance included), or a value that is neither an object nor an `smtp:` or `smtps:` URL, in any case. The sender refuses these before nodemailer sees them, so nodemailer writes nothing into your object, unless a `send` getter, or a Proxy, answers the sender and nodemailer differently. A `direct:` URL is refused too: nodemailer 10 sends it to `localhost:587`.

  An error nodemailer itself throws while it reads the options, such as for a `url` it cannot parse, or for legacy SES options (`ECONFIG`), passes through the constructor as it is.
- **`defaultFrom`**: the sender of a message without `from`. Its address is checked by the constructor, which throws when it is refused (see [Addresses](#addresses)).
- **`logger`**: see [Logs](#logs).

## Addresses

The sender accepts an address that nodemailer hands to the relay as it is: an `address` reaches the envelope and the header unchanged, but for its domain, which nodemailer writes in lowercase. The address must have these parts:

- a local part made of the characters ``A–Z a–z 0–9 ! # $ % & ' * + - / = ? ^ _ ` { | } ~``, in groups joined by single dots;
- `@`;
- a domain made of labels joined by single dots: letters, digits and hyphens, with no hyphen at either end of a label. The last label starts with a letter.

Any other address in `to`, `from` or `replyTo` makes `send` reject, before anything is sent. The reason is that nodemailer normalizes every address it gets, and turns some into other recipients:

- `victim@example.com, attacker@evil.com` goes to `"victim@example.com, attacker"@evil.com`;
- `user@123` goes to `user@0.0.0.123`;
- `a@ｅｘａｍｐｌｅ.com`, in full-width letters, goes to `a@example.com`.

It refuses some valid addresses too:

- a quoted local part (`"a b"@example.com`);
- an international address: give an international domain in its `xn--` form;
- an address literal (`user@[192.0.2.1]`).

**Names** may hold any text: quotes, commas, angle brackets, line breaks. nodemailer quotes or encodes a name for its header, so it never becomes header syntax. The sender trims a name, and leaves out a blank one, so the header holds the bare address.

**Recipients the types refuse** are checked at run time too. A recipient that is not an object, a hole in the `to` list or a `from` or `replyTo` of `null` or `""` included, or an address that is not a string, is refused like a refused address. `from` and `replyTo` are absent only when `undefined`. A name that is not a string is left out. `subject`, `text` and `html` are passed to nodemailer as they are: keep them strings, as the types ask. nodemailer reads an object body with a `path` from a file, and writes an object subject with `prepared` as raw header text.

## `send`

`send` resolves once the relay has accepted the message for every recipient.

| When | Rejects with | Sent | Logged |
| --- | --- | --- | --- |
| `to` is an empty list | `InvalidEmailMessageError`, `{ field: "to", reason: "empty" }` | no | no |
| an address is refused | `InvalidEmailMessageError`, `{ field, reason: "address" }`, with `index` in `to` | no | no |
| neither `from` nor `defaultFrom` | `InvalidEmailMessageError`, `{ field: "from", reason: "missing" }` | no | no |
| the relay took the message for some recipients, and refused the others | `EmailRecipientsRefusedError`, `{ refused }` | to the others | `warn` |
| nodemailer rejected: every recipient refused, the connection refused or lost, authentication failed, the message refused | nodemailer's error, as it is | maybe: a lost answer can follow a delivered message | `warn` |

- **Never a throw.** `send` never throws: every failure is a rejection.
- **The caller's values.** It never writes into the message or the options. A getter of yours that throws makes `send` reject with what it threw.
- **nodemailer's errors** are plain `Error`s with a `code` (`EENVELOPE`, `ESOCKET`, `ECONNECTION`, `EAUTH`, `EMESSAGE`, …), and often a `command` and a `responseCode`. They carry the addresses that the server echoed, in `message`, `response`, `rejected` and `rejectedErrors`: anything that logs them logs those addresses.

**Options of a send:**
- `tags` are dropped: SMTP has nowhere to keep them. A dropped tag loses no mail.

## Errors

The three classes extend `BaseError` of `@enardo/errors`; none extends another. Their messages and `details` hold no address, name, subject or body.

| Class | `code` | `details` |
| --- | --- | --- |
| `InvalidEmailSenderOptionsError` | `INVALID_EMAIL_SENDER_OPTIONS` | `{ reason: "no-transport" \| "pool" \| "not-smtp" \| "default-from" }` |
| `InvalidEmailMessageError` | `INVALID_EMAIL_MESSAGE` | `{ field: "to", reason: "empty" }`, `{ field: "to", reason: "address", index }`, `{ field: "from" \| "replyTo", reason: "address" }`, or `{ field: "from", reason: "missing" }` |
| `EmailRecipientsRefusedError` | `EMAIL_RECIPIENTS_REFUSED` | `{ refused }`: how many recipients the relay did not accept |

`@enardo/email` does not define yet what `send` rejects with, so these errors are the sender's own until it does.

## Logs

Pass a `logger` to get the logs below. When it has a `child` method, the sender calls it once, with the context `"NodemailerEmailSender"`.

| Outcome | Level | Message | Metadata |
| --- | --- | --- | --- |
| the message passed the checks, before it is sent | `debug` | `Sending email.` | `{ recipientsCount, hasHtmlBody, hasTextBody }` |
| sent | `info` | `Email sent.` | `{ recipientsCount }` |
| `EmailRecipientsRefusedError` | `warn` | `Email refused for some recipients.` | `{ recipientsCount, refused }` |
| nodemailer rejected | `warn` | `Email send failed.` | `{ recipientsCount }`, plus `code`, `command` and `responseCode` when the rejection has them |

- **Nothing personal.** The logs carry no address, name, subject or body, and not the error itself.
- **Levels.** A failure is logged at `warn`: you rethrow or log the error, at the level you judge right.
- **The caller's errors** of the table above are not logged.
- **nodemailer's own logger** is off unless `transport` sets `logger`. When it is on, it logs the recipients.

## Against `@enardo/email`'s contract

The sender meets the contract's rules, with these limits:

- it refuses some valid addresses (see [Addresses](#addresses));
- it gives no access to its transporter: a `socks` proxy, which needs its module set on the transporter (`set("proxy_socks_module", …)`), rejects every send (`EPROXY`), and no nodemailer plugin (`use()`) can be added;
- a refusal has two errors: nodemailer's when the relay refuses every recipient, `EmailRecipientsRefusedError` when it refuses some.

## Contributing

Run these inside `packages/email-nodemailer`:

```sh
pnpm format && pnpm lint && pnpm typecheck && pnpm test
```

The tests use no network: a local SMTP server stands in for the relay. The rules for changing the package are in [CLAUDE.md](./CLAUDE.md).
