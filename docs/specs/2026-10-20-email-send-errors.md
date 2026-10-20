---
status: draft
type: feature
packages: ["@enardo/email", "@enardo/email-nodemailer", "@enardo/errors"]
branch: feature/email/send-errors
---

# `@enardo/email`: the errors of `send`

## Why

The item `feature/email/send-errors` of `docs/backlog.md`, from the architectural review of `@enardo/email` (2026-10-14), queued by the user (2026-10-14).

- **The adapter lets nodemailer's errors through**, and they reach whoever handles them as they are. Through `@enardo/cqrs`'s `CommandHandler` (*Probes*):
  - the response's `error` is nodemailer's message: `getaddrinfo EAI_AGAIN smtp.internal.corp.test` for a host that does not resolve, `Can't send mail - all recipients were rejected: 550 5.1.1 <anna.marker@example.test>: no such user` when the relay refuses the recipient. The client gets the SMTP host, or the address;
  - the `error` log holds the address in `message`, `stack`, `response`, `rejected`, and each entry of `rejectedErrors` (`message`, `response`, `recipient`).
- **The contract says nothing of what `send` rejects with.**
  - A caller that retries, such as the queue or the outbox that usually drives a send port, has to read the driver's codes (`EENVELOPE`, `ESOCKET`, `responseCode`): the technology the port hides.
  - `to` takes a list, and the contract rejects a send when the relay refuses any recipient, though the others may have got the message. Only the implementation knows which recipients the relay refused.
- **A refusal has two errors**: nodemailer's when the relay refuses every recipient, the adapter's `EmailRecipientsRefusedError` when it refuses some. Neither says which recipients: the adapter's counts them.
- **The adapter's errors are interim** (its `CLAUDE.md`): at checkpoint 1 of `fix/email-nodemailer/contract-compliance` (2026-10-14), the user asked that the contract's errors replace or absorb them.

The packages serve any project that installs them. Cambusa, the one consumer today, shows the impact of the change (*The callers*), not the bounds of the need.

## Probes

On `main` (`f22a8ed`), after `pnpm exec turbo run build --filter=@enardo/email-nodemailer... --filter=@enardo/logger... --filter=@enardo/cqrs... --force`, in throwaway containers of the dev image (Node 24.21.0, TypeScript 5.9.3, nodemailer 10.1.0), with the repo mounted read-only and no network. A local SMTP server, or an LMTP one, answered as each row says; each send went through nodemailer, then through the adapter's `dist/`.

### nodemailer's rejections

Each is a plain `Error` (`name: "Error"`, no `cause`) with own fields `code`, `command` in every row but the last, and `response` and `responseCode` when the server answered.

| Case | `code` | `command` | `responseCode` | Other own fields |
| --- | --- | --- | --- | --- |
| every recipient refused | `EENVELOPE` | `RCPT TO` | one recipient's: `450` for a `550` and a `450` | `rejected`, `rejectedErrors` |
| the sender refused | `EENVELOPE` | `MAIL FROM` | `550`, `451` | |
| the message refused, after the data | `EMESSAGE` | `DATA` | `554`, `451` | |
| `503` to `DATA` | `EENVELOPE` | `DATA` | `503` | |
| a greeting of `421` or `554` | `EPROTOCOL` | `CONN` | `421`, `554` | |
| `535`, `454` to `AUTH` | `EAUTH` | `AUTH PLAIN` | `535`, `454` | |
| `auth` without a password | `EAUTH` | `API` | | |
| the connection closed by the server | `ECONNECTION` | `CONN` | | |
| no greeting within `greetingTimeout` | `ETIMEDOUT` | `CONN` | | `timeoutType` |
| a refused connection | `ESOCKET` | `CONN` | | `originalCode: "ECONNREFUSED"`, `errno`, `syscall`, `address`, `port` |
| `secure: true` against a plain server | `ESOCKET` | `CONN` | | `originalCode: "ERR_SSL_WRONG_VERSION_NUMBER"`, `library`, `reason` |
| a host that does not resolve | `EDNS` | `CONN` | | `originalCode: "EAI_AGAIN"` (`ENOTFOUND` with a network, 2026-10-14), `errno`, `syscall`, `hostname` |
| `getSocket` calls back with a string | | | | nodemailer rejects with the string |
| more recipients than `transport.maxRecipients` (`1`, for two) | `EMAXRECIPIENTS` | | | the server sees no connection |

- **Connections other than the one to the SMTP server** (found by the first review, run again here):
  - an HTTP proxy (`transport.proxy`) that is down rejects with its socket's own error, `code: "ECONNREFUSED"`, no `command`; one whose host does not resolve, with `EAI_AGAIN` (no network). One that answers `503` gives `EPROXY`, `Invalid response from proxy: 503`, a code it also gives for a `407`, a malformed answer, or a missing socks module (`http-proxy-client`, `mailer`, read in the source);
  - an OAuth2 token endpoint that refuses the connection gives `EAUTH`, `AUTH XOAUTH2`, `originalCode: "EFETCH"`. nodemailer sets `EFETCH` on every request it cannot complete (`setFetchCode`, read in the source), and `EOAUTH2` on a token answer it cannot use.
