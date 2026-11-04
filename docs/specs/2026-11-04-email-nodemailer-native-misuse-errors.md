---
status: draft
type: fix
tier: M
implementer: sonnet/medium
packages: ["@enardo/email-nodemailer"]
branch: fix/email-nodemailer/native-misuse-errors
---

# Report the misuses of `NodemailerEmailSender`'s options with native errors

## Why

From the backlog item *Review the `BaseError`s that report misuse or misconfiguration* (Queued), which applies ADR 0012 point 6 package by package and has this package left, and from a discussion with the user at intake, which kept one reason as a `BaseError`.

ADR 0012 point 6 gives a `BaseError` to a condition a caller may handle by `code`, and a native error to a misuse or a misconfiguration, which a caller fixes in its code. `InvalidEmailSenderOptionsError` carries five reasons under one `code`. Four leave a caller nothing to do but fix the options, and the fifth, a refused `defaultFrom`, can be handled. One `code` over all five says neither, and every `code` is public API (point 4).

Nothing is broken today: this is a matter of a coherent contract. The moment is what counts: `5.0.0` is unpublished, so the change costs no version.

## Probes

- `pnpm view @enardo/email-nodemailer versions --registry https://npm.enriconardo.com` (host) → `1.0.0`, `4.0.0`. The manifest's `5.0.0` is unpublished, so this change takes it as it is, with no bump.
- `git log 603cceb..HEAD -- packages/email-nodemailer` → since `4.0.0`, `@enardo/email` moved to a peer (`d0ea672`), and the `logger` option went (`c30a683`). `README.md` has no upgrade note for either.
- The throw sites, every one, in `src/nodemailer-email-sender.ts` → `default-from` `:67`; `no-transport` `:409`; `not-smtp` `:416` and `:462`; `transport-options` `:449`; `pool` `:455`.
- `git grep` for the class, the code and `InvalidEmailSenderOptionsReason`, outside this package and `docs/specs` → `docs/backlog.md:14` and `:15` alone.
- `grep -r` for the class and the code in `~/Projects/cambusa`, without `node_modules` and `dist` → no match. It depends on `^1.0.0`, and builds the sender at `apps/api-server/src/composition-root.ts:159`, from `config.email`. Its bootstrap (`apps/api-server/src/main.ts:105`) logs any error and exits: a `BaseError` and a native error take one path.
- `git grep` and `grep -r` for `InvalidDefaultFromError` and `INVALID_DEFAULT_FROM`, in this repo and in `cambusa` → no match: both are free (ADR 0012 point 4).
- The messages and outcomes, on `main`, after `./dev.sh exec pnpm exec turbo run build --filter=@enardo/email-nodemailer... --filter=@enardo/logger... --force`, from `dist/`:
  - `{}` → `NodemailerEmailSender needs transport options`;
  - `pool: true`, and a `url` with `?pool=true` → `NodemailerEmailSender does not create a pooled transporter`;
  - `streamTransport: true`, `lmtp: true`, `direct:x`, an object with `send` → `NodemailerEmailSender creates SMTP transporters only: transport must hold SMTP options`;
  - a `url` it cannot parse → `nodemailer could not build a transporter from the transport options`, `cause: { name: "TypeError", code: "ERR_INVALID_URL" }`; `{ SES: {} }` → the same, `cause: { name: "Error", code: "ECONFIG" }`; a `host` getter that throws `1` → the same, no `cause`;
  - `defaultFrom` with `a,b@example.test`, and the string `a@example.test` → `The address of defaultFrom is not one NodemailerEmailSender accepts`;
  - no `transport` and a refused `defaultFrom` → the `no-transport` refusal: `transport` is checked first;
  - `defaultFrom: ""` → no throw: only a truthy value is read;
  - a `defaultFrom` whose `address` getter throws a `RangeError` → that `RangeError` passes through, today and after this change.
- A `cause` absent or present, same build, in Node 24.21.0 → `Object.hasOwn(new Error("m", { cause: undefined }), "cause")` is `true`; `new Error("m", undefined)` has none. `Object.getOwnPropertyNames` gives `["stack", "message", "cause"]` for an error with a `cause`, and `["stack", "message"]` for a `TypeError` without.
- What the errors expose, through `createLogger("console", { format: "json" })` of `@enardo/logger`, same build, with a plain `Error` built as this spec's `transport-options` will be → `{ cause: { code, name }, message, name, stack }`, so the identifiers reach the log. With `{ cause: undefined }`, the log has no `cause`. `isBaseErrorLike` of it → `false`.
- A class of the planned shape, `super(message, { code })` with no `details`, same build → `isBaseErrorLike` is `true`, `details` is `undefined`, `toJSON()` holds `code`, `name`, `message`, `stack`, and the log holds them too.
- The fallback → `new NodemailerEmailSender({ transport })` without `defaultFrom` builds, and a message without `from` then rejects with `InvalidEmailMessageError`, `{ field: "from", reason: "missing" }` (`README.md:79`, not run here).
- `packages/errors/src/index.ts` exports no `serializeError`: the tests cannot use it in place of `toJSON()`.
- The highest case number in `__tests__/` → 84.
- `packages/uow-repository-mongo/__tests__/support/native-errors.ts` → the form of the native error's assertion.
- `packages/database-mongo/README.md:80` → the form of an upgrade note that names a peer.

