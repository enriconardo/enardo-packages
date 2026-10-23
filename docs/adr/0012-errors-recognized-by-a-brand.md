# 0012. An error of the ecosystem is recognized by a brand and its `code`, never by `BaseError`'s identity

- Status: proposed
- Date: 2026-10-23
- Spec: docs/specs/2026-10-23-error-brand.md

## Context

`BaseError` of `@enardo/errors` does two jobs. It gives every error the same shape: a `name` its class declares, a required `code`, `details`, `cause`, and `toJSON()` for logs. And its class has been how code recognizes an error of the ecosystem: `error instanceof BaseError`, as the package's README said, and as `@enardo/cqrs` does to pick the `code` it returns.

The second job depends on the copy of the module. Every package declares `@enardo/errors` as a `dependency`, so an app that installs a major of `@enardo/errors` that a package's range does not allow gets two copies, and `instanceof` fails silently: in `@enardo/cqrs`, an error built on the second copy loses its `code`, and the response carries its message instead. The check runs both ways: an app's error handler recognizes the packages' errors with it too.

The JS ecosystem recognizes an error without its class, through a documented string field (Node's `err.code`, Fastify's `FST_ERR_*`, Prisma's `code`, the `name` of `DOMException` and of AWS SDK v3), or through a brand checked by a guard (Axios' `isAxiosError`, Boom's `isBoom`, `http-errors`' `isHttpError`). Both work across copies, versions, module formats and realms.

Three more questions had no rule. Which errors extend `BaseError`: the root `CLAUDE.md`, the `@enardo/errors` README and its `CLAUDE.md` said three different things. Whether a `code` identifies an error: nothing kept two classes from sharing one. And who decides whether an error is expected in a flow: `@enardo/cqrs` classified every error with a catch-all, and logged an expected domain error at `error`.

## Decision

1. **A brand.** `BaseError.prototype` carries the key `Symbol.for("@enardo/errors.BaseError")`, with the value `true`, non-enumerable, non-writable, non-configurable: on the prototype, so `toJSON()` never serializes it and a subclass's fields cannot collide with it. `@enardo/errors` exports `isBaseErrorLike(value: unknown): value is BaseErrorLike`, which checks the brand and the shape (`name` and `code` strings, `details` an object that is not an array, or `undefined`), and returns `false` when a read throws. `BaseErrorLike` is `{ readonly name: string; readonly code: string; readonly details?: ErrorDetails }`: never `BaseError` (ADR 0003).
2. **The brand's key and `BaseErrorLike` are a contract between the majors of `@enardo/errors`.** Changing either breaks the recognition between versions; a new major may add to the shape the guard checks only in a way an older `BaseError` still meets.
3. **No package recognizes an error with `instanceof BaseError`.** `instanceof` with a specific class stays fine where the caller imports that class from the package that throws it. `@enardo/errors` stays a `dependency` of the packages that use it.
4. **A `code` identifies one condition.** Two classes never share a `code`; a class may own several (`EntityLifecycleError`). Every concrete class narrows `code` to its literals with `declare readonly code`, so the codes are in its declaration file and are public API: renaming one is a breaking change. `pnpm verify` checks that each class of `packages/*/src` declares them and that no literal belongs to two classes. Codes are not prefixed: a namespace is hygiene, not identity, and the projects follow the same rule in their own repos.
5. **`DatabaseError` is the one known exception.** Its `code` is a string the thrower picks. Its form is decided by the architectural review of `@enardo/database` and `@enardo/database-mongo`; until then the check names it as an exception.
6. **Operational or programmer error is the thrower's call.** A class extends `BaseError` when it describes a condition a caller may handle by `code`. Misuse and misconfiguration, which a caller fixes in its code rather than handles, throw native errors (`TypeError`, `RangeError`, `Error`). The existing `BaseError`s that report misuse or misconfiguration are reviewed one by one, each in its own package.
7. **Whether an error is expected in a flow is the app's call.** No package decides what reaches a client, or at what severity. The app maps an allowlist of `code`s to responses, and everything else is an unexpected failure. A component such as `@enardo/cqrs` does not classify errors with a catch-all: it rethrows and leaves the decision to the app, or returns the expected outcomes as values.

## Consequences

- A package's error is recognized whatever copy of `@enardo/errors` built it, including one of another major, and across realms (`Symbol.for` is shared between them).
- A value that carries the brand and the shape passes the guard whatever built it: the brand proves a convention, not a provenance, as with `isAxiosError`.
- After the guard, a caller reads `name`, `code` and `details`; for anything else (`toJSON`, a subclass's field), it narrows with the specific class, or reads the value as `unknown`.
- Every error class of this repo declares its codes, and adding one with a taken code fails `pnpm verify`. A mismatch between the declared literal and the value passed to `super` is not caught by the compiler: each class's tests pin the runtime `code`.
- The projects' errors extend `BaseError` and carry the brand; the uniqueness of their codes against the packages' is theirs to check.
- `@enardo/cqrs` still recognizes errors with `instanceof BaseError`, and classifies them with a catch-all, until its own branch.

## Alternatives considered

- **`@enardo/errors` as a peer of every package.** It makes one copy, the app's, and a major mismatch an install warning, but correctness still depends on the install.
- **The brand behind `Symbol.hasInstance`.** `instanceof BaseError` would then pass a `BaseError` of another major, and narrow it to this major's class: a check that claims a class it does not prove (ADR 0003).
- **A guard on `code: string` alone, or on a prefix of `code`.** Node's system errors and nodemailer's have a string `code` too, so the guard would not tell an error of the ecosystem from them. A prefix is a convention nothing enforces, which the apps' errors would have to follow too, with every existing code renamed, a major for each package.
- **The brand as an instance field.** `toJSON()` serializes own enumerable fields, and a subclass's fields could collide with it.
- **A codes check that reads the literals passed to `super`.** It misses a code passed through a parameter (`EntityLifecycleError`), and leaves the codes out of the declarations, where a consumer reads them.