- **The rejection shows no stage.** A server that closes the connection before its greeting, or after `EHLO`, `MAIL FROM`, `RCPT TO`, `DATA` or the data's final dot, gives the same `ECONNECTION`, `CONN`, `Connection closed unexpectedly`: nothing tells a message the relay never got from one it may have accepted.
- **Addresses.** The server's answers echo addresses, and nodemailer copies them into `message` and `response`. `rejected`, and each entry of `rejectedErrors` (`message`, `response`, `recipient`), hold them too. As the `cause` of a `BaseError`, `toJSON()` keeps them all. The other fields hold none: `errno`, `syscall`, `hostname`, `address` and `port` describe the SMTP server.

### Refused recipients

- **Over SMTP**, each refused recipient is in `rejected`, and in `rejectedErrors` as an `EENVELOPE`, `RCPT TO` error with its own `responseCode` and `recipient`, the address as `rejected` holds it. When some recipients are refused, `sendMail` resolves with both in its result, for a `550` and a `450` alike; when every one is, they are own fields of the rejection. The same with `PIPELINING` advertised.
- **Over LMTP** (`lmtp: true`), a recipient refused after the data is in `rejected` only, unless a `RCPT TO` was refused before (found by the `critic`, run again here). `sendMail` resolves, even when every recipient is refused:
  - one of two refused after the data: `rejected: ["bob@example.test"]`, no `rejectedErrors`;
  - both: `accepted: []`, `rejected` of both, no `rejectedErrors`;
  - one refused at `RCPT TO`, one after the data: `rejectedErrors` holds both, the second as `EMESSAGE`, `DATA`, with its `recipient`.

  The adapter on `main`, which reads `rejected`, rejects with `{ refused: 1 }`, `{ refused: 2 }` and `{ refused: 2 }`. nodemailer keeps the reply after the data in its envelope's `rejectedErrors`, but puts that array in the result only when it holds an entry once `DATA` is answered (`_actionDATA`, read in its source): the same reply is exposed or not, depending on another recipient (the `critic`'s second run).
- **Where LMTP is turned on.** `created.transporter.options`, nodemailer's own copy of the options, has `lmtp: true` for `{ lmtp: true }`, for a `url` with `?lmtp=true` (as an object or a string), and for that `url` with `lmtp: false` beside it: the URL wins. A `lmtp` getter on the prototype is not copied, and `options.lmtp` is absent. `SMTPConnection` reads `lmtp` from those options, merged with what a caller's `getSocket` calls back with (`smtp-transport`'s `send`, read in its source).
- **The envelope's form of an address.** With `to` of `anna@example.test`, `bob@Refused.TEST`, `bob@refused.test` and `Bob@refused.test`, the envelope, `rejected` and the `recipient`s hold `bob@refused.test` once, and `Bob@refused.test`: the domain lowercased, the local part as given, an exact duplicate once. The grammar of the adapter's `address.ts` lets nodemailer change nothing else (fuzzed by the spec of `fix/email-nodemailer/contract-compliance`). The adapter on `main` rejects with `{ refused: 2 }`.

### `@enardo/cqrs`, `@enardo/errors`, TypeScript

- `mapErrorToString` returns `code` for a `BaseError` and `message` for any other `Error` (`packages/cqrs/src/command-handler.ts`). The run of *Why* went through `CommandHandler` and `@enardo/logger` (`format: "json"`).
- `toJSON()` keeps a `cause` that is not an `Error` as it is: `{ code: "ESOCKET", command: "CONN" }` comes out unchanged. A `cause` passed as `undefined` is an own property of the error, and `toJSON()` leaves it out.
- A parameter typed `{ cause?: Readonly<Record<string, string | number>> }` refuses an `Error`, an interface that extends it, and an `unknown` (TS2322), and accepts an object of identifiers (`tsc --strict`).

### The constructor

- `new NodemailerEmailSender({ transport: "smtp://user:s3cret@[bad" })`, and the same `url` in an object, throw `createTransport`'s `TypeError` as it is: `{ message: "Invalid URL", code: "ERR_INVALID_URL", input: "smtp://user:s3cret@[bad" }`, the password in `input` (found by the `critic`'s second run, run again here).

### The callers

- In Cambusa (`474c20c`), the api-server builds the only `NodemailerEmailSender`. Identity's resend handler and its `UserRegistered` handler call `send`, to one recipient. No code of Cambusa's names an error of the adapter, and its web app maps no email code (`apps/web/src/lib/api/error-messages.ts`).
- In this repo, outside the adapter and frozen specs, its errors are named only by `docs/backlog.md`.
- No test of the adapter sends from `deferred.test`, or sets `lmtp`.

## Decisions

