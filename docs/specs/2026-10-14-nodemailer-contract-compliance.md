---
status: done
type: fix
packages: ["@enardo/email-nodemailer", "@enardo/email"]
branch: fix/email-nodemailer/contract-compliance
---

# `@enardo/email-nodemailer`: meet the email contract

## Why

The item `fix/email-nodemailer/contract-compliance` of `docs/backlog.md`. It comes from the spec of `chore/repo/adapter-drivers` (2026-10-13); the user split it from `chore/email-nodemailer/nodemailer-10` after the architectural review of `@enardo/email-nodemailer` (2026-10-14).

- **A security bug in the adapter's own code.** `send` writes each mailbox as the string `"${name}" <${address}>`, and nodemailer parses that string as an address list. A display name chosen by whoever registers adds a recipient, who then gets Cambusa's verification link. On `from`, the same name replaces the envelope sender (*Probes*). An address without a name is parsed as a list too.
- **The adapter breaks most rules of `@enardo/email`'s contract**, which `refactor/email/contract-docs` stated:
  - it resolves with no sender, with an empty `to` on a stream transport, and when the relay refused some recipients;
  - it ignores `idempotencyKey`;
  - its constructor throws a native `Error`;
  - its error log carries the recipients' addresses.
- **A transporter it creates with `pool: true` keeps the process alive**, and the adapter has no way to close it.
- **It has no tests, no README and no `CLAUDE.md`.**

## Probes

### Setup

- **Where.** On `master` (`82af592`), in throwaway containers of the dev image (`en-monorepo-dev`: Node 24.21.0, TypeScript 5.9.3, nodemailer 10.1.0), with the repo mounted read-only.
- **Builds.** `dist/` was rebuilt first, with `pnpm exec turbo run build --filter=@enardo/email-nodemailer... --force`, and with `--filter=@enardo/logger... --force` for the log probe.
- **What the messages went through.** nodemailer itself, or the adapter's `dist/index.mjs`, to one of two places:
  - a stream transport (`streamTransport: true, buffer: true`), whose result holds the envelope and the raw message;
  - a minimal SMTP server written for the probes. It answers `550` to a `RCPT TO` at `refused.test`, `450` at `deferred.test`, and `550` to a `MAIL FROM` at `refused.test`. On request, it closes the connection after `DATA` without answering, or answers `554`.
- **Types.** `tsc --noEmit` ran over a copy of the package's manifest and `tsconfig.json`, with its `node_modules`, in the `en-probe` volume.

### The adapter on `master`

| Input | Result |
| --- | --- |
| `to` named `x" <attacker@evil.test>, "y` | resolves; the envelope holds `attacker@evil.test` and the victim; `To: x <attacker@evil.test>, y <victim@example.test>` |
| the same name on `replyTo` | `Reply-To: x <attacker@evil.test>, y <support@example.test>` |
| the same name on `from` | the envelope's sender (`MAIL FROM`, where bounces go) is `attacker@evil.test`; `From: x <attacker@evil.test>, y <noreply@example.test>` |
| `address: "victim@example.test, attacker@evil.test"`, no name | two recipients |
| `address: "x>,attacker@evil.test"`, with a name | the recipients `x` and `attacker@evil.test` |
| `to: []`, stream transport | resolves, with no recipient |
| no `from` and no `defaultFrom` | resolves; no `From` header; over SMTP, `MAIL FROM:<>` |
| two recipients, one refused, SMTP | resolves |
| two sends with the same `idempotencyKey`, SMTP | the server sees two `MAIL FROM` |
| `new NodemailerEmailSender({})` | throws a native `Error`, with no `code` |
| both `transport` and `transporter` | `transport` is ignored |
| a refused send, logged through `@enardo/logger` (console, JSON) | the `error` log holds the address in the error's `message`, in `rejected`, and in each of `rejectedErrors` (`message`, `response`, `recipient`); the `debug` log holds the subject |

The `from` row is new: the backlog had `to` and `replyTo` only.

### nodemailer 10.1.0, with `{ name, address }` objects

Read in its source (`dist/esm/mime-node`, `mailer`, `smtp-connection`), then run.

**Names are safe in object form**, in `to`, `from` and `replyTo` alike: the envelope keeps the one address, and the header one mailbox.
- `x" <attacker@evil.test>, "y` and `Anna; Bcc: attacker@evil.test` are written as quoted strings.
- A name with a line break or a non-ASCII character is written as an encoded word (`=?UTF-8?Q?Anna=0D=0ABcc=3A_…?=`); no `Bcc` header appears.
- A blank name (`"   "`) is written as it is: `To:     <a@example.test>`.

**The address is normalized, not kept as given** (`_normalizeAddress`, then `_convertAddresses`):
1. every control character, `<` and `>` becomes a space, and the value is trimmed;
2. the domain is lowercased and goes through `url.domainToASCII` (a WHATWG host parser), or through punycode when that fails;
3. a local part that is neither a dot-atom nor a quoted string gets quoted.

What reaches the relay, in the envelope (`MAIL FROM`, `RCPT TO`) and in the header alike:

| `address` | Reaches the relay as |
| --- | --- |
| `Anna.Rossi@Example.TEST` | `Anna.Rossi@example.test` |
| ``a!#$%&'*+/=?^_`{\|}~-x@example.test`` | unchanged |
| `victim@example.test, attacker@evil.test` | `"victim@example.test, attacker"@evil.test`: one recipient, at the attacker's domain |
| `a,attacker@evil.test` | `"a,attacker"@evil.test` |
| `x>,attacker@evil.test` | `"x ,attacker"@evil.test` |
| `a@b@evil.test` | `"a@b"@evil.test` |
| `a..b@`, `.a@`, `a.@`, `a(comment)@example.test` | the local part quoted |
| `a@example.test\r\nBcc: x@evil.test` | `"a@example.test Bcc: x"@evil.test` |
| ` a@example.test ` | `a@example.test` |
| `user@123`, `user@1.2.3`, `user@0x7f.1` | `user@0.0.0.123`, `user@1.2.0.3`, `user@127.0.0.1`: the host parser reads a domain whose last label is a number as an IPv4 address |
| `user@example.123`, `user@example.0x10` | unchanged |
| `user@jõgeva.ee` | `user@xn--jgeva-dua.ee` |
| `a@ｅｘａｍｐｌｅ.test` (full-width letters) | `a@example.test` |
| `jõ@example.test`, `"a b"@example.test`, `user@[127.0.0.1]`, `user@localhost`, `noat` | unchanged |
| `a@example..test`, `a@ex ample.test`, `a@-x.test`, `a@x_y.test`, `a@example.test.` | unchanged |
| `""`, `"   "` | no recipient: the envelope is empty |

**A grammar that nodemailer leaves unchanged, but for the case of the domain:**