## Decisions

Taken with the user at intake.

The test is point 6's: can a caller handle the condition by `code`, or does it fix its code? A value read from the environment is not fixed in the code, so what decides here is whether a caller has anything to do but stop.

1. **`default-from` stays a `BaseError`, as `InvalidDefaultFromError`, `INVALID_DEFAULT_FROM`.** A caller has a way on: it builds the sender without `defaultFrom`, and gives each message its `from`. The address can come from the environment, as in `cambusa`.
2. **The class is renamed, and has no `details`.** A `code` identifies one condition (point 4), and `INVALID_EMAIL_SENDER_OPTIONS` would promise every option. `details.reason` would have one value. `InvalidEmailSenderOptionsReason` goes.
3. **`no-transport`, `pool` and `not-smtp`: a native `TypeError`.** `transport` is not SMTP options of the kind accepted, and the types already refuse `pool: true` and `lmtp: true`.
4. **`transport-options`: a native `Error`, with the same `cause`.** nodemailer threw while reading the options, from any field, and no value of one type says why. There is no sender without a transport, so a caller can only stop. The `cause` stays `{ name, code }`, with nothing else: only identifiers, never the thrown value, whose message and fields can hold the URL, password included. An absent `cause` is no own property.
5. **The messages stay as they are.** With `details.reason` gone, they tell the reasons apart (probes).
6. **`@enardo/errors` stays in `dependencies`**, for the one class, and the README keeps naming it.
7. **The backlog item closes.** `ENV_MISSING`, `ENV_MALFORMED` and the two errors of `@enardo/entities` move to *To evaluate*, undecided, each with point 6's test and decision 1's reading, since this spec is not read after the merge.

Not taken:

- A native error with a `code`: ADR 0012 keeps a `code` for what a caller may handle, TypeScript would not declare it, and the two earlier branches set it aside.
- Native errors for all five reasons, the first proposal: the user keeps `default-from`, as a caller can handle it.
- `RangeError` for `default-from`: not needed once it stays a `BaseError`.
- Keeping the old class name and code: nobody reads them, and `5.0.0` is unpublished.

## Open questions

None.

## Changes

`@enardo/email-nodemailer`, staying at `5.0.0`:

- `src/errors/invalid-email-sender-options.error.ts`: deleted. `src/errors/invalid-default-from.error.ts`: `InvalidDefaultFromError extends BaseError`, `name` as a field, `declare readonly code: "INVALID_DEFAULT_FROM"`, a constructor with no parameter, the message of the probes. Its JSDoc says that neither message nor error holds the address, and what a caller can do. `src/errors/index.ts` follows.
- `src/nodemailer-email-sender.ts`:
  - `:67`: `new InvalidDefaultFromError()`.
  - `:409`, `:416`, `:455`, `:462`: `new TypeError(<the message>)`, the `not-smtp` message in one constant for its two sites.
  - `:449`: `new Error(<the message>, cause && { cause })`, with a comment on why `{ cause }` alone would not do (probes).
  - The constructor's JSDoc: `@throws {TypeError}`, `@throws {Error}` with what its `cause` holds, `@throws {InvalidDefaultFromError}`.
- `README.md`:
  - *Exports* (`:29`, `:30`): the row of `InvalidDefaultFromError`, which replaces the two.
  - *Options*: `:36` the constructor throws a `TypeError`; `:42` a native `Error` with the same `cause`; `:43` `defaultFrom` throws `InvalidDefaultFromError`, which a caller can handle by building the sender without `defaultFrom` and giving each message its `from`.
  - *Errors* (`:93`): the table's row is `InvalidDefaultFromError`, `INVALID_DEFAULT_FROM`, no `details`. It extends `BaseError` of `@enardo/errors`; its message and fields hold no address. Everything else the constructor refuses is a native error with no `code`: the `TypeError`s of `transport`, and the `Error` with `{ name, code }` as `cause`.
  - A section *Upgrading from 4.x*, before *Contributing*: `@enardo/email` `^3.0.0` is now a peer; the `logger` option is gone; `InvalidEmailSenderOptionsError`, its code and `InvalidEmailSenderOptionsReason` are removed. `InvalidDefaultFromError` takes over `default-from`, and the other reasons are native errors with the same messages, fixed in the options. It says that a comparison with the old `code` still compiles and is never reached.
- `CLAUDE.md`:
  - `:3`: this spec joins the reasons, in the tree.
  - `:10`: `src/errors/` holds the error of a refused `defaultFrom`.
  - `:49`: the constructor throws a native `Error` with the thrown value's `name` and `code` as `cause`.
  - `:63`: 78 to 84 in `2026-10-21-nodemailer-non-string-content.md`, 85 on in this spec.

Repo, `docs/backlog.md`:

- The item leaves *Queued*.
- *To evaluate* gains two items, each from this spec:
  - `ENV_MISSING` and `ENV_MALFORMED` of `@enardo/env`, against ADR 0012 point 6: can a caller handle the condition by `code`, or does it fix its code? A variable is a misconfiguration, yet it is not fixed in the caller's code. `@enardo/email-nodemailer` settled the same reading on whether a caller has anything to do but stop: `INVALID_DEFAULT_FROM` stays a `BaseError`, and an option without which no sender exists became native.
  - `ENTITY_NOT_MUTABLE` and `ENTITY_ALREADY_MARKED_FOR_REMOVAL` of `@enardo/entities`, against the same point: its README shows a caller catching one with `instanceof`, so they are no plain case.

## Test cases

"The native `X`" is a thrown value whose `constructor` is exactly `X`, whose `name` is `X`'s, with the exact message given, and with no `code` and no `details` property. The exact `constructor` catches a subclass named like the old class, and a `TypeError` of nodemailer's passed through. "The sender's `not-smtp` message" and the others are those of the *Probes*.

New, in `__tests__/constructor.test.ts`:

85. A `defaultFrom` with `a,b@example.test` on a server's transport → throws `InvalidDefaultFromError`; then a sender on the same transport without `defaultFrom` sends `MESSAGE`, and the server saw one connection: the refused sender opened none, and the fallback of decision 1 works.
86. No `transport` and a refused `defaultFrom` → the native `TypeError`, the `no-transport` message: `transport` is checked first.
87. `defaultFrom: "a@example.test"` (a string, past the types) → `InvalidDefaultFromError`: what is refused does not depend on the address's shape.

Existing tests that change, each keeping its number and its other assertions. The `details` and `code` assertions become "the native `X`":

- `TypeError`, the `no-transport` message: `__tests__/constructor.test.ts:58`, `:71`, `:84`, `:230`.
- `TypeError`, the `pool` message: `:99`, `:113`, `:126`, `:204`, `:278`, `:304`.
- `TypeError`, the `not-smtp` message: `:354`, `:381`, `:448`, `:477`, `:531`, `:555`, `:595`, `:619`, `:646`; `:489` (case 51) checks it too.
- `Error`, the `transport-options` message: `expectTransportOptionsRefusal` (`:675`), in cases 69 to 77. It takes an `Error`, and in place of `toJSON()`, which a native error lacks, it checks that `SECRET` is not in `error.message`, `error.stack` or `JSON.stringify(error.cause)`, and that the error's own properties are exactly `stack`, `message` and, when there is a `cause`, `cause`: a field copied from nodemailer's error fails it. Cases 76 and 77 check `Object.hasOwn(error, "cause")` is `false`, in place of `:796`: `{ cause: undefined }` fails them. Each `cause` stays as asserted.
- `InvalidDefaultFromError`, `code` `INVALID_DEFAULT_FROM`, `details` `undefined`: `:155` (case 8), which keeps its `toJSON()` check of the address; `__tests__/recipients.test.ts:574`.
- `__tests__/send.test.ts:270` (case 32): the row of `InvalidDefaultFromError`, which also checks `isBaseErrorLike(error)`; `__tests__/send.test.ts:302` (case 33): the entry point exports exactly `NodemailerEmailSender` and `InvalidDefaultFromError`.

`__tests__/support/assertions.ts` gains `expectNativeError(error, type, message)`, of the shape of `packages/uow-repository-mongo/__tests__/support/native-errors.ts`.

The old usage (from the types, not compiled): an import of the removed class or type fails to compile; `isBaseErrorLike(error) && error.code === "INVALID_EMAIL_SENDER_OPTIONS"` compiles, since `code` is a `string` there, and is never reached, as the cases above show: the upgrade note says so.

No test through `@enardo/logger`, which is no dependency of this package: the probes show the log's form, and the own-properties check keeps the error to what those probes logged.

## Risks

- **The password reaches an error.** Only `transport-options` meets the URL, and it keeps reading `name` and `code` alone. Cases 69 to 77 show it, through the own-properties check above, which replaces `toJSON()`.
- **A caller's comparison with the old `code` goes silent.** It compiles and never matches. No caller is known; the upgrade note names it.

## Out of scope

- `@enardo/env`, `@enardo/entities`: to evaluate, in branches of their own.
- `send`'s errors, which are `@enardo/email`'s.
- The `RangeError` of a `defaultFrom` getter that throws, which passes through today.
- ADR 0012: point 6 already decides the case, and an accepted ADR is not edited.
- `cambusa`'s upgrade, and publishing: sessions of their own.

## Plan

1. This spec, commit `[repo] docs: spec the option errors of email-nodemailer`; the `critic`'s run.
2. Test-first (`test-author`): cases 85 to 87, and the existing tests changed as listed. Then decisions 1 to 6, the JSDoc, the README and the package's `CLAUDE.md`; the suite and `typecheck` green. Commit `[@enardo/email-nodemailer] fix: throw native errors on misuse` (body: the breaking change).
3. `pnpm verify`; the backlog changes, commit `[repo] docs: close the misuse errors item`.
