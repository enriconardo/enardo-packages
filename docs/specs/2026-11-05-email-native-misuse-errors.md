---
status: draft
type: fix
tier: L
implementer: sonnet/medium
packages: ["@enardo/email", "@enardo/email-nodemailer"]
branch: fix/email/native-misuse-errors
---

# Reject the `type` and `missing` refusals of `send` with native errors

## Why

From the backlog item of the same name (Queued), which applies ADR 0018. Its table gives `InvalidEmailMessageError` two verdicts:

- `type`: "a bug: the compiler refuses it". Native.
- `missing`: "the composition: no `from`, and a sender without a default". Native.
- `empty` and `address`: "each message, `from` included". They stay. Decisions 6 and 7 say where these lines leave an exception, accepted.

Today the two reasons sit under a public `code`, which ADR 0012 keeps for what a caller may handle, and no branch on that `code` helps: the program has to change. Nothing is broken: this is the last of the three branches that bring the code in line with ADR 0018.

## Probes

- `pnpm view @enardo/email versions` and `time` (host, private registry) → `1.0.0`, `3.0.0`, published on 2026-10-23, after the last change to `src/`: the contract goes to `4.0.0`.
- `pnpm view @enardo/email-nodemailer versions` → `1.0.0`, `4.0.0`. The manifest's `5.0.0` is unpublished, so it takes the change with no bump.
- `git grep` of the two reasons in `packages/` and `docs/adr` → `packages/email/src/errors/invalid-email-message.error.ts:13`, `:17`, `:21` on; `packages/email/README.md:40`; `packages/email/__tests__/errors.test.ts:139`, `:143`, `:147`, `:151`; `packages/email-nodemailer/src/nodemailer-email-sender.ts:160`, `:179`; `packages/email-nodemailer/README.md:76`, `:77`; `packages/email-nodemailer/__tests__/content.test.ts`, `send.test.ts:69`.
- `git grep -l "@enardo/email" -- 'packages/*/package.json'` → `email-nodemailer` is the only dependent, and the only implementation.
- `~/Projects/cambusa`, `git grep` for the class, its code and `isBaseErrorLike` → no match. It declares `@enardo/email-nodemailer` `^1.0.0` and `@enardo/email` `^1.0.0`. Both call sites pass `from` and three strings (`packages/identity/src/application/event-handlers/user-registered/send-verification-email.ts:31`, `.../resend-verification-email.handler.ts:53`), so neither reason is reached.
- `toMailOptions` runs inside the `async send` (`nodemailer-email-sender.ts:91`, `:92`) → a `throw` there is a rejection, whatever the class.
- Every other refusal of the sender's: `new TypeError` and `new Error` at the constructor alone, from `fix/email-nodemailer/native-misuse-errors`. `no-transport`, an absent option, is a `TypeError` (`dist/index.mjs`, after the build below).
- The change applied in a throwaway clone, in a throwaway container of the dev image, after `pnpm install --no-frozen-lockfile --ignore-scripts` and `pnpm exec turbo run build --filter=@enardo/email-nodemailer... --force`, with `@enardo/email` at `4.0.0`:
  - `pnpm-lock.yaml` unchanged by the version;
  - `tsc --noEmit` on `@enardo/email-nodemailer` → nothing;
  - `tsc --noEmit` on `@enardo/email` → the rows of `errors.test.ts:139` to `:151`, and a type probe, each line marked with what it expected, every mark met: assigning `{ field: "subject", reason: "type" }` or `{ field: "from", reason: "missing" }` to `InvalidEmailMessageDetails` → TS2322; `details.reason === "type"`, `=== "missing"`, `details.field === "subject"` → TS2367; `case "type"` in a `switch` on `reason` → TS2678; `details.field === "from"`, and `details.reason === "address" && details.field`, compile;
  - the suite of `@enardo/email` → 4 failures, those four rows. No other;
  - the suite of `@enardo/email-nodemailer` → 34 failures of 370: in `content.test.ts`, case 78 (27), 79 (2), 82 (1), 83 (2 of its 3 rows); in `send.test.ts`, case 19, and the `no sender` row of case 31. No other: `recipients.test.ts` and `constructor.test.ts` pass;
  - `pnpm pack` of `@enardo/email-nodemailer` → `"@enardo/email": "^4.0.0"` in the packed manifest;
  - this clone threw a `TypeError` for `missing` too, the class before decision 1 settled. Not re-run: the tests that failed expected `InvalidEmailMessageError`, so the plain `Error` has no bearing on the list.
