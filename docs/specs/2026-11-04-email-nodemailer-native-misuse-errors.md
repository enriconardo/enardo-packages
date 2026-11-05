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

From the backlog item *Review the `BaseError`s that report misuse or misconfiguration* (Queued), which applies ADR 0012 point 6 package by package and has this package left, and from a discussion with the user at intake and after the `critic`'s first run, which settled the case of `defaultFrom`.

ADR 0012 point 6 gives a `BaseError` to a condition a caller may handle by `code`, and a native error to a misuse or a misconfiguration, which a caller fixes in its code. `InvalidEmailSenderOptionsError` reports misconfigurations under a public `code`, written before the rule, and every `code` is public API (point 4). Its package has no other error of its own.

Nothing is broken today: this is a matter of a coherent contract. The moment is what counts: `5.0.0` is unpublished, so the change costs no version.

## Probes

- `pnpm view @enardo/email-nodemailer versions --registry https://npm.enriconardo.com` (host) → `1.0.0`, `4.0.0`. The manifest's `5.0.0` is unpublished, so this change takes it as it is, with no bump.
- `git log 603cceb..HEAD -- packages/email-nodemailer` → since `4.0.0`, `@enardo/email` moved to a peer (`d0ea672`), and the `logger` option went (`c30a683`). `README.md` has no upgrade note for either.
- The throw sites, every one, in `src/nodemailer-email-sender.ts` → `default-from` `:67`; `no-transport` `:409`; `not-smtp` `:416` and `:462`; `transport-options` `:449`; `pool` `:455`.
- `git grep` for the class, the code and `InvalidEmailSenderOptionsReason`, outside this package and `docs/specs` → `docs/backlog.md:14` and `:15` alone.
- `grep -r` for the class and the code in `~/Projects/cambusa`, without `node_modules` and `dist` → no match. It depends on `^1.0.0` and runs 1.0.0, which has the class and the code (`node_modules/@enardo/email-nodemailer/dist/index.mjs`), and its source never names them. It builds the sender at `apps/api-server/src/composition-root.ts:159`. Its bootstrap (`apps/api-server/src/main.ts:105`) logs any error and exits: a `BaseError` and a native error take one path.
- `~/Projects/*/package.json` and their workspaces → `cambusa`, and `en-monorepo`, the repo these packages were imported from. Projects elsewhere: none, says the user (2026-11-05).
- Handling a refused `defaultFrom`, in `cambusa` → `SMTP_SENDER_ADDRESS` feeds both `defaultFrom` (`composition-root.ts:167`) and the `from` of every message (`:230`, `:284`). A sender built without `defaultFrom` then refuses the same address on each send, and `send-verification-email.ts:41` hands that to `onError`, which logs it: the app runs and sends no verification mail. A caller with a second valid address can pass it as `defaultFrom`.
- The neighbours → every `new RangeError` in `packages/*/src` is a numeric bound: `packages/password-hasher/src/create-password-hasher.ts:48`, `packages/uow-repository/src/retry-on-conflict.ts:24`. A refused string differs by package. `@enardo/http-client` throws a `TypeError` for every caller's error (`src/utils.ts:23`, `:26`, `:29`, `src/http-client.ts:71`, a numeric bound at `src/deadline.ts:33`, and its `CLAUDE.md`, *Errors*), `baseUrl` being an optional option with a per-call alternative. `@enardo/logger` throws an `Error` (`src/create-logger.ts:29`). `@enardo/uow-repository-mongo` throws an `Error` where every value has the right type (`src/mongo-data-store.ts:144`).
- `packages/errors/src/base/base-error.ts:32` → `BaseError extends Error`, so an `Error` could become a `BaseError` and stay what it was, and a `TypeError` could not.
- The messages and outcomes, on `main`, after `./dev.sh exec pnpm exec turbo run build --filter=@enardo/email-nodemailer... --filter=@enardo/logger... --force`, from `dist/`:
  - `{}` → `NodemailerEmailSender needs transport options`;
  - `pool: true`, and a `url` with `?pool=true` → `NodemailerEmailSender does not create a pooled transporter`;
  - `streamTransport: true`, `lmtp: true`, `direct:x`, an object with `send` → `NodemailerEmailSender creates SMTP transporters only: transport must hold SMTP options`;
  - a `url` it cannot parse → `nodemailer could not build a transporter from the transport options`, `cause: { name: "TypeError", code: "ERR_INVALID_URL" }`; `{ SES: {} }` → the same, `cause: { name: "Error", code: "ECONFIG" }`; a `host` getter that throws `1` → the same, no `cause`;
  - `defaultFrom` with `a,b@example.test`, and the string `a@example.test` → `The address of defaultFrom is not one NodemailerEmailSender accepts`;
  - no `transport` and a refused `defaultFrom` → the `no-transport` refusal: `transport` is checked first;
  - `defaultFrom: ""` → no throw: only a truthy value is read;
  - a `defaultFrom` whose `address` getter throws a `RangeError` → that `RangeError` passes through, today and after this change.
