---
status: done
type: fix
tier: L
implementer: sonnet/medium
packages: ["@enardo/cqrs", "@enardo/eslint-config"]
branch: fix/cqrs/expected-failures-as-values
---

# `@enardo/cqrs` returns only the codes a handler lists, and rethrows the rest

## Why

The backlog item *`@enardo/cqrs` sends the message of a native error to the client*, from the spec of `feature/email/send-errors` (2026-10-20). `CommandHandler.execute()` and `QueryHandler.execute()` catch every error and return `{ success: false, error, exception }`. `mapErrorToString` puts in `error` the `code` of an `instanceof BaseError`, the `message` of any other `Error`, `"INTERNAL_ERROR"` for anything else; an app's HTTP layer sends `error` to the client. So the message of a native error, such as `getaddrinfo EAI_AGAIN smtp.internal.corp.test`, reaches the client.

The root cause is the catch-all, which ADR 0012 point 7 rules out: whether an error is expected in a flow is the app's call, and a component such as `cqrs` does not classify errors with a catch-all. The catch-all has two more costs:
- a caller that wraps `execute()` in a `try`, such as an event subscriber with an error callback, never sees a failure: `execute()` never rejects;
- `instanceof BaseError` loses the `code` of an error built on a second copy of `@enardo/errors` (ADR 0012 point 3).

The shape was chosen with the user at intake (2026-10-23), so the `critic` runs on this spec.

## Probes

