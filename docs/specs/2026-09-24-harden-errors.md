---
status: done
type: fix
packages: ["@enardo/errors", "@enardo/database", "@enardo/entities", "@enardo/uow-repository", "@enardo/uow-repository-mongo", "@enardo/cqrs", "@cambusa/catalog", "@cambusa/collaboration", "@cambusa/identity", "@cambusa/planning", "@cambusa/shared", "@cambusa/shopping", "@cambusa/api-server"]
branch: fix/errors/harden-base-error
---

# Harden `@enardo/errors`

## Goal

Make `BaseError` a contract that its 39 subclasses and their consumers can rely on: every error has a name the compiler enforces, a machine-readable code, typed and immutable fields, and a serialized form that keeps its message, stack and cause. The package keeps only what is used, and gets the documentation a shared package owes its consumers.

## Problem

An architectural review of the package found eight issues. This branch addresses the root contract (1, 2, 5–8); issues 3 and 4 go to their own branch (see *Out of scope*).

1. **Errors lose message, stack and cause when logged (bug).** Consumers log `logger.error("…", { error })`. Winston's `format.errors` only unwraps an error at the top level of the log entry; a nested one goes through `JSON.stringify`, which sees own enumerable properties only. Probed with the current packages: a `NotFoundHttpError` logs as `{"code":"USER_NOT_FOUND","httpStatus":404,"name":"NotFoundError"}`, a plain `Error` as `{}`. This hits the `cqrs` handlers, `http-client` and the api-server's `"Unhandled error."` log. This branch fixes the errors side (`toJSON`); the logger side has its own branch.
2. **The root contract is too loose.**
   - `code?: string` is optional, although it is the error's machine-readable identity. `cqrs` falls back to `error.message` in the same field, and because `BaseError` is concrete, `get-product-by-id.handler.ts:36` can `throw new BaseError("TODO")`: a request for another group's product gets a 500 with `{ "error": "TODO" }`. That bug is fixed first, on its own branch (see *Prerequisite*).
   - `details: string | string[] | Record<string, unknown>` forces every reader to discriminate. The api-server's `toErrorCode` looks for error codes inside string and array `details`, which no producer writes (checked: every producer passes an object). `EntityLifecycleError` copies `details` into a private `_context` to expose it typed, and narrows `code` with `declare readonly`: consumers are working around the base types.
   - Fields are mutable: `error.code = "OTHER"` and `error.httpStatus = 200` succeed (probed).
3. HTTP transport errors live in the root package that every domain imports, and serve two opposite roles (a response received by a client, a status chosen by a server). Out of scope.
4. The HTTP hierarchy has its own defects (`NetworkError extends HttpError`, no status validation, `""` meaning "default message", default messages that duplicate and diverge from `@enardo/http-status`). Out of scope, except where this branch's invariants require a change (see *HTTP classes in this branch*).
5. **`name` is a constructor option.** Any caller can override an error's identity. 36 subclasses repeat their class name as a string, which protects them from minifiers mangling `constructor.name`; the other 3 rely on it. The HTTP classes use names that no class has: `NotFoundHttpError` is named `NotFoundError`.
6. **`IBaseError` and `IHttpError` guarantee nothing.** Every member they add is optional, so any `Error` is assignable to them. No consumer (checked).
7. **`InvalidDataError` has no consumer** (checked) and is inconsistent with the rest of the package: no JSDoc, `.js` import extensions, no `cause`, its list is flattened into the message and not kept in `details`, and an empty list yields `"Invalid data: "`.
8. **Documentation and tests.** No README, `description: "An Errors Package"`, incomplete JSDoc. Tests import internal paths, so nothing pins the public surface, and there are no type-level cases. `if (options.code)` silently drops falsy values. Every module uses a default export, while the other shared packages use named exports.

## Design

### Probed facts

Probed in the dev container with TypeScript 5.9.3 and Node 24.21, using the compiler options of `@enardo/typescript-config/base.json`:

- **P1.** For a generic class `C<T>`, `x instanceof C` narrows `unknown` to `C<any>`: every member typed by `T` becomes `any`.
- **P2.** `abstract override readonly name: string` compiles on a class extending `Error`, and a concrete subclass that does not declare `name` is a compile error.
- **P3.** `override readonly name = "X"` gives `name` the literal type `"X"`. A subclass cannot redeclare it with another literal unless the parent annotates `name: string`; with that annotation, it can.
- **P4.** In a subclass, `declare readonly code: "X"` and `declare readonly details: T` narrow the inherited types, compile under `noImplicitOverride`, and emit nothing, so the values set by the base constructor survive.
- **R1.** A `name` set by a subclass field initializer, which runs after `super()` returns, is also what the stack header shows (`Named: named message`): V8 formats the header lazily. `Error.captureStackTrace(this, new.target)` in the base constructor still removes the constructor frames.
- **R2.** `Object.freeze(this)` in the base constructor makes every subclass field initializer throw (`TypeError: Cannot define property name, object is not extensible`).
- **R3.** A `toJSON()` that spreads the own enumerable properties and adds `name`, `message`, `stack` and a serialized `cause` is picked up by `JSON.stringify` on a nested error, and by the current winston JSON format: the log line then carries the message, stack, code, subclass fields and the whole cause chain. A cycle in the cause chain is caught by a `WeakSet` and does not throw.

### No generics: subclasses narrow with `declare`

The review proposed `BaseError<TCode, TDetails>`. P1 rules it out: every `error instanceof BaseError` in consumers (`cqrs`, the api-server error handler) would type `error.code` as `any`, which type-aware lint rejects (`no-unsafe-*`) and which is less safe than today.

Instead, `BaseError` types `code: string` and `details: ErrorDetails | undefined`, and a subclass that wants precise types narrows them with `declare readonly` (P4), as `EntityLifecycleError` already does. The cost: the compiler does not check the value passed to `super()` against the declared type. Both sit in the same class a few lines apart, and the class's tests pin the value.

### Target public API

```ts
abstract class BaseError extends Error {
  abstract override readonly name: string;
  readonly code: string;
  readonly details: ErrorDetails | undefined;
  constructor(message: string, options: BaseErrorOptions);
  toJSON(): SerializedError;
}

interface BaseErrorOptions extends ErrorOptions { // ErrorOptions brings `cause`
  code: string;
  details?: ErrorDetails;
}

type ErrorDetails = Readonly<Record<string, unknown>>;

interface SerializedError {
  readonly name: string;
  readonly message: string;
  readonly stack?: string;
  readonly cause?: unknown;
  readonly [key: string]: unknown;
}
```

A subclass, with the optional narrowing:

```ts
export class DuplicateEntityError extends BaseError {
  override readonly name = "DuplicateEntityError";
  declare readonly code: "DUPLICATE_ENTITY";
  declare readonly details: { readonly key: string };

  constructor(key: string, options?: Pick<BaseErrorOptions, "cause">) {
    super(`An entity with identity "${key}" is already tracked.`, {
      ...options,
      code: "DUPLICATE_ENTITY",
      details: { key },
    });
  }
}
```

`toJSON()` returns:

- the own enumerable properties: `code`, `details` and every field a subclass adds, such as `httpStatus`;
- then `name`, `message`, `stack` (no key when undefined) and `cause` (no key when undefined);
- a `cause` that is an `Error` is serialized the same way, recursively, whether or not it is a `BaseError`; any other value is kept as is; a cycle becomes `"[Circular]"`.

It is meant for logs, never for HTTP responses: it carries `details`, `stack` and, for an `HttpError`, the upstream response body.

Removed: `IBaseError`, `IHttpError`, `InvalidDataError`, the `name` option.

### HTTP classes in this branch

They leave the package in the next branch, but at the end of this one they meet the package's invariants, and change only as much as those require:

| Class | `name` | default `code` | other |
| --- | --- | --- | --- |
| `HttpError` | `"HttpError"`, typed `string` (extended) | `HTTP_<status>`, or `HTTP_ERROR` without a status | `httpStatus`, `httpError` readonly |
| `ClientHttpError`, `ServerHttpError` | class name, typed `string` (extended) | same rule | |
| the 10 concrete classes | class name (`NotFoundHttpError`, …) | `HTTP_<their status>` (`HTTP_404`) | |
| `NetworkError` | `"NetworkError"` | `NETWORK_ERROR` | accepts `{ cause, details }` |

`code` stays overridable through the options: the auth middleware passes `AUTHENTICATION_REQUIRED`. The `HTTP_` prefix is deliberate: no entry of `@cambusa/error-codes` starts with it, so the api-server's `toErrorCode` resolves an `HttpError` without an explicit code to `INTERNAL_ERROR`, exactly as today. Default messages, the class hierarchy and status validation do not change here.

### Decisions (to confirm at checkpoint 1)

