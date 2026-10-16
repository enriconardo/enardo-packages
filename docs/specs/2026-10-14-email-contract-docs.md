---
status: done
type: refactor
packages: ["@enardo/email", "@enardo/email-nodemailer"]
branch: refactor/email/contract-docs
---

# `@enardo/email`: document the contract, and accept a readonly recipient list

## Why

The item `refactor/email/contract-docs` of `docs/backlog.md`, from the architectural review of `@enardo/email` (2026-10-14), queued by the user the same day.

`@enardo/email` is four types and no word of documentation. The shared-package conventions ask for JSDoc on the public API, and every question the types leave open is answered today by whoever writes an adapter or a caller: what `name` may hold, who validates `address`, who supplies the sender when `from` is absent, when `send` resolves, what the options promise. The only adapter, `@enardo/email-nodemailer`, answers several of them in a way a caller would not expect (see *Where the adapter stands*).

`to` also refuses a `readonly` list (TS2322), so a caller that keeps its recipients in a readonly array needs a copy or a cast to send.

## Probes

They ran on `master` (`dd19ab3`), in throwaway containers of the dev image (`en-monorepo-dev`: Node 24.21.0, TypeScript 5.9.3, nodemailer 6.10.1), with the repo mounted read-only; the copies of the packages lived in the `en-probe` volume. The `dist/` they read was rebuilt first, with `pnpm exec turbo run build --filter=@enardo/email-nodemailer... --filter=@cambusa/identity... --force`.

### Types

On a copy of `packages/email` and `packages/email-nodemailer`:

- **A readonly list is refused**: `const message: EmailMessage = { to: list, … }` with `list: readonly EmailRecipient[]` fails with TS2322 (`The type 'readonly EmailRecipient[]' is 'readonly' and cannot be assigned to the mutable type 'EmailRecipient[]'`). With `to: EmailRecipient | readonly EmailRecipient[]`, it compiles.
- **The adapter breaks on the change, twice.** Against the changed contract, `toAddresses(message.to)` fails with TS2345: its parameter is `EmailRecipient | EmailRecipient[]`. Widened to `EmailRecipient | readonly EmailRecipient[]`, the method fails again (TS2345, TS2339 on `recipient.address`): `Array.isArray` narrows to `any[]`, which a readonly array is not, so the false branch keeps `readonly EmailRecipient[]`. The count of recipients in `send`, which reads only the true branch, compiles.
- **A guard fixes it**: `isRecipientList(recipients: EmailRecipient | readonly EmailRecipient[]): recipients is readonly EmailRecipient[]`, returning `Array.isArray(recipients)`, used in `toAddresses`. The adapter's `tsc --noEmit` and `eslint src` pass against the changed contract, and `tsc` against `master`'s: the widened parameter takes the mutable list too. The guard narrows only between the members of its parameter's union, which `Array.isArray` tells apart ([ADR 0003](../adr/0003-type-guards-claim-only-what-they-check.md)).
- **TypeScript cannot check that an implementation reads the options**: the adapter declares `send(message: EmailMessage)`, without `options`, and implements `EmailSender`, which declares `send(message, options?)`.

### The adapter at runtime

Through `NodemailerEmailSender` built from `master`: with a stream transport (`streamTransport: true, buffer: true`), which hands back the envelope and the raw message, and with the `transport` option against a minimal SMTP server written for the probe, which refuses with `550` every `RCPT TO` at `refused.test`. The default sender is `Cambusa <noreply@cambusa.test>` unless the row says otherwise.

| Input | Result |
| --- | --- |
| `address: "victim@example.test, attacker@evil.test"`, no name | resolves; the envelope has both addresses |
| `address: "a,attacker@evil.test"`, no name | resolves; the envelope has `attacker@evil.test` only |
| `address: "a,attacker@evil.test"`, name `Mario Rossi` | resolves; one recipient, `a,attacker@evil.test` |
| `address: "x>attacker@evil.test"`, name `Mario Rossi` | resolves; the envelope has `x`, the header `To: "Mario Rossiattacker@evil.test>" <x>` |
| `subject: "Hi\r\nBcc: attacker@evil.test"`, and the same with `\n` | resolves; `Subject: Hi Bcc: attacker@evil.test`, one header; the envelope keeps the one recipient |
| `to: []`, SMTP | rejects, `EENVELOPE` `No recipients defined`, `command: "API"`; the server sees no `MAIL FROM` |
| `to: []`, stream transport | resolves, with no recipient |
| no `from` and no `defaultFrom`, SMTP | resolves; the server sees `MAIL FROM:<>` |
| no `from` and no `defaultFrom`, stream transport | resolves; the envelope's `from` is `false`, and the message has no `From` header |
| two recipients, one refused, SMTP | resolves; the server sees both `RCPT TO`, then `DATA` |
| two recipients, one with a name, stream transport | resolves; `To: Anna <a@example.test>, b@example.test`, both in the envelope |
| one recipient, refused, SMTP | rejects, `EENVELOPE`, `command: "RCPT TO"`, `Can't send mail - all recipients were rejected: 550 no such user` |

