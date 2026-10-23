---
status: draft
type: fix
tier: L
implementer: sonnet/medium
packages: ["@enardo/cqrs", "@enardo/eslint-config"]
branch: fix/cqrs/expected-failures-as-values
---

# `@enardo/cqrs` returns only the failures a handler declares, and rethrows the rest

## Why

The backlog item *`@enardo/cqrs` sends the message of a native error to the client*, from the spec of `feature/email/send-errors` (2026-10-20). `CommandHandler.execute()` and `QueryHandler.execute()` catch every error and return `{ success: false, error, exception }`. `mapErrorToString` puts in `error` the `code` of an `instanceof BaseError`, the `message` of any other `Error`, `"INTERNAL_ERROR"` for anything else; an app's HTTP layer sends `error` to the client. So the message of a native error, such as `getaddrinfo EAI_AGAIN smtp.internal.corp.test`, reaches the client.

The root cause is the catch-all, which ADR 0012 point 7 rules out: whether an error is expected in a flow is the app's call, and a component such as `cqrs` "rethrows and leaves the decision to the app, or returns the expected outcomes as values". The same catch-all logs every failure at `error`, then hands it back to the caller, who logs it again. And `instanceof BaseError` loses the `code` of an error built on a second copy of `@enardo/errors` (ADR 0012 point 3).

The shape was chosen with the user at intake (2026-10-23), so the `critic` runs on this spec.

## Probes

- Current behavior, through `dist/` (`pnpm exec turbo run build --filter=@enardo/cqrs... --force`, then a script in `packages/cqrs`, dev container, Node 24.21.0): a handler that throws `new Error("getaddrinfo EAI_AGAIN smtp.internal.corp.test")` → `{"success":false,"error":"getaddrinfo EAI_AGAIN smtp.internal.corp.test"}`, with an `exception` key; a `BaseError` subclass with code `E_CODE` → `error: "E_CODE"`; the string `"str"` → `error: "INTERNAL_ERROR"`.
- A prototype of the types of *Changes*, `tsc --noEmit` on the package's `tsconfig.json`:
  - `this.failureResponse("OTHER")` in a handler of `CommandResponse<{ id: string }, "EMAIL_TAKEN" | "EMAIL_INVALID">` → TS2345;
  - with `CommandResponse<{ id: string }>` (`TCode` defaults to `never`), `this.failureResponse("ANY")` → TS2345, and after `if (!response.success)` the response is `never`;
  - after `if (!response.success)` on the first, `response.error` is `"EMAIL_TAKEN" | "EMAIL_INVALID"`, and a `switch` on it with `const x: never = response.error` in `default` compiles;
  - `protected async handle()` with no return annotation compiles in the subclass.
- `eslint src --rule` with `no-restricted-syntax` and the selector `BinaryExpression[operator="instanceof"]:matches([right.name="BaseError"], [right.property.name="BaseError"])`, in every package with a `src/` → errors only at `packages/cqrs/src/command-handler.ts:70` and `query-handler.ts:67`. On a sample file: `e instanceof BaseError` and `e instanceof errors.BaseError` (namespace import) reported, `e instanceof Error` not. Not probed, and missed by the selector: an aliased import (`import { BaseError as B }`).
- `__tests__/` uses `instanceof BaseError` on purpose: `packages/errors/__tests__/base/is-base-error-like.test.ts:53`, `packages/errors/__tests__/types.test.ts:131`.
- `cqrs` imports nothing from `@enardo/errors` but `BaseError` for the two checks (`git grep -n "@enardo/errors" packages/cqrs/src`); it has no `__tests__/`, no `vitest.config.ts`, no README; its `lint` and `format` scripts cover `src` only. `@enardo/logger` is the model of a tested Node package (`vitest.config.ts`, `vitest` and `@enardo/errors` in `devDependencies`, scripts on `src __tests__`).
- No `@enardo/*` package depends on `cqrs` (`git grep '"@enardo/cqrs"' -- '*package.json'`).
- Versions: `cqrs` 1.0.0, `eslint-config` 1.1.0; a preset that adds rules took a minor (`f432111`).