```
address = local "@" domain
local   = atext+ ("." atext+)*      atext: A–Z a–z 0–9 ! # $ % & ' * + - / = ? ^ _ ` { | } ~
domain  = (label ".")* last
label   = alnum (ldh* alnum)?        alnum: A–Z a–z 0–9    ldh: alnum and -
last    = alpha (ldh* alnum)?        alpha: A–Z a–z
```

- **The fuzz.** 100,000 random addresses of the grammar, with:
  - upper and lower case, and every `atext` character;
  - labels of digits only, before the last one;
  - labels with `--` inside, labels starting `xn--` or `XN--`;
  - valid A-labels of random Unicode strings, and invalid `xn--` labels.

  Each reached `getEnvelope()` of nodemailer's `MailComposer` as one recipient, with the local part as given and the domain in lowercase. 2,000 more went through `sendMail` on a stream transport, in `to`, `from` and `replyTo` at once, and came out the same in the envelope and in the three headers. No mismatch.
- **Why `last` starts with a letter.** It keeps out the numbers that the host parser reads as an IPv4 address, decimal or `0x…`. Every top-level domain starts with a letter.
- **What the grammar refuses beyond what nodemailer changes:**
  - quoted local parts;
  - international addresses (an IDN domain is accepted in its `xn--` form);
  - address literals;
  - malformed values that nodemailer leaves alone.

  The contract allows refusing a malformed address. Refusing a valid but rare one is a limitation, which the README states.

**Objects passed in.**
- nodemailer 10.1.0 writes into a recipient object it keeps: `_convertAddresses` assigns its `address` back, even when it is unchanged. A frozen recipient, in `to` or in `from`, makes `sendMail` throw `TypeError: Cannot assign to read only property 'address'`. A frozen list of objects it can write to resolves.
- An unfrozen object shows no change after the send. 6.10.1 added `name: ""` to it (see `refactor/email/contract-docs`).
- An exact duplicate is in the envelope once; `t@example.test` and `T@example.test` stay two.

### Outcomes over SMTP

nodemailer 10.1.0, against the probes' server:

| Case | Result |
| --- | --- |
| two recipients, one refused (`550`) | resolves with `accepted: ["a@example.test"]`, `rejected: ["b@refused.test"]`, and `rejectedErrors` with `responseCode: 550`; the server sees `DATA` |
| two recipients, one deferred (`450`) | the same, with `responseCode: 450` |
| every recipient refused | rejects: `EENVELOPE`, `command: "RCPT TO"`, with own fields `rejected` and `rejectedErrors`; no `DATA` |
| the connection closed after `DATA`, with no answer | rejects: `ECONNECTION`, `CONN`, `Connection closed unexpectedly` |
| `554` after `DATA` | rejects: `EMESSAGE`, `DATA` |
| the sender refused (`550` to `MAIL FROM`) | rejects: `EENVELOPE`, `MAIL FROM` |
| `to: []` | rejects: `EENVELOPE`, `API`, `No recipients defined`; the server sees nothing |

- **Addresses in the results.** Every message and `response` of a refusal carries the address that the server echoed. So do `rejected` and the `recipient` of each entry of `rejectedErrors`.
- **`pending`.** `SentMessageInfo` declares `accepted`, `rejected` and `pending`, each `string[] | undefined`. No transport of 10.1.0 sets `pending`. Its declaration says that LMTP reports it, but LMTP's failures per recipient go to `rejected` (`_actionLMTPStream`).
- **The identifiers of an error** (read in the source):
  - `command` is one of nodemailer's literals: `CONN`, `API`, `MAIL FROM`, `RCPT TO`, `DATA`, `RSET`, `AUTH …`. At most it holds the auth method of the transport's options.
  - `code` is one of its constants.
  - `responseCode` is a number.
- **nodemailer's own logger is off** unless the transport's options set `logger` (`shared.getLogger`, read in the source).

### Pools

- **A pool keeps the process alive.** With `pool: true`, a socket stays open after a send, and the process does not exit: `timeout` killed it after 8 s. After `close()`, it exits within a second, and a send rejects: `ECONNECTION`, `Connection pool was closed`.
- **Without a pool, nothing stays open.** The process exits right after each send. `close()` changes nothing: a send after it opens a new connection.
- **`url` can turn a pool on.** `createTransport` builds a pool when the options it parsed have `pool`, and it parses `url` into them. `{ url: "smtp://…/?pool=true" }` gives a pool, and so does `{ url: "…?pool=true", pool: false }`. The created transporter's `options.pool` is `true` in every case that gave a pool, and absent otherwise.
- **A pool opens no connection before its first send.** The server saw none within 500 ms of `createTransport`, and the process exited.

### Types

On the package's tsconfig, against nodemailer 10.1.0's own declarations, with these options:

```ts
{ defaultFrom?: EmailRecipient } & (
  | { transport: Omit<SMTPTransport.Options, "pool"> & { pool?: false }; transporter?: never }
  | { transporter: Transporter; transport?: never }
)
```

- **Refused.** `{}`, `{ defaultFrom }` alone, and both transports, each with TS2345. `pool: true`, with TS2322. A variable of type `SMTPTransport.Options` (its `pool` is `boolean | undefined`), with TS2322.
- **Compile.** `pool: false`, and the api-server's options: `host`, `port`, `secure`, and `auth` or `undefined`. Transporters of every kind: stream, JSON, pooled, SMTP, and a custom transport.
- **Results.** `Transporter`'s `sendMail` resolves to `SentMessageInfo`, which types `rejected` and `pending`: reading them needs no `any`.

### The callers

- **`@cambusa/api-server`** builds the only sender, with `transport` (`host`, `port`, `secure`, `auth`) and with `defaultFrom` from `SMTP_SENDER_ADDRESS`. That is `no-reply@cambusa.local` in both `.env` examples, which the grammar accepts. Its shutdown ends with `process.exit`.
- **`@cambusa/identity`** sends to one recipient, named `${firstName} ${lastName}`, with the same sender as `from`.
- **Cambusa's routes check addresses before they reach the adapter.** The register and resend routes check the address with zod 3.25.76's `z.string().email()`, and `Email` lowercases it. zod accepts nothing that the grammar refuses, except a domain label that ends with a hyphen (`a@x-.test`):
  - a list of 25 edge cases;
  - 200,000 random mutations of valid addresses: 327 of the addresses zod accepted, the grammar refused, and each of them has such a label.

  No registry issues such a label (hostname syntax forbids it).
- **No test builds the adapter** (`git grep NodemailerEmailSender`). The api-server's `app.test.ts` imports types from the composition root only. No existing test sends an input that this branch refuses.

## Changes

### 1. Recipients

- **Copies, never strings.** Every mailbox (`to`, `from`, `replyTo`, `defaultFrom`) reaches nodemailer as a new `{ name, address }` object that the adapter makes: never a string, never the caller's object. `to` is always a new array.
- **Names.** The name is trimmed. A blank or absent name gives `{ address }` alone.
- **Addresses.** An address that the grammar of *Probes* refuses rejects the call, before anything is sent. The domain reaches the relay in lowercase, as nodemailer writes it.

### 2. `send`

**Superseded at checkpoint 2**: no `idempotencyKey` and no `UnsupportedEmailOptionError`, and `send` reads `rejected` only.

**Before anything is sent**, `send` rejects:
- with `UnsupportedEmailOptionError` when `options.idempotencyKey` is set, to any value but `undefined`: SMTP has no idempotency, and the adapter keeps no keys;
- with `InvalidEmailMessageError` when `to` is an empty list, when an address of `to`, `from` or `replyTo` is refused, or when there is no sender (neither `from` nor `defaultFrom`).

**`tags` are dropped**, as the contract allows: SMTP has nowhere to keep them. The README says so.

**After nodemailer resolves**, `send` reads `rejected` and `pending` of its result.
- Each counts when it is an array. A result that is not an object counts as none.
- When they hold at least one entry, `send` rejects with `EmailRecipientsRefusedError`: the relay took the message for the other recipients.
- A read that throws makes `send` reject with what it threw, and is logged as a failed send.
- Otherwise `send` resolves with `undefined`.

**When nodemailer rejects**, `send` rejects with nodemailer's error, as it is: every recipient refused, a lost answer, a refused connection. Wrapping them is `feature/email/send-errors`'s job.

**Always a rejection.** `send` never throws: it is `async`, so every failure is a rejection.

**The caller's values.** `send` reads `message` and `options`, and writes nothing into them. A getter of the caller's that throws rejects the call with what it threw.

### 3. The constructor

**Superseded at checkpoint 2**: `transport` only, no `transporter`, and the checks of *Checkpoint 2* and *Fourth review follow-ups*.

- **The types.** The options become the union of *Probes*: `transport` or `transporter`, never both, never neither. The type of `transport` refuses `pool: true`.
- **At run time**, for callers the types do not reach, it throws `InvalidEmailSenderOptionsError`:
  - when neither option is present, or both are (present: truthy);
  - when the transporter built from `transport` is a pool. Its `options.pool` says so, which also covers a `url` with `?pool=true`. A refused pool has opened nothing, so it needs no `close()`. **Amended after the second review**: the check is on the class that nodemailer built, `SMTPPool` (see *Second review follow-ups*);
  - when the address of `defaultFrom` is refused.
- **A transporter passed in stays the caller's.** The adapter never closes it, and a pool passed this way works.

### 4. Errors

**Superseded at checkpoint 2**: three classes, without `UnsupportedEmailOptionError`; the reasons of `InvalidEmailSenderOptionsError` are those of *Checkpoint 2*.

Four classes, siblings, each extending `BaseError` of `@enardo/errors` (a new dependency), each with one code. Their messages and `details` hold no address, name, subject or body.

| Class | `code` | `details` | Thrown by |
| --- | --- | --- | --- |
| `InvalidEmailSenderOptionsError` | `INVALID_EMAIL_SENDER_OPTIONS` | `{ reason: "no-transport" \| "two-transports" \| "pool" \| "default-from" }` | the constructor |
| `InvalidEmailMessageError` | `INVALID_EMAIL_MESSAGE` | `{ field: "to" \| "from" \| "replyTo", reason: "empty" \| "address" \| "missing", index? }` | `send`, before sending |
| `UnsupportedEmailOptionError` | `UNSUPPORTED_EMAIL_OPTION` | `{ option: "idempotencyKey" }` | `send`, before sending |
| `EmailRecipientsRefusedError` | `EMAIL_RECIPIENTS_REFUSED` | `{ refused }`: how many recipients the relay did not accept | `send`, once the relay took the message for the others |

- **`index`** is the position in `to` of a refused address, 0 for a single recipient. It is present only then.
- **`reason`** is `"empty"` with `field: "to"`, and `"missing"` with `field: "from"`.

### 5. Logs

**The interface.** The local `Logger` interface gains `warn`, as the copy in `@enardo/http-client` has it.

**What the logs carry:** counts, flags and nodemailer's identifiers; never an address, a name, a subject or a body.

| Outcome | Level | Message | Metadata |
| --- | --- | --- | --- |
| the message passed the checks, before sending | `debug` | `Sending email.` | `{ recipientsCount, hasHtmlBody, hasTextBody }` |
| sent | `info` | `Email sent.` | `{ recipientsCount }` |
| `EmailRecipientsRefusedError` | `warn` | `Email refused for some recipients.` | `{ recipientsCount, refused }` |
| nodemailer rejected, or a read of its result threw | `warn` | `Email send failed.` | `{ recipientsCount }`, plus `code` and `command` (strings) and `responseCode` (a number) of the rejection, when present |

- **`recipientsCount`** is the number of recipients in `to`.
- **The caller's errors are not logged** (`InvalidEmailMessageError`, `UnsupportedEmailOptionError`): nothing was sent.
- **Left out:** `subject`, and the error object.
- **Reading the rejection.** Its three fields are read one by one, each in a `try`. A read that throws, or a value of another type, counts as missing. Only the top level of the rejection is read, so a cycle or a deep value changes nothing. A throw there would replace the error being reported.
- **`child`** is still called once, with the context `"NodemailerEmailSender"`.

### 6. Package files

- **`package.json`.**
  - `@enardo/errors` (`workspace:*`) in `dependencies`.
  - `vitest` (`catalog:`) in `devDependencies`.
  - The scripts `test` and `test:watch`; `lint`, `lint:fix`, `format` and `format:check` over `src __tests__`.
- **`vitest.config.ts`**, with the `~` alias, as in `@enardo/email`.
- **`src/`:**
  - `nodemailer-email-sender.ts`;
  - `address.ts`, the grammar;
  - `errors/`, one file per class, and an `index.ts`;
  - `logger.ts`;
  - `index.ts`.
- **`README.md`.** It covers:
  - what the package is, its exports, and an example;
  - the constructor's options;
  - which addresses it accepts;
  - what `send` resolves and rejects with;
  - the options of a send: `idempotencyKey` rejected, `tags` dropped;
  - the logs;
  - the limits left against `@enardo/email`'s contract. With a `transporter` of the caller's, `send` trusts its `rejected` and `pending`, and sends to whatever recipients its defaults add;
  - how to run the checks.

  It names no package it does not depend on.
- **`CLAUDE.md`.** The invariants of the item:
  - recipients reach nodemailer as copies of `{ name, address }` objects;
  - an address reaches the relay unchanged, but for the case of its domain, or the call rejects; and why each part of the grammar is there;
  - the logs carry counts, flags and identifiers only;
  - no transporter the adapter creates holds a connection between sends.
  - the four error classes are interim: `feature/email/send-errors` replaces them with the contract's errors, and the adapter does not add more in the meantime.

  And how the tests work, without network: a stream transport for headers and envelope, a custom transport for results, a local SMTP server for refusals.

### 7. The backlog

- **`feature/email/send-errors`.** Three facts go into the item:
  - the adapter's four errors are interim: the contract's errors replace or absorb them;
  - when the relay refuses every recipient, the adapter rejects with nodemailer's error, and when it refuses some, with `EmailRecipientsRefusedError`: the contract's error makes these one;
  - nodemailer's errors carry the addresses the server echoed, in own fields (*Probes*), so a `cause` keeps them in a serialized error.
- ***Native errors thrown on purpose*** (*To evaluate*). The adapter's line leaves, and the count goes from twelve to eleven.
- ***`@cambusa/shared`'s `Email` accepts characters…*** (*To evaluate*). The adapter now refuses such addresses: the sentence on its string form says so instead. The domain's check still relies on the routes'.
- **The item itself** leaves the backlog in a commit of its own, before the merge.

No other package changes: the api-server's options compile against the union, and its sender passes the grammar. **Superseded at checkpoint 2**: `@enardo/email` loses `idempotencyKey`.

## Decisions

Confirmed by the user at checkpoint 1 (2026-10-14).

1. **Errors of the adapter's own, rather than `feature/email/send-errors` first.** The item leaves the choice to this spec.
   - The security fix does not wait for a contract design that has questions of its own: whether an error is retryable or permanent, and which recipients a refusal names.
   - The contract allows it: each implementation documents its errors, until the contract defines them.
   - Cost: four classes that the next item replaces. Until then, a refusal has two errors: nodemailer's when every recipient is refused, the adapter's when some are.
   - **At checkpoint 1**, the user asked that their replacement be recorded where it will be found when the time comes. It is in two places: the item `feature/email/send-errors` (*7*), and the adapter's `CLAUDE.md` (*6*).
2. **The grammar of *Probes*, with its limits**: no quoted local part, no international address (an IDN domain in its `xn--` form only), no address literal.
   - The other way to tell is to compare nodemailer's own result (`MailComposer#compile().getEnvelope()`) with the input, before sending. It accepts everything that nodemailer leaves unchanged, but it makes nodemailer's normalization the rule, it compiles every message twice, and it still needs a rule for the case of the domain.
   - The grammar refuses nothing that Cambusa's routes accept, but a label ending with a hyphen (*The callers*).