The first probe of the missing sender passed `undefined` to a helper whose parameter defaulted to the sender, and showed one; the rows above come from the second run, which passes no `defaultFrom` at all.

### The callers

- **`@cambusa/shared`'s `Email` accepts more than one mailbox's syntax**: `Email.create("a,attacker@evil.test")` and `Email.create("x>attacker@evil.test")` return the value unchanged; `Email.create("victim@example.test,attacker@evil.test")` throws `InvalidEmailError` (two `@`). Its pattern is `^[^\s@]+@[^\s@]+\.[^\s@]+$`.
- **`@cambusa/identity` puts the first name into the HTML unescaped.** `SendVerificationEmailOnUserRegisteredHandler`, built from `dist/internal.mjs`, with a first name `<a href="https://evil.test/login">Accedi qui</a>`, sends `html` starting `<p>Ciao <a href="https://evil.test/login">Accedi qui</a>,</p>`. The register route takes `firstName: z.string().min(1)`, and `ResendVerificationEmailHandler` builds its HTML the same way (read, not run).

## Changes

### 1. `to` accepts a readonly list

`EmailMessage.to` becomes `EmailRecipient | readonly EmailRecipient[]`. Nothing else in the types changes: the other fields take no array, and a readonly property never blocks an assignment.

In `@enardo/email-nodemailer`, `toAddresses` takes `EmailRecipient | readonly EmailRecipient[]` and narrows through the guard of *Probes*, a function of the module, with a comment saying why `Array.isArray` is not enough. Nothing else in the adapter changes.

`@cambusa/identity` passes one recipient, and changes nothing.

### 2. The contract, in JSDoc

Each export, and each of its fields, gets a JSDoc comment. What they say:

**`EmailRecipient`**: a mailbox, an address with an optional display name. `from` and `replyTo` use it too, despite its name.

- `address`: one address, `local@domain`: never a list, nor the `Name <address>` form. The caller validates it. An implementation hands it to its transport as one address, never inside a string the transport parses, so a malformed address can be refused, never turned into other recipients.
- `name`: display text, which may hold any character: quotes, commas, angle brackets, line breaks. The implementation encodes it for the header; it never becomes header syntax.

**`EmailMessage`**:

- `to`: one recipient, or a list of at least one. Every recipient of a list is in the `To` header, so each sees the others' addresses: people who must not see each other get a message each. An implementation rejects an empty list.
- `subject`: plain text. The implementation encodes it, and a line break in it never starts a header.
- `text`: the plain-text body, which every client can show.
- `html`: an HTML version of the same content, sent with `text`. It is sent as given: the caller escapes every value it puts into it.
- `from`: the sender. When absent, the implementation's default sender, set when it is created; an implementation without one rejects the call.
- `replyTo`: where replies go, instead of `from`.

**`SendEmailOptions`**: an implementation honors each option as documented here, or rejects the call; it never ignores one silently. TypeScript cannot check it (*Probes*).

- `idempotencyKey`: the caller's name for one message, so that a retry does not send it twice. Once the relay has accepted the message for any of its recipients, a call with the same key sends nothing, for as long as the implementation's window lasts: it resolves when the relay accepted the message for every recipient, and rejects otherwise. The window starts when the relay accepts the message, and the implementation documents its length. A call made while another with the same key is pending sends nothing while it waits: it waits for the other to settle, then follows these rules as a retry would, or rejects. A message the relay accepted for no recipient leaves the key unused, so a retry sends. The guarantee holds across restarts of the caller's process and of the implementation's: an implementation that keeps keys in memory only cannot give it, and rejects a call with a key. A key names one message: reused for another, the call either rejects or counts as a repeat of the first.

  **Amended after review.** The rule first tied the key to the call: "once a call with a key has resolved", and "a call that rejected leaves the key unused, so a retry sends". A call rejects when the relay refuses one recipient and accepts the others, and when its outcome is lost after the relay accepted, so a retry with the key had to send again, the duplicate the key exists to prevent. The README said the opposite ("a second call with the same key sends nothing"). The key now follows what the relay accepted, and a call that waits for another is defined.
