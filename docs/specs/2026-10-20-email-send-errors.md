---
status: draft
type: feature
packages: ["@enardo/email", "@enardo/email-nodemailer", "@enardo/errors"]
branch: feature/email/send-errors
---

# `@enardo/email`: the errors of `send`

## Why

The item `feature/email/send-errors` of `docs/backlog.md`, from the architectural review of `@enardo/email` (2026-10-14), queued by the user (2026-10-14).

- **The adapter lets nodemailer's errors through**, and they reach whoever handles them as they are. Through `@enardo/cqrs`'s `CommandHandler`, as Cambusa's resend handler runs it (*Probes*):
  - the response's `error` is nodemailer's message: `getaddrinfo EAI_AGAIN smtp.internal.corp.test` for a host that does not resolve, `Can't send mail - all recipients were rejected: 550 5.1.1 <anna.marker@example.test>: no such user` when the relay refuses the recipient. The client gets the SMTP host, or the address;
  - the `error` log holds the address in `message`, `stack`, `response`, `rejected`, and each entry of `rejectedErrors` (`message`, `response`, `recipient`).
- **The contract says nothing of what `send` rejects with.** A caller that retries has to read the driver's codes (`EENVELOPE`, `ESOCKET`, `responseCode`), the technology the port hides. No caller retries today: Cambusa's two calls send to one recipient, one logs the failure, the other lets it reach `CommandHandler`, which answers with its `code`. The item names this caller for when one comes.
- **A refusal has two errors**: nodemailer's when the relay refuses every recipient, the adapter's `EmailRecipientsRefusedError` when it refuses some.
- **The adapter's errors are interim** (its `CLAUDE.md`): at checkpoint 1 of `fix/email-nodemailer/contract-compliance` (2026-10-14), the user asked that the contract's errors replace or absorb them.

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

- **The rejection shows no stage.** A server that closes the connection before its greeting, or after `EHLO`, `MAIL FROM`, `RCPT TO`, `DATA` or the data's final dot, gives the same `ECONNECTION`, `CONN`, `Connection closed unexpectedly`: nothing tells a message the relay never got from one it may have accepted.
- **Addresses.** The server's answers echo addresses, and nodemailer copies them into `message` and `response`. `rejected`, and each entry of `rejectedErrors` (`message`, `response`, `recipient`), hold them too. As the `cause` of a `BaseError`, `toJSON()` keeps them all. The other fields hold none: `errno`, `syscall`, `hostname`, `address` and `port` describe the SMTP server.

### Refused recipients

- **Over SMTP**, each refused recipient is in `rejected`, and in `rejectedErrors` as an `EENVELOPE`, `RCPT TO` error with its own `responseCode`. When some recipients are refused, `sendMail` resolves with both in its result, for a `550` and a `450` alike; when every one is, they are own fields of the rejection. The same with `PIPELINING` advertised.
- **Over LMTP** (`lmtp: true`), a recipient refused after the data is in `rejected` only, unless a `RCPT TO` was refused before (found by the `critic`, run again here). `sendMail` resolves, even when every recipient is refused:
  - one of two refused after the data: `rejected: ["bob@example.test"]`, no `rejectedErrors`;
  - both: `accepted: []`, `rejected` of both, no `rejectedErrors`;
  - one refused at `RCPT TO`, one after the data: `rejectedErrors` holds both, the second as `EMESSAGE`, `DATA`.

  The adapter on `main`, which reads `rejected`, rejects with `{ refused: 1 }`, `{ refused: 2 }` and `{ refused: 2 }`.
- **`rejected` counts the envelope's recipients.** With `to` of `anna@example.test`, `bob@Refused.TEST`, `bob@refused.test` and `Bob@refused.test`, the envelope and `rejected` hold `bob@refused.test` once, and `Bob@refused.test`: the domain lowercased, an exact duplicate once. The adapter on `main` rejects with `{ refused: 2 }`.

### `@enardo/cqrs`, `@enardo/errors`, TypeScript