- A `cause` absent or present, same build, in Node 24.21.0 → `Object.hasOwn(new Error("m", { cause: undefined }), "cause")` is `true`; `new Error("m", undefined)` has none.
- What the errors expose, through `createLogger("console", { format: "json" })` of `@enardo/logger`, same build, with a plain `Error` built as `transport-options` will be → `{ cause: { code, name }, message, name, stack }`, so the identifiers reach the log. With `{ cause: undefined }`, the log has no `cause`. `isBaseErrorLike` of it → `false`.
- Removing `@enardo/errors` from the manifest, with `src/errors/` and the throws of *Changes* (with placeholder messages), in a throwaway clone, in a throwaway container of the dev image, after `pnpm install --no-frozen-lockfile --ignore-scripts` → the lockfile loses four lines, the importer's `dependencies`; `turbo run build --filter=@enardo/email-nodemailer...` passes; `tsc --noEmit` reports nothing in `src/`; `dist/index.mjs` and `dist/index.d.mts` import no `@enardo/errors`; `import("./dist/index.mjs")` exports `NodemailerEmailSender` alone. The constructor throws `TypeError` for `{}` and `Error` for the unparsable `url`, with the `cause` above; the own properties are `stack`, `message`, and `cause` when there is one, and none without identifiers. A refused `defaultFrom` threw the placeholder `RangeError` there, the class before decision 1 settled: which native class it is has no bearing on the dependency. The tests were not run there.
- Doc lines that name this package and `@enardo/errors` → `README.md:101` alone, outside the source and the tests.
- `packages/errors/src/index.ts` exports no `serializeError`.
- The highest case number in `__tests__/` → 84.
- `packages/uow-repository-mongo/__tests__/support/native-errors.ts` → the form of the native error's assertion.
- `packages/database-mongo/README.md:80` → the form of an upgrade note that names a peer.

## Decisions

Taken with the user: the list at intake, decision 1 after the `critic`'s three runs. Its last form is what the third run proposed, so the user skipped a fourth.

The test is point 6's: can a caller handle the condition by `code`, or does it fix its code? An option read from the environment answers no to both: it is not fixed in the code, and nothing handles it. Point 6 and the root `CLAUDE.md` name misconfiguration outright, so it is native here: the calling code can only stop, or try another value, and a `try`/`catch` around the constructor does either with no `code`. The same word reaches `ENV_*`, which are left to their own branch: it follows the word, or says why not.

1. **`default-from`: a native `Error`.** The case that matters, a string that fails the grammar, has the right types, as with the option error of `@enardo/uow-repository-mongo`. A value that is not a mailbox at all takes the same throw site, past the types. It adds no class, as decision 3 throws an `Error` too, and the two differ by message. `BaseError extends Error`, so a `code` can come in a later minor, if a project needs one.
2. **`no-transport`, `pool` and `not-smtp`: a native `TypeError`.** `transport` is not SMTP options of the kind accepted, and the types already refuse `pool: true` and `lmtp: true`.
3. **`transport-options`: a native `Error`, with the same `cause`.** nodemailer threw while reading the options, from any field, and no value of one type says why. The `cause` stays `{ name, code }`, with nothing else: only identifiers, never the thrown value, whose message and fields can hold the URL, password included. An absent `cause` is no own property.
4. **The class goes**, with its code, `InvalidEmailSenderOptionsReason` and `src/errors/`. No class is kept over a native base: a class of the package's own would invite the `instanceof` that point 6 means to remove the need for.
5. **The messages stay as they are.** With `details.reason` gone, they tell the reasons apart (probes).
6. **`@enardo/errors` leaves the `dependencies`**, as the backlog item asks once no use of it is left. Not a devDependency either: the tests identify a native error by its exact `constructor` and the absence of `code`.
7. **The backlog item closes.** What it left to evaluate moves to *To evaluate*, undecided, with the errors it never listed, since this spec is not read after the merge.

Not taken:

- **`default-from` as a `BaseError`, `InvalidDefaultFromError`**, which the user first chose, as a caller could handle it by building the sender without `defaultFrom` and giving each message its `from`. That way on needs a second valid address, which could be passed as `defaultFrom` in the first place, and `cambusa` has one value for both (probes). It would also narrow point 6, as a misconfiguration kept as a `BaseError`, in an ADR that would have to answer for `baseUrl`, which has the same shape and throws a `TypeError`. Decision 1 leaves the `code` to a later minor, once a project needs one.
- **`RangeError` for `default-from`**, first proposed: every `RangeError` in the repo is a numeric bound (probes), and a third class in the constructor would tell nothing a caller needs.
- **`TypeError` for `default-from`**, on the analogy with `baseUrl` of `@enardo/http-client`: that package throws a `TypeError` for every caller's error, numeric bounds included, and a `code` added later would cost a major, as a `BaseError` is no `TypeError` (probes).
- A native error with a `code`: ADR 0012 keeps a `code` for what a caller may handle, TypeScript would not declare it, and the two earlier branches set it aside.

## Open questions

None.

## Changes

`@enardo/email-nodemailer`, staying at `5.0.0`:

- `src/errors/`: deleted; `export * from "./errors"` leaves `src/index.ts`.
- `src/nodemailer-email-sender.ts`:
  - `:67`: `new Error(<the message>)`.
  - `:409`, `:416`, `:455`, `:462`: `new TypeError(<the message>)`, the `not-smtp` message in one constant for its two sites.
  - `:449`: `new Error(<the message>, cause && { cause })`, with a comment on why `{ cause }` alone would not do (probes).
  - The constructor's JSDoc, which takes over the *why* of the deleted class: `@throws {TypeError}` for `transport`; `@throws {Error}` for a refused `defaultFrom`, with no address in its message, and for what nodemailer threw, with what its `cause` holds and why never that error's message.
- `package.json`: `@enardo/errors` leaves `dependencies`; `pnpm-lock.yaml` follows, through `./dev.sh exec pnpm install`.
- `README.md`:
  - *Exports* (`:29`, `:30`): the two rows go.
  - *Options*: `:36` the constructor throws a `TypeError`; `:42` a native `Error` with the same `cause`; `:43` `defaultFrom` throws a native `Error`.
  - *Errors* (`:93`): the table and the sentence on `BaseError` go. The package adds no error class. `send` rejects as before. The constructor throws native errors, with no `code`: a `TypeError` for `transport`, an `Error` for a refused `defaultFrom`, whose message holds no address, and an `Error` for what nodemailer threw, with `{ name, code }` as `cause`, each left out when missing or not a string, and absent when both are.
  - A section *Upgrading from 4.x*, before *Contributing*: `@enardo/email` `^3.0.0` is now a peer; the `logger` option is gone; `InvalidEmailSenderOptionsError`, its code and `InvalidEmailSenderOptionsReason` are removed, each refusal is a native error with the same message, fixed in the options. A comparison with the old `code` still compiles and is never reached. It does not name `@enardo/errors`.
- `CLAUDE.md`:
  - `:3`: this spec joins the reasons, in the tree.
  - `:10`: the line of `src/errors/` goes.
  - `:47`: "it gets `pool` instead" names a reason that goes: it gets the pool's refusal.
  - `:49`: the constructor throws a native `Error` with the thrown value's `name` and `code` as `cause`.
  - `:63`: 78 to 84 in `2026-10-21-nodemailer-non-string-content.md`, 85 on in this spec.

Repo, `docs/backlog.md`:

- The item leaves *Queued*. What it says of `@enardo/uow-repository` 0.2.0 is already on the item of the `I` prefix.
- *To evaluate* gains three items, each from this spec, each against ADR 0012 point 6: can a caller handle the condition by `code`, or does it fix its code?
  - `ENV_MISSING` and `ENV_MALFORMED` of `@enardo/env`. A variable is a misconfiguration, yet it is not fixed in the caller's code. `@enardo/email-nodemailer` made its options native, those an app reads from its environment included: the calling code can only stop or try another value, which a `try`/`catch` around its constructor does with no `code`, and no known project's source reads that code. Point 6's word "misconfiguration" reaches `ENV_*` too: their branch follows it, or says why not.
  - `ENTITY_NOT_MUTABLE` and `ENTITY_ALREADY_MARKED_FOR_REMOVAL` of `@enardo/entities`: its README shows a caller catching one with `instanceof`, so they are no plain case.
  - `INVALID_ENTITY_ID` of `@enardo/entities`, and the `type` and `missing` reasons of `InvalidEmailMessageError` of `@enardo/email`, with its `address` reason on `from`, which can come from the same variable as `defaultFrom`: the review never listed them, so closing it leaves them without a verdict.