- Current behavior, through `dist/` (`pnpm exec turbo run build --filter=@enardo/cqrs... --force`, then a script in `packages/cqrs`, dev container, Node 24.21.0): a handler that throws `new Error("getaddrinfo EAI_AGAIN smtp.internal.corp.test")` → `{"success":false,"error":"getaddrinfo EAI_AGAIN smtp.internal.corp.test"}`, with an `exception` key; a `BaseError` subclass with code `E_CODE` → `error: "E_CODE"`; the string `"str"` → `error: "INTERNAL_ERROR"`.
- `UnitOfWork.execute(work)` commits when `work` resolves and skips the commit when it throws (`packages/uow-repository/src/unit-of-work.ts:113-116`): a failure found inside `work` after a change was staged is thrown, or the change commits. `ConcurrencyConflictError` is thrown during the commit (`packages/uow-repository-mongo/src/mongo-data-store.ts:306`, `:370`, per the `critic`'s first run). A handler that opens a unit of work gets its expected failures as rejections.
- The types and the base class of *Changes*, prototyped in `packages/cqrs` and checked with `tsc --noEmit` on its `tsconfig.json` (TypeScript 5.9.3):
  - `protected override readonly expectedCodes = ["A", "B"] as const` in a handler of `CommandResponse<{ id: string }, "A" | "B">` compiles; `["A"] as const` too;
  - `["A", "X"] as const` → TS2416; `["A", "X"]` with no `as const` → TS2416 (`string[]`); the same list with the annotation `readonly CommandFailureCode<...>[]` → TS2322 on `"X"`;
  - with `CommandResponse<{ id: string }>` (`TCode` defaults to `never`), `["A"] as const` → TS2416 (`readonly never[]`); a handler that does not override a base `[]` compiles, and so does every 1.x handler and route, with `response.error` now `never` (the `critic`'s second run);
  - with `expectedCodes` abstract, a handler that does not declare it → TS2515; `expectedCodes = []` and `["A", "B"] as const` compile (the `critic`'s second run, `node:24-bookworm`, TypeScript 5.9.3);
  - the response type derived from the list, `const codes = ["A", "B"] as const`, `CommandResponse<P, (typeof codes)[number]>`, `expectedCodes = codes`, compiles with the exhaustive `switch` (the same run);
  - `handle()` returning `{ id: 1 }` for a `{ id: string }` payload → TS2416;
  - after `if (!response.success)`, a `switch (response.error)` over both codes with `const x: never = response` in `default` compiles; with `CommandResponse<{ id: string }>`, `response.error` in the failure branch is `never`, and the branch itself is `CommandFailureResponse<never>`, not `never` (the `critic`'s first run: `const n: never = response` there is TS2322).
- The same base class as plain JS, with `isBaseErrorLike` from `@enardo/errors`' `dist/` (dev container): a `BaseError` with a listed code and `details` → `{"success":false,"error":"EMAIL_TAKEN"}`, no `details`; a `BaseError` with another code → rejects with the same instance; an `Error` with `code: "EMAIL_TAKEN"` and no brand → rejects with it; an empty list → rejects with the `BaseError`. A subclass's field initializer has run before `execute()` is called.
- `isBaseErrorLike` returns `false` when a read throws (ADR 0012 point 1; `packages/errors/__tests__/base/is-base-error-like.test.ts`).
- `eslint src --rule` with `no-restricted-syntax` and the selector `BinaryExpression[operator="instanceof"]:matches([right.name="BaseError"], [right.property.name="BaseError"])`, in every package with a `src/` → errors only at `packages/cqrs/src/command-handler.ts:70` and `query-handler.ts:67`. On a sample file: `e instanceof BaseError` and `e instanceof errors.BaseError` (namespace import) reported, `e instanceof Error` not. Not probed, and missed by the selector: an aliased import (`import { BaseError as B }`).
- `__tests__/` uses `instanceof BaseError` on purpose: `packages/errors/__tests__/base/is-base-error-like.test.ts:53`, `packages/errors/__tests__/types.test.ts:131`.
- `cqrs` has no `__tests__/`, no `vitest.config.ts`, no README; its `lint` and `format` scripts cover `src` only. `@enardo/logger` is the model of a tested Node package (`vitest.config.ts`, `vitest` in `devDependencies`, scripts on `src __tests__`).
- `SyncEventBus` awaits its subscribers in sequence, inside the publisher's transaction (`packages/events/src/sync.event-bus.ts:9-10`, `:34-36`): a subscriber that rejects stops the next ones and fails the publisher's work.
- No `@enardo/*` package depends on `cqrs` (`git grep '"@enardo/cqrs"' -- '*package.json'`).
- An object literal `{ debug() {}, error() {} }` passed as `logger` to a `Logger` without `error` → TS2353 (the `critic`'s first run).
- Versions: `cqrs` 1.0.0, `eslint-config` 1.1.0. The one minor of `eslint-config` (`f432111`) added a preset, and no rule to the existing ones.

## Decisions

Taken with the user at intake, after the `critic`'s first run:

1. **A handler lists the codes it expects; `execute()` turns a thrown error with a listed code into a failure, and rethrows everything else.** `handle()` returns the payload, as in 1.x, and throws its failures, so a unit of work rolls back and a conflict at commit is covered. The list is typed by the codes of the handler's response type. Not taken:
   - failures returned by `handle()` as values: a failure found inside a unit of work must be thrown to roll back, so every handler would translate thrown codes with a `try` of its own;
   - rethrowing everything, with `execute()` returning the payload: the simplest, and the common practice in Node, but the codes a command can fail with would be in no type, and a route would lose the `success` branch it has in 1.x;
   - the `code` of a `BaseErrorLike`, and `"INTERNAL_ERROR"` for the rest: still a catch-all.
2. **`execute()` no longer logs a failure at `error`.** It rethrows, and the caller logs. The rest of what a package logs stays with *What a package logs*.
3. **A lint rule against `instanceof BaseError`** in the presets, now that no use is left in `src/` (the backlog item).

Taken by this spec:

4. **A failure carries only the code.** Not the thrower's `details`, written for logs and not for a client, nor `exception`: a field can be added in a minor, when a handler needs one.
5. **`TCode` defaults to `never`**: a handler that lists nothing returns no failure, its list accepts only `[]`, and `response.error` is `never`. `string` would let any code through the list's type.
6. **`expectedCodes` is abstract**, after the `critic`'s second run: with a base `[]`, every 1.x handler would compile unchanged and reject with every failure it used to return, a change no compiler error would show. Abstract, every handler shows at the upgrade (TS2515), and a new one cannot forget its list; a handler with no expected failure writes `expectedCodes = []`. The README derives the response type from the list (`(typeof codes)[number]`), so the two cannot drift; a code in a hand-written type but missing from the list is rethrown, the safe side.
7. **Recognition by `isBaseErrorLike`**, so `@enardo/errors` stays a `dependency`. An error without the brand (a native error with a `code`, a `BaseError` of 1.0.0) is never a failure.
8. **`successResponse` stays; `failureResponse` takes the code; `mapErrorToString` goes.**
9. **`Logger` loses `error`**, which nothing calls any more: each package's copy holds what it uses (the dropped item *Split `@enardo/logger`*). An app that passes a literal with `error` gets TS2353, which *Migrating* states.
10. **`eslint-config` takes 2.0.0.** The rule makes `node()` and `react()` stricter for every app on `^1.x`: an app with `instanceof BaseError` in its `src/` goes red on a lockfile refresh. ESLint's own versioning counts new lint errors from its recommended config as a major.
11. **The rule is on `src/**` of every preset**, in `createConfig`; its message points to `@enardo/errors`' README, which ships with the package, not to ADR 0012, which does not.

## Open questions

None.

## Changes

### `@enardo/cqrs` (1.0.0 → 2.0.0)

- `src/command-response.ts`:
  - `CommandFailureResponse<TCode extends string>`: `{ success: false; error: TCode; payload?: never }`, without `exception`;
  - `CommandSuccessResponse<TPayload>`: without `exception?: never`;
  - `CommandResponse<TPayload = unknown, TCode extends string = never>`;
  - `CommandSuccessPayload<TResponse>` constrained by `CommandResponse<unknown, string>`; new `CommandFailureCode<TResponse>` = `Extract<TResponse, { success: false }>["error"]`.
- `src/command-handler.ts`:
  - `TResult extends CommandResponse<unknown, string>`;
  - `protected abstract readonly expectedCodes: readonly CommandFailureCode<TResult>[]`, with JSDoc: the codes of the response type, `as const`, `[]` for none;
  - `execute()`: logs `Executing command.` and, on a payload, `Command executed successfully.` at `debug`, as now, and returns `successResponse(payload)`; on a throw that `isBaseErrorLike` recognizes with a code in `expectedCodes`, logs `Command failed with an expected code.` at `debug` with `{ command, error: code }` and returns `failureResponse(code)`; on any other throw, rethrows it, with no log;
  - `failureResponse(code: CommandFailureCode<TResult>): TResult`; `successResponse` unchanged; `mapErrorToString` removed; `BaseError` import replaced by `isBaseErrorLike`.
- `src/query-response.ts`, `src/query-handler.ts`: the same, with `QueryFailureCode`, `Query executed successfully.` and `Query failed with an expected code.`.
- `src/logger.ts`: `Logger` and the no-op logger lose `error`.
- `package.json`: `vitest` in `devDependencies`; `test` and `test:watch`; `lint`, `lint:fix`, `format`, `format:check` on `src __tests__`; version 2.0.0.
- `vitest.config.ts` (new), as `@enardo/logger`'s.
- `README.md` (new):
  - a command handler with `const codes = [...] as const`, its response type derived from them, `expectedCodes = codes`, and a unit of work that throws; a handler with `expectedCodes = []`;
  - the rules: only a listed code of an error recognized by `isBaseErrorLike` becomes a failure, with no `details`; a code missing from the list is rethrown; `as const`;
  - an app's side: the failure branch with an exhaustive `switch` on `response.error` (`const x: never = response` in `default`), and what `execute()` rethrows going to the app's error handling, an allowlist of codes with everything else an unexpected failure (ADR 0012 point 7), for an HTTP route and an in-process caller such as an event subscriber;
  - the logger option;
  - *Migrating from 1.x*: every handler declares `expectedCodes` (TS2515 until it does), listing the codes its callers handle as failures today; an error whose code is not listed now rejects `execute()`, at every caller, HTTP routes and in-process callers alike; a subscriber of a synchronous event bus that rejects stops the next subscribers and rolls back the publisher's transaction, which 1.x let commit; `error` holds only a listed code, never a message or `"INTERNAL_ERROR"`; `exception` and `mapErrorToString` are gone; `failureResponse` takes a code; a response type lists its codes in its second parameter; `Logger` has no `error`, so a literal with it is TS2353; an error built on `@enardo/errors` 1.0.0 has no brand, and is rethrown.

### `@enardo/eslint-config` (1.1.0 → 2.0.0)

- `index.js`, `createConfig`: a block on `src/**` with `no-restricted-syntax` and the selector of *Probes*, with the message `Recognize an error with isBaseErrorLike and its code (README of @enardo/errors).`
- `README.md`, *Rule choices*: the rule and why (an error built by another copy of `@enardo/errors` fails it silently), what it misses (an aliased import), that tests are not restricted, and that an entry setting `no-restricted-syntax` after the preset replaces it.

### Repo

- `docs/backlog.md`: *What a package logs* no longer lists `cqrs`' failure logs at `error` (`command-handler.ts:46`, `query-handler.ts:43`), which this branch removes; this item leaves, in a commit of its own.

## Test cases

`packages/cqrs/__tests__/command-handler.test.ts`, with a test `Command`, a `BaseError` subclass whose code is passed to its constructor, and handlers of `CommandResponse<{ id: string }, "EMAIL_TAKEN" | "EMAIL_INVALID">` listing both codes unless the case says otherwise:

1. `handle()` returns `{ id: "1" }` → `execute()` resolves to exactly `{ success: true, payload: { id: "1" } }` (`toStrictEqual`).
2. `handle()` throws the `BaseError` with `"EMAIL_TAKEN"` and `details: { email: "anna@example.test" }` → resolves to exactly `{ success: false, error: "EMAIL_TAKEN" }`: no `details`, no `exception`.
3. `handle()` throws the `BaseError` with `"OTHER_CODE"` → rejects with that same instance (`toBe`).
4. `handle()` throws an `Error` with `code: "EMAIL_TAKEN"` and no brand → rejects with that same instance.
5. `handle()` throws `new Error("getaddrinfo EAI_AGAIN smtp.internal.corp.test")` → rejects with that same instance.
6. `handle()` throws the string `"boom"` → rejects with `"boom"`.
7. `handle()` throws an object with the brand `Symbol.for("@enardo/errors.BaseError")`, a `name` and `code: "EMAIL_TAKEN"`, not an instance of this copy's `BaseError` → resolves to `{ success: false, error: "EMAIL_TAKEN" }`.
8. `handle()` throws an object with the brand whose `code` getter throws → rejects with that same object: the guard's read does not replace it.
9. A handler that lists only `"EMAIL_INVALID"` throws the `BaseError` with `"EMAIL_TAKEN"` → rejects with it: a code in the type but not in the list is rethrown.
10. A handler of `CommandResponse<{ id: string }>` with `expectedCodes = []` throws the `BaseError` with `"EMAIL_TAKEN"` → rejects with it.
11. A `handle()` that is not `async` and throws synchronously → `execute()` returns a promise: with the listed `BaseError` it resolves to the failure, with a native `Error` it rejects with it; it never throws.
12. With a logger whose `debug` and `error` are spies (an object wider than `Logger`): on case 5, `debug` is called once, with `Executing command.`, and `error` never; on case 2, `debug` is called with `Command failed with an expected code.` and `{ command: <the command's class name>, error: "EMAIL_TAKEN" }`; on case 1, with `Command executed successfully.` and `{ command: <...> }`.
13. Types (`expectTypeOf`, `@ts-expect-error`): a handler with no `expectedCodes` does not compile; the response type derived from a `const` list compiles, and its `CommandFailureCode` is the list's union; a list with `"OTHER"` does not compile; a list with no `as const` does not compile; with `CommandResponse<{ id: string }>`, a list with any code does not compile; `handle()` returning `{ id: 1 }` does not compile; after `if (!response.success)` `response.error` is exactly `"EMAIL_TAKEN" | "EMAIL_INVALID"`; `response.exception` does not compile; `CommandFailureCode<...>` is the union; with `CommandResponse<{ id: string }>`, `response.error` in the failure branch is `never`.

14–26. `packages/cqrs/__tests__/query-handler.test.ts`: cases 1–13 for `QueryHandler`, `QueryResponse`, `QueryFailureCode` and the `Query …` messages.

27. `packages/cqrs/__tests__/index.test.ts`: the runtime exports are exactly `Command`, `CommandHandler`, `Query`, `QueryHandler`.

The lint rule has no automated case: `@enardo/eslint-config` has no tests. Step 4 runs it on a sample file in `cqrs/src` with the forms of *Probes*, removed before the commit, and `pnpm verify:all` lints every package with it.

## Risks

- **An app keeps a 1.x habit that the compiler does not see.** Every handler shows at the upgrade (decision 6), but a code left out of its list rejects, and the rejection shows in no type: a route without error handling, or an event subscriber that ignored the response, now meets it, and inside a synchronous event bus it rolls back the publisher's transaction. *Migrating from 1.x* lists the callers; the app's error handling catches what a handler throws.
- **A code in a hand-written response type but missing from the list** is rethrown, and the failure branch for it is dead code no check reports. The README's derived type removes it; case 9 pins the behavior.
- **An app that recognizes errors built on `@enardo/errors` 1.0.0**: they have no brand, so they are rethrown rather than returned; the README says so, as `@enardo/errors`' README already does for its guard.
- **A preset rule an app's code fails**: wanted, and a major (decision 10).

## Out of scope

- The other log points of `cqrs` and of the other packages: *What a package logs*.
- `details` on a failure (decision 4).
- The duplication between the command and query sides.
- A way for a unit of work to roll back without a throw.
- Running `cqrs`' tests in browsers: its `src/` runs on servers.

## Plan

1. This spec: the branch's first commits.
2. `@enardo/cqrs`: the test setup (`vitest.config.ts`, scripts, `devDependencies`), then cases 1–27 test-first, by the `test-author`; they fail on 1.x for the expected reasons.
3. `@enardo/cqrs`: the changes of *Changes*, cases 1–27 green; README; version 2.0.0.
4. `@enardo/eslint-config`: the rule, checked on the sample file; README; version 2.0.0. After step 3, so no commit is red.
5. The backlog: the change to *What a package logs*.
6. At the merge: this spec `done`, the backlog item removed in a commit of its own.