3. **A pool is refused, rather than given a `close()`.**
   - Without a pool, a transporter holds no connection between sends, so there is nothing to close.
   - A caller who wants a pool builds it, passes it as `transporter`, and closes it.
   - A `close()` would need a rule for a send that comes after it, which nodemailer answers in two ways (*Pools*).
4. **Failures are logged at `warn`, with identifiers only.**
   - The caller logs the error again, at the level it judges right, as with `@enardo/http-client`'s logs. The adapter's `error` log carried addresses.
   - `subject` leaves the logs: a caller can put a name in it.
5. **`defaultFrom` is checked when the sender is built**, so a sender misconfigured at boot fails at boot. `from` is checked at each send.
6. **`pending` counts as refused.** **Superseded at checkpoint 2**: with no transporter of the caller's, the result is always `SMTPTransport`'s, which never sets `pending`. No nodemailer transport sets it, but a caller's `transporter` may, and the contract resolves only once the relay has accepted the message for every recipient.
7. **Names stay trimmed**, as today. A blank name, which nodemailer would write as an empty phrase, gives the bare address.

## Test cases

Test-first: the public API of an `@enardo/*` package, and a security fix. The `test-author` writes them from this spec, in one run in the foreground, in `packages/email-nodemailer/__tests__/`, importing from `~/index`. The tests run on Node only: the package runs nowhere else.