- `tags`: names and values for the provider: it shows them in its logs and reports, and returns them with its delivery events. They never reach the recipient. An implementation whose provider keeps no such data drops them, and its documentation says so (see *Decisions*).

**`EmailSender`**, `send`:

- resolves once the relay (the service, or the SMTP server, that the implementation hands the message to) has accepted it for every recipient. Delivery comes later, and a bounce never reaches the caller;
- rejects when the relay refuses the message, or any of its recipients, in which case the others may have received it; **amended after the second review**: and when the relay's answer is lost, so a rejected call may have reached every recipient. A server that takes the whole message and closes before its reply makes the adapter reject with `ECONNECTION`, `Connection closed unexpectedly` (probed by the second review). The amendment of `idempotencyKey` above relies on this case;
- never modifies `message` or `options`;
- what it rejects with is not part of the contract yet: each implementation documents its errors.

### 3. A README

`packages/email/README.md`, in the shape of `@enardo/transaction-manager`'s: what the package is (types only; adapters in their own packages), a table of the exports, an example of a caller, the contract split into what callers must do (validate `address`, escape what goes into `html`, a message each for recipients who must not see each other) and what implementations must do (the rest of *2*), and how to run the checks. **Added after review**: one sentence said which rules `@enardo/email-nodemailer` breaks today, so that no caller relies on those rejections. **Removed at checkpoint 2**, with the adapter's name in the first paragraph, on the user's rule: a package's README never names a package it does not depend on. The adapter's own README, which its assessment writes, says it instead.

### 4. Tests in `@enardo/email`

The package has none, and no test runner. It gets them as `@enardo/transaction-manager` has them: `vitest` (`catalog:`) in `devDependencies`, the scripts `test` and `test:watch`, `lint`, `lint:fix`, `format` and `format:check` over `src __tests__`, and a `vitest.config.ts` with the `~` alias. `vitest run` fails without a test file (`No test files found, exiting with code 1`, probed on a copy of `@enardo/transaction-manager` without `__tests__/`), so this lands in the same commit as the tests.

## Where the adapter stands

Against the rules of *2*, from the probes. This branch changes none of it: the adapter's assessment, `chore/email-nodemailer/architectural-assessment`, upgrades nodemailer to 10, and its behavior is probed again there. The gaps go into that item's *What*.

| Rule | The adapter today |
| --- | --- |
| `address` is one address | Without a name, it hands the string to nodemailer, which parses a list: a comma adds a recipient, or drops what comes before it. With a name, it writes `"${name}" <${address}>`, and a `>` in the address ends it: `x>attacker@evil.test` gives `x`, and `x>,attacker@evil.test` gives `x` and `attacker@evil.test` (the last one **probed by the review**). |
| `name` never becomes header syntax | Already in the item: a name can add recipients. |
| A line break in `subject` never starts a header | Holds: nodemailer folds it into a space. |
| An empty `to` is rejected | Left to the transport: SMTP rejects it, a stream transport sends nothing and resolves. |
| No sender at all is rejected | Resolves: `MAIL FROM:<>`, no `From` header. |
| A refused recipient rejects the call | Resolves when another recipient was accepted. |
| Options are honored or rejected | `idempotencyKey` is ignored, already in the item. `tags` are dropped, which *2* allows once the adapter documents it. |

The adapter has no README or tests yet; they are in the item too.

## Test cases

Test-first: public API of an `@enardo/*` package. The `test-author` writes them from this spec, in one run, in the foreground, in `packages/email/__tests__/email.types.test.ts`, importing from `~/index`. They are type checks (`expectTypeOf`, assignments, `@ts-expect-error`): `pnpm typecheck` covers `__tests__/` through the `library` preset, and is the command that fails; `vitest run` erases the types.

1. A `readonly EmailRecipient[]` is accepted as `to`.
2. A mutable `EmailRecipient[]` is accepted as `to`.
3. One `EmailRecipient` is accepted as `to`.
4. A string is not accepted as `to`.
5. A `readonly string[]` is not accepted as `to`.
6. **Added after review**: `EmailMessage["to"]` is exactly `EmailRecipient | readonly EmailRecipient[]`. Three wrong types passed cases 1 to 5, and only the adapter's typecheck, as a dependent, caught them: `EmailRecipient | Iterable<EmailRecipient>`, `EmailRecipient | ArrayLike<EmailRecipient>`, and an optional `to` (probed by the review on a copy). The type exists since step 5, so the case pins it, and is checked against those three: a new `test-author` run, in the foreground.

