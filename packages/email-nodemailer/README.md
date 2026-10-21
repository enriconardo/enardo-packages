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
| `NodemailerSmtpOptions` | nodemailer's SMTP options, with no pool and no LMTP |
| `InvalidEmailSenderOptionsError` | What the constructor throws: see [Errors](#errors) |
| `InvalidEmailSenderOptionsReason` | The type of its `details.reason` |
| `Logger`, `LoggerMetadata` | What `logger` must implement |

`send` rejects with the errors of `@enardo/email`, which the package does not re-export: import them from there.

## Options

- **`transport`** (required): nodemailer's SMTP options. The sender creates its transporter from them, which opens a connection for each message and closes it once the message is sent. The constructor throws `InvalidEmailSenderOptionsError` when `transport` is missing (counted as missing when falsy), and when nodemailer would build from it anything but that:
  - a pool (`pool: true`, or a `url` with `?pool=true`): it keeps a connection open after a send, and nothing would close it. The types refuse `pool: true` too;
  - another transport, from flags the types let through in a variable (`streamTransport`, `jsonTransport`, `sendmail`): a stream transport, for one, resolves without sending anything;
  - LMTP (`lmtp: true`, or a `url` with `?lmtp=true`, which wins over `lmtp: false`): it hands the message to its final mailbox store, with no queue behind it, and nodemailer would not always keep the reply of a recipient it refuses. The types refuse `lmtp: true` too;
  - anything nodemailer would not read as options: a transport object (an object with a `send` function, an `SMTPTransport` instance included), or a value that is neither an object nor an `smtp:` or `smtps:` URL, in any case. The sender refuses these before nodemailer sees them, so nodemailer writes nothing into your object, unless a `send` getter, or a Proxy, answers the sender and nodemailer differently. A `direct:` URL is refused too: nodemailer 10 sends it to `localhost:587`.

  An error nodemailer throws while it reads the options, such as for a `url` it cannot parse, or for legacy SES options (`ECONFIG`), becomes an `InvalidEmailSenderOptionsError` with the reason `transport-options`. Its `cause` holds the `name` and `code` of what nodemailer threw, each only when it is a string, and nothing else: the error's message and fields can hold the URL, password included.
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

`send` resolves once the relay has accepted the message for every recipient. It rejects with the errors of `@enardo/email`:

| When | Rejects with | Sent | Logged |
| --- | --- | --- | --- |
| `to` is an empty list | `InvalidEmailMessageError`, `{ field: "to", reason: "empty" }` | no | no |
| an address is refused | `InvalidEmailMessageError`, `{ field, reason: "address" }`, with `index` in `to` | no | no |
| neither `from` nor `defaultFrom` | `InvalidEmailMessageError`, `{ field: "from", reason: "missing" }` | no | no |
| the relay refused recipients, some or all | `EmailRecipientsRefusedError`, `{ refused }`: `{ index, retryable }` for each | to the others, if any | `warn` |
| any other failure: the connection refused or lost, a timeout, authentication failed, the sender or the message refused, `maxRecipients` exceeded | `EmailSendFailedError`, `{ retryable }`, with nodemailer's identifiers in `cause` | maybe: a lost answer can follow a delivered message | `warn` |

- **Never a throw.** `send` never throws: every failure is a rejection.
- **The caller's values.** It never writes into the message or the options. A getter of yours that throws makes `send` reject with what it threw.
- **`refused`** lists every entry of `to` that the relay refused. nodemailer writes the domain of an address in lowercase, and sends two addresses that differ only there once: both entries are listed.
- **`retryable`**, for a refused recipient, is true when the relay answered its `RCPT TO` with a `4xx`. For an `EmailSendFailedError`, it is false on a `5xx` reply, true on a `4xx`, and, with neither, true when a connection failed, timed out or was lost: to the relay, to an HTTP `proxy`, or to an OAuth2 token endpoint. Those are nodemailer's `ECONNECTION`, `ESOCKET`, `ETIMEDOUT`, `EDNS` and `EFETCH`, and the system's `ECONNREFUSED`, `ECONNRESET`, `ENOTFOUND`, `EAI_AGAIN`, `EHOSTUNREACH`, `ENETUNREACH` and `EPIPE`, as `code` or `originalCode`. Some misconfigurations give those codes too: a wrong host or port, or a token URL that nodemailer cannot request (`ftp:`, or `https:` to a plain HTTP server, both `EFETCH`). Bound your retries.
  - Not retryable: `EPROXY` (a proxy that answers with an error or closes before the tunnel, or a missing socks module), `ETLS`, `EOAUTH2` (a token endpoint's answer nodemailer cannot use), and an `EAUTH` with no `originalCode`. Each mixes misconfigurations with outages: a token endpoint that answers `503` comes out permanent.
- **`cause`** of an `EmailSendFailedError` holds nodemailer's identifiers, each when present: `code` (`ESOCKET`, `EENVELOPE`, `EAUTH`, …, or the system's own, `ECONNREFUSED`, from a proxy's socket), `command` (`CONN`, `MAIL FROM`, `DATA`, …), `responseCode`, and `originalCode`, the code nodemailer replaced with its own: the system's under `ESOCKET` or `EDNS` (`ECONNREFUSED`, `ENOTFOUND`), or nodemailer's under `EAUTH` (`EFETCH`, `EOAUTH2`). It has none of nodemailer's other fields, which echo the addresses the server sent back, nor the server's text; nodemailer's own logger shows that text (see [Logs](#logs)).

**Options of a send:**
- `tags` are dropped: SMTP has nowhere to keep them. A dropped tag loses no mail.

## Errors

`send` rejects with the errors of `@enardo/email`: see `send`, above, and that package's README. The constructor throws the package's own:

| Class | `code` | `details` |
| --- | --- | --- |
| `InvalidEmailSenderOptionsError` | `INVALID_EMAIL_SENDER_OPTIONS` | `{ reason: "no-transport" \| "pool" \| "not-smtp" \| "default-from" \| "transport-options" }`; `not-smtp` covers LMTP too |

It extends `BaseError` of `@enardo/errors`. Its message and `details` hold no address. For `transport-options`, the `cause` is `{ name, code }` of the error nodemailer threw, each left out when missing or not a string, and absent when both are.

## Logs

Pass a `logger` to get the logs below. When it has a `child` method, the sender calls it once, with the context `"NodemailerEmailSender"`.

| Outcome | Level | Message | Metadata |
| --- | --- | --- | --- |
| the message passed the checks, before it is sent | `debug` | `Sending email.` | `{ recipientsCount, hasHtmlBody, hasTextBody }` |
| sent | `info` | `Email sent.` | `{ recipientsCount }` |
| `EmailRecipientsRefusedError` | `warn` | `Email recipients refused.` | `{ recipientsCount, refused }`: how many entries `refused` lists |
| `EmailSendFailedError` | `warn` | `Email send failed.` | `{ recipientsCount }`, plus `code`, `command`, `responseCode` and `originalCode` when the rejection has them: the fields of its `cause` |

- **Nothing personal.** The logs carry no address, name, subject or body, and not the error itself.
- **Levels.** A failure is logged at `warn`: you rethrow or log the error, at the level you judge right.
- **The caller's errors** of the table above are not logged.
- **nodemailer's own logger** is off unless `transport` sets `logger`. When it is on, it logs the recipients.

## Against `@enardo/email`'s contract

The sender meets the contract's rules, with these limits:

- it refuses some valid addresses (see [Addresses](#addresses));
- it gives no access to its transporter: a `socks` proxy, which needs its module set on the transporter (`set("proxy_socks_module", …)`), rejects every send (`EPROXY`), and no nodemailer plugin (`use()`) can be added.

## Contributing

Run these inside `packages/email-nodemailer`:

```sh
pnpm format && pnpm lint && pnpm typecheck && pnpm test
```

The tests use no network: a local SMTP server stands in for the relay. The rules for changing the package are in [CLAUDE.md](./CLAUDE.md).