- `mapErrorToString` returns `code` for a `BaseError` and `message` for any other `Error` (`packages/cqrs/src/command-handler.ts`). The run of *Why* went through `CommandHandler` and `@enardo/logger` (`format: "json"`).
- `toJSON()` keeps a `cause` that is not an `Error` as it is: `{ code: "ESOCKET", command: "CONN" }` comes out unchanged. A `cause` passed as `undefined` is an own property of the error, and `toJSON()` leaves it out.
- A parameter typed `{ cause?: Readonly<Record<string, string | number>> }` refuses an `Error`, an interface that extends it, and an `unknown` (TS2322), and accepts an object of identifiers (`tsc --strict`).

### The callers

- In Cambusa (`474c20c`), the api-server builds the only `NodemailerEmailSender`. Identity's resend handler and its `UserRegistered` handler call `send`, to one recipient. No code of Cambusa's names an error of the adapter, and its web app maps no email code (`apps/web/src/lib/api/error-messages.ts`).
- In this repo, outside the adapter and frozen specs, its errors are named only by `docs/backlog.md`.
- No test of the adapter sends from `deferred.test`, or to `refused-after-data.test`.

## Decisions

1. **Three errors in the contract**, siblings, each extending `BaseError`. `send` rejects with one of them, or with what a value of the caller's threw when read:
   - `InvalidEmailMessageError` (`INVALID_EMAIL_MESSAGE`): an empty `to`, no sender, or an address the implementation refuses, found before anything is sent. It moves from the adapter with its `details`.
   - `EmailRecipientsRefusedError` (`EMAIL_RECIPIENTS_REFUSED`): the relay refused at least one recipient. One error whether it took the message for the others or refused them all.
   - `EmailSendFailedError` (`EMAIL_SEND_FAILED`): any other failure: the relay out of reach, the sender or the message refused, an authentication that failed, an answer lost, a limit of the transport (`maxRecipients`).
   - Not chosen: a class per failure (connection, authentication, message). No caller tells them apart: `retryable` carries what a caller decides on, and the cause what an operator reads.
   - `InvalidEmailSenderOptionsError` stays the adapter's: the contract has no constructor, and its reasons (`pool`, `not-smtp`) are nodemailer's.
2. **A retryable failure is told apart from a permanent one**, by `retryable: boolean` in the `details` of `EmailRecipientsRefusedError` and `EmailSendFailedError`.
   - It says whether the same send, later and with nothing changed, may succeed. It does not say that a retry is safe: an `EmailSendFailedError` may follow a delivered message, which the adapter cannot tell (*The rejection shows no stage*), and an `EmailRecipientsRefusedError` may follow one delivered to the other recipients.
   - It serves the caller of *Why*, which does not exist yet. It costs a rule on nodemailer's codes and the cases that pin it. Not chosen: no flag, which leaves that caller reading the cause.
   - SMTP draws the line in its replies: `4xx` is transient, `5xx` permanent. Greylisting, the commonest refusal that a retry overcomes, is a `450` to a recipient.
   - The adapter's rule for a failure: retryable on a `4xx` reply; with neither a `4xx` nor a `5xx` reply, on a connection that failed, timed out or was lost (`ECONNECTION`, `ESOCKET`, `ETIMEDOUT`, `EDNS`). A wrong host or port gives the codes of an outage (`ECONNREFUSED`, a TLS mismatch), so it counts as retryable: a caller bounds its retries anyway, while a transient failure taken for a permanent one loses the message.
   - For a refusal: retryable when every refused recipient got a `4xx`. A refusal whose code nodemailer does not keep (LMTP, after the data) counts as permanent.
3. **A refusal counts its recipients, and names none**: `details` is `{ refused, retryable }`, `refused` being how many recipients the relay refused.
   - Every caller sends to one recipient: with one, a list says no more than the count and the flag.
   - Not chosen: each refused recipient by its index in `to`, with its own `retryable`, so that a caller could retry the deferred ones alone. It needs a model of nodemailer's normalization of the envelope, and a duty on every implementation. When a caller sends to several recipients and retries, adding it is a new major.
   - Not chosen: the addresses, which are personal data (*4*).
