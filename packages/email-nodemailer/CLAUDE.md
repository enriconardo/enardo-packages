# @enardo/email-nodemailer

The nodemailer implementation of `@enardo/email`'s `EmailSender`. The public contract is in [README.md](./README.md); this file holds the rules for changing the package. The reasons behind them, and the probes, are in `docs/specs/2026-10-14-nodemailer-contract-compliance.md`.

## Layout

```
src/nodemailer-email-sender.ts   NodemailerEmailSender, its options, the mailboxes, the reads of nodemailer's results and rejections
src/address.ts                   the grammar of the addresses the sender accepts
src/errors/                      the three error classes, one file each
src/logger.ts                    the Logger interface (a local copy) and the noop logger
__tests__/support/               the SMTP server (and its idle servers), header parsing and the decoder of encoded words, the recording logger, the seeded address generators, the assertions
```

## Recipients

- **Every mailbox reaches nodemailer as a new `{ name, address }` object, made by the sender.**
  - Never a string: nodemailer parses a string as an address list, so a display name, or an address with a comma or a `>`, became other recipients, or another envelope sender on `from`.
  - Never the caller's object: nodemailer writes into the objects it keeps (`_convertAddresses` assigns `address` back), and a frozen one makes `sendMail` throw. `to` is always a new array; `defaultFrom` is copied once by the constructor, then again for each send.
- **What was checked is what is sent.** A getter, or a value that converts to a string differently each time, could answer differently twice:
  - each field of the message, and each `address` and `name`, is read once;
  - the `to` list is copied once (`Array.from`), and the check of its length and the mapping both use the copy. The copy also turns a hole into an entry, which `map` would skip;
  - a recipient that is not an object, or an address that is not a string, is refused, since nodemailer would convert it again. `from` and `replyTo` are absent when `undefined` only: a falsy value goes through the check, and is refused;
  - a name that is not a string is left out.
- **An address reaches the relay unchanged, but for the case of its domain, or the call rejects.** nodemailer normalizes every address, in object form too: it quotes a local part that is not a dot-atom, lowercases the domain and runs it through `url.domainToASCII` (a WHATWG host parser, which also maps characters), and turns `<`, `>` and control characters into spaces. The grammar of `address.ts` keeps what survives that unchanged:
  - a dot-atom of ASCII `atext`, so nothing gets quoted;
  - ASCII labels of letters, digits and hyphens, so the host parser has nothing to map or punycode;
  - a last label that starts with a letter: the host parser reads a domain whose last label is a number (`123`, `0x7f`) as an IPv4 address.

  It was fuzzed against nodemailer 10.1.0 (spec, *Probes*), and cases 15 and 16 of the tests keep checking it against the installed version. A change to the grammar, or a nodemailer upgrade, runs them. An upgrade also asks for `isTransportOptions` to be compared again with `createTransport`'s rule. Any loosening needs a new probe that every address it adds comes out unchanged.

## Sending

- **What the contract rejects, the sender rejects before calling nodemailer**: an empty `to`, a refused address, a missing sender. Nothing is sent, and nothing is logged.
- **A refusal is read from `rejected` of the result**, which `SMTPTransport` always sets. LMTP's failures go there too.
- **nodemailer's rejections pass through as they are**, until `@enardo/email` defines the errors of `send`.
- **The three error classes are interim.** `feature/email/send-errors` (in `docs/backlog.md`) replaces them with the contract's errors. Until then the sender adds no other class.

## Transporters

- **The sender creates its transporter, always, from `transport`.** No transporter of the caller's: the sender guarantees what the README says only for a transporter it owns (a result it can trust, no recipients added by defaults, no pool left open). Decided by the user at checkpoint 2.
- **It is an `SMTPTransport`, never a pool.** The constructor checks the class that nodemailer built, not the options it was given:
  - `instanceof SMTPPool` refuses a pool, which would keep a connection open after a send. A `url` with `?pool=true` turns one on even with `pool: false`, and only nodemailer reads `pool`, so a getter cannot answer the check differently. A pool connects on its first send, so the refused one has nothing to close;
  - `instanceof SMTPTransport` refuses the rest: a stream, JSON or sendmail transport, from flags the types let through in a variable. A stream transport resolves without sending anything;
  - `created.transporter === transport` refuses a transport object that nodemailer took as it is. The check before `createTransport` refuses every object with a `send` method, so only a `send` getter, or a Proxy, that answers the two reads differently gets here; such an object has `mailer` and an `error` listener by then. On an `SMTPPool` subclass it gets `pool` instead, from the check before it.
- **What nodemailer would not read as options is refused before `createTransport`** (`isTransportOptions`, nodemailer's own rule but for `direct:`): an object with a `send` function, or a value that is neither an object nor an `smtp:` or `smtps:` URL, in any case. nodemailer's rule also takes a `direct:` URL as options, then sends to `localhost:587`, so the sender refuses it. `Mail` writes `mailer` into a transport object it takes, and listens to its `error`: refused afterwards, the caller's object would stay changed, and wired to an orphan `Mail` that throws on its next `error`. The identity check after `createTransport` stays, for a `send` getter that answers differently to the two reads.
- **`transport` reaches `createTransport` as it is, never as a copy.** `createTransport` reads `url`, `pool` and the transport flags through the prototype chain, and a spread lost them: a class instance with a `url` getter went to `localhost:587`, in the second review.

## Logs

- **The logs carry counts, flags, and nodemailer's identifiers**: `code`, `command`, `responseCode`. They never carry an address, a name, a subject, a body, or an error object. nodemailer's errors echo addresses in `message`, `response`, `rejected` and `rejectedErrors`.
- **The rejection is a value the sender does not control**: `transport.getSocket`, a callback of the caller's, makes nodemailer reject with whatever it calls back with. Each identifier is read on its own, in a `try`, and only at the top level. A read that throws, or a value of another type, counts as missing. A throw there would replace the error being reported.

## Tests

- **No network.** A local SMTP server on `node:net` stands in for the relay. It records each message's envelope (`MAIL FROM`, `RCPT TO`) and raw text, refuses or defers recipients by domain, and can drop the connection after `DATA`. Rejections the server cannot produce go through `transport.getSocket`.
- **Nothing sent.** A test that expects nothing to be sent points its sender at an idle server of its own; each file checks once, after its tests, that no idle server saw a connection.
- **Names** are compared exactly with the ones given, after decoding the header's encoded words: a mailbox sent as a string with an escaped name loses its line breaks, and fails.
- **Node only.** The package runs nowhere else, so the tests import `node:*` freely and have no browser project.
- **Entry point only.** The tests import the package from `~/index`. Each case carries its number in the spec.
