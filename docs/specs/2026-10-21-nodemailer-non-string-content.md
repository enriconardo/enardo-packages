---
status: done
type: fix
tier: L
implementer: sonnet/medium
packages: ["@enardo/email", "@enardo/email-nodemailer"]
branch: fix/email-nodemailer/non-string-content
---

# `@enardo/email-nodemailer`: refuse a `subject`, `text` or `html` that is not a string

## Why

`NodemailerEmailSender.send` passes `subject`, `text` and `html` to nodemailer as it gets them (`toMailOptions`, `src/nodemailer-email-sender.ts:198-206`). nodemailer gives an object meaning:

- a body `{ path }` is read from a file into the message, and a body `{ href }` is fetched;
- a header value `{ prepared: true, value }` is written as raw text, for every header nodemailer does not format itself, `Subject` included, so its line breaks start new headers (`Bcc`, `Reply-To`).

The types of `@enardo/email` refuse all of these; only a caller the types do not reach can pass them, and no caller does today. The adapter already checks recipients as values for the same reason (package `CLAUDE.md`, *Recipients*); the content was left out.

From the first *Queued* item of `docs/backlog.md`: the first and second reviews of `fix/email-nodemailer/contract-compliance` (2026-10-14, 2026-10-15), queued by the user at its checkpoint 2.

## Probes