1. **No generics on `BaseError`** (P1); subclasses narrow with `declare readonly`.
2. **`name` is abstract**: every concrete class declares it as a class field, and it leaves the options. The 36 explicit names already equal their class names (checked), so only the HTTP classes change name (decision 5).
3. **`code` is required; `details` is an object or nothing.** String and array `details` go: no producer uses them.
4. **Immutability is compile-time only** (`readonly`). The base constructor cannot freeze the instance (R2).
5. **HTTP classes**: names aligned to class names, `HTTP_<status>` default codes, `NetworkError` accepts `cause`. The codes are interim: the next branch may redesign them when it moves the classes. Nothing reads HTTP error names today (checked: web app, api-server, `@enardo/http` tests).
6. **`toJSON` as specified above.** The serializer stays internal; the logger spec decides whether to export it.
7. **Remove `IBaseError`, `IHttpError` and `InvalidDataError`**: they have no consumers.
8. **`@enardo/entities`**: `EntityLifecycleError` becomes abstract (never instantiated directly, checked), narrows `code` and `details` with `declare` and drops its private `_context` copy; the public `context` getter stays and returns `details`. `InvalidEntityIdError` narrows `details` to `InvalidEntityIdDetails`. The other subclasses migrate mechanically; narrowing them is recommended in the README and applied when their files are next touched.

### Prerequisite