### Support (`__tests__/support/`)

- **A capturing transporter**: a stream transporter (`nodemailer.createTransport({ streamTransport: true, buffer: true })`) that records what each `sendMail` resolved with, so a test reads the envelope and the raw message. A helper unfolds the headers and returns the lines of one of them. Another parses a header back with nodemailer's `addressparser` (`nodemailer/lib/addressparser`).
- **A custom transporter** (`createTransport({ name, version, send })`) that resolves with a result the test gives, or rejects with a value the test gives.
- **A local SMTP server** on `node:net`, as in *Probes*. It counts connections, records commands, and reports when the client closes its socket.
- **A recording logger**, whose `child` records its argument and returns the same logger.
- **Seeded generators**: addresses of the grammar, and mutations of them (a character inserted, replaced or removed, from an alphabet with every special of *Probes*, whitespace, CR, LF and non-ASCII characters).

### Constructor

**At checkpoint 2**, cases 2, 4, 10, 27 and 28 left the suite, and every case moved onto the SMTP server (*Checkpoint 2*).

1. `{ transport }` pointing at the SMTP server builds a sender, and a send reaches the server.
2. `{ transporter }` builds a sender that sends through it.
3. Neither option: a type error (`@ts-expect-error`), and at run time `InvalidEmailSenderOptionsError` with `code` and `details.reason: "no-transport"`.
4. Both options: a type error, and at run time `reason: "two-transports"`.
5. `transport: { …, pool: true }`: a type error, and at run time `reason: "pool"`; the server sees no connection.
6. `transport: { url: "smtp://127.0.0.1:<port>/?pool=true" }`, alone and with `pool: false`: `reason: "pool"`.
7. `transport: { …, pool: false }` builds a sender that sends.
8. `defaultFrom` with a refused address: `reason: "default-from"`. Neither the message nor `toJSON()` holds the address.
9. After a send through a transporter that the adapter created, the server sees the client close its socket.
10. A pooled `transporter` passed in is accepted, and is not closed by the adapter: after a send, its socket stays open until the test closes it.

### Recipients

11. **Names.** Each of these names, on `to`, then `from`, then `replyTo`: `x" <attacker@evil.test>, "y`, `Rossi, Mario`, `Anna; Bcc: attacker@evil.test`, `Anna\r\nBcc: attacker@evil.test`, `Anna\nBcc: attacker@evil.test`, `Zoë <z>`, `日本語`.
    - The envelope holds the given address only: as its one recipient for `to`, as its sender for `from`; for `replyTo`, the envelope does not change.
    - The header, parsed back, is one mailbox with that address. The raw message has no `Bcc` header.
    - For the ASCII names without a line break, the parsed name equals the given one.
12. **Trimming.** `  Mario Rossi  ` gives the name `Mario Rossi`. `   ` gives the bare address, with no display name.
13. **Accepted addresses**, in `to`, `from` and `replyTo`: `anna@example.test`, `Anna.Rossi@Example.TEST`, ``a!#$%&'*+/=?^_`{|}~-x@example.test``, `a.b.c@example.test`, `a@mail-1.example-2.test`, `a@123.example.test`, `a@xn--jgeva-dua.ee`, `a@XN--JGEVA-DUA.EE`, `a@localhost`. The envelope and the header carry the local part as given and the domain in lowercase.
14. **Refused addresses**, in `to` (alone, and at index 1 of a list), `from` and `replyTo`:
    - `victim@example.test, attacker@evil.test`, `a,attacker@evil.test`, `x>attacker@evil.test`, `x>,attacker@evil.test`, `a@b@evil.test`;
    - `"a b"@example.test`, `a..b@example.test`, `.a@example.test`, `a.@example.test`, `a(comment)@example.test`;
    - `user@123`, `user@1.2.3`, `user@0x7f.1`, `user@example.123`;
    - `a@-x.test`, `a@x-.test`, `a@x_y.test`, `a@example.test.`, `a@example..test`, `a@ex ample.test`;
    - ` a@example.test `, `a@example.test\r\nBcc: x@evil.test`, `""`, `noat`;
    - `user@jõgeva.ee`, `jõ@example.test`, `a@ｅｘａｍｐｌｅ.test`, `user@[127.0.0.1]`.

    Each rejects with `InvalidEmailMessageError`: `details` is `{ field, reason: "address" }`, with `index` (0 or 1) for `to`. The transporter's `sendMail` is never called. `toJSON()` holds no part of the address (checked on the markers `attacker`, `victim`, `evil`).
15. **The grammar, generated.** 500 addresses from the seeded generator of the grammar, in `to`: each is sent, and reaches the envelope and the header as itself, with the domain in lowercase.
16. **The invariant, generated.** 2,000 seeded mutations, in `to`. Each either rejects with `InvalidEmailMessageError` (`reason: "address"`), or reaches the envelope as exactly one recipient equal to itself, with the domain in lowercase. Both outcomes occur at least 100 times.
17. **Nothing written into the caller's values.**
    - A message frozen deep (the message, `to` as a list and each recipient, `from`, `replyTo`), with frozen options `{ tags: … }`, is sent, to the right envelope.
    - An unfrozen message equals, after the send, its `structuredClone` taken before.

### `send`

18. `to: []` rejects with `InvalidEmailMessageError` `{ field: "to", reason: "empty" }`. Nothing is sent, on the capturing transporter or on the SMTP server.
19. With no `from` and no `defaultFrom`: `{ field: "from", reason: "missing" }`, and the server sees no connection.
20. With no `from`: the sender is `defaultFrom`, in the envelope and in `From` (with its name).
21. With `from` and `defaultFrom`: the sender is `from`.
22. SMTP, one of two recipients refused (`550`): `EmailRecipientsRefusedError` with `details.refused: 1`. The server saw `DATA`. `toJSON()` holds neither address.
23. SMTP, one of two recipients deferred (`450`): the same.
24. SMTP, every recipient refused: rejects with nodemailer's own error (`code: "EENVELOPE"`, `command: "RCPT TO"`), not an instance of the adapter's classes.
25. SMTP, the connection closed after `DATA`: rejects with `code: "ECONNECTION"`.
26. SMTP, every recipient accepted: resolves with `undefined`.
27. **A custom transporter's results:**
    - `{ rejected: ["x"] }` and `{ pending: ["x"] }` each reject with `refused: 1`; both together, with `refused: 2`;
    - `{ rejected: [] }`, `{}`, `undefined` and `{ rejected: "x" }` resolve;
    - a result whose `rejected` is a getter that throws rejects with that very error.
28. `idempotencyKey: "k"` and `idempotencyKey: ""` reject with `UnsupportedEmailOptionError` `{ option: "idempotencyKey" }`, and nothing is sent. `{ idempotencyKey: undefined }` sends.
29. `tags: { campaign: "spring-marker" }` sends, and the raw message holds neither `campaign` nor `spring-marker`.
30. A subject with `\r\nBcc: attacker@evil.test`, and one with `\nBcc: attacker@evil.test`: one `Subject` header, no `Bcc` header, and only the recipient in the envelope.
31. `send` called with an invalid message returns a promise that rejects; it does not throw.
32. Each error class: `instanceof` its class and `BaseError`, `name` equal to the class name, its `code`.
33. The entry point exports, at run time, exactly: `NodemailerEmailSender`, `InvalidEmailSenderOptionsError`, `InvalidEmailMessageError`, `UnsupportedEmailOptionError`, `EmailRecipientsRefusedError`.

### Logs