All in the dev container, Node 24.21.0, nodemailer 10.1.0, after `pnpm exec turbo run build --filter=@enardo/email-nodemailer... --force`, through `dist/` to a local SMTP server on `node:net` (the branch has no commit yet: `main`'s code). Each send with `to`, `from`, `subject: "s"`, `text: "t"`, and the field below:

- `html: { path: "/etc/hostname" }` → resolves; the HTML part holds the container's hostname.
- `text: { path: "/etc/os-release" }` → resolves; the body holds `PRETTY_NAME="Debian GNU/Linux 12 (bookworm)"`.
- `subject: { prepared: true, value: "Hi\r\nBcc: attacker@evil.test\r\nReply-To: attacker@evil.test" }` → resolves; the message has the headers `Subject: Hi`, `Bcc: attacker@evil.test`, `Reply-To: attacker@evil.test`.
- `html: { href: "http://127.0.0.1:1/" }` → rejects with `EmailSendFailedError`: nodemailer tried to fetch it.
- `subject: undefined` → resolves, with no `Subject` header; `text: undefined` → resolves, with an empty body; `html: null` → resolves, as without `html`.
- `text: 42` and `text: new String("hi")` → reject with `EmailSendFailedError`; `text: Buffer.from("hi")` → resolves.
- `subject: ""`, `text: ""`, `html: ""` → resolves.
- `toMailOptions` reads each field once, by destructuring (`src/nodemailer-email-sender.ts:164`), and `send` logs only after it returns (`:100-107`): a refusal there sends and logs nothing, as for the existing refusals.
- To reuse: the shape of `InvalidEmailMessageDetails` and `messageOf` (`packages/email/src/errors/invalid-email-message.error.ts:5-26`); the idle server and the recording logger of `__tests__/support/` for "nothing sent, nothing logged".
- Existing tests that send a `subject`, `text` or `html` other than a string literal: none (`git grep -nE "subject:|text:|html:"` in both email packages' `__tests__`, and every `as unknown`, `as never` and `@ts-expect-error` there, which are all on recipients and transports).
- `docs/critic-runs.md` logs four L specs; this one is the fifth, which makes `chore/repo/evaluate-critic` due.

## Decisions

Taken with the user at intake (2026-10-21).

- **The adapter refuses a `subject`, `text` or `html` that is not a string**, with `InvalidEmailMessageError`, before anything is sent. A `typeof` check, not a list of the object shapes nodemailer reads: it closes the file, URL and raw-header paths, and the next one nodemailer adds. Not chosen: `disableFileAccess` and `disableUrlAccess` in the message, which leave the subject open, and which the transporter's own options override.
- **`html` is absent only when `undefined`**, as `from` and `replyTo`: `null` is refused. `subject` and `text` are required by the types, so `undefined` is refused too: today it sends a message with no subject, or an empty body.
- **The contract gets the reason**: `{ field: "subject" | "text" | "html"; reason: "type" }` in `InvalidEmailMessageDetails`, and `EmailSender.send`'s JSDoc lists it among the refusals.
- **A major of `@enardo/email`, `3.0.0`.** A new member of a union the caller receives makes an exhaustive `switch` on `reason` without `default` stop compiling, Cambusa's style; the rule of ADR 0004 applies as written. Chosen by the user after the `critic`'s first run, in place of the minor taken at intake. Not chosen: a minor with a written promise that `details` may gain values in a minor, which would have needed an ADR.
- **A major of `@enardo/email-nodemailer`, `4.0.0`.** Its range on `@enardo/email` moves to `^3.0.0`: an app still on `@enardo/email` 2 would get two copies, and `instanceof` on the contract's errors would fail across them. It also refuses values the README says it passes as they are.
- **Order of the checks:** `to`, `from`, `replyTo`, then `subject`, `text`, `html`: the first refused field is reported, as today.

## Open questions

None.

## Changes

`@enardo/email`:

- **`src/errors/invalid-email-message.error.ts`**: the member `{ readonly field: "subject" | "text" | "html"; readonly reason: "type" }`, with the JSDoc `The value of \`field\` is not a string.`, and its message in `messageOf`: `` `The email sender refuses ${field}: not a string` ``. Neither holds the value.
- **`src/email-sender.ts`**: the `InvalidEmailMessageError` bullet adds `or a \`subject\`, \`text\` or \`html\` that is not a string (\`html\` is absent only when \`undefined\`)`.
- **`README.md`**: the row of `InvalidEmailMessageError` adds the `details` and the case; *Implementations* adds: reject a `subject`, `text` or `html` that is not a string, `html` being absent only when `undefined`.
- **`package.json`**: version `3.0.0`.

`@enardo/email-nodemailer`:

- **`src/nodemailer-email-sender.ts`**: `toMailOptions` checks `subject`, `text` and `html` after the mailboxes, with `typeof … !== "string"` (`html` skipped when `undefined`), and throws `InvalidEmailMessageError({ field, reason: "type" })`. The values it checked are the ones it passes. A comment says why: nodemailer reads an object body as a file or a URL, and an object subject with `prepared` as raw header text. `send`'s `@throws` names the case.
- **`README.md`**: *Recipients the types refuse* says the content is checked too, in place of the sentences on passing it as it is; the table of `send` gets the row `subject`, `text` or `html` not a string (`html` absent only when `undefined`) → `InvalidEmailMessageError`, `{ field, reason: "type" }`, not sent, not logged.- **`CLAUDE.md`**: *Sending*, the first bullet adds a `subject`, `text` or `html` that is not a string, and why (the file, URL and raw-header paths); the opening and *Tests* point to this spec, case 78 on.
- **`package.json`**: version `4.0.0`; the `workspace:^` on `@enardo/email` publishes as `^3.0.0`.
- **`docs/backlog.md`**: the item leaves, in a commit of its own.

## Test cases

`@enardo/email`, in `__tests__/errors.test.ts`, the table of `InvalidEmailMessageError`: `{ field: "subject" | "text" | "html", reason: "type" }` → `details` as given, message `The email sender refuses <field>: not a string`.

`@enardo/email-nodemailer`, in a new `__tests__/content.test.ts`, numbered from 78. Each refusal expects `InvalidEmailMessageError`, `code: "INVALID_EMAIL_MESSAGE"`, `details` `toStrictEqual` the one named, nothing sent (an idle server), and nothing logged (the recording logger).

78. For each of `subject`, `text`, `html`, each value: `null`, `42`, `true`, `new String("hi")`, `Buffer.from("hi")`, `{ path: <a temporary file> }`, `{ href: "http://127.0.0.1:1/" }`, `{ prepared: true, value: "x" }`, `["hi"]` → `{ field, reason: "type" }`. `42`, a `String` and a `Buffer` catch a check on objects only, or on the shapes nodemailer reads.
79. `subject: undefined`, and `text: undefined` → `{ field, reason: "type" }`.
80. `html: undefined`, and a message without `html` → sent, with a single text part.
81. `subject: ""`, `text: ""`, `html: ""` → sent.
82. `subject: { prepared: true, value: "Hi\r\nBcc: <marker address>" }` → refused; `message`, `stack` and `JSON.stringify(error.toJSON())` hold neither `Bcc` nor the marker.
83. Order: a refused `replyTo` and `subject: 42` → `{ field: "replyTo", reason: "address" }`; `subject: 42` and `html: 42` → `subject`; `text: 42` and `html: 42` → `text`.
84. A message whose `subject` getter returns `"s"` on its first read and `{ prepared: true, value: "Hi\r\nBcc: …" }` after → sent, with `Subject: s` and no `Bcc` header; the getter is read once.

## Risks

`risk: medium`: the fix closes a file read and a header injection. A check on object shapes would leave the next shape nodemailer reads open: case 78 sends values of every type. A second read of a field after the check would reopen it: case 84.

## Out of scope

- `disableFileAccess` and `disableUrlAccess`: with the content refused, nothing of the caller's reaches them.
- What nodemailer does with a string subject or body: it encodes them.
- A `subject` of `""`, which nodemailer sends with no `Subject` header: a string the types accept.

## Plan

1. **Test-first**: the `test-author` writes the `@enardo/email` cases and cases 78–84 from this spec. Run before the change, the contract's fail on the message (`messageOf` returns `undefined`); 78, 79 and 82–84 fail (the message is sent, or `EmailSendFailedError`); 80 and 81 pass.
2. `@enardo/email`: the reason, its message, the contract's JSDoc and README, version `3.0.0`; committed with its tests. → `[@enardo/email] feat: add the type reason to invalid messages`.
3. The check in `toMailOptions`, after building `@enardo/email`; every case green, the existing ones untouched. Committed with cases 78–84, so that no commit is red. → `[@enardo/email-nodemailer] fix: refuse content that is not a string`.
4. README, package `CLAUDE.md`, version. → `docs:` / `build:`.
5. The backlog item leaves. → `[repo] docs: …`.
6. `pnpm verify`, the reviewer, checkpoint 2.