## Decisions

Taken with the user at intake:

1. **Expected failures are values the handler returns; everything thrown is rethrown.** `handle()` returns `this.successResponse(payload)` or `this.failureResponse(code)`, with `code` one of the codes the handler's response type declares. `execute()` catches nothing. Not taken:
   - rethrowing everything, with `execute()` returning the payload: the common practice in Node (`@nestjs/cqrs`, error middleware), but a handler's expected failures would be in no type;
   - the `code` of a `BaseErrorLike`, and `"INTERNAL_ERROR"` for the rest: still a catch-all, against ADR 0012 point 7;
   - a per-handler allowlist of thrown codes turned into failures: no library does it, and it would carry the thrower's `details` to the client.
2. **`execute()` no longer logs a failure.** It rethrows, and the caller logs it. The rest of what a package logs stays with its backlog item, *What a package logs*.
3. **A lint rule against `instanceof BaseError`** in the presets, now that no use is left in `src/` (the backlog item).

Taken by this spec:

4. **`TCode` defaults to `never`.** `CommandResponse<Payload>` declares no expected failure: `failureResponse` takes nothing and the failure branch narrows to `never`. A handler lists its codes to return any; `string` would allow any code and lose the exhaustive `switch`.
5. **The failure carries only `error`.** No `details` and no `exception`: `exception` carried the raw error in the response, the path of the leak. An optional field is a minor later, when a handler needs one.
6. **The names stay `successResponse` and `failureResponse`**, so a subclass keeps its calls to the first; `failureResponse` changes its parameter from the error to the code. `mapErrorToString` goes.
7. **`@enardo/errors` leaves `cqrs`' `dependencies`**, since `src/` no longer imports it; it becomes a `devDependency`, for the tests that throw a `BaseError`.
8. **The lint rule is on `src/**` of every preset**, in `createConfig`: the tests of `@enardo/errors` compare the guard with `instanceof BaseError` on purpose.

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
  - `handle(command): Promise<TResult>`;
  - `execute()` logs `Executing command.` at `debug` as now, awaits `handle()` with no `try`, logs `Command executed.` at `debug` with `{ command, success }`, and returns the response;
  - `failureResponse(code: CommandFailureCode<TResult>): TResult`; `successResponse` unchanged; `mapErrorToString` and the import of `BaseError` removed.
- `src/query-response.ts`, `src/query-handler.ts`: the same, `QueryFailureCode` and `Query executed.`.
- `src/logger.ts`: `Logger` loses `error`, which nothing calls any more; the no-op logger too.
- `package.json`: `@enardo/errors` from `dependencies` to `devDependencies`; `vitest` in `devDependencies`; `test` and `test:watch`; `lint`, `lint:fix`, `format`, `format:check` on `src __tests__`; version 2.0.0.
- `vitest.config.ts` (new), as `@enardo/logger`'s.
- `README.md` (new): what the package is, a command handler with expected failures, how an app maps the response and handles what `execute()` rethrows (an allowlist of codes, everything else an unexpected failure, as ADR 0012 point 7 says), the logger option, and *Migrating from 1.x*: `handle()` returns a response, `execute()` rejects with what it threw, `exception` and `mapErrorToString` are gone, a response type lists its codes.

### `@enardo/eslint-config` (1.1.0 → 1.2.0)

- `index.js`, `createConfig`: a block on `src/**` with `no-restricted-syntax` and the selector of *Probes*, with a message pointing to `isBaseErrorLike` and ADR 0012.
- `README.md`, *Rule choices*: the rule, why (ADR 0012 point 3), what it misses (an aliased import), that tests are not restricted, and that an entry setting `no-restricted-syntax` after the preset replaces it.