34. `child` is called once, with `{ context: "NodemailerEmailSender" }`.
35. A send to two recipients, with `html`: `debug` `Sending email.` `{ recipientsCount: 2, hasHtmlBody: true, hasTextBody: true }`, then `info` `Email sent.` `{ recipientsCount: 2 }`, and nothing else.
36. SMTP, every recipient refused: `debug`, then `warn` `Email send failed.` `{ recipientsCount: 1, code: "EENVELOPE", command: "RCPT TO", responseCode: 550 }`.
37. SMTP, one of two refused: `debug`, then `warn` `Email refused for some recipients.` `{ recipientsCount: 2, refused: 1 }`.
38. The caller's errors (an empty `to`, a refused address, no sender, an `idempotencyKey`): no log at all.
39. Across 35 to 37, with names, addresses, a subject and bodies that hold markers, no call to the logger holds a marker (`JSON.stringify` of every call).
40. **Reading the rejection.** With a custom transporter that rejects:
    - with an `Error` whose `code` is a getter that throws: `send` rejects with that very error, and the `warn` log has no `code`;
    - with a string: `send` rejects with that string, and the log has `recipientsCount` only;
    - with `{ code: 5, command: ["RCPT TO"], responseCode: "550" }`: the log has `recipientsCount` only.

**On `master`:**
- **Expected to fail.**
  - The cases that use the errors fail, since the classes are not exported and the assertions check the class, the `code` and the `details`. The `@ts-expect-error` lines of cases 3 to 5 fail `pnpm typecheck` (TS2578).
  - Cases 11, 14, 16, 18, 19, 22, 23, 27, 28, 31 and 35 to 40 fail on behavior.
- **Expected to pass**, as checks that the fix keeps what works: 1, 2, 7, 9, 10, 12, 13, 15, 17, 20, 21, 25, 26, 29, 30 and 34, and 24 but for its check against the adapter's classes. `master` passes strings, so nodemailer never touches the caller's objects (17).
- **The `test-author` reports** which cases pass on `master`, and why any case of the first list does.

Wrong implementations these cases rule out:
- a check that refuses only `,` and `>` (14, 16);
- a grammar that lets a numeric last label through (14);
- strings with an escaped name: the two *Changes 1* tests of *Implementation*, not case 11 (**amended**: see there);
- the caller's objects passed on (17, frozen);
- a refusal read from `rejected` only (27, `pending`);
- logging the error object (39);
- a check of `pool` on the options rather than on the created transporter (6);
- reading the rejection's fields without a `try` (40).

## Implementation

### What the `test-author` added

The `test-author`'s run wrote cases 1 to 40, and reported every outcome on `master` as this spec predicts. It also tried 15 wrong versions of a reference model of its own, outside `src/`, and found a hole in the cases.

- **Case 11 did not rule out strings with an escaped name.** An adapter that sends `"<escaped name>" <address>` passes all of case 11. nodemailer turns a line break inside quotes into a space (`To: "Anna Bcc: attacker@evil.test" <victim@example.test>`), so nothing is injected, and case 11 compares only the names without a line break. Two tests, labelled *Changes 1*, check the rule of *Changes 1* directly, on what `sendMail` receives:
  - a new list of new `{ name, address }` objects;
  - a blank name gives `{ address }`;
  - neither a string nor the caller's object;
  - a copy of `defaultFrom`.
- **Expectations the spec's text states, beyond the numbered cases:**
  - 3 and 4: an option set to `undefined` counts as absent (present: truthy);
  - 12: `defaultFrom`'s name is trimmed too;
  - 17: unfrozen options are compared with their `structuredClone`;
  - 27: a `null` result resolves, and a throwing read of the result is logged as a failed send;
  - 31: a getter of the caller's that throws rejects the call;
  - 38: `sendMail` is never called.
- **Not covered:**
  - that only the top level of a rejection is read;
  - `hasHtmlBody` and `hasTextBody` for empty strings;
  - the order of the checks;
  - `warn` on the type of `Logger`.

  None is a rule whose break the cases would miss in a way that matters: the first is how case 40 holds, and the other three are not rules of this spec.

### Plan, as run

- **The `options` parameter came with step 4.2**, together with its `idempotencyKey` check: case 17 calls `send(message, options)`, and `pnpm typecheck` refused it without the parameter (TS2554).
- **Each step was committed with its own test file.** The test files of the later steps were kept outside the package until their step: `constructor` (4.1), `recipients` (4.2), `send` (4.3), `logs` (4.4). Each commit passed `pnpm verify`, and the four files are the `test-author`'s, unchanged.

### *Verification* 2

The rows of *The adapter on `master`*, against the branch's `dist/`, rebuilt with `pnpm exec turbo run build --filter=@enardo/email-nodemailer... --filter=@enardo/logger... --force`:

- **Names** on `to`, `replyTo` and `from`: one recipient, the victim; the envelope's sender stays `noreply@example.test`. The name is quoted in the header.
- **Rejected before anything is sent:**
  - `victim@example.test, attacker@evil.test` and `x>,attacker@evil.test`: `InvalidEmailMessageError`, `{ field: "to", reason: "address", index: 0 }`;
  - an empty `to`, and no sender: `InvalidEmailMessageError`. Over SMTP the server sees no `MAIL FROM`;
  - an `idempotencyKey`: `UnsupportedEmailOptionError`.
- **Refusals over SMTP:**
  - one of two recipients refused: `EmailRecipientsRefusedError`, `{ refused: 1 }`;
  - every recipient refused: nodemailer's `EENVELOPE`.
- **The constructor:** `{}` throws `no-transport`, and both transports throw `two-transports`.
- **The logs** through `@enardo/logger`: `debug` with counts and flags; `warn` with `{ recipientsCount, refused }`, or with `code`, `command` and `responseCode`. No address, no subject.

## Review follow-ups

The first review found the code and the tests sound, and one blocking defect, in the backlog. Each finding was probed again before the fix.

### Blocking

