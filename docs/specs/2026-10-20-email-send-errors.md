---
status: draft
type: feature
packages: ["@enardo/email", "@enardo/email-nodemailer"]
branch: feature/email/send-errors
---

# `@enardo/email`: the errors of `send`

## Why

The item `feature/email/send-errors` of `docs/backlog.md`, from the architectural review of `@enardo/email` (2026-10-14), queued by the user (2026-10-14).

- **The contract says nothing of what `send` rejects with.** A caller that retries has to read the driver's codes (`EENVELOPE`, `ESOCKET`, `responseCode`), the technology the port hides.
- **The adapter lets nodemailer's errors through**, and they reach whoever handles them as they are. Through `@enardo/cqrs`'s `CommandHandler`, as Cambusa's resend handler runs it (*Probes*):
  - the response's `error` is nodemailer's message: `getaddrinfo EAI_AGAIN smtp.internal.corp.test` for a host that does not resolve, `Can't send mail - all recipients were rejected: 550 5.1.1 <anna.marker@example.test>: no such user` when the relay refuses the recipient. The client gets the SMTP host, or the address;
  - the `error` log holds the address in `message`, `stack`, `response`, `rejected`, and each entry of `rejectedErrors` (`message`, `response`, `recipient`).
- **A refusal has two errors**: nodemailer's when the relay refuses every recipient, the adapter's `EmailRecipientsRefusedError` when it refuses some. Neither says which recipients: the adapter's counts them.
- **The adapter's errors are interim** (its `CLAUDE.md`): at checkpoint 1 of `fix/email-nodemailer/contract-compliance` (2026-10-14), the user asked that the contract's errors replace or absorb them.

## Probes

On `main` (`f22a8ed`), after `pnpm exec turbo run build --filter=@enardo/email-nodemailer... --filter=@enardo/logger... --filter=@enardo/cqrs... --force`, in throwaway containers of the dev image (Node 24.21.0, nodemailer 10.1.0), with the repo mounted read-only and no network. A local SMTP server answered as each row says; each send went through nodemailer, then through the adapter's `dist/`.

### nodemailer's rejections

Each is a plain `Error` (`name: "Error"`, no `cause`) with own fields `code` and `command`, plus `response` and `responseCode` when the server answered.

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

- **The rejection shows no stage.** A server that closes the connection before its greeting, or after `EHLO`, `MAIL FROM`, `RCPT TO`, `DATA` or the data's final dot, gives the same `ECONNECTION`, `CONN`, `Connection closed unexpectedly`: nothing tells a message the relay never got from one it may have accepted.
- **Addresses.** The server's answers echo addresses, and nodemailer copies them into `message` and `response`. `rejected`, and each entry of `rejectedErrors` (`message`, `response`, `recipient`), hold them too. As the `cause` of a `BaseError`, `toJSON()` keeps them all. The other fields hold none: `errno`, `syscall`, `hostname`, `address` and `port` describe the SMTP server.
- **Per recipient.** Each entry of `rejectedErrors` is an `EENVELOPE`, `RCPT TO` error with its own `responseCode`, and `recipient`, the address as the envelope sent it. The same with `PIPELINING` advertised.
- **Some recipients refused.** `sendMail` resolves, with `rejected` and `rejectedErrors` in its result, for a `550` and a `450` alike.
- **`rejectedErrors` covers `rejected`.** nodemailer pushes each refused recipient to both (`_actionRCPT`, and `_actionLMTPStream` for LMTP, read in its source), and in every case above both named the same recipients.
- **The envelope's form of an address.** With `to` of `anna@example.test`, `bob@Refused.TEST`, `bob@refused.test` and `Bob@refused.test`, the envelope, `rejected` and the `recipient`s hold `bob@refused.test` once, and `Bob@refused.test`: the domain lowercased, the local part as given, an exact duplicate once. The grammar of the adapter's `address.ts` lets nodemailer change nothing else (fuzzed by the spec of `fix/email-nodemailer/contract-compliance`).

### The adapter on `main`

- It rejects with nodemailer's error, as it is, in every row above.
- With some recipients refused, it rejects with `EmailRecipientsRefusedError`, `{ refused: 2 }`, for `to` of `anna@example.test`, `bruno@refused.test`, `carla@deferred.test`, and for the four of *The envelope's form of an address* alike.
- Through `CommandHandler` and `@enardo/logger` (`format: "json"`), as in *Why*. `mapErrorToString` returns `code` for a `BaseError` and `message` for any other `Error` (`packages/cqrs/src/command-handler.ts`).

