---
status: draft
type: fix
tier: M
implementer: sonnet/medium
packages: ["@enardo/email-nodemailer"]
branch: fix/email-nodemailer/redact-transport-errors
---

# `@enardo/email-nodemailer`: keep the transport's secrets out of the constructor's errors

## Why

`NodemailerEmailSender`'s constructor lets what `nodemailer.createTransport` throws pass through as it is (`src/nodemailer-email-sender.ts:454`), and the README documents it (*Options*, `transport`). For a `url` that does not parse, that is the `TypeError` of the URL parser, whose `input` holds the whole URL, SMTP password included. A misconfigured `url` puts the password into whatever logs the error at boot: `toJSON()` of a `BaseError` that wraps it, or a logger that serializes an error's own fields, as `@enardo/logger` does.

From the first *Queued* item of `docs/backlog.md`, found by the `critic`'s second run on the spec of `feature/email/send-errors` (2026-10-20). Root cause: the constructor treats nodemailer's option errors as safe to show, while `send` already reduces nodemailer's errors to their identifiers (package `CLAUDE.md`, *Logs*).

## Probes

All in the dev container, Node 24.21.0, nodemailer 10.1.0.

- `createTransport`'s synchronous throws, read in `dist/cjs/nodemailer.js:60-105`, `shared/index.js:324-386` (`parseConnectionUrl`, legacy `url.parse`), `smtp-transport/index.js` (constructor), `ses-transport/index.js:64-69` → it throws from: the URL parse; the legacy SES check (`ECONFIG`); `SESTransport`'s constructor (`ECONFIG`); `SMTPTransport`'s constructor through `wellknown(service)`; and any getter of the caller's that `assign` or the flag checks read.
- `createTransport(x)` for each input, own properties of the thrown error printed:
  - `"smtp://user:s3cret@[bad"` and `{ url: "smtp://user:s3cret@[bad" }` → `TypeError`, `{ code: "ERR_INVALID_URL", input: "smtp://user:s3cret@[bad", message: "Invalid URL" }`;
  - `"smtp://user:s3cret@ho st"` → the same, with that `input`;
  - `{ url: 42 }`, `{ url: {} }` → `TypeError`, `(input || "").replace is not a function`, no `code`;
  - `{ SES: { ses: {}, aws: {} } }` → `Error`, `code: "ECONFIG"`, `Using legacy SES configuration…`;
  - `{ SES: {} }` → `Error`, `code: "ECONFIG"`, `Missing SES configuration…`;
  - `{ service: 42 }`, `{ service: {} }` → `TypeError`, `key.split is not a function`, no `code`;
  - `{ get host() { throw new Error("from caller s3cret") } }` → that error, as it is;
  - `"smtp://user:s3cret@host:99999"`, `"smtp://user:s3%cret@host"`, `{ auth: "user:s3cret" }`, `{ auth: { type: "weird", … } }`, `{ logger: 42 }`, `{ logger: {} }`, `{ tls: "x" }` → no throw.
- The serialized form, after `pnpm exec turbo run build --filter=@enardo/email-nodemailer... --force`: `new NodemailerEmailSender({ transport })` caught and wrapped as the `cause` of a `BaseError` subclass, `toJSON().cause` without `stack`:
  - both bad-host transports → `{"code":"ERR_INVALID_URL","input":"smtp://user:s3cret@[bad","name":"TypeError","message":"Invalid URL"}`: the password reaches the log;
  - legacy SES → `{"code":"ECONFIG","name":"Error","message":"Using legacy SES configuration, …"}`;
  - `{ service: 42 }` → `{"name":"TypeError","message":"key.split is not a function"}`.
- `serializeError` of `@enardo/errors` returns a `cause` that is not an `Error` as it is (`packages/errors/src/base/serialize-error.ts:37-39`): a plain object of identifiers is serialized as is.
- To reuse: `readField` (`src/nodemailer-email-sender.ts:404`), which reads one field in a `try`; `EmailErrorCause` of `@enardo/email` (`packages/email/src/errors/email-error.types.ts:10`), the type of the `cause` of `send`'s errors; `EmailSendFailedError`'s `options?: { cause?: EmailErrorCause }` (`packages/email/src/errors/email-send-failed.error.ts:36`).
- No existing test sends any of these inputs (`git grep` of `ERR_INVALID_URL`, `ECONFIG`, `Invalid URL`, `SES`, `service:` in both email packages).

## Decisions

Taken with the user at intake (2026-10-21).

- **Every throw of `createTransport` becomes `InvalidEmailSenderOptionsError`**, with the new reason `"transport-options"`, not only the known ones: a list of known codes would let the next one nodemailer adds through as it is. Not chosen: wrapping `ERR_INVALID_URL` alone.
- **Its `cause` is the thrown value's identifiers**, `{ name, code }`, each kept only when it is a string, read with `readField`; no `cause` when neither is. Never `message`, `input` or `stack`: `input` holds the URL, and a getter of the caller's can throw anything. Typed `EmailErrorCause`, the type of the `cause` of `send`'s errors, which the package already imports.
- **A new major, `3.0.0`.** A caller could tell nodemailer's `TypeError` or `ECONFIG` apart today, and the README documents the pass-through: changing the class of what is thrown breaks it. Not chosen: a minor as a leak fix.
- **Only the `createTransport` call is wrapped.** The checks before it (`isTransportOptions`) and after it throw the package's own errors already; a throw from a getter or a Proxy read by `isTransportOptions` itself stays the caller's own error, as it is today.

