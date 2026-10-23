# @enardo/errors

Root of the error hierarchy of the `@enardo/*` packages and of the projects built on them; an error a caller may handle by `code` extends `BaseError`, in this repo and in the projects; misuse and misconfiguration throw native errors. The public contract is in [README.md](./README.md); this file holds the rules for changing the package.

## Layout

```
src/base/base-error.ts          BaseError
src/base/base-error.types.ts    BaseErrorOptions, BaseErrorLike, ErrorDetails, SerializedError
src/base/is-base-error-like.ts  isBaseErrorLike, the guard on the brand
src/base/serialize-error.ts     the serializer behind toJSON (internal, not exported)
__tests__/                      mirrors src/, plus index.test.ts (public surface) and types.test.ts (type-level)
```

## Invariants

- **No dependencies.** Most packages of this repo import this one, directly or not, and so do the projects that install them, on Node and in browsers (Cambusa's web app, through `@enardo/http-client` and its own packages), so a dependency of its own would reach them all. An error tied to a protocol or a technology lives in the package that speaks it, as `@enardo/http-client`'s errors do.
- **The root contract.**
  - `BaseError` is abstract, and so is its `name`.
  - Every concrete class declares `name` as a field, equal to the class name. The field's literal type blocks subclasses, so a class meant to be extended types it `string`.
  - `code` is required.
  - `details` is an object (`ErrorDetails`).
  - Every field is `readonly`. This is compile-time only: freezing the instance in the base constructor would make every subclass field initializer throw.
- **The brand's key and `BaseErrorLike` are a contract between majors** (ADR 0012, point 2): the key `Symbol.for("@enardo/errors.BaseError")`, set on the prototype, and the shape the guard checks. A new major may add to that shape only in a way an older `BaseError` still meets. `BaseErrorLike` is never `BaseError` (ADR 0003).
- **No type parameters on `BaseError`.** `instanceof` with a generic class narrows to `BaseError<any>`, which would type `error.code` as `any` in every consumer. Subclasses narrow `code` and `details` with `declare readonly`.
- **`code` is for machines, `message` for humans.** No code parses a message.
- **Every constructor accepts `cause`.** An error that wraps another passes it as `cause`, and never pastes its message into its own.
- **`toJSON` is for logs, never for responses.** It carries `details` and the stack.
- **Only cross-cutting errors live here.** An error specific to a context lives in the package that throws it.
- Named exports only; `src/index.ts` lists them explicitly.

## Tests

- Test-first: the tests define the contract of a shared package.
- Tests import from the entry point (`~/index`), and `index.test.ts` pins the exact list of runtime exports.
- Every contract change gets type-level tests in `types.test.ts`:
  - abstractness;
  - required fields;
  - `readonly`;
  - `declare` narrowing;
  - `code` being exactly `string` after `instanceof`, never `any`.
- Every new class gets tests for:
  - its `name`;
  - its stack header, `<name>: <message>`;
  - its default `code`;
  - `cause` propagation.
- A literal field type is widened by `expectTypeOf(value)`: read it in type position instead (`expectTypeOf<MyError["name"]>()`).
- `new` of an abstract class under `@ts-expect-error` has an error type: return it through a function typed `() => unknown` (the `compileOnly` helper), or type-aware lint reports an unsafe return.

## Public API changes

- JSDoc on every export, and the README updated in the same commit.
- A change to `BaseError` or its options migrates every subclass in this repo in the same commit, so the branch never goes red. Find them with `git grep -n 'extends BaseError'`, and follow their subclasses too. `pnpm verify` checks every dependent here.
- The projects' subclasses live in their own repos, which `pnpm verify` does not see: a change that breaks them is a new major version, and each project migrates when it moves to it.
