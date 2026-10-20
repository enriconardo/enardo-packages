# @enardo/email

The contract for sending email: the types of a message and of its sender, and the errors that `send` rejects with. Implementations live in their own packages, so that code which sends email doesn't depend on a mail library.

## Exports

| Export | Meaning |
| --- | --- |
| `EmailSender` | Sends a message with `send(message, options?)`, and resolves once the relay has accepted it |
| `EmailMessage` | The message: `to`, `subject`, `text`, and optionally `html`, `from` and `replyTo` |
| `EmailRecipient` | A mailbox: an `address`, and an optional display `name`. `from` and `replyTo` use it too |
| `SendEmailOptions` | `tags` |
| `InvalidEmailMessageError`, `EmailRecipientsRefusedError`, `EmailSendFailedError` | What `send` rejects with: see [Errors](#errors) |
| `InvalidEmailMessageDetails`, `EmailRecipientsRefusedDetails`, `RefusedEmailRecipient`, `EmailSendFailedDetails` | The types of their `details` |
| `EmailErrorCause` | The type of their `cause` |

A caller depends on `EmailSender` only, and gets an implementation from its composition root:

```ts
import type { EmailSender } from "@enardo/email";

async function sendWelcome(emailSender: EmailSender, user: { email: string; name: string }) {
  await emailSender.send({
    to: { address: user.email, name: user.name },
    subject: "Welcome",
    text: `Hello ${user.name}`,
    html: `<p>Hello ${escapeHtml(user.name)}</p>`,
  });
}
```

`escapeHtml` stands for the caller's own escaping. `to` takes one recipient, or a list, mutable or `readonly`.

## Errors

The three classes extend `BaseError` of `@enardo/errors`; none extends another. `send` rejects with one of them, or with what a value of the caller's threw when read (a getter of the message).

| Class | `code` | `details` | When |
| --- | --- | --- | --- |
| `InvalidEmailMessageError` | `INVALID_EMAIL_MESSAGE` | `{ field: "to", reason: "empty" }`, `{ field: "to", reason: "address", index }`, `{ field: "from" \| "replyTo", reason: "address" }`, or `{ field: "from", reason: "missing" }` | before anything is sent: an empty `to`, an address the implementation refuses, no sender |
| `EmailRecipientsRefusedError` | `EMAIL_RECIPIENTS_REFUSED` | `{ refused }`: `{ index, retryable }` for each refused recipient, in ascending order of `index` | the relay refused one recipient or more; it took the message for the others, if any |
| `EmailSendFailedError` | `EMAIL_SEND_FAILED` | `{ retryable }` | any other failure: the relay out of reach, the sender or the message refused, an authentication that failed, an answer lost |

- **`index`** is the position of the recipient in `to`, 0 for a single recipient.
- **`retryable`** says whether the same send, later and with nothing changed, may succeed: the relay refused for now (an SMTP `4xx`), not for good (`5xx`), or could not be reached. It does not say that a retry is safe.
- **No personal data.** Neither the message, `details` nor `cause` holds an address, a name, a subject or a body: the errors can be logged. `cause` holds the identifiers of the driver's failure, which each implementation documents; its type, `EmailErrorCause`, takes strings and numbers, never an `Error`.

## Contract

Each field's comment holds the details. In short:

### Callers

- Validate `address`: it is one address, `local@domain`. A display name goes in `name`, never in `address`.
- Escape every value put into `html`: it is sent as given.
- Send a message each to people who must not see each other's addresses: every recipient of a list is in the `To` header.
- Treat a resolved `send` as accepted by the relay, not as delivered: a bounce never reaches the caller. A rejected `send` may have reached some of its recipients, or all of them, when the relay's answer was lost: a retry can send twice.
- Branch on the error's class or `code`, never on its message.
- Retry an `EmailRecipientsRefusedError` with the refused recipients whose `retryable` is true, and only them: the others took the message, or refused it for good. That retry is a message of its own, whose `To` header lists them alone.
- Retry an `EmailSendFailedError` when it is `retryable`, knowing that the first send may have been delivered: an answer lost looks like any other failure.

```ts
import {
  EmailRecipientsRefusedError,
  EmailSendFailedError,
  type EmailMessage,
  type EmailRecipient,
  type EmailSender,
} from "@enardo/email";

/** The recipients to send `message` to again later, if any. */
async function sendOnce(
  emailSender: EmailSender,
  message: EmailMessage & { to: readonly EmailRecipient[] },
): Promise<readonly EmailRecipient[]> {
  try {
    await emailSender.send(message);
    return [];
  } catch (error) {
    if (error instanceof EmailRecipientsRefusedError) {
      return error.details.refused
        .filter(({ retryable }) => retryable)
        .flatMap(({ index }) => message.to[index] ?? []);
    }
    if (error instanceof EmailSendFailedError && error.details.retryable) {
      return message.to; // may send twice
    }
    throw error;
  }
}
```

### Implementations

- Hand each `address` to the transport as one address, never inside a string the transport parses: a malformed address can be refused, never turned into other recipients.
- Encode `name` and `subject` for their headers: neither becomes header syntax, and a line break never starts a header.
- Reject a call with an empty `to` list.
- When `from` is absent, use the default sender set when the implementation was created, and reject the call when there is none.
- Resolve once the relay has accepted the message for every recipient; reject when it refuses the message or any recipient, and when its answer is lost.
- Reject with the errors of [Errors](#errors), never with the driver's own:
  - `InvalidEmailMessageError` for what is refused before anything is sent;
  - `EmailRecipientsRefusedError` when the relay refused recipients, each listed once, by its index in `to`. Two entries of `to` that the transport sends as one recipient are both listed;
  - `EmailSendFailedError` for any other failure, and for a refusal of recipients it cannot name.
- Set `retryable` when a later send may succeed with nothing changed, and document the rule.
- Keep addresses, names, subjects and bodies out of the errors: put the driver's identifiers in `cause`, never the driver's error, whose fields can echo the recipients' addresses.
- Never modify `message` or `options`.
- Do with each option what its comment says, or reject the call; never ignore one silently. TypeScript cannot check it: a `send` that declares no `options` parameter still implements `EmailSender`.
  - `tags`: metadata for the provider, which never reaches the recipient. An implementation whose provider keeps no such data drops them, and says so in its documentation.

## Contributing

Run these inside `packages/email`:

```sh
pnpm format && pnpm lint && pnpm typecheck && pnpm test
```

The tests check the types and the errors: `pnpm typecheck` catches a broken type, `pnpm test` a broken error. They run on Node only: sending email takes credentials that a browser must not hold.