## Open questions

None.

## Changes

`@enardo/email-nodemailer`:

- **`src/errors/invalid-email-sender-options.error.ts`**: the reason `"transport-options"` (JSDoc: nodemailer could not build a transporter from `transport`), with a message that names no option value, such as `nodemailer could not build a transporter from the transport options`. The constructor takes `options?: { cause?: EmailErrorCause }`, passed to `BaseError` as `cause`. The class's JSDoc says the `cause` holds identifiers only.
- **`src/nodemailer-email-sender.ts`**: `transporterOf` calls `createTransport` in a `try`; the `catch` throws `InvalidEmailSenderOptionsError("transport-options", …)` with the identifiers of the thrown value. Its comment says why: an option error of nodemailer's can hold the URL, password included (`input`). The constructor's `@throws` names the new case.
- **`README.md`**: the *Options* paragraph on the pass-through says instead that an error nodemailer throws while it reads the options becomes `InvalidEmailSenderOptionsError` with `transport-options`, and a `cause` of its `name` and `code` only; *Errors* adds the reason, and says the `cause`.
- **`CLAUDE.md`**: under *Transporters*, the rule: nothing `createTransport` throws passes through; its identifiers only, since its errors hold the URL.
- **`package.json`**: version `3.0.0`.
- **`docs/backlog.md`**: the item leaves, in a commit of its own.

## Test cases

In `__tests__/constructor.test.ts`, numbered after the highest in the package (68). Each expects `InvalidEmailSenderOptionsError`, `code: "INVALID_EMAIL_SENDER_OPTIONS"`, `details` `toStrictEqual({ reason: "transport-options" })`, the `cause` with `toStrictEqual`, and checks the secret, `s3cret`, on `message`, `stack` and `JSON.stringify(error.toJSON())`.

69. `transport: "smtp://user:s3cret@[bad"` (a string, as the types accept) → `cause` `{ name: "TypeError", code: "ERR_INVALID_URL" }`; no `s3cret`.
70. `transport: { url: "smtp://user:s3cret@[bad" }` → the same.
71. `transport: { url: "smtp://user:s3cret@ho st" }` → the same: another form the parser refuses.
72. Legacy SES options, `{ SES: { ses: {}, aws: {} } }`, through a variable the types let through → `cause` `{ name: "Error", code: "ECONFIG" }`.
73. `{ SES: {} }` → `cause` `{ name: "Error", code: "ECONFIG" }`: a throw from a transport's constructor, not from `createTransport`'s own body.
74. `{ service: 42 }` → `cause` `{ name: "TypeError" }`, with no `code` key: a missing identifier is left out, not `undefined`.
75. A transport whose own `host` getter throws `Object.assign(new Error("s3cret"), { code: 42, input: "s3cret" })` → `cause` `{ name: "Error" }`: a `code` that is not a string is left out, and no other field reaches the error.
76. A `host` getter that throws the string `"s3cret"` → no `cause` (`error.cause` is `undefined`, and `toJSON()` has no `cause` key); no `s3cret`.
77. A `host` getter that throws an error whose `code` and `name` getters throw → still `InvalidEmailSenderOptionsError`, with no `cause`: a read that throws counts as missing, and never replaces the error.

The existing refusals (`no-transport`, `pool`, `not-smtp`, `default-from`) keep their reasons, which their tests check: an implementation that wraps them too fails there.

## Risks

`risk: medium`: a secret leak. A `cause` that keeps any field beyond `name` and `code` brings it back: cases 69–71 and 75 check the serialized form, not the message.

## Out of scope

- A getter or a Proxy that throws while `isTransportOptions` reads `transport`: the caller's own error, as today.
- Asynchronous errors on the first `send` (`EAUTH`, connection codes): `send` reduces them already.
- Logging the refusal: the constructor logs nothing, as for its other reasons.

## Plan

1. **Test-first**: the `test-author` writes cases 69–77 from this spec; run before the fix, each fails on the pass-through (a `TypeError` or an `Error`, not `InvalidEmailSenderOptionsError`).
2. The reason, the `cause` option and the `try` around `createTransport`; cases 69–77 green, the existing ones untouched. Committed with the tests of step 1, so that no commit is red. → `[@enardo/email-nodemailer] fix: redact createTransport errors`.
3. README, package `CLAUDE.md`, version `3.0.0`. → `docs:` / `build:`.
4. The backlog item leaves. → `[repo] docs: …`.
5. `pnpm verify`, the reviewer, checkpoint 2.
