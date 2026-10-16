# @enardo/email

The contract for sending email. The package holds types only: implementations live in their own packages, so that code which sends email doesn't depend on a mail library.

## Exports

| Type | Meaning |
| --- | --- |
| `EmailSender` | Sends a message with `send(message, options?)`, and resolves once the relay has accepted it |
| `EmailMessage` | The message: `to`, `subject`, `text`, and optionally `html`, `from` and `replyTo` |
| `EmailRecipient` | A mailbox: an `address`, and an optional display `name`. `from` and `replyTo` use it too |
| `SendEmailOptions` | `tags` |

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

## Contract

Each field's comment holds the details. In short:

### Callers

- Validate `address`: it is one address, `local@domain`. A display name goes in `name`, never in `address`.
- Escape every value put into `html`: it is sent as given.
- Send a message each to people who must not see each other's addresses: every recipient of a list is in the `To` header.
- Treat a resolved `send` as accepted by the relay, not as delivered: a bounce never reaches the caller. A rejected `send` may have reached some of its recipients, or all of them, when the relay's answer was lost: a retry can send twice.

### Implementations

- Hand each `address` to the transport as one address, never inside a string the transport parses: a malformed address can be refused, never turned into other recipients.
- Encode `name` and `subject` for their headers: neither becomes header syntax, and a line break never starts a header.
- Reject a call with an empty `to` list.
- When `from` is absent, use the default sender set when the implementation was created, and reject the call when there is none.
- Resolve once the relay has accepted the message for every recipient; reject when it refuses the message or any recipient, and when its answer is lost.
- Never modify `message` or `options`.
- Do with each option what its comment says, or reject the call; never ignore one silently. TypeScript cannot check it: a `send` that declares no `options` parameter still implements `EmailSender`.
  - `tags`: metadata for the provider, which never reaches the recipient. An implementation whose provider keeps no such data drops them, and says so in its documentation.

The contract does not define yet what `send` rejects with: each implementation documents its errors.

## Contributing

Run these inside `packages/email`:

```sh
pnpm format && pnpm lint && pnpm typecheck && pnpm test
```

The tests check the types, so `pnpm typecheck` is the command that catches a broken contract.