## Test cases

"The native `X`" is a thrown value whose `constructor` is exactly `X`, whose `name` is `X`'s, with the exact message given, and with no `code` and no `details` property. The exact `constructor` catches a subclass named like the old class, and a `TypeError` of nodemailer's passed through. "The `not-smtp` message" and the others are those of the *Probes*.

New, in `__tests__/constructor.test.ts`:

85. No `transport` and a refused `defaultFrom` → the native `TypeError`, the `no-transport` message: `transport` is checked first.
86. `defaultFrom: "a@example.test"` (a string, past the types) → the native `Error`, the `default-from` message: what is refused does not depend on the value's shape.

Existing tests that change, each keeping its number and its other assertions. The `details` and `code` assertions become "the native `X`":

- `TypeError`, the `no-transport` message: `__tests__/constructor.test.ts:58`, `:71`, `:84`, `:230`.
- `TypeError`, the `pool` message: `:99`, `:113`, `:126`, `:204`, `:278`, `:304`.
- `TypeError`, the `not-smtp` message: `:354`, `:381`, `:448`, `:477`, `:531`, `:555`, `:595`, `:619`, `:646`; `:489` (case 51) checks it too.
- `Error`, the `default-from` message: `:155` (case 8), and `__tests__/recipients.test.ts:574`. Case 8 replaces its `toJSON()` check of the address by the own-properties check below, on `stack` and `message`, and checks `error.stack` for the markers.
- `Error`, the `transport-options` message: `expectTransportOptionsRefusal` (`:675`), in cases 69 to 77. It takes an `Error`, and in place of `toJSON()`, which a native error lacks, it checks that `SECRET` is not in `error.message`, `error.stack` or `JSON.stringify(error.cause)`, and that the error's own properties are exactly `stack`, `message` and, when there is a `cause`, `cause`: a field copied from nodemailer's error fails it. Cases 76 and 77 check `Object.hasOwn(error, "cause")` is `false`, in place of `:796`: `{ cause: undefined }` fails them. Each `cause` stays as asserted.
- `__tests__/send.test.ts:262` (case 32) and its import of `BaseError` (`:7`): removed, as it pins the removed class alone. `:302` (case 33): the entry point exports exactly `NodemailerEmailSender`.

`__tests__/support/assertions.ts` gains `expectNativeError(error, type, message)`, of the shape of `packages/uow-repository-mongo/__tests__/support/native-errors.ts`, for `Error` and `TypeError`.

The old usage (from the types, not compiled): an import of the removed class or type fails to compile; `isBaseErrorLike(error) && error.code === "INVALID_EMAIL_SENDER_OPTIONS"` compiles, since `code` is a `string` there, and is never reached, as the cases above show no `code`, and a native error has no brand: the upgrade note says so.

No test through `@enardo/logger`, which is no dependency of this package: the probes show the log's form, and the own-properties check keeps the error to what those probes logged. No test for the dependency's removal: `pnpm verify` builds and typechecks without it, and the clone's probe loaded the package.

## Risks

- **The password reaches an error.** Only `transport-options` meets the URL, and it keeps reading `name` and `code` alone. Cases 69 to 77 show it, through the own-properties check above, which replaces `toJSON()`.
- **A caller's comparison with the old `code` goes silent.** It compiles and never matches. No caller is known; the upgrade note names it.

## Out of scope

- `@enardo/env`, `@enardo/entities`, `@enardo/email`'s `InvalidEmailMessageError`: to evaluate, in branches of their own.
- `send`'s errors, which are `@enardo/email`'s.
- The `RangeError` of a `defaultFrom` getter that throws, which passes through today.
- ADR 0012: point 6's word "misconfiguration" decides the case, and an accepted ADR is not edited.
- `cambusa`'s upgrade, and publishing: sessions of their own.

## Plan

1. This spec, commit `[repo] docs: spec the option errors of email-nodemailer`; the `critic`'s runs.
2. Test-first (`test-author`): cases 85 and 86, and the existing tests changed as listed. Then decisions 1 to 6, the JSDoc, the manifest, the lockfile, the README and the package's `CLAUDE.md`; the suite and `typecheck` green. Commit `[@enardo/email-nodemailer] fix: throw native errors on misuse` (body: the breaking change).
3. `pnpm verify`; the backlog changes, commit `[repo] docs: close the misuse errors item`.