### Repo

- `docs/backlog.md`: *What a package logs* no longer lists `cqrs`' failure logs (`command-handler.ts:46`, `query-handler.ts:43`), which this branch removes; this item leaves, in a commit of its own.

## Test cases

`packages/cqrs/__tests__/command-handler.test.ts`, with a test `Command` and handlers of `CommandResponse<{ id: string }, "EMAIL_TAKEN" | "EMAIL_INVALID">`:

1. `handle()` returns `this.successResponse({ id: "1" })` → `execute()` resolves to exactly `{ success: true, payload: { id: "1" } }` (`toStrictEqual`).
2. `handle()` returns `this.failureResponse("EMAIL_TAKEN")` → resolves to exactly `{ success: false, error: "EMAIL_TAKEN" }`: no `exception` key.
3. `handle()` throws `new Error("getaddrinfo EAI_AGAIN smtp.internal.corp.test")` → `execute()` rejects with that same instance (`toBe`).
4. `handle()` throws a `BaseError` subclass with code `"EMAIL_TAKEN"` → rejects with that same instance: a thrown error is not turned into a failure, even with a declared code.
5. `handle()` throws the string `"boom"` → rejects with `"boom"`.
6. A `handle()` that is not `async` and throws synchronously → `execute()` returns a promise that rejects with the error; it does not throw.
7. With a logger whose `debug` and `error` are spies (an object with more than `Logger` asks): on case 3, `error` is never called, and `debug` only with `Executing command.`; on case 2, `debug` is called with `Command executed.` and `{ command: <the command's class name>, success: false }`.
8. Types (`expectTypeOf`, `@ts-expect-error`): `failureResponse("OTHER")` does not compile; with `CommandResponse<{ id: string }>`, `failureResponse("ANY")` does not compile; after `if (!response.success)` `response.error` is exactly `"EMAIL_TAKEN" | "EMAIL_INVALID"`; `response.exception` does not compile; `CommandFailureCode<...>` is the union.

9–16. `packages/cqrs/__tests__/query-handler.test.ts`: cases 1–8 for `QueryHandler`, `QueryResponse`, `QueryFailureCode`, `Query executed.`.

17. `packages/cqrs/__tests__/index.test.ts`: the runtime exports are exactly `Command`, `CommandHandler`, `Query`, `QueryHandler`.

The lint rule has no automated case: `@enardo/eslint-config` has no tests. Step 4 runs it on a sample file in `cqrs/src` (the forms of *Probes*), removed before the commit, and `pnpm verify:all` lints every package with it.

## Risks

- **An app keeps a 1.x habit and the compiler does not see it.** An app that read `exception` or relied on `execute()` never rejecting: `exception` no longer compiles; the rejection does not show in a type. The README's *Migrating from 1.x* says it; the app's error middleware must catch what a handler throws.
- **A preset rule an app's code fails.** An app that installs `eslint-config` 1.2.0 with `instanceof BaseError` in its `src/` gets a lint error: wanted, by ADR 0012 point 3.

## Out of scope

- The other log points of `cqrs` and of the other packages: *What a package logs*.
- `details` on a failure (decision 5).
- The duplication between the command and query sides.
- Running `cqrs`' tests in browsers: its `src/` runs on servers.

## Plan

1. This spec: the branch's first commit.
2. `@enardo/cqrs`: the test setup (`vitest.config.ts`, scripts, `devDependencies`), then cases 1–17 test-first, by the `test-author`; they fail on 1.x for the expected reasons.
3. `@enardo/cqrs`: the changes of *Changes*, cases 1–17 green; README; version 2.0.0.
4. `@enardo/eslint-config`: the rule, checked on the sample file; README; version 1.2.0. After step 3, so no commit is red.
5. The backlog: the change to *What a package logs*.
6. At the merge: this spec `done`, the backlog item removed in a commit of its own.