- `packages/email-nodemailer/__tests__/support/assertions.ts` → `expectNativeError` and `OPTIONS_MESSAGES`, the form to reuse; `reasonOf` gives the rejection unchecked.
- The highest case number in `packages/email-nodemailer/__tests__/` → 86.
- `packages/email` has no `CLAUDE.md`, and its tests carry no case numbers.

## Decisions

Taken with the user at intake. The verdicts themselves are ADR 0018's; no new ADR.

1. **A `TypeError` for `type`, a plain `Error` for `missing`.** `type` is a value of the wrong type. In `missing` no value has one: `{ to, subject, text }` compiles and is valid on another sender, so what is refused is the message combined with the sender's state. The spec of `@enardo/entities` says of a state that "a `TypeError` does not describe it", and `@enardo/env` gives an unset variable a plain `Error`. The user's choice after the `critic`'s first run, over a `TypeError` for both.
2. **The contract names both classes.** `@enardo/email`'s README and `send`'s JSDoc say that a `send` with no sender rejects with a native `Error`, and one with content that is not a string with a native `TypeError`, both with no `code`. Every implementation then behaves alike.
3. **The rest stays:**
   - `send` rejects and never throws;
   - the messages are those of the removed reasons, in the adapter's code;
   - the order of the checks: `to`, `from` and the sender, `replyTo`, then the content;
   - `missing` stays in `send`, not in the constructor: a sender without a default is valid when each message has its `from`.
4. **No `code`** on the native error (ADR 0018 point 4).
5. **`field` and `reason` narrow** with the union: `field` is `"to" | "from" | "replyTo"`, `reason` is `"empty" | "address"`.
6. **A recipient or an address of the wrong type stays `address`, an accepted asymmetry with `type`.** `toMailbox` refuses a non-object recipient and a non-string address through the same path as a malformed one (`nodemailer-email-sender.ts:210` to `:219`; `recipients.test.ts:460` to `:482`, with casts to compile), and splitting it would lose the structured `index` of a null address in a list. So `INVALID_EMAIL_MESSAGE` keeps reporting values the compiler refuses, which ADR 0018 holds against an all-`BaseError` class, and `replyTo: 42` and `subject: 42` get different errors. `type` is native on the ADR's verdict. Nothing here tells the two apart in principle.
7. **`missing` is native on the ADR's ground, the composition, with an accepted cost.** Where a sender has no default on purpose, an absent `from` belongs to one message, and the sender cannot tell that from a forgotten default, which ADR 0018 point 3 would read as coming from outside. That composition gets a native error all the same: no known project is in it, and a `BaseError` would let an app whose allowlist holds `INVALID_EMAIL_MESSAGE` report a forgotten default as the client's fault on every request. On one field, then: `from: undefined` with no default rejects natively, `from: null` or `""` with `InvalidEmailMessageError`, `address`. The caller of `send` cannot see whether its sender has a default (`EmailSender` has only `send`), so the rule goes on the composition: a sender with no default is handed only to code that passes `from` on every message.

Not taken:

- **A `TypeError` for `missing`**, first chosen, on the analogy with `no-transport` and Node's `ERR_MISSING_ARGS`: both are a required argument, which the types refuse, and here the types accept the message.
- **The contract saying only "a native error"**: implementations could differ for no reason, and a test could not check one.
- **`missing` at the constructor**: it would refuse a valid composition.