### `@enardo/errors`

- `toJSON()` keeps a `cause` that is not an `Error` as it is: `{ code: "ESOCKET", command: "CONN" }` comes out unchanged.
- A `cause` passed as `undefined` is an own property of the error; `toJSON()` leaves it out.

### The callers

- In Cambusa (`474c20c`), the api-server builds the only `NodemailerEmailSender`. Identity's resend handler and its `UserRegistered` handler call `send`, to one recipient. No code of Cambusa's names an error of the adapter, and its web app maps no email code (`apps/web/src/lib/api/error-messages.ts`).
- In this repo, outside the adapter and frozen specs, its errors are named only by `docs/backlog.md`.
- No test of the adapter sends from `deferred.test`.

## Decisions

1. **Three errors in the contract**, siblings, each extending `BaseError`. `send` rejects with one of them, or with what a value of the caller's threw when read:
   - `InvalidEmailMessageError` (`INVALID_EMAIL_MESSAGE`): the message breaks the contract or the implementation's limits, and nothing was sent. It moves from the adapter with its `details`.
   - `EmailRecipientsRefusedError` (`EMAIL_RECIPIENTS_REFUSED`): the relay refused at least one recipient. One error whether it took the message for the others or refused them all: `details.refused` says which.
   - `EmailSendFailedError` (`EMAIL_SEND_FAILED`): any other failure: the relay out of reach, the sender or the message refused, an authentication that failed, an answer lost.
   - Not chosen: a class per failure (connection, authentication, message). No caller tells them apart: `retryable` carries what a caller decides on, and the cause what an operator reads.
   - `InvalidEmailSenderOptionsError` stays the adapter's: the contract has no constructor, and its reasons (`pool`, `not-smtp`) are nodemailer's.
2. **A retryable failure is told apart from a permanent one**, by `retryable: boolean`: in `EmailSendFailedError`'s `details`, and on each refused recipient.
   - It says whether the same send, later and with nothing changed, may succeed. It does not say that a retry is safe: an `EmailSendFailedError` may follow a delivered message, and the adapter cannot tell (*The rejection shows no stage*).
   - SMTP draws the line in its replies: `4xx` is transient, `5xx` permanent. Greylisting, the commonest refusal that a retry overcomes, is a `450` to one recipient.
   - The adapter's rule: retryable on a `4xx` reply; with neither a `4xx` nor a `5xx` reply, on a connection that failed, timed out or was lost (`ECONNECTION`, `ESOCKET`, `ETIMEDOUT`, `EDNS`). A wrong host or port gives the codes of an outage (`ECONNREFUSED`, a TLS mismatch), so it counts as retryable: a caller bounds its retries anyway, while a transient failure taken for a permanent one loses the message.
   - Not chosen: no flag, leaving the caller to read the cause, which is the problem of *Why*.
3. **The refused recipients are named by their index in `to`**: `details.refused` lists `{ index, retryable }` for each, once, in ascending order, with index 0 for a single recipient.
   - A caller can retry the deferred recipients alone: the others took the message, or refused it for good. With a count, as today, a partial refusal leaves two choices: send twice, or give up.
   - An index holds no address (*4*), and the caller maps it back to its own `to`.
   - Two entries of `to` that the envelope sends as one recipient, such as `bob@Refused.TEST` and `bob@refused.test`, are both listed.
   - Not chosen: the addresses, which are personal data; a count, as today.