1. **The backlog's count of native throws was wrong.** *Changes 7* said "from twelve to eleven"; `git grep -nE "throw new (Error|TypeError|RangeError)" -- '**/src/**'` finds 12 on the branch, 13 on `master`. The item's list has missed `toTimeout`'s `TypeError` in `@enardo/http-client` (`deadline.ts`) since it was added on 2026-10-07. The item now says twelve, thirteen before this branch, and lists `toTimeout`.

### Taken from its suggestions

The first three are paths into the defect this branch fixes: a value the types refuse, read more than once, so that what was checked is not what is sent.

2. **A `to` with holes got past the empty-list check.** `to: new Array(1)` and `[ , ]` resolved with no recipient, since `map` skips holes; over SMTP, nodemailer rejected with its own `EENVELOPE`. A Proxy whose `length` answers 1, then 0, resolved too (probed by the review). The fix copies the list once (`Array.from`), and checks and maps the copy. An entry that is not an object, a hole included, is refused as `{ field: "to", reason: "address", index }`; so is a `from` or `replyTo` that is not an object.
3. **A non-string `address` was converted to a string twice**, by the grammar's check and by nodemailer. An object whose `toString` answers `ok@example.test`, then `victim@example.test, attacker@evil.test`, passed, and reached the envelope as `"victim@example.test, attacker"@evil.test` (probed by the review). An `address` that is not a string is now refused.
   - **A non-string `name` takes the same path.** `name?.trim()` passed on whatever `trim` returned, and a number made `send` reject with a `TypeError` (`name?.trim is not a function`). A `name` that is not a string is now left out: it is display text, and leaving it out sends the message to the same mailbox.
4. **A `pool` getter on `transport` got past the pool check.** Without a `url`, the created transporter's `options` is the caller's own object, so `pool` was read twice: a getter answering `true`, then `false`, gave an accepted sender on a pool (probed by the review). The sender now creates the transporter from a copy of `transport` (`{ ...transport }`), so the check reads what nodemailer read.
5. **Docs:**
   - `EmailRecipientsRefusedError`'s comment said that LMTP may leave recipients pending; per *Probes*, LMTP's failures go to `rejected`, and only a caller's transporter can set `pending`;
   - the README called `InvalidEmailSenderOptionsReason` the type of `details`; it is the type of `details.reason`;
   - the README's tables lacked a read of the transporter's result that throws: `send` rejects with what was thrown, logged at `warn`.
6. **"Present: truthy" was tested with `undefined` only**, which a `!= null` check passes too. Cases 46 add `false`, `0` and `""`.

### Not changed

- **A logger that throws**: in `warn`, its error replaces nodemailer's; in `info`, `send` rejects after the relay accepted the message. The logger is the caller's code, `master` behaved the same, and the review did not probe it.
- **`text` and `html` are passed on as given**, as on `master`: `{ path }` reads a file into the message, and `{ href }` fetches a URL (the first probed by the review). The types refuse both. This branch does not touch the bodies: the finding enters the backlog's *To evaluate*, for a branch of its own.

### Test cases of the follow-ups

Written by a new `test-author` run, in the foreground, before the fixes, and seen failing. Every value the types refuse goes through a cast.

41. **Entries that are not mailboxes.** `to: new Array(1)` and `to: [RECIPIENT, , ]` (a hole at index 1), `to: [null]`, `to: ["a@example.test"]`, and `to: "a@example.test"`: `InvalidEmailMessageError`, `{ field: "to", reason: "address", index }` with the index of the entry. `from: "a@example.test"` and `replyTo: 42`: `{ field, reason: "address" }`. Nothing is sent.
42. **A `to` that answers differently.** A Proxy over `[]` whose `length` answers 1, then 0: `send` rejects with `InvalidEmailMessageError` with `field: "to"`, and nothing is sent.
43. **A non-string address.** An object whose `toString` answers `ok@example.test` the first time and `victim@example.test, attacker@evil.test` after, in `to`, `from` and `replyTo`: `InvalidEmailMessageError`, `reason: "address"`, nothing sent. The same object as `defaultFrom`'s address: `InvalidEmailSenderOptionsError`, `reason: "default-from"`. An address `42` in `to`: refused too.
44. **A non-string name.** An object whose `toString` answers `Anna` the first time and `x" <attacker@evil.test>, "y` after (with a `trim` that returns the object itself), and the number `42`, as the name of `to`: the message is sent, the envelope holds the address only, and the header is the bare address.
45. **A `pool` getter.** A `transport` whose `pool` getter answers `true` the first time and `false` after: `InvalidEmailSenderOptionsError`, `reason: "pool"`. One that answers `false`, then `true`: a sender that sends, and whose socket the server sees closed after the send.
46. **Present: truthy.** `{ transporter, transport: false }`, `{ transporter, transport: 0 }` and `{ transporter, transport: "" }` build a sender that sends through the transporter. `{ transport, transporter: false }` builds one that sends through `transport`. `{ transport: false, transporter: "" }` throws `reason: "no-transport"`.

**What the run found.** It wrote 22 tests. On the code before the fixes, 12 failed on the behaviors above. The 10 that passed pin what already held:
- the five of 46: the constructor already took truthiness for presence. A `!= null` mutant of the `test-author`'s reference model fails all five;
- the string entries and the non-object `from` and `replyTo` of 41, and the address `42` of 43: their `address` read as `undefined` or `"42"`, which the grammar refuses.

The fixes made all 258 tests pass.

## Second review follow-ups

The second review found the six follow-ups of the first fixed, each with tests that its mutants fail, and two blocking defects. Each was probed again before the fix.

### Blocking

1. **The copy of `transport` (follow-up 4) dropped options, and redirected the mail.**
   - **The cause.** `{ ...transport }` keeps own enumerable properties only, and `createTransport` reads `url`, `pool` and the transport flags with plain property access, which follows the prototype chain. **Corrected after the third review**: the transports themselves copy the other options with `Object.keys`, so a `host` on the prototype is lost by nodemailer anyway, on `master` too.
   - **A case the types accept.** A class instance with a `url` getter, passed as `transport`, lost its `url`. `send` then went to `localhost:587` (`ESOCKET`, `ECONNREFUSED 127.0.0.1:587`), where `createTransport(instance)` reached the server. An MTA listening on local port 587 would have sent the mail, with no error.
   - **A case the types refuse.** A URL string was spread into characters, and went to `localhost:587` too, so a `?pool=true` in it was no longer refused.

   **The fix.** The copy goes, and `transport` reaches `createTransport` as it is, as before follow-up 4. The pool check moves from `options.pool` to the class nodemailer built: `created.transporter instanceof SMTPPool`, imported from `nodemailer/lib/smtp-pool` (in nodemailer's exports map). Only nodemailer reads `pool`, so a getter cannot answer the check differently. **Corrected after the third review**: it reads an own getter twice (in `createTransport`, then when the transport copies its options), but the class is decided on the first read. And it covers every way into a pool: `pool`, a `url` with `?pool=true`, a URL string. Cases 45 and 6 keep checking the getter and the `url`.
2. **The README claimed more than the code checks.** "What the types refuse is checked at run time too" holds for recipients only: `subject`, `text` and `html` are passed on as given.
   - **The path the review found.** A `subject` object with `prepared: true` is written as raw header text, since `Subject` is not among nodemailer's `FORMATTED_HEADERS`. `{ prepared: true, value: "Hi\r\nBcc: attacker@evil.test\r\nReply-To: …" }` put a `Bcc` and a `Reply-To` header into the message, and a body of the attacker's. The envelope did not change (probed by the review).
   - **How it is handled.** The defect is on `master` too, and no caller passes an object `subject` (Cambusa's subjects are constant strings). The README's sentence is scoped to recipients. The backlog item on the bodies (*To evaluate*) now covers `subject`, and notes that refusing a non-string value closes both paths, where `disableFileAccess` and `disableUrlAccess` close only the bodies'.

### Taken from its suggestions

- The `CLAUDE.md` bullet and the code comment on the copy go with it.
- A comment line of 100 characters is rewrapped.

### Test cases of the follow-ups

Written by a new `test-author` run, in the foreground, before the fix, and seen failing.

47. **A `transport` whose options live on its prototype.** A class instance whose `url` getter returns `smtp://127.0.0.1:<port>/`, with no own property, builds a sender whose send reaches the SMTP server. The same class with `?pool=true` in its `url` throws `InvalidEmailSenderOptionsError`, `reason: "pool"`.
48. **A URL string as `transport`** (through a cast: the types refuse it). `smtp://127.0.0.1:<port>/` builds a sender whose send reaches the server. With `?pool=true`: `reason: "pool"`.

## Third review follow-ups

The third review found both fixes of the second sound, with tests that its mutants fail, and one blocking defect, in a claim of the docs. It was probed again before the fix.

### Blocking

1. **A falsy `from` or `replyTo` that is not an object counted as absent.**
   - **The claim.** The README and follow-up 2 of the first review say that a recipient that is not an object is refused.
   - **What the code did.** It tested `from ? … : defaultFrom` and `replyTo && …`. With `""`, `0`, `false`, `null` or `NaN`:
     - as `from`, the message went from `defaultFrom`, or, with none, was refused as `missing`;
     - as `replyTo`, it went with no `Reply-To`.

     No unchecked value reached nodemailer, and nobody got mail meant for another.
   - **The fix.** The code makes the claim true: `from` and `replyTo` count as absent when `undefined` only, and any other value goes through the check of a mailbox. A message field the types type as optional is absent when it is `undefined`, as `idempotencyKey` already is. The constructor's options keep their own rule (present: truthy).

### Taken from its suggestions

- The comment of the code and the *Transporters* bullet of `CLAUDE.md` said that nodemailer reads its options through the prototype chain. Only `createTransport` does, for `url`, `pool` and the transport flags. Both now say so, and the spec is corrected in place.

### Not changed

- **A transport instance passed as `transport`.** The types accept an `SMTPPool` instance there, and nodemailer takes it as a plugin. One from nodemailer's ESM build is refused (`instanceof`). One from its CJS build (`require("nodemailer/lib/smtp-pool")` is another class) is accepted, and the pool runs. It is the caller's own object, which they built and can close: the adapter created nothing. Refusing a `transport` that nodemailer took as a plugin would be a change to the public API, out of this spec's scope.
- **A `pnpm deploy` install.** The review reasoned, without a run, that both of the adapter's specifiers (`nodemailer`, `nodemailer/lib/smtp-pool`) resolve to the one nodemailer next to it. The spec does not claim more.

### Test cases of the follow-ups

Written by a new `test-author` run, in the foreground, before the fix, and seen failing.

49. **A falsy `from` or `replyTo`.** Each of `""`, `0`, `false`, `null` and `NaN`, through a cast:
    - as `from`, with a `defaultFrom`: `InvalidEmailMessageError`, `{ field: "from", reason: "address" }`, nothing sent;
    - as `from`, without a `defaultFrom`: the same;
    - as `replyTo`: `{ field: "replyTo", reason: "address" }`, nothing sent.

    `from: undefined`, with a `defaultFrom`, sends from `defaultFrom`. `replyTo: undefined` sends with no `Reply-To` header.

**What the run found.** It wrote 17 tests. On the code before the fix, the 15 with a falsy value failed: the `from` placements sent from `defaultFrom`, or were refused as `missing`, and `replyTo` sent with no `Reply-To`. The two with `undefined` passed, and pin what already held. The fix made all 279 tests pass.

## Checkpoint 2

The user's decisions (2026-10-15), taken before the merge.

### 1. `idempotencyKey` leaves both packages

The adapter rejected every call with a key, as the contract asks of an implementation that cannot keep one, and no implementation can keep one without a store of its own. The key leaves `@enardo/email` and the adapter as if it had never been there.

- **What goes:**
  - the field of `SendEmailOptions` and its JSDoc;
  - the README's rules on it, and the sentence of `send`'s JSDoc that relied on it;
  - the adapter's `UnsupportedEmailOptionError`, its check, its tests (case 28, and its entries in 32, 33 and 38), and its lines in the README and `CLAUDE.md`;
  - the bullets of `feature/email/send-errors` that are about it.
- **What stays:** the specs, merged or not, keep their mentions: they are snapshots.
- **No test of its absence.** The user's rule: the same reasoning would ask for one for any key.
- **The callers' rule** of `@enardo/email`'s README now says that a rejected call may have reached some of its recipients, or all of them, so a retry can send twice.
- **The rule on options** stays ("do with each option what its comment says, or reject the call"): `tags` is the only option left.

### 2. The adapter takes configuration only

`transporter` leaves: the adapter always creates its transporter, from `transport`. With no transporter of the caller's, the limits of the README that came from one go: a result the adapter has to trust, recipients added by its defaults, and a pool it does not control.

**Probes** (nodemailer 10.1.0, in the dev image):

| `transport` given to `createTransport` | Builds |
| --- | --- |
| `{ host }`, `{ service: "gmail" }`, `{ url: "direct:?…" }` | `SMTPTransport` |
| `{ host, pool: true }`, `{ url: "smtp://…/?pool=true" }` | `SMTPPool` |
| `{ host, streamTransport: true }` | `StreamTransport`: `sendMail` resolves, and nothing is sent |
| `{ host, jsonTransport: true }`, `{ host, sendmail: true }` | `JSONTransport`, `Sendmail` |
| a plugin `{ name, version, send }`, an `SMTPTransport` instance | the object itself |

- **What the types stop.** A literal with `streamTransport`, or with the keys of a plugin, is TS2353. An `SMTPTransport` instance is TS2322. A variable that carries `streamTransport` or `sendmail` besides SMTP options compiles.
- **`getSocket`.** A rejection that the adapter does not control still reaches it: `transport.getSocket`, a callback of the caller's, makes `sendMail` reject with whatever it calls back with, as it is (an `Error` with a `code` getter that throws, a string, an object with fields of other types).

**Changes:**

- **The options** are `{ transport: NodemailerSmtpOptions; defaultFrom?: EmailRecipient; logger?: Logger }`.
- **The constructor** refuses a `transport` from which nodemailer did not build an `SMTPTransport` (`nodemailer/lib/smtp-transport`):
  - `reason: "pool"` for an `SMTPPool`;
  - `reason: "not-smtp"` for any other transport, plugin or object.

  The reasons are `no-transport`, `pool`, `not-smtp` and `default-from`; `two-transports` goes.
- **The result** of `SMTPTransport` always has `rejected`, and never `pending`: `send` reads `rejected` only.
- **The rejection** is read as before, field by field, each read in a `try`: `getSocket` can hand it anything.

**Tests.**
- **No transporter is injected.** Every case observes the local SMTP server: the envelope in `MAIL FROM` and `RCPT TO`, and the raw message in what follows `DATA`.
- **The cases that only an injected transporter reached go:**
  - 2 and 10;
  - 4 (both options);
  - the `transporter` parts of 46;
  - 27 (custom results), and its logs test.
- **Case 40** goes through `getSocket`.
- **The two *Changes 1* tests** checked what `sendMail` received. In their place, case 11 compares every name exactly with the one given, after decoding the header's encoded words, line breaks and non-ASCII names included. A string with an escaped name fails it, since nodemailer turns a line break inside quotes into a space. **Corrected after the fourth review**: case 11 covers "never a string" only. "Never the caller's object" for `defaultFrom` lost its test with them, and case 53 restores it.

50. **Another transport.** A `transport` built in a variable as SMTP options plus `streamTransport: true`, then plus `jsonTransport: true`, then plus `sendmail: true`: `InvalidEmailSenderOptionsError`, `reason: "not-smtp"`. An object with `name`, `version` and `send`, through a cast: the same.

**What the runs found.**
- **Decision 1.** A first `test-author` run removed case 28, and the key's class from cases 24, 32, 33 and 38. Only case 33 failed before the code changed (the class was still exported).
- **The overload.** `send` keeps its `options` parameter through an overload: `tags`, the only option left, are dropped. The implementation declares no parameter, which the lint rule on unused arguments would flag, and the class still accepts what `EmailSender` accepts.
- **Decision 2.** A second run moved every case onto the SMTP server, and wrote case 50, which alone failed before the code changed: the four transports were accepted. The others pin behavior the change keeps.
  - **Nothing sent.** Each test that expects nothing to be sent has an idle server of its own, and each file checks once that none saw a connection.
  - **Duration.** The suite takes about 4 s, up from 1.5 s.
  - **Its own wrong versions.** On a reference model, case 11 failed a sender of strings with escaped names, on the six names with a line break. The idle servers' check failed a sender that calls `sendMail` after rejecting.
- **Not covered.** That `send` reads `rejected` only has no test: nothing reaches `pending` through SMTP.

## Fourth review follow-ups

The fourth review found both changes of checkpoint 2 complete, and two blocking defects. Each was probed again before the fix.

### Blocking

1. **A transport object got through the constructor.** `createTransport` takes any object with a `send` function as a plugin, and keeps it as the transporter. An `SMTPTransport` instance, a subclass of it, or an object with `SMTPTransport.prototype` passed `instanceof SMTPTransport`. A subclass could resolve without sending, or resolve with no `rejected`, which made `send` reject with a `TypeError` (probed by the review). The types refuse them: only a cast or a JS caller gets there.
   - **Why the check comes before nodemailer.** `Mail`'s constructor writes `mailer` into the object it takes, and attaches an `error` listener that re-emits on itself (read in its source). A refusal after `createTransport` would leave the caller's object changed, and wired to an orphan `Mail`: with no listener there, a later `error` of that object would throw.
   - **The fix.** Before `createTransport`, `transport` is refused (`not-smtp`) unless nodemailer would read it as options: an object without a `send` function, or an `smtp:`, `smtps:` or `direct:` URL string (nodemailer's own rule, in `createTransport`). After it, as well as the two `instanceof` checks, the sender refuses a transporter that is `transport` itself: a `send` getter could answer one way to the sender and another to nodemailer.
2. **"Never the caller's object" lost its test for `defaultFrom`** (see the correction in *Checkpoint 2*). A sender that keeps the caller's `defaultFrom`, and passes it on, passed every case. nodemailer then writes into it, and a frozen `defaultFrom` makes every send throw. Case 53 restores the test.

### Taken from its suggestions

- **A `transport` that is neither an object nor an SMTP URL** (`"smtp.example.com"`, a number, `true`) made nodemailer throw a native `TypeError` from `Mail`'s constructor. **Corrected by the `test-author`**: a function does not throw; nodemailer takes it as a transport object and writes `mailer` into it, and the sender refused it afterwards. A test of case 51 checks that the function is left as it was. The check before `createTransport` refuses it (`not-smtp`). An error nodemailer throws while it reads the options, such as a `url` it cannot parse or legacy SES options (`ECONFIG`), still passes through as it is, and the README says so.
- **"Each `address` and `name` is read once" had no test.** A sender that reads `address` a second time for the copy passed every case. Case 52 adds one, with getters.
- **The README's limits.** With no transporter of the caller's, a `socks` proxy cannot get its module (`transporter.set("proxy_socks_module", …)`), so every send through one rejects with `EPROXY` (probed by the review), and no nodemailer plugin (`use()`) can be added.
- **The spec's bookkeeping.** The front matter names `@enardo/email`. *Changes 2*, *3*, *4* and *7*, *Verification* 1 and the constructor cases carry a "superseded at checkpoint 2" line.

### Not changed

- **LMTP refusing every recipient after `DATA`.** nodemailer would resolve with every recipient in `rejected`, so `send` would reject with `EmailRecipientsRefusedError`, whose message says that the others may have received it. Read in the source, not probed; no caller uses LMTP.

### Test cases of the follow-ups

Written by a new `test-author` run, in the foreground, before the fix, and seen failing.

50. **(extended) Transport objects.** Through a cast, each throws `InvalidEmailSenderOptionsError`, `reason: "not-smtp"`, and nothing is sent:
    - an `SMTPTransport` instance, built from SMTP options that point at the test server;
    - an instance of a subclass whose `send` calls back with `{ rejected: [] }` and sends nothing;
    - a plain object whose prototype is `SMTPTransport.prototype`.

    The refused instance is left as it was: no own property `mailer`, and no `error` listener (`listenerCount("error")` is 0).
51. **A `transport` that is not options.** `"smtp.example.com"`, `1`, `true` and a function, through a cast: `InvalidEmailSenderOptionsError`, `reason: "not-smtp"`, not a native error.
52. **Read once.**
    - An `address` getter that answers `ok@example.test` the first time and `victim@example.test, attacker@evil.test` after, on `to`, `from` and `replyTo`: the message is sent with `ok@example.test` in the envelope and in the header, and nothing of the second answer.
    - A `name` getter that answers `Anna` the first time and `x" <attacker@evil.test>, "y` after: the header's name is `Anna`.
53. **A frozen `defaultFrom`.** `defaultFrom: Object.freeze({ address: "noreply@example.test", name: "Cambusa" })`, and two messages without `from`: both reach the server, from `noreply@example.test`, with `Cambusa` in `From`.

**What the run found.** It wrote 15 tests. On the code before the fix, 7 failed:
- the three objects of 50, which were accepted;
- the string, `1` and `true` of 51, which threw native `TypeError`s;
- 51's function, which was refused, but only after nodemailer had written `mailer` into it.

Cases 52 and 53 passed, pinning what the code does: the reference model's wrong versions (reading `address` or `name` twice, passing the caller's `defaultFrom` on) fail them. The fix made all 273 tests pass.

## Fifth review follow-ups

A review of the last fix only (`ff7b97a`). It found the code right on every input it tried: `isTransportOptions` agrees with `createTransport`'s rule on 27 inputs. It found three rules without a test, each with a mutant that passes all 273 tests, and a claim of the README the code does not keep.

### Blocking

1. **The identity check had no test.** A subclass of `SMTPTransport` whose `send` getter answers `undefined` to the sender's read and a function to nodemailer's passes the check before `createTransport`, and nodemailer takes it as the transporter: only `created.transporter === transport` refuses it.
2. **"Refused before nodemailer writes into it" was checked on `SMTPTransport` objects only.** A pre-check of `instanceof SMTPTransport` in place of the `send` rule passed every case. Under it, nodemailer wrote `mailer` into a `{ name, version, send }` plugin, and attached an `error` listener to an `EventEmitter` with a `send` method.
3. **The URL forms were untested.** Only lowercase `smtp://` was accepted in a test, so a rule without the `i` flag, or one for `smtp:` alone, passed every case, and would refuse `SMTPS://…`, which nodemailer reads as `secure: true`.
4. **The README said that the sender writes nothing into the caller's object.** A `send` getter, or a Proxy's `get` trap, that answers differently to the sender's read and to nodemailer's still gets `mailer` and an `error` listener: it is refused after `createTransport` (probed by the review). Only an object built to do so gets there. The README and `CLAUDE.md` now say so.

### Taken from its suggestions

- **A `direct:` URL does no direct delivery.** nodemailer 10 reads it as `{ direct: true }`, which no code of nodemailer's reads, and connects to `localhost:587`, on `master` too (probed by the review). The sender now refuses a `direct:` string before `createTransport` (`not-smtp`): only `smtp:` and `smtps:` strings, in any case, are read as options. A `url` inside an options object is left to nodemailer.
- **`CLAUDE.md`** no longer says that the identity check catches a subclass with a `send` method, which the check before `createTransport` refuses. It asks for `isTransportOptions` to be checked again on a nodemailer upgrade, as the address grammar is.

### Test cases of the follow-ups

Written by a new `test-author` run, in the foreground, before the fix.

54. **The identity check.** A subclass of `SMTPTransport` whose `send` is a getter that answers `undefined` the first time and a function after, through a cast: `InvalidEmailSenderOptionsError`, `reason: "not-smtp"`.
55. **Objects that are not `SMTPTransport`.** The `{ name, version, send }` plugin of case 50 is left with no own `mailer`. `Object.assign(new EventEmitter(), { send() {} })`, through a cast: `reason: "not-smtp"`, and afterwards no own `mailer` and `listenerCount("error")` is 0.
56. **URL strings.** `SMTP://127.0.0.1:<port>/`, `SMTPS://127.0.0.1:<port>/` and `smtps://127.0.0.1:<port>/`, through a cast, build a sender: the constructor does not throw, and opens no connection. `direct:?name=x` and `DIRECT:?name=x` throw `reason: "not-smtp"`.

**What the run found.** It wrote 7 tests, and added the `mailer` check to the plugin test of case 50. On the code before the fix, only the two `direct:` tests failed. The others pin what the code does; the `test-author`'s reference model shows each wrong version of the review failing them:
- no identity check;
- an `instanceof SMTPTransport` pre-check;
- a URL rule without the `i` flag, or for `smtp:` only.

The fix made all 280 tests pass.

## Out of scope

- Errors of the contract, and wrapping nodemailer's: `feature/email/send-errors`.
- Closing a transporter at the api-server's shutdown: the api-server creates none that holds a connection.
- The HTML injection in identity's emails, and `Email`'s pattern: their own items, in *To evaluate*.
- International addresses (SMTPUTF8) and quoted local parts.

## Verification

1. `pnpm verify`: `@enardo/email-nodemailer` and its dependent `@cambusa/api-server`; since checkpoint 2, `@enardo/email` and its dependents too.
2. The rows of *The adapter on `master`*, run again against the branch's `dist/`: each one rejects, or sends to the intended recipient only.

## Plan

1. This spec, first commit of the branch. ⏸ Checkpoint 1.
2. The package files of *6* but the README and `CLAUDE.md`; `pnpm install` in the dev container.
3. The `test-author` writes the cases, in one run in the foreground; they are seen failing for the expected reason.
4. The implementation, in steps that each end green, committed with their tests:
   1. the errors and the constructor;
   2. the recipients and the grammar;
   3. the outcomes of `send` and its options;
   4. the logs.
5. README and `CLAUDE.md`. Commit `[@enardo/email-nodemailer] docs: …`.
6. The backlog changes of *7*. Commit `[repo] docs: …`.
7. `pnpm verify` and *Verification* 2; then the `reviewer`, and the fixes it calls for. ⏸ Checkpoint 2.
8. The spec marked `done`; the item leaves the backlog in its own commit; `git merge --no-ff`.