On `master`, case 1 fails `pnpm --filter @enardo/email typecheck` with TS2322 at its line, and cases 2 to 5 pass. Wrong types each case rules out: `readonly EmailRecipient[]` alone (3), a non-empty tuple (1, 2), `any` (4, 5), `EmailRecipient | readonly unknown[]` (5).

The rules of *2* that bind implementations have no test here: the package has no implementation to run them against. The adapter's tests, which the adapter's assessment writes, check them.

## Decisions (to confirm at checkpoint 1)

1. **`tags` are dropped where the provider has nothing to keep them in**, while `idempotencyKey` is honored or rejected. The item asks for "honor it or reject the call, never ignore it" for every option. For `tags`, rejecting would make a caller that sets them unable to send through SMTP, as in development with a local mail catcher, for the sake of data that only feeds the provider's reports. A dropped tag loses no mail and sends nothing twice. The general rule stays for every option whose loss changes what is sent.
2. **A refused recipient rejects the call**, although the others may have received the message. nodemailer resolves instead, and the caller cannot tell: `send` returns nothing. Rejecting makes the loss visible; `feature/email/send-errors` decides what the error carries (which recipients were refused), and the backlog item says so.
3. **No sender at all rejects the call**: a message without `From` breaks RFC 5322, and `MAIL FROM:<>` is the null sender of bounces.
4. **`SendEmailOptions` stays, documented**, as the item asks, although no caller passes it and the only adapter ignores it. Removing it until a provider adapter needs it is the alternative.
5. **The adapter gets the type fix only**: its gaps go to its own item, which the queue already puts first and which changes nodemailer's major version.

## Found while exploring

Added to *To evaluate* in `docs/backlog.md` at checkpoint 1, on the user's request (2026-10-14), each for a branch of its own:

- **HTML injection in identity's verification emails.** The register route takes any non-empty first name, and both handlers put it unescaped into `html` (*Probes*). Anyone can register with someone else's address: the owner then gets an email from Cambusa's real sender, with the attacker's link in it. The fix escapes the name in both handlers.
- **`Email` accepts characters a mailbox's local part cannot hold unquoted**, such as `,` and `>`, which an address-list parser splits on (*Probes*). The contract now leaves the validation to the caller. **Corrected after review**: a name does not stop an added recipient (`x>,attacker@evil.test` with a name gives `x` and `attacker@evil.test`), and no HTTP path brings such an address to `Email` today: the register and resend routes check it with `z.string().email()` first, which refuses `a,attacker@evil.test`, `x>attacker@evil.test` and `x>,attacker@evil.test` (zod 3.25.76). Probed by the review, and again.

The api-server's duplicate sender stays: it passes the same `config.email` sender as the adapter's `defaultFrom` and as each identity handler's `sender`, and *2* makes both valid. Dropping the handlers' option is a change to `@cambusa/identity`; no item is added unless the user wants one.

## Out of scope

- The adapter's gaps, and its README and tests: `chore/email-nodemailer/architectural-assessment`.
- An error type for `send`: `feature/email/send-errors`.
- A result for `send` that lists refused recipients, instead of rejecting.
- Renaming `EmailRecipient`, which also types senders: a breaking change for a name.
- The two findings above.

## Verification

- `pnpm verify`: `@enardo/email`, and its dependents `@enardo/email-nodemailer`, `@cambusa/identity` and `@cambusa/api-server`.
- The README's and JSDoc's claims about TypeScript and the adapter are the ones probed above.

## Review follow-ups

The first review found three blocking defects, all in the docs, and the code and the tests sound. Each finding was probed again before the fix.

1. **The `idempotencyKey` rules contradicted each other, and the README contradicted the JSDoc**: see the amendment in *2*. The other rules of the README were read again against the JSDoc, for the same kind of drift.
2. **The backlog understated what a name protects against, and left out what limits the exposure**: see the correction in *Found while exploring*. The item on `Email` says both facts. The adapter's item says the first: the routes' check is Cambusa's, and a shared adapter's item has no use for it (**corrected after the second review**, which found the sentence claiming both for both).
3. **A source named as "the same spec"**, against the backlog's format: named in full.