Approved by the user at checkpoint 1 (2026-10-20), tier L, the refusal of LMTP (*8*) included.

1. **Three errors in the contract**, siblings, each extending `BaseError`. `send` rejects with one of them, or with what a value of the caller's threw when read:
   - `InvalidEmailMessageError` (`INVALID_EMAIL_MESSAGE`): an empty `to`, no sender, or an address the implementation refuses, found before anything is sent. It moves from the adapter with its `details`.
   - `EmailRecipientsRefusedError` (`EMAIL_RECIPIENTS_REFUSED`): the relay refused at least one recipient. One error whether it took the message for the others or refused them all: `details.refused` says which.
   - `EmailSendFailedError` (`EMAIL_SEND_FAILED`): any other failure: the relay out of reach, the sender or the message refused, an authentication that failed, an answer lost, a limit of the transport (`maxRecipients`).
   - Not chosen: a class per failure (connection, authentication, message). What a program decides on is whether to retry, which `retryable` says; why the send failed is for the operator, who reads the cause.
   - `InvalidEmailSenderOptionsError` stays the adapter's: the contract has no constructor, and its reasons (`pool`, `not-smtp`) are nodemailer's.
2. **A retryable failure is told apart from a permanent one**, by `retryable: boolean`: in `EmailSendFailedError`'s `details`, and on each refused recipient.
   - It says whether the same send, later and with nothing changed, may succeed. It does not say that a retry is safe: an `EmailSendFailedError` may follow a delivered message, which the adapter cannot tell (*The rejection shows no stage*).
   - SMTP draws the line in its replies: `4xx` is transient, `5xx` permanent. An app hands its mail to a relay, which queues it and retries the delivery itself, so a `4xx` reaches the app from that relay: a rate limit, too many recipients (`452`), a temporary local error.
   - The adapter's rule for a failure: retryable on a `4xx` reply; with neither a `4xx` nor a `5xx` reply, on a connection that failed, timed out or was lost, to the relay or to anything nodemailer reaches on the way, read on `code` or on `originalCode`:
     - nodemailer's codes of a connection: `ECONNECTION`, `ESOCKET`, `ETIMEDOUT`, `EDNS`, and `EFETCH`, a request it could not complete, such as the OAuth2 token one;
     - the system's, which an HTTP proxy's socket gives as they are: `ECONNREFUSED`, `ECONNRESET`, `ENOTFOUND`, `EAI_AGAIN`, `EHOSTUNREACH`, `ENETUNREACH`, `EPIPE`.

     A wrong host or port gives the codes of an outage (`ECONNREFUSED`, a TLS mismatch), so it counts as retryable: a caller bounds its retries anyway, while a transient failure taken for a permanent one loses the message. `EPROXY` and `ETLS` do not count: each mixes misconfigurations (a proxy that refuses its credentials, a missing socks module, a certificate) with outages. The user chose this rule after the first review (2026-10-20), over keeping nodemailer's four codes alone, and over a failure retryable unless known permanent.
   - For a refused recipient: retryable when its own reply is a `4xx`. A reply the adapter cannot read counts as permanent: with LMTP refused (*8*), only a rejection that the caller's own `getSocket` produces gets there.
   - Not chosen: no flag, which leaves the caller reading the cause.
3. **The refused recipients are named by their index in `to`**: `details.refused` lists `{ index, retryable }` for each, once, in ascending order, with index 0 for a single recipient.
   - A caller that sent to several recipients can retry the deferred ones alone, and mark those refused for good: the others took the message. With a count, it can only send twice, or give up.
   - An index holds no address (*4*); the caller maps it back to its own `to`. A retry to some of the recipients is another message: its `To` header lists only them. The README says so.
   - Two entries of `to` that the envelope sends as one recipient, such as `bob@Refused.TEST` and `bob@refused.test`, are both listed.
   - The cost: the adapter matches each refused address to `to` by its envelope form (*Probes*), which holds while `address.ts`'s grammar does; and every implementation takes the duty. An implementation whose provider reports each recipient's outcome later, as events, never rejects with a partial refusal, so the duty does not arise for it (how HTTP providers answer is not probed).
   - An implementation that knows the relay refused recipients, but not which, rejects with `EmailSendFailedError`: the contract says so, and the adapter does it for a refusal it cannot read.
   - The class holds what it can: its type takes a list of at least one recipient, and it keeps a copy sorted by index. Listing each recipient once stays the implementation's duty.
   - No `retryable` for the error as a whole: retrying the whole message would send it twice to the recipients that took it.
   - Not chosen: a count with one `retryable`, which the `critic`'s first run proposed on the ground that the only consumer sends to one recipient. Adding the list later puts a new duty on every implementation. Nor the addresses, which are personal data.