`get-product-by-id.handler.ts` is the only production code that instantiates `BaseError` directly (the package's own tests are rewritten in step 3), so an abstract `BaseError` does not compile until it changes. What it should do instead is a behavior decision for cambusa, not part of the error contract: it is fixed on its own branch (`fix/cambusa/catalog/foreign-group-product`, own spec), merged into `master` before step 3 of the *Plan*, and this branch is rebased on it.

## Scope

### `@enardo/errors`

1. `src/base/`: `BaseError`, `BaseErrorOptions`, `ErrorDetails`, `SerializedError`, the internal serializer.
2. `src/http/`: the changes in the table above.
3. Remove `src/validation/`, `IBaseError` and `IHttpError`.
4. Named exports only; `src/index.ts` lists them explicitly.
5. JSDoc on every export.
6. `__tests__/`: rewritten from the test cases below, with `types.test.ts` for the type-level cases.
7. `README.md`, `CLAUDE.md` (see *Package CLAUDE.md*), and a real `description` in `package.json`.

### Consumers

| Package | Change |
| --- | --- |
| `@enardo/database` | `DatabaseError`: `name` field; its options become `BaseErrorOptions`, so `code` is required (the three call sites in `database-mongo` already pass one); `database-error.test.ts` rewritten, test-first |
| `@enardo/entities` (4) | decision 8, `name` fields |
| `@enardo/uow-repository` (6), `@enardo/uow-repository-mongo` (2) | `name` field; `Omit<BaseErrorOptions, "name" \| "code">` becomes `Omit<BaseErrorOptions, "code">` |
| `@cambusa/{catalog,collaboration,identity,planning,shared,shopping}` (26) | `name` field |
| `@enardo/cqrs` | `mapErrorToString` returns `error.code` for a `BaseError`: the `?? error.message` fallback can no longer apply |
| `@cambusa/api-server` | `toErrorCode`: drop the two `details` branches (dead, and no longer allowed by the type); the first check becomes `isErrorCode(error.code)` |
| root `CLAUDE.md` | the line on errors says that subclasses declare `name` as a field and pass a `code`, and links the README |

`@enardo/http` and `@cambusa/web` need no change; `pnpm verify` re-checks them as dependents.

## Out of scope

- **Logger**: serializing any nested `Error` (plain errors still log as `{}`). Branch `fix/logger/serialize-nested-errors` with its own spec, after this one, so it can decide whether to reuse the serializer.
- **Issues 3 and 4**: moving the HTTP errors to `@enardo/http`, the api-server choosing statuses through error codes only, `NetworkError` as a sibling of `HttpError`, a required and validated `httpStatus`, an optional `message`, default messages from `getReasonPhrase`, `http-client` passing `cause` instead of pasting messages. Next branch, own spec.
- `cqrs` returning `error.message` for errors that are not a `BaseError`.
- Narrowing `code` and `details` in subclasses outside `@enardo/entities`.
- Runtime immutability (R2).

## Test plan

Test-first: this is the public API of `@enardo/*` packages. The `test-author` subagent writes the tests from this spec; each suite is seen failing for the expected reason before any implementation. Type-level cases use vitest `expectTypeOf` and `@ts-expect-error`, enforced by `typecheck`. Tests of `@enardo/errors` import from the entry point (`~/index`), and define their own concrete subclasses, since `BaseError` is abstract.

### `BaseError`

1. An instance of a concrete subclass is `instanceof Error` and `instanceof BaseError`, with the given `message`.
2. `name` is the name the subclass declares, as an own property.
3. The first line of `stack` is `<name>: <message>`, and `stack` contains no constructor frame (`new <Class>`).
4. A subclass of a concrete subclass that redeclares `name` reports the most derived name, in `name` and in `stack`.
5. `code` and `details` are the ones given, `details` is `undefined` when omitted, and `cause` is propagated.
6. `code: ""` is kept, not dropped as falsy.

### `toJSON`

7. The result has `name`, `message`, `stack`, `code`, `details`, and every own enumerable field a subclass adds.
8. The result has no `details` key and no `cause` key when they are absent.
9. A plain `Error` cause serializes to its `name`, `message` and `stack`; a `BaseError` cause to its own `toJSON` shape, `code` included; a chain of three causes is serialized to the end.
10. A cause that is not an `Error` (a string, an object) is kept as is.
11. A cycle in the cause chain yields `"[Circular]"` and does not throw.
12. Regression for issue 1: `JSON.parse(JSON.stringify({ error }))` has `error.message`, `error.stack` and `error.cause.message`.

### HTTP classes

13. For each of the 10 concrete classes: `name` equals the class name, `httpStatus` is its status, the default `code` is `HTTP_<status>`, the default message is unchanged, and the instance is `instanceof` its intermediate class, `HttpError` and `BaseError`.
14. A `code` given in the options wins over the default (`UnauthorizedHttpError` with `AUTHENTICATION_REQUIRED`).
15. `HttpError`, `ClientHttpError`, `ServerHttpError`: `name` is the class name; `code` is `HTTP_<status>` when a status is given, `HTTP_ERROR` otherwise.
16. `httpError` is propagated by a concrete class.
17. `NetworkError`: `name` is `NetworkError`, `code` is `NETWORK_ERROR`, `httpStatus` is `undefined`, `cause` is propagated.
18. `toJSON` of an `HttpError` has `httpStatus` and `httpError`.

### Public surface

19. The runtime exports of the entry point are exactly `BaseError`, `HttpError`, `NetworkError`, `ClientHttpError`, `ServerHttpError` and the 10 concrete HTTP classes (compared as a sorted list).
20. `IBaseError` and `IHttpError` are not exported (`@ts-expect-error` on their import).

### Types

21. `new BaseError(…)` is rejected: the class is abstract.
22. A concrete subclass that does not declare `name` is rejected.
23. Options without `code` are rejected; `name` in the options is rejected.
24. `details` rejects a string and an array.
25. `name`, `code`, `details`, `httpStatus` and `httpError` are readonly.
26. After `if (error instanceof BaseError)` on an `unknown`, `error.code` is exactly `string`, not `any`. This pins decision 1.
27. With `declare readonly` narrowing, an instance's `code` and `details` have the declared types; a literal `name` has its literal type.
28. The concrete HTTP classes reject `httpStatus` in their options.

### `@enardo/database`

29. `database-error.test.ts` is rewritten (this spec authorizes changing it): `name` is `"DatabaseError"`, `code` is required (type-level), object `details` and `cause` are propagated, the instance is `instanceof BaseError`. The cases for string and array `details` and for a missing `code` go.

### `@enardo/entities`

30. `EntityLifecycleError` cannot be instantiated (type-level). `EntityNotMutableError` and `EntityAlreadyMarkedForRemovalError` report their class name as `name`, `code` is typed `EntityLifecycleErrorCode`, `details` is typed `EntityLifecycleErrorContext`, and `context` is the same object as `details`.
31. `InvalidEntityIdError`: `details` is typed `InvalidEntityIdDetails`.

### Everything else

The existing tests of every other consumer stay green unchanged. `@cambusa/api-server` has no test suite: `typecheck` covers it, plus a manual check that `pnpm cambusa:dev` starts and that a request without a token still gets 401 `AUTHENTICATION_REQUIRED`.

## Plan

Each step ends with `pnpm verify` green and one commit.

1. **Spec** (this file).
2. **Prerequisite**: the catalog branch is merged into `master`; this branch is rebased on it.
3. **Tests for the new contract**: `test-author` writes tests 1–31; they are run to confirm that they fail for the expected reasons (missing `toJSON`, names, codes, abstractness, `readonly`). Not committed alone, since a red state is never committed.
4. **New contract and migration**: implement `@enardo/errors` to make step 3 green, and migrate every consumer in the same commit: removing the `name` option breaks every subclass otherwise. One logical change: the new contract and its adoption.
5. **Documentation**: JSDoc review, `README.md`, package `CLAUDE.md`, the root `CLAUDE.md` line, the `package.json` description.
6. **Review**: the `reviewer` subagent checks the full diff against this spec; findings are fixed.
7. **Checkpoint 2**, then integrate (`status: done`, `--no-ff` merge) and open the logger spec.

## Package CLAUDE.md

Written in step 5, it codifies the invariants of *Design* for future work:

- no dependency on a technology; the HTTP classes and the `@enardo/http-status` dependency are on their way out, and nothing is added on that side;
- the root contract: `BaseError` is abstract; `name` is abstract, declared by each concrete class as a field equal to the class name, and typed `string` only in classes meant to be extended; `code` is required; `details` is an object; every field is `readonly`;
- no generics on `BaseError` (P1): subclasses narrow `code` and `details` with `declare readonly`;
- `code` is for machines, `message` for humans; no code parses a message;
- every constructor accepts `cause`; code that wraps an error passes it as `cause` and never pastes its message into its own;
- `toJSON` is for logs, never for responses;
- errors specific to a context live in the package that throws them, not here;
- tests import from the entry point; every contract change gets type-level tests (abstractness, required fields, `readonly`, narrowing, `instanceof` not yielding `any`); every new class gets tests for its name, its stack header and `cause` propagation;
- a public API change updates JSDoc and README in the same commit, and migrates every subclass in that commit too.

## Risks

| Risk | Mitigation |
| --- | --- |
| The mechanical migration of 39 subclasses misses one | The compiler: a concrete subclass without `name`, or a `super()` call without `code`, does not typecheck; `pnpm verify` checks every dependent |
| A class extended later has a literal `name` | P3: the compiler reports it; the rule is in the package CLAUDE.md |
| `toJSON` puts sensitive data in logs | Own enumerable fields (`details`, `httpError`) already reach the logs today; `toJSON` adds `message`, `stack` and `cause`. Documented: never send it in a response |
| Stack traces make log lines long | Accepted: formatting belongs to the logger branch |
| The default HTTP codes change the api-server's behavior | The `HTTP_` prefix matches no `ERROR_CODES` entry; test 14 keeps the auth middleware's code |

## Implementation notes

Decided or found during implementation, after the spec was approved:

1. **The manual check found an existing bug, not a regression.** A request without a token gets 401 as before, but its body says `INTERNAL_ERROR`, not `AUTHENTICATION_REQUIRED` as *Everything else* expected. The auth middleware throws with `AUTHENTICATION_REQUIRED`, which is not registered in `@cambusa/error-codes`, so `toErrorCode` discards it, on `master` as on this branch. Left to the next branch, which reworks how the api-server picks statuses and codes.
2. **`DatabaseError` has no constructor**: it inherits `BaseError`'s `(message, options: BaseErrorOptions)`.
3. **The tests pin details of `toJSON` beyond the numbered cases**: a `null` cause is kept (only `undefined` is left out), a plain `Error` cause keeps its own enumerable fields (such as Node's `code` and `errno`), and there is no `stack` key when the stack is undefined.
4. **`new` of an abstract class under `@ts-expect-error` has an error type**: the entities test returns it through a function typed `(): unknown`, as the `compileOnly` helper of the errors tests does, so type-aware lint does not report an unsafe return.
5. **No `Error.captureStackTrace` call** (review). V8 already starts the stack at the `new` expression: probed on Node 24, a three-level hierarchy without the call has no constructor frames in its stack. On the runtime the package targets, the call did nothing, and test 3 holds without it.
6. **Cycle detection covers the cause chain only** (review). An error reachable from another field that points back up the chain makes `JSON.stringify` call `toJSON` again with a fresh chain, until the stack overflows; the reviewer reproduced it with winston's JSON format. Nothing creates such a back-reference today, and the README states the limit. A logger that never throws on what it is given belongs to the logger branch.
7. **`cqrs` for an `HttpError` without an explicit code** (review): `error` in the response is now `HTTP_<status>` instead of the error's message. No handler throws an `HttpError` today; this matters when the HTTP errors move.