Taken from its suggestions:

- case 6 of *Test cases*;
- `EmailRecipient`'s comment and the README said "senders use it too", and `replyTo` is no sender: both say "`from` and `replyTo` use it too", as *2* does;
- the README's sentence on the adapter, in *3*;
- nodemailer 6.10.1 writes into the recipient objects it gets: `{ address: "a@example.test" }` gains `name: ""`, `x>,attacker@evil.test` becomes `"x ,attacker"@evil.test`, and a frozen object makes `sendMail` throw `TypeError: Cannot assign to read only property 'address'` (probed by the review, and again). The fix that the adapter's item plans for the display name, objects in place of strings, has to copy them, or it breaks "never modifies `message`": the item says so.

## Second review follow-ups

The second review found the `idempotencyKey` fix holding, and two blocking defects in the docs:

1. **The README's sentence on the adapter said that it resolves "with a refused recipient"**, without the condition: with one recipient, refused, it rejects (*Probes*). The sentence now says "when another was accepted". Its other claims were read again for the same drop of a condition: "with no sender" now says that the adapter leaves the call to its transport, since only the probe's server was seen accepting `MAIL FROM:<>`, and the adapter's backlog item says so too.
2. **A sentence of the first follow-ups claimed both facts for both backlog items**: corrected in place.

Taken from its suggestions:

- the pending-call rule of `idempotencyKey` read two ways once the other call's message was accepted for no recipient: the waiting call now follows the rules "as a retry would" once the other has settled;
- a call can reject after the relay accepted the whole message, even with one recipient: *2* and the README say so, and the README's callers' rule no longer limits a partial reach to several recipients;
- `feature/email/send-errors` records that the error of a repeat after a partial acceptance must read as permanent, and that retrying only the refused recipients takes a new key;
- a name in `from` or `replyTo` becomes header syntax too, through the same `toAddress` (probed by the second review: with the name `x" <attacker@evil.test>, "y` on `replyTo`, the header is `Reply-To: x <attacker@evil.test>, y <support@cambusa.test>`; probed again). The adapter's item says that the fix covers all three fields, and the README's sentence names them.

## Checkpoint 2

The user's rule (2026-10-14): a package's README does not name a package it does not depend on. `@enardo/email` depends on no adapter, so its README names none: the adapter's name leaves the first paragraph, and the sentence on the rules the adapter breaks leaves the README. The adapter's backlog item has its own README say it. The *Review follow-ups* above describe that sentence as it was before.

Six other READMEs name seven packages they do not depend on, found with a lookup of every `@enardo/*` and `@cambusa/*` name in a README against its package's `dependencies`, `devDependencies` and `peerDependencies`: `http-client` (`@enardo/logger`), `http-status` (`@enardo/http-client`), `transaction-manager` (`@enardo/transaction-manager-mongo`), `transaction-manager-mongo` (`@enardo/database-mongo`), `uow-repository` (`@enardo/transaction-manager-mongo`, `@enardo/uow-repository-mongo`), `uow-repository-mongo` (`@enardo/database-mongo`). They are out of this branch's scope. On the user's request, the rule went into the root `CLAUDE.md` (*Code conventions*), and the six READMEs into the backlog's *To evaluate*.

## Plan

1. This spec, first commit of the branch. ⏸ Checkpoint 1.
2. The test setup of *4*, in the working tree; `pnpm install` in the dev container.
3. The `test-author` writes cases 1 to 5; case 1 is seen failing with TS2322.
4. The adapter's guard and parameter; its `typecheck` and `lint` pass against the unchanged contract. Commit `[@enardo/email-nodemailer] refactor: accept a readonly recipient list`.
5. `to` accepts a readonly list; `pnpm verify`. Commit `[@enardo/email] refactor: accept a readonly list as to`, with the test setup and the tests.
6. JSDoc and README. Commit `[@enardo/email] docs: document the email sender contract`.
7. The backlog: the adapter's gaps into its item, the recipients a rejection names into `feature/email/send-errors`. Commit `[repo] docs: record the gaps found against the email contract`. The two findings went into *To evaluate* at checkpoint 1, on the user's request, in a commit of their own.
8. `pnpm verify`, then the `reviewer`; fixes (*Review follow-ups*). ⏸ Checkpoint 2.
9. Spec `done`; the item leaves the backlog in its own commit; `git merge --no-ff`.