4. **The errors hold no address, name, subject or body**, in their message, `details` or `cause`, so a caller can log them, as `CommandHandler` logs every failure. The user chose it before checkpoint 1 (2026-10-20), over nodemailer's error as `cause`, which the item's *What* names.
   - The adapter's errors and logs hold none already (its README). The contract makes it a rule for every implementation.
   - The compiler holds part of it: the classes take a `cause` of type `EmailErrorCause`, `Readonly<Record<string, string | number>>`, which refuses an `Error` and an `unknown` (*Probes*). A string can still hold an address: the README states the rule.
   - The adapter reduces nodemailer's error to `{ code, command, responseCode, originalCode }`, each when present. Its other fields echo addresses (*Probes*). `@enardo/http-client`'s `NetworkError` reduces its cause the same way, in its own constructor (`fix/http-client/redact-cause`).
   - `@enardo/errors`' README tells a wrapping error to pass the other one as `cause`. It gains when not to: when that error can hold personal data or secrets, which `toJSON()` would carry into every log.
   - The cost: the server's text (`response`), which explains a refusal (`5.7.1 Relaying denied`) but often echoes an address. nodemailer's own logger shows it, recipients included, when `transport` sets `logger` (adapter's README, *Logs*).
5. **`@enardo/email` and `@enardo/email-nodemailer` go to 2.0.0.**
   - The contract's `EmailSender` does not change, but an implementation of 1.0.0 no longer meets the contract: its rejections are its own. Not chosen: 1.1.0, which callers could take as safe with any implementation of 1.x.
   - The adapter drops two exports, and its rejections change.
   - `@enardo/errors` changes its README only, which needs no version.
6. **The errors are classes of `@enardo/email`**, which gains runtime code and a dependency on `@enardo/errors`. Its `dist/index.mjs` stops being empty, and the adapter's starts importing it. `@enardo/database` and `@enardo/database-mongo` do the same with `DatabaseError`. The adapter does not re-export them, as it does not re-export `EmailSender`.
7. **The adapter's logs follow the errors.** A refusal logs `warn` `Email recipients refused.` with `{ recipientsCount, refused }`, `refused` being the length of `details.refused`, whether the relay refused some recipients or all. `Email send failed.` carries the fields of the cause, so it gains `originalCode`.
8. **The adapter refuses LMTP**: the constructor throws `InvalidEmailSenderOptionsError`, `not-smtp`, when nodemailer's copy of the options has `lmtp`, and the type of `transport` takes `lmtp?: false`, as it takes `pool?: false`.
   - LMTP hands the message to its final mailbox store, with no queue behind it: `EmailSender` sends through a relay (its JSDoc), and the adapter's README speaks of an SMTP server only.
   - It is the one path on which nodemailer resolves with refusals whose replies it may or may not expose (*Probes*), so the same reply would be retryable or not depending on another recipient (the `critic`'s second run).
   - The check reads what nodemailer built, like the constructor's other checks, so a `url` with `?lmtp=true` is refused too. A caller's `getSocket` can still call back with `lmtp`, after the check: a refusal is still read from `rejected`, so it never passes for a send, but its reply may be lost, and `retryable` false.
   - A project that delivers over LMTP writes an implementation of its own; the refusal comes inside a major that already breaks. Not chosen: LMTP kept, with a refusal without a readable reply counted as retryable, which keeps the test server's LMTP mode and the dependence on another recipient.
9. **Test-first**, as public API of two `@enardo/*` packages. The `test-author` writes the cases of *Test cases*, one run per package.
10. **No ADR.** Each decision is a rule of `@enardo/email`'s contract or of its adapter, recorded in their READMEs; the one that reaches beyond them goes into `@enardo/errors`' README.

## Changes

### `@enardo/email` 2.0.0

`src/errors/`, one file per class and an `index.ts`, exported by `src/index.ts`. Each class declares its `name` as a field, narrows `code` and `details` with `declare readonly`, and takes `options?: { cause?: EmailErrorCause }` last.

| Class | Constructor | `details` | `message` |
| --- | --- | --- | --- |
| `InvalidEmailMessageError` | `(details: InvalidEmailMessageDetails, options?)` | as given | `The email has no recipient: to is an empty list`; `The email has no sender: no from, and no default sender`; `The email sender refuses the address of to[1]` (or `from`, `replyTo`) |
| `EmailRecipientsRefusedError` | `(refused: readonly [RefusedEmailRecipient, ...RefusedEmailRecipient[]], options?)` | `{ refused }`, a copy sorted by `index` | `The relay refused the email for to[1], to[3]` |
| `EmailSendFailedError` | `(details: EmailSendFailedDetails, options?)` | as given | `Sending the email failed`, plus `; a later retry may succeed` when `retryable` |

- **Types**, exported:
  - `InvalidEmailMessageDetails`, unchanged from the adapter: `{ field: "to", reason: "empty" }`, `{ field: "to", reason: "address", index }`, `{ field: "from" | "replyTo", reason: "address" }`, `{ field: "from", reason: "missing" }`;
  - `RefusedEmailRecipient`: `{ readonly index: number; readonly retryable: boolean }`;
  - `EmailRecipientsRefusedDetails`: `{ readonly refused: readonly RefusedEmailRecipient[] }`;
  - `EmailSendFailedDetails`: `{ readonly retryable: boolean }`;
  - `EmailErrorCause`: `Readonly<Record<string, string | number>>`.
- **`EmailSender.send`'s JSDoc** says what it rejects with.
- **`package.json`**: version `2.0.0`; `"dependencies": { "@enardo/errors": "workspace:^" }`; the description `Email sender contract: the message types and the errors of send.`
- **`README.md`**:
  - the package holds the types and the errors of `send`, no longer types only;
  - the exports, the errors among them;
  - *Callers*: branch on the class or on `code`. Retry an `EmailRecipientsRefusedError` with the refused recipients whose `retryable` is true, and only them: a message of its own, whose `To` header lists them alone. Retry an `EmailSendFailedError` when `retryable`, knowing that it may send twice. The errors can be logged: they hold no address, name, subject or body. An example of each retry;
  - *Implementations*: when each error applies (*Decisions* 1), what `retryable` means (*2*), how `refused` lists the recipients, each once, and `EmailSendFailedError` for a refusal of recipients it cannot name (*3*), what the errors never hold, a `cause` included (*4*), and that a driver's error never passes through. The sentence `The contract does not define yet what send rejects with` leaves;
  - *Contributing*: the tests check behavior too.
- **Node only**: no browser project. Sending email takes credentials that a browser must not hold, so no browser runs an implementation, and a client learns of a failure from its server's `code`.

### `@enardo/email-nodemailer` 2.0.0

- **`src/errors/`** keeps `InvalidEmailSenderOptionsError`; `InvalidEmailMessageError` and `EmailRecipientsRefusedError` leave.
- **The constructor** refuses LMTP (*Decisions* 8): after `createTransport`, it throws `InvalidEmailSenderOptionsError("not-smtp")` when `created.transporter.options.lmtp` is truthy. `NodemailerSmtpOptions` becomes `Omit<SMTPTransport.Options, "pool" | "lmtp"> & { pool?: false; lmtp?: false }`.
- **`src/nodemailer-email-sender.ts`** throws the contract's errors, imported from `@enardo/email`:
  - Before the send, it keeps each `to` address's envelope form: the local part as given, the domain lowercased.
  - **A refusal** comes from `rejected` and `rejectedErrors`: the result's when `sendMail` resolves with `rejected` not empty, as today; the rejection's when it rejects with `code: "EENVELOPE"` and `command: "RCPT TO"`. Each address of `rejected` is matched to every index of `to` with that envelope form, and `send` rejects with `EmailRecipientsRefusedError`, listing each matched index once, in ascending order. An index is retryable when the entry of `rejectedErrors` whose `recipient` is its address has a `responseCode` from 400 to 499 (a number); without such an entry, it is not.
  - The fields of a value the sender does not control are read like its identifiers: each on its own, in a `try`. A refusal that cannot be read counts as any other rejection: a `rejected` that is not an array, or is empty; an entry of it that is not a string, or matches no index; a read that throws. A `rejectedErrors` that cannot be read leaves every index not retryable.
  - **Any other rejection** of nodemailer becomes `EmailSendFailedError`. Its `cause` holds `code`, `command` and `originalCode` when they are strings, and `responseCode` when it is a number, each read on its own, in a `try`, at the top level, as the logs read them today. It has no `cause` when none of them is present.
  - **`retryable` of a failure**: false when `responseCode` is 500 to 599; true when it is 400 to 499; otherwise, true when `code` or `originalCode` is one of the connection codes of *Decisions* 2.
  - The logs of *Decisions* 7.
- **`src/index.ts`**: `NodemailerEmailSender`, `NodemailerEmailSenderOptions`, `NodemailerSmtpOptions`, `InvalidEmailSenderOptionsError`, `InvalidEmailSenderOptionsReason`, `Logger`, `LoggerMetadata`.
- **`package.json`**: version `2.0.0`. `@enardo/email` stays in `dependencies` (`workspace:^`, packed as `^2.0.0`).
- **`README.md`**: the exports; *Options*: LMTP refused, with a `url` that turns it on; the table of `send`, with the contract's errors; `refused`, where two entries of `to` that differ only in the case of the domain are both listed; the rules of `retryable`; *Errors*: the cause's fields, and `InvalidEmailSenderOptionsError`, the adapter's own; *Logs*; *Against `@enardo/email`'s contract* loses its line on two errors for a refusal.
- **`CLAUDE.md`**:
  - *Layout*: `src/errors/` holds the constructor's error;
  - *Transporters*: LMTP is refused, read from nodemailer's copy of the options, and why (*Decisions* 8);
  - *Sending*: the lines on nodemailer's rejections passing through and on the interim classes leave. A refusal is read from `rejected`, which LMTP would fill after the data, and matched to `to` by envelope form, which relies on the grammar of `address.ts`: a change to it checks the match again. Its `retryable` comes from `rejectedErrors`, matched by `recipient`. Every other rejection becomes `EmailSendFailedError`, with its identifiers in `cause`;
  - *Logs*: `originalCode` joins the identifiers;
  - *Tests*: cases 1 to 56 carry their number in the spec of `fix/email-nodemailer/contract-compliance`, from 57 on in this one.

### `@enardo/errors`

- **`README.md`**, *Writing an error*: the bullet on `cause` adds that an error that can hold personal data or secrets is not passed whole, since `toJSON()` carries a cause into every log: the wrapping error takes its identifiers instead, and documents them.

### Repo

- `pnpm-lock.yaml`, from `pnpm install`.
- `docs/backlog.md`:
  - in `fix/email-nodemailer/non-string-content`, a line: since `feature/email/send-errors`, `InvalidEmailMessageDetails` is `@enardo/email`'s, so refusing a `subject`, `text` or `html` that is not a string adds a field and a reason to the contract, a minor of `@enardo/email`;
  - in *To evaluate*, a new item: `@enardo/cqrs`'s `CommandHandler` puts the `message` of any `Error` that is not a `BaseError` in the response's `error`, which an HTTP layer like Cambusa's api-server sends to the client. Before this task, that was nodemailer's message, with the address of a refused recipient or the SMTP host (*Probes*). The item of this task recorded it, and leaves with it. From the spec of `feature/email/send-errors`;
  - first in *Queued*, as the user asked at checkpoint 1, a new item, `fix/email-nodemailer/redact-transport-errors`: `NodemailerEmailSender`'s constructor lets `createTransport`'s errors through, and the `TypeError` for a `url` that does not parse holds the URL in `input`, the SMTP password included (*Probes*, *The constructor*). Committed at checkpoint 1, not in step 6;
  - this task's item removed, in a commit of its own.

## Test cases

### `@enardo/email` (`__tests__/errors.test.ts`, from `~/index`)

E1. Each class, built with valid arguments: an instance of it and of `BaseError`, `name` equal to the class name, its `code`, and a stack whose first line is `<name>: <message>`.
E2. `InvalidEmailMessageError`, for each of `{ field: "to", reason: "empty" }`, `{ field: "to", reason: "address", index: 1 }`, `{ field: "from", reason: "address" }`, `{ field: "replyTo", reason: "address" }` and `{ field: "from", reason: "missing" }`: `details` equals the argument, and `message` is the one of *Changes*.
E3. `EmailRecipientsRefusedError([{ index: 3, retryable: true }, { index: 1, retryable: false }])`: `details` is `{ refused: [{ index: 1, retryable: false }, { index: 3, retryable: true }] }`, and `message` is `The relay refused the email for to[1], to[3]`. The list given is not changed, and a later change to it does not reach `details`.
E4. `EmailSendFailedError` with `{ retryable: false }` and `{ retryable: true }`: `details` equals the argument; the messages are `Sending the email failed` and `Sending the email failed; a later retry may succeed`.
E5. Each class, given `{ cause: { code: "ESOCKET", responseCode: 421 } }`: `cause` is that object, and `toJSON().cause` equals it. Built without `options`, `toJSON()` has no `cause`.
E6. The entry point exports at run time exactly `InvalidEmailMessageError`, `EmailRecipientsRefusedError` and `EmailSendFailedError`.
E7. Types, checked by `pnpm typecheck`:
   - each `code` is its literal, and `details` is `InvalidEmailMessageDetails`, `EmailRecipientsRefusedDetails` and `EmailSendFailedDetails`;
   - assigning a field of `RefusedEmailRecipient` or of `EmailSendFailedDetails` is a type error, and so is `new EmailRecipientsRefusedError([])`;
   - for each class, a `cause` of type `Error`, and one of type `unknown`, are type errors.

### `@enardo/email-nodemailer`

Each case imports the contract's errors from `@enardo/email`, so a rejection with the right class from another copy fails.

**Support.** The SMTP server also answers `451` to a `MAIL FROM` at `deferred.test`.

**Changed cases**, under their number in the spec of `fix/email-nodemailer/contract-compliance`:

- **14, 16, 18, 19, 31, 41, 42, 43, 49**: `InvalidEmailMessageError` comes from `@enardo/email`; the assertions do not change.
- **22**: one of two recipients refused (`550`): `EmailRecipientsRefusedError`, `details` `{ refused: [{ index: 1, retryable: false }] }`. The rest as today: `DATA`, one message, neither address in `toJSON()`.
- **23**: one of two deferred (`450`): `{ refused: [{ index: 1, retryable: true }] }`.
- **24**: every recipient refused, `to` of `bob@refused.test` alone: `EmailRecipientsRefusedError`, `{ refused: [{ index: 0, retryable: false }] }`; the server saw no `DATA`.
- **25**: the connection closed after `DATA`: `EmailSendFailedError`, `details` `{ retryable: true }`, `cause` strictly `{ code: "ECONNECTION", command: "CONN" }`.
- **32**: `InvalidEmailSenderOptionsError` alone.
- **33**: the entry point exports at run time exactly `NodemailerEmailSender` and `InvalidEmailSenderOptionsError`.
- **36**: every recipient refused: `debug`, then `warn` `Email recipients refused.` `{ recipientsCount: 1, refused: 1 }`.
- **37**: one of two refused: `debug`, then `warn` `Email recipients refused.` `{ recipientsCount: 2, refused: 1 }`.
- **40**, the rejections through `getSocket`:
  - the `Error` whose `code` getter throws, with `command: "RCPT TO"` and `responseCode: 550`: `EmailSendFailedError`, `{ retryable: false }`, `cause` strictly `{ command: "RCPT TO", responseCode: 550 }`. The log as today;
  - a string, and `{ code: 5, command: ["RCPT TO"], responseCode: "550" }`: `EmailSendFailedError`, `{ retryable: false }`, no `cause` in `toJSON()`. The log as today.

**New cases:**

57. **Refused and deferred, in order.** `to` of `anna@example.test`, `bruno@refused.test`, `carla@deferred.test`: `{ refused: [{ index: 1, retryable: false }, { index: 2, retryable: true }] }`; one message sent.
58. **Every recipient refused, mixed.** `to` of `bruno@refused.test`, `carla@deferred.test`: `{ refused: [{ index: 0, retryable: false }, { index: 1, retryable: true }] }`; no `DATA`. nodemailer's own `responseCode` is `450`, so a `retryable` read from it gives `true` to both.
59. **LMTP refused.** `transport` of the server's options with `lmtp: true`; of `{ url: "smtp://127.0.0.1:<port>/?lmtp=true" }`, alone and with `lmtp: false`; and the same URL as a string: each throws `InvalidEmailSenderOptionsError`, `details.reason: "not-smtp"`, and the server sees no connection. `lmtp: true` in a literal is a type error (`@ts-expect-error`). `lmtp: false` builds a sender, and a send reaches the server.
60. **The envelope's form.** `to` of `anna@example.test`, `bob@Refused.TEST`, `bob@refused.test`, `Bob@refused.test`: `{ refused: [{ index: 1, retryable: false }, { index: 2, retryable: false }, { index: 3, retryable: false }] }`. A match on the exact address misses index 1; one that stops at the first index misses 2.
61. **The sender refused.** `from` of `victim@refused.test`: `EmailSendFailedError`, `{ retryable: false }`, `cause` strictly `{ code: "EENVELOPE", command: "MAIL FROM", responseCode: 550 }`. `JSON.stringify(error.toJSON())` holds no `victim`, which the server's answer echoes.
62. **The sender deferred.** `from` at `deferred.test`: `{ retryable: true }`, `cause` strictly `{ code: "EENVELOPE", command: "MAIL FROM", responseCode: 451 }`.
63. **A refused connection.** A port where nothing listens (a server started, then closed): `EmailSendFailedError`, `{ retryable: true }`, `cause` strictly `{ code: "ESOCKET", command: "CONN", originalCode: "ECONNREFUSED" }`. The log: `debug`, then `warn` `Email send failed.` `{ recipientsCount: 1, code: "ESOCKET", command: "CONN", originalCode: "ECONNREFUSED" }`.
64. **The limit of the transport.** `maxRecipients: 1` in `transport`, two recipients: `EmailSendFailedError`, `{ retryable: false }`, `cause` strictly `{ code: "EMAXRECIPIENTS" }`; the server sees no connection.
65. **The rule of `retryable`.** Each rejection an `Error` with these fields, through `getSocket`; `cause` strictly the same fields:

    | Fields | `retryable` |
    | --- | --- |
    | `code: "ETIMEDOUT"`, `command: "CONN"` | true |
    | `code: "EDNS"`, `command: "CONN"`, `originalCode: "ENOTFOUND"` | true |
    | `code: "ESOCKET"`, `command: "CONN"` | true |
    | `code: "EPROTOCOL"`, `command: "CONN"`, `responseCode: 421` | true |
    | `code: "EAUTH"`, `command: "AUTH PLAIN"`, `responseCode: 454` | true |
    | `code: "ECONNECTION"`, `command: "CONN"`, `responseCode: 221` | true |
    | `code: "ECONNECTION"`, `command: "CONN"`, `responseCode: 554` | false |
    | `code: "EMESSAGE"`, `command: "DATA"`, `responseCode: 554` | false |
    | `code: "EAUTH"`, `command: "API"` | false |
    | `code: "EPROTOCOL"`, `command: "CONN"` | false |
    | `code: "ECONNREFUSED"`, and each other system code of *Decisions* 2 alone | true |
    | `code: "EAUTH"`, `command: "AUTH XOAUTH2"`, `originalCode: "EFETCH"` | true |
    | `code: "EAUTH"`, `command: "AUTH PLAIN"`, `originalCode: "ECONNRESET"` | true |
    | `code: "EAUTH"`, `command: "AUTH XOAUTH2"`, `responseCode: 535`, `originalCode: "EFETCH"` | false |
    | `code: "EPROXY"` | false |
    | `code: "ETLS"`, `command: "CONN"` | false |
    | `code: "EOAUTH2"` | false |
66. **The cause keeps the identifiers only.** A rejection `Error` with the message `Message failed: 554 refused for <victim@example.test>`, `code: "EMESSAGE"`, `command: "DATA"`, `responseCode: 554`, `originalCode: "EX"`, `response` and `rejected` holding `victim@example.test`, and `hint: "victim"`: `cause` is strictly `{ code: "EMESSAGE", command: "DATA", responseCode: 554, originalCode: "EX" }`, and `JSON.stringify(error.toJSON())` holds no `victim`.
67. **A `RCPT TO` rejection, read.** Through `getSocket`, an `Error` with `code: "EENVELOPE"`, `command: "RCPT TO"`, `responseCode: 550`, and, for `to` of `anna@example.test`:
    - `rejected: ["anna@example.test"]`, `rejectedErrors: [{ recipient: "anna@example.test", responseCode: 450 }]`: `EmailRecipientsRefusedError`, `{ refused: [{ index: 0, retryable: true }] }`;
    - the same `rejected`, with `rejectedErrors` of `[{ recipient: "anna@example.test", responseCode: "450" }]`, `[{ recipient: "other@example.test", responseCode: 450 }]`, `[]`, absent, or a getter that throws: `{ refused: [{ index: 0, retryable: false }] }`;
    - `rejected` of `["stranger@example.test"]`, `[7]`, `[]`, `"x"`, absent, or a getter that throws: `EmailSendFailedError`, `{ retryable: false }`, `cause` strictly `{ code: "EENVELOPE", command: "RCPT TO", responseCode: 550 }`.

68. **A proxy that is down.** `transport` of the server's options with `proxy` at a port where nothing listens: `EmailSendFailedError`, `{ retryable: true }`, `cause` strictly `{ code: "ECONNREFUSED" }`; the server sees no connection.

**On `main`**, the E cases and 57 to 67 fail, on missing exports, on nodemailer's own errors or on a count in `details`, and so do the changed cases, on their imports or on the old classes and `details`. Two parts pass, as checks of what stays: `lmtp: false` in 59, and 32. The `test-author` reports any other that passes, and why.

**Wrong implementations these cases rule out:**
- recipients matched by their exact address (60), or by the first index only (60);
- `retryable` read from nodemailer's own `responseCode` (58), or from an entry of `rejectedErrors` by its position rather than its `recipient` (67, `other@example.test`);
- a refusal read from `rejectedErrors` alone (67, `rejectedErrors: []`);
- LMTP checked on the options given rather than on nodemailer's copy (59, the URL with `lmtp: false`);
- every `EENVELOPE` taken as permanent (62);
- the `code` read before the `responseCode` (65, `554`);
- the connection codes read on `code` alone (65, `EFETCH` and `ECONNRESET` as `originalCode`), or nodemailer's four alone (65, the system codes; 68);
- nodemailer's error, or every field of it, as the cause (61, 66);
- a `RCPT TO` rejection trusted without matching its recipients (67).

**Check by hand**, after the build: the probe through `CommandHandler` and `@enardo/logger` of *Probes*, run again. The response's `error` is `EMAIL_RECIPIENTS_REFUSED` when the relay refuses the recipient, and `EMAIL_SEND_FAILED` for the host that does not resolve; no log line holds the address.

## Out of scope

- Cambusa's move to the 2.0.0 packages, in its repo, after the publish. Its web app can then map `EMAIL_RECIPIENTS_REFUSED` and `EMAIL_SEND_FAILED`.
- The publish, through the `publish` skill: `@enardo/email` before its adapter.
- What `@enardo/cqrs` does with an error that is not a `BaseError`: the new item of *To evaluate*.
- A `subject`, `text` or `html` that is not a string: `fix/email-nodemailer/non-string-content`, next in the queue.
- Telling a message never sent from one maybe sent: nodemailer's rejections give no sign of it (*Probes*).
- The enhanced status code (`5.1.1`): it lives in `response`, which echoes addresses.

## Plan

Each step ends green and committed.

1. This spec, the `critic`, checkpoint 1.
2. `@enardo/email`, test-first: the `test-author` writes E1 to E7. Then the three classes, the JSDoc, `package.json` and `pnpm install`, and the README.
3. `@enardo/email-nodemailer`, test-first: the `test-author` changes the cases listed, writes 57 to 67, and adds the server's `451`. Then the sender and its constructor, the classes that leave, `package.json`, the README and the `CLAUDE.md`.
4. `@enardo/errors`' README.
5. The check by hand.
6. `docs/backlog.md`: the line in `fix/email-nodemailer/non-string-content` and the new item. Then, in a commit of its own, this task's item removed.
7. The `reviewer`, checkpoint 2, integrate.