4. **The errors hold no address, name, subject or body**, in their message, `details` or `cause`, so a caller can log them, as `CommandHandler` logs every failure.
   - The adapter's errors and logs hold none already (its README). The contract makes it a rule for every implementation.
   - The compiler holds part of it: the classes take a `cause` of type `EmailErrorCause`, `Readonly<Record<string, string | number>>`, which refuses an `Error` and an `unknown` (*Probes*). A string can still hold an address: the README states the rule.
   - The adapter reduces nodemailer's error to `{ code, command, responseCode, originalCode }`, each when present. Its other fields echo addresses (*Probes*). `@enardo/http-client`'s `NetworkError` reduces its cause the same way, in its own constructor (`fix/http-client/redact-cause`).
   - `@enardo/errors`' README tells a wrapping error to pass the other one as `cause`. It gains when not to: when that error can hold personal data or secrets, which `toJSON()` would carry into every log.
   - The cost: the server's text (`response`), which explains a refusal (`5.7.1 Relaying denied`) but often echoes an address. nodemailer's own logger shows it, recipients included, when `transport` sets `logger` (adapter's README, *Logs*).
   - Not chosen: nodemailer's error as `cause`, as the item's *What* says: every log of the error would keep the addresses.
5. **`@enardo/email` and `@enardo/email-nodemailer` go to 2.0.0.**
   - The contract's `EmailSender` does not change, but an implementation of 1.0.0 no longer meets the contract: its rejections are its own. Not chosen: 1.1.0, which callers could take as safe with any implementation of 1.x.
   - The adapter drops two exports, and its rejections change.
   - `@enardo/errors` changes its README only, which needs no version.
6. **The errors are classes of `@enardo/email`**, which gains runtime code and a dependency on `@enardo/errors`. Its `dist/index.mjs` stops being empty, and the adapter's starts importing it. `@enardo/database` and `@enardo/database-mongo` do the same with `DatabaseError`. The adapter does not re-export them, as it does not re-export `EmailSender`.
7. **The adapter's logs follow the errors.** A refusal logs `warn` `Email recipients refused.` with `{ recipientsCount, refused }`, whether the relay refused some recipients or all. `Email send failed.` carries the fields of the cause, so it gains `originalCode`.
8. **Test-first**, as public API of two `@enardo/*` packages. The `test-author` writes the cases of *Test cases*, one run per package.
9. **No ADR.** Each decision is a rule of `@enardo/email`'s contract or of its adapter, recorded in their READMEs; the one that reaches beyond them goes into `@enardo/errors`' README.

## Changes

### `@enardo/email` 2.0.0

`src/errors/`, one file per class and an `index.ts`, exported by `src/index.ts`. Each class declares its `name` as a field, narrows `code` and `details` with `declare readonly`, and takes `options?: { cause?: EmailErrorCause }` last.

| Class | Constructor | `details` | `message` |
| --- | --- | --- | --- |
| `InvalidEmailMessageError` | `(details: InvalidEmailMessageDetails, options?)` | as given | `The email has no recipient: to is an empty list`; `The email has no sender: no from, and no default sender`; `The email sender refuses the address of to[1]` (or `from`, `replyTo`) |
| `EmailRecipientsRefusedError` | `(details: EmailRecipientsRefusedDetails, options?)` | as given | `The relay refused the email for 1 recipient` (`for 2 recipients`) |
| `EmailSendFailedError` | `(details: EmailSendFailedDetails, options?)` | as given | `Sending the email failed` |

The last two messages end with `; a later retry may succeed` when `retryable`.

- **Types**, exported:
  - `InvalidEmailMessageDetails`, unchanged from the adapter: `{ field: "to", reason: "empty" }`, `{ field: "to", reason: "address", index }`, `{ field: "from" | "replyTo", reason: "address" }`, `{ field: "from", reason: "missing" }`;
  - `EmailRecipientsRefusedDetails`: `{ readonly refused: number; readonly retryable: boolean }`;
  - `EmailSendFailedDetails`: `{ readonly retryable: boolean }`;
  - `EmailErrorCause`: `Readonly<Record<string, string | number>>`.
- **`EmailSender.send`'s JSDoc** says what it rejects with.
- **`package.json`**: version `2.0.0`; `"dependencies": { "@enardo/errors": "workspace:^" }`; the description `Email sender contract: the message types and the errors of send.`
- **`README.md`**:
  - the package holds the types and the errors of `send`, no longer types only;
  - the exports, the errors among them;
  - *Callers*: branch on the class or on `code`. `retryable` says that a retry may succeed, not that it is safe: an `EmailSendFailedError` may follow a delivered message, an `EmailRecipientsRefusedError` one delivered to the others. The errors can be logged: they hold no address, name, subject or body. An example of a retry;
  - *Implementations*: when each error applies (*Decisions* 1), what `retryable` and `refused` mean (*2*, *3*), what the errors never hold, a `cause` included (*4*), and that a driver's error never passes through. The sentence `The contract does not define yet what send rejects with` leaves;
  - *Contributing*: the tests check behavior too.
- **Node only**: no browser project, since no browser app imports the package (*The callers*).

### `@enardo/email-nodemailer` 2.0.0

- **`src/errors/`** keeps `InvalidEmailSenderOptionsError`; `InvalidEmailMessageError` and `EmailRecipientsRefusedError` leave.
- **`src/nodemailer-email-sender.ts`** throws the contract's errors, imported from `@enardo/email`:
  - **A refusal** comes from `rejected` and `rejectedErrors`: the result's when `sendMail` resolves with `rejected` not empty, as today; the rejection's when it rejects with `code: "EENVELOPE"` and `command: "RCPT TO"`. `send` rejects with `EmailRecipientsRefusedError`: `refused` is the length of `rejected`, and `retryable` is true when `rejectedErrors` is an array as long as `rejected` whose every entry has a `responseCode` from 400 to 499 (a number).
  - The rejection's fields are read like its identifiers: each on its own, in a `try`. A `rejected` that is not an array, or is empty, or whose read throws, makes the rejection a failure like any other. A `rejectedErrors` that cannot be read makes the refusal not retryable.
  - **Any other rejection** of nodemailer becomes `EmailSendFailedError`. Its `cause` holds `code`, `command` and `originalCode` when they are strings, and `responseCode` when it is a number, each read on its own, in a `try`, at the top level, as the logs read them today. It has no `cause` when none of them is present.
  - **`retryable` of a failure**: false when `responseCode` is 500 to 599; true when it is 400 to 499; otherwise, true when `code` is `ECONNECTION`, `ESOCKET`, `ETIMEDOUT` or `EDNS`.
  - The logs of *Decisions* 7.
- **`src/index.ts`**: `NodemailerEmailSender`, `NodemailerEmailSenderOptions`, `NodemailerSmtpOptions`, `InvalidEmailSenderOptionsError`, `InvalidEmailSenderOptionsReason`, `Logger`, `LoggerMetadata`.
- **`package.json`**: version `2.0.0`. `@enardo/email` stays in `dependencies` (`workspace:^`, packed as `^2.0.0`).
- **`README.md`**: the exports; the table of `send`, with the contract's errors; `refused`, a count of the envelope's recipients, where two entries of `to` that differ only in the case of the domain count once; the rules of `retryable`, LMTP's refusals after the data included; *Errors*: the cause's fields, and `InvalidEmailSenderOptionsError`, the adapter's own; *Logs*; *Against `@enardo/email`'s contract* loses its line on two errors for a refusal.
- **`CLAUDE.md`**:
  - *Layout*: `src/errors/` holds the constructor's error;
  - *Sending*: the lines on nodemailer's rejections passing through and on the interim classes leave. A refusal is read from `rejected`, which LMTP fills after the data, and its `retryable` from `rejectedErrors`, which it does not; every other rejection becomes `EmailSendFailedError`, with its identifiers in `cause`;
  - *Logs*: `originalCode` joins the identifiers;
  - *Tests*: cases 1 to 56 carry their number in the spec of `fix/email-nodemailer/contract-compliance`, from 57 on in this one.

### `@enardo/errors`

- **`README.md`**, *Writing an error*: the bullet on `cause` adds that an error that can hold personal data or secrets is not passed whole, since `toJSON()` carries a cause into every log: the wrapping error takes its identifiers instead, and documents them.

### Repo

- `pnpm-lock.yaml`, from `pnpm install`.
- `docs/backlog.md`:
  - in `fix/email-nodemailer/non-string-content`, a line: since `feature/email/send-errors`, `InvalidEmailMessageDetails` is `@enardo/email`'s, so refusing a `subject`, `text` or `html` that is not a string adds a field and a reason to the contract, a minor of `@enardo/email`;
  - in *To evaluate*, a new item: `@enardo/cqrs`'s `CommandHandler` puts the `message` of any `Error` that is not a `BaseError` in the response's `error`, which the api-server sends to the client. Before this task, that was nodemailer's message, with the address of a refused recipient or the SMTP host (*Probes*). The item of this task recorded it, and leaves with it. From the spec of `feature/email/send-errors`;
  - this task's item removed, in a commit of its own.

## Test cases

### `@enardo/email` (`__tests__/errors.test.ts`, from `~/index`)

E1. Each class, built with valid arguments: an instance of it and of `BaseError`, `name` equal to the class name, its `code`, and a stack whose first line is `<name>: <message>`.
E2. `InvalidEmailMessageError`, for each of `{ field: "to", reason: "empty" }`, `{ field: "to", reason: "address", index: 1 }`, `{ field: "from", reason: "address" }`, `{ field: "replyTo", reason: "address" }` and `{ field: "from", reason: "missing" }`: `details` equals the argument, and `message` is the one of *Changes*.
E3. `EmailRecipientsRefusedError` with `{ refused: 1, retryable: false }` and `{ refused: 2, retryable: true }`: `details` equals the argument; the messages are `The relay refused the email for 1 recipient` and `The relay refused the email for 2 recipients; a later retry may succeed`.
E4. `EmailSendFailedError` with `{ retryable: false }` and `{ retryable: true }`: `details` equals the argument; the messages are `Sending the email failed` and `Sending the email failed; a later retry may succeed`.
E5. Each class, given `{ cause: { code: "ESOCKET", responseCode: 421 } }`: `cause` is that object, and `toJSON().cause` equals it. Built without `options`, `toJSON()` has no `cause`.
E6. The entry point exports at run time exactly `InvalidEmailMessageError`, `EmailRecipientsRefusedError` and `EmailSendFailedError`.
E7. Types, checked by `pnpm typecheck`:
   - each `code` is its literal, and `details` is `InvalidEmailMessageDetails`, `EmailRecipientsRefusedDetails` and `EmailSendFailedDetails`;
   - assigning a field of `EmailRecipientsRefusedDetails` or `EmailSendFailedDetails` is a type error;
   - for each class, a `cause` of type `Error`, and one of type `unknown`, are type errors.

### `@enardo/email-nodemailer`

Each case imports the contract's errors from `@enardo/email`, so a rejection with the right class from another copy fails.

**Support.** The SMTP server also answers `451` to a `MAIL FROM` at `deferred.test`. With `lmtp`, it answers `LHLO` as it answers `EHLO`, and after the data one reply per recipient it accepted, in order: `550` at `refused-after-data.test`, `250` otherwise.

**Changed cases**, under their number in the spec of `fix/email-nodemailer/contract-compliance`:

- **14, 16, 18, 19, 31, 41, 42, 43, 49**: `InvalidEmailMessageError` comes from `@enardo/email`; the assertions do not change.
- **22**: one of two recipients refused (`550`): `EmailRecipientsRefusedError`, `details` `{ refused: 1, retryable: false }`. The rest as today: `DATA`, one message, neither address in `toJSON()`.
- **23**: one of two deferred (`450`): `{ refused: 1, retryable: true }`.
- **24**: every recipient refused, `to` of `bob@refused.test` alone: `EmailRecipientsRefusedError`, `{ refused: 1, retryable: false }`; the server saw no `DATA`.
- **25**: the connection closed after `DATA`: `EmailSendFailedError`, `details` `{ retryable: true }`, `cause` strictly `{ code: "ECONNECTION", command: "CONN" }`.
- **32**: `InvalidEmailSenderOptionsError` alone.
- **33**: the entry point exports at run time exactly `NodemailerEmailSender` and `InvalidEmailSenderOptionsError`.
- **36**: every recipient refused: `debug`, then `warn` `Email recipients refused.` `{ recipientsCount: 1, refused: 1 }`.
- **37**: one of two refused: `debug`, then `warn` `Email recipients refused.` `{ recipientsCount: 2, refused: 1 }`.
- **40**, the rejections through `getSocket`:
  - the `Error` whose `code` getter throws, with `command: "RCPT TO"` and `responseCode: 550`: `EmailSendFailedError`, `{ retryable: false }`, `cause` strictly `{ command: "RCPT TO", responseCode: 550 }`. The log as today;
  - a string, and `{ code: 5, command: ["RCPT TO"], responseCode: "550" }`: `EmailSendFailedError`, `{ retryable: false }`, no `cause` in `toJSON()`. The log as today.

**New cases:**

57. **Refused and deferred.** `to` of `anna@example.test`, `bruno@refused.test`, `carla@deferred.test`: `{ refused: 2, retryable: false }`, one message sent. A refusal retryable when any recipient got a `4xx` gives `true`.
58. **Every recipient refused, mixed.** `to` of `bruno@refused.test`, `carla@deferred.test`: `{ refused: 2, retryable: false }`, no `DATA`. nodemailer's own `responseCode` is `450`, so a `retryable` read from it gives `true`.
59. **Every recipient deferred.** `to` of `bruno@deferred.test`, `carla@deferred.test`: `{ refused: 2, retryable: true }`.
60. **LMTP, after the data.** With `lmtp: true`, `to` of `anna@example.test`, `bob@refused-after-data.test`: `{ refused: 1, retryable: false }`. Both at `refused-after-data.test`: `{ refused: 2, retryable: false }`. A refusal read from `rejectedErrors` alone resolves both.
61. **The envelope's count.** `to` of `anna@example.test`, `bob@Refused.TEST`, `bob@refused.test`, `Bob@refused.test`: `{ refused: 2, retryable: false }`, as the README says.
62. **The sender refused.** `from` of `victim@refused.test`: `EmailSendFailedError`, `{ retryable: false }`, `cause` strictly `{ code: "EENVELOPE", command: "MAIL FROM", responseCode: 550 }`. `JSON.stringify(error.toJSON())` holds no `victim`, which the server's answer echoes.
63. **The sender deferred.** `from` at `deferred.test`: `{ retryable: true }`, `cause` strictly `{ code: "EENVELOPE", command: "MAIL FROM", responseCode: 451 }`.
64. **A refused connection.** A port where nothing listens (a server started, then closed): `EmailSendFailedError`, `{ retryable: true }`, `cause` strictly `{ code: "ESOCKET", command: "CONN", originalCode: "ECONNREFUSED" }`. The log: `debug`, then `warn` `Email send failed.` `{ recipientsCount: 1, code: "ESOCKET", command: "CONN", originalCode: "ECONNREFUSED" }`.
65. **The limit of the transport.** `maxRecipients: 1` in `transport`, two recipients: `EmailSendFailedError`, `{ retryable: false }`, `cause` strictly `{ code: "EMAXRECIPIENTS" }`; the server sees no connection.
66. **The rule of `retryable`.** Each rejection an `Error` with these fields, through `getSocket`; `cause` strictly the same fields:

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
67. **The cause keeps the identifiers only.** A rejection `Error` with the message `Message failed: 554 refused for <victim@example.test>`, `code: "EMESSAGE"`, `command: "DATA"`, `responseCode: 554`, `originalCode: "EX"`, `response` and `rejected` holding `victim@example.test`, and `hint: "victim"`: `cause` is strictly `{ code: "EMESSAGE", command: "DATA", responseCode: 554, originalCode: "EX" }`, and `JSON.stringify(error.toJSON())` holds no `victim`.
68. **A `RCPT TO` rejection, read.** Through `getSocket`, an `Error` with `code: "EENVELOPE"`, `command: "RCPT TO"`, `responseCode: 550`, and:
    - `rejected: ["anna@example.test"]`, `rejectedErrors: [{ responseCode: 450 }]`: `EmailRecipientsRefusedError`, `{ refused: 1, retryable: true }`;
    - the same `rejected`, with `rejectedErrors` of `[{ responseCode: "450" }]`, `[]`, `[{ responseCode: 450 }, { responseCode: 450 }]`, absent, or a getter that throws: `{ refused: 1, retryable: false }`;
    - `rejected` of `[]`, `"x"`, absent, or a getter that throws: `EmailSendFailedError`, `{ retryable: false }`, `cause` strictly `{ code: "EENVELOPE", command: "RCPT TO", responseCode: 550 }`.

**On `main`**, every case of this list fails: the E cases and 57 to 68 on missing exports, on nodemailer's own errors or on `details` without `retryable`, the changed cases on their imports or on the old classes and `details`. The `test-author` reports any that passes, and why.

**Wrong implementations these cases rule out:**
- `retryable` of a refusal true when any recipient got a `4xx` (57), or read from nodemailer's own `responseCode` (58), or always false (59, 68);
- a refusal read from `rejectedErrors` alone (60);
- every `EENVELOPE` taken as permanent (63);
- the `code` read before the `responseCode` (66, `554`);
- nodemailer's error, or every field of it, as the cause (62, 67);
- a `rejectedErrors` trusted without its length (68).

**Check by hand**, after the build: the probe through `CommandHandler` and `@enardo/logger` of *Probes*, run again. The response's `error` is `EMAIL_RECIPIENTS_REFUSED` when the relay refuses the recipient, and `EMAIL_SEND_FAILED` for the host that does not resolve; no log line holds the address.

## Out of scope

- Cambusa's move to the 2.0.0 packages, in its repo, after the publish. Its web app can then map `EMAIL_RECIPIENTS_REFUSED` and `EMAIL_SEND_FAILED`.
- The publish, through the `publish` skill: `@enardo/email` before its adapter.
- Each refused recipient named by its index (*Decisions* 3), until a caller sends to several recipients and retries.
- What `@enardo/cqrs` does with an error that is not a `BaseError`: the new item of *To evaluate*.
- A `subject`, `text` or `html` that is not a string: `fix/email-nodemailer/non-string-content`, next in the queue.
- Telling a message never sent from one maybe sent: nodemailer's rejections give no sign of it (*Probes*).
- The enhanced status code (`5.1.1`): it lives in `response`, which echoes addresses.

## Plan

Each step ends green and committed.

1. This spec, the `critic`, checkpoint 1.
2. `@enardo/email`, test-first: the `test-author` writes E1 to E7. Then the three classes, the JSDoc, `package.json` and `pnpm install`, and the README.
3. `@enardo/email-nodemailer`, test-first: the `test-author` changes the cases listed, writes 57 to 68, and adds the server's `451` and LMTP mode. Then the sender, the classes that leave, `package.json`, the README and the `CLAUDE.md`.
4. `@enardo/errors`' README.
5. The check by hand.
6. `docs/backlog.md`: the line in `fix/email-nodemailer/non-string-content` and the new item. Then, in a commit of its own, this task's item removed.
7. The `reviewer`, checkpoint 2, integrate.