## Open questions

1. **Does the contract name the classes** (decision 2), raised by the `critic`'s second run? There is no conformance suite, the cases are the adapter's, and the contract says never to branch on these errors, so naming them makes a difference nobody reads into contract behaviour. The alternative: the contract says "a native error, with no `code`", and the adapter's README and tests name the classes.

## Changes

`@enardo/email`, `3.0.0` → `4.0.0`:

- `package.json`: the version.
- `src/errors/invalid-email-message.error.ts`: the `missing` and `type` members of `InvalidEmailMessageDetails` and their `case`s in `messageOf` go.
- `src/email.types.ts:47`, the comment on `from`: the same rule on the composition, and the native error when it is absent with no default.
- `src/email-sender.ts`, `send`'s JSDoc: `InvalidEmailMessageError` for an empty `to` or a refused address; before anything is sent, a native `Error` for no sender, and a native `TypeError` for a `subject`, `text` or `html` that is not a string.
- `README.md`:
  - *Exports* `:13`: "What `send` rejects with" holds, with the native errors under *Errors*.
  - *Errors* `:36`: `send` rejects with one of the classes, with a native error for a misuse, or with what a value of the caller's threw. `:40`: the two reasons and their "when" go. A new line: a native `Error` for no sender and no default, a native `TypeError` for content that is not a string, both with no `code`: a bug or a composition to fix, never a condition to branch on or retry. *Callers* gains: a composition root that creates a sender with no default hands it only to code that passes `from` on every message.
  - *Implementations* `:100`: reject with a `TypeError`; `:101`: reject with an `Error`. `:103`, `:104`: `InvalidEmailMessageError` for an empty `to` or a refused address. *No personal data* (`:46`) and `:108` reach the native errors' messages too.
  - A section *Upgrading from 3.x*, before *Contributing*: the two reasons are gone, `missing` a native `Error` and `type` a native `TypeError`, each with the same message and no `code`. A comparison with `details.reason` or a `details.field` of content fails to compile. `instanceof InvalidEmailMessageError` and a comparison with its `code` compile, and no longer match those two cases.

`@enardo/email-nodemailer`, staying at `5.0.0`:

- `src/nodemailer-email-sender.ts`: `:160` throws `new Error(<the message>)` and `:179` `new TypeError(<the message>)`; `send`'s JSDoc gains `@throws {Error} (rejects)` and `@throws {TypeError} (rejects)` for them, and `@throws {InvalidEmailMessageError}` loses them.
- `README.md`:
  - `:30`, `:70`, `:93`: `send` rejects with the errors of `@enardo/email` or, for those two misuses, a native error.
  - `:66`: the content is refused with a `TypeError`.
  - `:76`: the table's row gives `TypeError`, `:77` `Error`, each with its message.
  - `:20` and *Upgrading from 4.x* `:112`: the peer is `^4.0.0`. A new line: those two refusals are native errors (see `@enardo/email`'s upgrade note).
- `CLAUDE.md`:
  - `:3`: this spec joins the reasons, in the tree.
  - `:33`: every failure of the send becomes an error of `@enardo/email`, and no error of nodemailer's passes through; the two misuses are the sender's own native errors.
  - `:62`: 85 and 86 in the spec of `2026-11-04`, 87 on in this spec.

Repo, `docs/backlog.md`: the item leaves *Queued*.

## Test cases

"The native `Error`" and "the native `TypeError`" are `expectNativeError(reason, <the class>, message)`, plus own properties that are exactly `stack` and `message`: a `cause` or a field added fails it, and the exact `constructor` tells the two apart. The messages:

- no sender, a native `Error`: `The email has no sender: no from, and no default sender`;
- not a string, a native `TypeError`: `The email sender refuses <field>: not a string`, for `subject`, `text` and `html`.

Each goes through a sender on an idle server, which shows that nothing was sent.

New, `packages/email-nodemailer/__tests__/content.test.ts`, each on a sender without `defaultFrom` and a message without `from`, unless it says otherwise:

87. `to: []` and `subject: 42` → `InvalidEmailMessageError`, `{ field: "to", reason: "empty" }`, its `code`: a check moved ahead of `to` fails it.
88. `to` with a refused address and `subject: 42` → `InvalidEmailMessageError`, `{ field: "to", reason: "address", index: 0 }`.
89. A refused `replyTo` and `subject: 42` → the native `Error`, no sender: `missing` comes before `replyTo` and the content.
90. A sender with `defaultFrom`, a refused `from` and `subject: 42` → `InvalidEmailMessageError`, `{ field: "from", reason: "address" }`: a refused `from` neither falls back on the default nor gives way to the content.

Existing tests that change, each keeping its number:

- `content.test.ts`:
  - 78 and 79: the native `TypeError`, not a string, with the field. `expectRefused` gives way to a helper that returns the rejection, for these cases and 82 and 83.
  - 82: the native `TypeError`, `subject`; it checks `error.message` and `error.stack`, in place of `toJSON()`, which a native error lacks. The own-properties check covers the rest.
  - 83: the rows `subject: 42 and html: 42` and `text: 42 and html: 42` give the native `TypeError` of the first field. The `replyTo` row stays.
- `send.test.ts`:
  - 19: the native `Error`, no sender.
  - 31: the row `no sender` expects the native `Error`, the assertion at `:234` now depending on the row. It still checks that `send` does not throw and returns a promise.
- `packages/email/__tests__/errors.test.ts`: the rows `:138` to `:153` go.

New, `packages/email/__tests__/errors.test.ts`, in *the types of the errors*: `new InvalidEmailMessageError({ field: "subject", reason: "type" })` and `new InvalidEmailMessageError({ field: "from", reason: "missing" })`, each under a `@ts-expect-error`, in `compileOnly`. A union that keeps a member makes the directive unused, which `typecheck` fails.

`__tests__/support/assertions.ts` of the adapter gains the two messages beside `OPTIONS_MESSAGES`, and the own-properties check as a helper. That `html: null` is refused and `html: undefined` sent stays in 78 and 80; case 31 keeps what a getter throws passing through as it is, untouched.

The old usage: the probes compile it. What compiles and behaves differently, `instanceof InvalidEmailMessageError` or a comparison with its `code` on those two cases, no longer matches: 19, 78 and 83 show it through the exact `constructor` and no `code`, and the upgrade note says so.

No test through a log: a native error's own properties are checked, and `@enardo/logger` is no dependency of this package.

## Out of scope

- `empty` and `address`, which stay (ADR 0018).
- ADR 0012 and ADR 0018: accepted, and not edited.
- `cambusa`'s upgrade, and publishing: sessions of their own.

## Plan

The adapter moves first: it stops using the two reasons while they still exist, so every commit compiles.

1. This spec, commit `[repo] docs: spec the native errors of email send`; the `critic`'s run.
2. Test-first (`test-author`): cases 87 to 90, and the existing tests of the adapter as listed. Then the throws, the JSDoc, the adapter's README and `CLAUDE.md`; suite and `typecheck` green. Commit `[@enardo/email-nodemailer] fix: reject misuses of send natively` (body: the breaking change).
3. Test-first: the two `@ts-expect-error`, the rows removed. Then the union, `messageOf`, the JSDoc, the manifest and the README. `@enardo/email`'s suite and `typecheck` green, and the adapter's on a fresh build. Commit `[@enardo/email] fix: drop the type and missing reasons` (body: the breaking change, `4.0.0`).
4. `pnpm verify`; the backlog item goes, commit `[repo] docs: remove the email native errors backlog item`.