4. **The errors hold no address, name, subject or body**, in their message, `details` or `cause`, so a caller can log them, as `CommandHandler` logs every failure.
   - The adapter's errors and logs hold none already (its README). The contract makes it a rule for every implementation.
   - The adapter reduces nodemailer's error to its identifiers in `cause`: `{ code, command, responseCode, originalCode }`, each when present. Its other fields echo addresses (*Probes*). `@enardo/http-client`'s `NetworkError` reduces its cause the same way (`fix/http-client/redact-cause`).
   - The cost: the server's text (`response`), which explains a refusal (`5.7.1 Relaying denied`) but often echoes an address. nodemailer's own logger shows it, recipients included, when `transport` sets `logger` (adapter's README, *Logs*).
   - Not chosen: nodemailer's error as `cause`, as the item's *What* says: every log of the error would keep the addresses.
5. **`@enardo/email` and `@enardo/email-nodemailer` go to 2.0.0.**
   - The contract's types do not change, but an implementation of 1.0.0 no longer meets it: its rejections are its own. Not chosen: 1.1.0, which callers could take as safe with any implementation of 1.x.
   - The adapter drops two exports, and its rejections change.
6. **The errors are classes of `@enardo/email`**, which gains runtime code and a dependency on `@enardo/errors`. Its `dist/index.mjs` stops being empty, and the adapter's starts importing it. `@enardo/database` and `@enardo/database-mongo` do the same with `DatabaseError`. The adapter does not re-export them, as it does not re-export `EmailSender`.
7. **The adapter's logs follow the errors.** A refusal logs `warn` `Email recipients refused.` with `{ recipientsCount, refused }`, `refused` being the length of `details.refused`, whether the relay refused some recipients or all. `Email send failed.` carries the fields of the cause, so it gains `originalCode`.
8. **Test-first**, as public API of two `@enardo/*` packages. The `test-author` writes the cases of *Test cases*, one run per package.
9. **No ADR.** Each decision is a rule of `@enardo/email`'s contract or of its adapter, recorded in their READMEs.

## Changes

### `@enardo/email` 2.0.0

`src/errors/`, one file per class and an `index.ts`, exported by `src/index.ts`. Each class declares its `name` as a field, narrows `code` and `details` with `declare readonly`, and takes an optional `options: Pick<BaseErrorOptions, "cause">` last.

| Class | Constructor | `details` | `message` |
| --- | --- | --- | --- |
| `InvalidEmailMessageError` | `(details: InvalidEmailMessageDetails, options?)` | as given | `The email has no recipient: to is an empty list`; `The email has no sender: no from, and no default sender`; `The email sender refuses the address of to[1]` (or `from`, `replyTo`) |
| `EmailRecipientsRefusedError` | `(refused: readonly RefusedEmailRecipient[], options?)` | `{ refused }` | `The relay refused the email for to[1], to[3]` |
| `EmailSendFailedError` | `(details: EmailSendFailedDetails, options?)` | as given | `Sending the email failed`, plus `; a later retry may succeed` when `retryable` |

- **Types**, exported:
  - `InvalidEmailMessageDetails`, unchanged from the adapter: `{ field: "to", reason: "empty" }`, `{ field: "to", reason: "address", index }`, `{ field: "from" | "replyTo", reason: "address" }`, `{ field: "from", reason: "missing" }`;
  - `RefusedEmailRecipient`: `{ readonly index: number; readonly retryable: boolean }`;
  - `EmailSendFailedDetails`: `{ readonly retryable: boolean }`.
- **`EmailSender.send`'s JSDoc** says what it rejects with.
- **`package.json`**: version `2.0.0`; `"dependencies": { "@enardo/errors": "workspace:^" }`; the description `Email sender contract: the message types and the errors of send.`
- **`README.md`**:
  - the package holds the types and the errors of `send`, no longer types only;
  - the exports, the errors among them;
  - *Callers*: branch on the class or on `code`. Retry an `EmailRecipientsRefusedError` with the refused recipients whose `retryable` is true, and only them. Retry an `EmailSendFailedError` when `retryable`, knowing that it may send twice. The errors can be logged: they hold no address, name, subject or body. An example of each retry;
  - *Implementations*: when each error applies (*Decisions* 1), what `retryable` means (*2*), how `refused` lists the recipients (*3*), what the errors never hold (*4*), and that a driver's error never passes through. The sentence `The contract does not define yet what send rejects with` leaves;
  - *Contributing*: the tests check behavior too.
- **Node only**: no browser project, since no browser app imports the package (*The callers*).

### `@enardo/email-nodemailer` 2.0.0

- **`src/errors/`** keeps `InvalidEmailSenderOptionsError`; `InvalidEmailMessageError` and `EmailRecipientsRefusedError` leave.
- **`src/nodemailer-email-sender.ts`**:
  - It throws the contract's errors, imported from `@enardo/email`.
  - Before the send, it keeps each `to` address's envelope form: the local part as given, the domain lowercased.
  - **A refusal** is a list of `rejectedErrors`: the result's when `sendMail` resolves, the rejection's when it rejects with `code: "EENVELOPE"` and `command: "RCPT TO"`. The sender matches each entry's `recipient` to every index of `to` with that envelope form, and rejects with `EmailRecipientsRefusedError`, listing each matched index once, in ascending order. An index is retryable when its entry's `responseCode` is a number from 400 to 499.
  - A refusal that cannot be read counts as any other rejection: a list that is not an array, or an empty one; an entry whose `recipient` is not a string, or matches no index; a read that throws. `rejected` is no longer read: `rejectedErrors` covers it (*Probes*).
  - **Any other rejection** of nodemailer becomes `EmailSendFailedError`. Its `cause` holds `code`, `command` and `originalCode` when they are strings, and `responseCode` when it is a number, each read on its own, in a `try`, at the top level, as the logs read them today. It has no `cause` when none of them is present.
  - **`retryable`**: false when `responseCode` is 500 to 599; true when it is 400 to 499; otherwise, true when `code` is `ECONNECTION`, `ESOCKET`, `ETIMEDOUT` or `EDNS`.
  - A resolved send with no entry in `rejectedErrors` resolves, as today.
  - The logs of *Decisions* 7.
- **`src/index.ts`**: `NodemailerEmailSender`, `NodemailerEmailSenderOptions`, `NodemailerSmtpOptions`, `InvalidEmailSenderOptionsError`, `InvalidEmailSenderOptionsReason`, `Logger`, `LoggerMetadata`.
- **`package.json`**: version `2.0.0`. `@enardo/email` stays in `dependencies` (`workspace:^`, packed as `^2.0.0`).
- **`README.md`**: the exports; the table of `send`, with the contract's errors; the rule of `retryable`; *Errors*: the cause's fields, and `InvalidEmailSenderOptionsError`, the adapter's own; *Logs*; *Against `@enardo/email`'s contract* loses its line on two errors for a refusal.
- **`CLAUDE.md`**:
  - *Layout*: `src/errors/` holds the constructor's error;
  - *Sending*: the lines on nodemailer's rejections passing through and on the interim classes leave. A refusal is read from `rejectedErrors`, matched by envelope form; every other rejection becomes `EmailSendFailedError`, with its identifiers in `cause`;
  - *Logs*: `originalCode` joins the identifiers;
  - *Tests*: cases 1 to 56 carry their number in the spec of `fix/email-nodemailer/contract-compliance`, from 57 on in this one.

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
E3. `EmailRecipientsRefusedError([{ index: 1, retryable: false }, { index: 3, retryable: true }])`: `details` is `{ refused: [{ index: 1, retryable: false }, { index: 3, retryable: true }] }`, and `message` is `The relay refused the email for to[1], to[3]`.
E4. `EmailSendFailedError({ retryable: false })` and `({ retryable: true })`: `details` equals the argument, and each `message` is the one of *Changes*.
E5. Each class, given `{ cause: { code: "ESOCKET" } }`: `cause` is that object, and `toJSON().cause` equals it. Built without `options`, `toJSON()` has no `cause`.
E6. The entry point exports at run time exactly `InvalidEmailMessageError`, `EmailRecipientsRefusedError` and `EmailSendFailedError`.
E7. Types, checked by `pnpm typecheck`: each `code` is its literal; `details` is `InvalidEmailMessageDetails`, `{ readonly refused: readonly RefusedEmailRecipient[] }` and `EmailSendFailedDetails`; assigning `index` or `retryable` of a `RefusedEmailRecipient`, or `retryable` of `EmailSendFailedDetails`, is a type error.

### `@enardo/email-nodemailer`

Each case imports the contract's errors from `@enardo/email`, so a rejection with the right class from another copy fails.

**Support.** The SMTP server also answers `451` to a `MAIL FROM` at `deferred.test`.

**Changed cases**, under their number in the spec of `fix/email-nodemailer/contract-compliance`:

- **14, 16, 18, 19, 31, 41, 42, 43, 49**: `InvalidEmailMessageError` comes from `@enardo/email`; the assertions do not change.
- **22**: one of two recipients refused (`550`): `EmailRecipientsRefusedError`, `details` `{ refused: [{ index: 1, retryable: false }] }`. The rest as today: `DATA`, one message, neither address in `toJSON()`.
- **23**: one of two deferred (`450`): the same, with `retryable: true`.
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

57. **Refused and deferred, in order.** `to` of `anna@example.test`, `bruno@refused.test`, `carla@deferred.test`: `{ refused: [{ index: 1, retryable: false }, { index: 2, retryable: true }] }`; the server received one message.
58. **Every recipient refused, mixed.** `to` of `bruno@refused.test`, `carla@deferred.test`: `{ refused: [{ index: 0, retryable: false }, { index: 1, retryable: true }] }`; no `DATA`. nodemailer's own `responseCode` is `450`, so a retryable read from it marks both.
59. **The envelope's form.** `to` of `anna@example.test`, `bob@Refused.TEST`, `bob@refused.test`, `Bob@refused.test`: `{ refused: [{ index: 1, … }, { index: 2, … }, { index: 3, … }] }`, each `retryable: false`. A match on the exact address misses index 1; one that stops at the first index misses 2.
60. **The sender refused.** `from` of `victim@refused.test`: `EmailSendFailedError`, `{ retryable: false }`, `cause` strictly `{ code: "EENVELOPE", command: "MAIL FROM", responseCode: 550 }`. `JSON.stringify(error.toJSON())` holds no `victim`, which the server's answer echoes.
61. **The sender deferred.** `from` at `deferred.test`: `{ retryable: true }`, `cause` strictly `{ code: "EENVELOPE", command: "MAIL FROM", responseCode: 451 }`.
62. **A refused connection.** A port where nothing listens (a server started, then closed): `EmailSendFailedError`, `{ retryable: true }`, `cause` strictly `{ code: "ESOCKET", command: "CONN", originalCode: "ECONNREFUSED" }`. The log: `debug`, then `warn` `Email send failed.` `{ recipientsCount: 1, code: "ESOCKET", command: "CONN", originalCode: "ECONNREFUSED" }`.
63. **The rule of `retryable`.** Each rejection an `Error` with these fields, through `getSocket`; `cause` strictly the same fields:

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
64. **The cause keeps the identifiers only.** A rejection `Error` with the message `Message failed: 554 refused for <victim@example.test>`, `code: "EMESSAGE"`, `command: "DATA"`, `responseCode: 554`, `originalCode: "EX"`, `response` and `rejected` holding `victim@example.test`, and `hint: "victim"`: `cause` is strictly `{ code: "EMESSAGE", command: "DATA", responseCode: 554, originalCode: "EX" }`, and `JSON.stringify(error.toJSON())` holds no `victim`.
65. **A `RCPT TO` rejection, read.** Through `getSocket`, an `Error` with `code: "EENVELOPE"`, `command: "RCPT TO"`, `responseCode: 550`, and as `rejectedErrors`:
    - `[{ recipient: "anna@example.test", responseCode: 450 }]`: `EmailRecipientsRefusedError`, `{ refused: [{ index: 0, retryable: true }] }`;
    - `[{ recipient: "anna@example.test", responseCode: "450" }]`: the same, with `retryable: false`;
    - `[{ recipient: "stranger@example.test", responseCode: 550 }]`, `[]`, `"x"`, `[{ recipient: 7 }]`, and a getter that throws: each `EmailSendFailedError`, `{ retryable: false }`, `cause` strictly `{ code: "EENVELOPE", command: "RCPT TO", responseCode: 550 }`.

**On `main`**, every case of this list fails: the E cases and 57 to 65 on missing exports or on nodemailer's own errors, the changed cases on their imports or on the old classes and `details`. The `test-author` reports any that passes, and why.

**Wrong implementations these cases rule out:**
- recipients matched by their exact address (59), or by the first index only (59);
- `retryable` read from nodemailer's own `responseCode` for every recipient (58);
- every `EENVELOPE` taken as permanent (61);
- the `code` read before the `responseCode` (63, `554`);
- nodemailer's error, or every field of it, as the cause (60, 64);
- a `RCPT TO` rejection trusted without matching its recipients (65).

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
3. `@enardo/email-nodemailer`, test-first: the `test-author` changes the cases listed, writes 57 to 65, and adds the server's `451`. Then the sender, the classes that leave, `package.json`, the README and the `CLAUDE.md`.
4. The check by hand.
5. `docs/backlog.md`: the line in `fix/email-nodemailer/non-string-content` and the new item. Then, in a commit of its own, this task's item removed.
6. The `reviewer`, checkpoint 2, integrate.
