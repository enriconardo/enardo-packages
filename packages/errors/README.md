# @enardo/errors

The root of the error hierarchy: an error a caller may handle by `code`, which the `@enardo/*` packages and the projects built on them throw, extends `BaseError`; misuse and misconfiguration throw native errors. It guarantees that an error has a name its class declares, a machine-readable `code`, optional structured `details`, and a serialized form that keeps its message, stack and cause.

## Exports

| Export | Meaning |
| --- | --- |
| `BaseError` | Abstract root class. `name`, `code`, `details` are read-only; `toJSON()` serializes the error for logs. |
| `isBaseErrorLike` | Guard: whether a value carries the brand of `BaseError` and its shape, whatever copy of this package built it. |
| `BaseErrorLike` | `{ name, code, details? }`: what the guard proves. |
| `BaseErrorOptions` | Constructor options: `code` (required), `details`, `cause`. |
| `ErrorDetails` | `Readonly<Record<string, unknown>>`: what `details` may hold. |
| `SerializedError` | What `toJSON()` returns. |

## Writing an error

```ts
import { BaseError, type BaseErrorOptions } from "@enardo/errors";

export class UserNotFoundError extends BaseError {
  override readonly name = "UserNotFoundError";
  declare readonly code: "USER_NOT_FOUND";
  declare readonly details: { readonly userId: string };

  constructor(userId: string, options?: Pick<BaseErrorOptions, "cause">) {
    super(`User "${userId}" was not found`, {
      ...options,
      code: "USER_NOT_FOUND",
      details: { userId },
    });
  }
}
```

- **`name` is a class field equal to the class name.** It is abstract in `BaseError`, so the compiler rejects a concrete class that forgets it, and minifiers cannot change it the way they change `constructor.name`. The field gets the literal type `"UserNotFoundError"`; a class meant to be extended annotates it `name: string`, otherwise its subclasses cannot declare their own. An abstract intermediate class declares no name.
- **`code` is required**: it is what code handling the error switches on. A concrete class declares its codes with `declare readonly code`, on itself or on an ancestor. A code identifies one condition: it belongs to one concrete class, across packages, and it is public API, so renaming it is a breaking change.
- **`details` is an object.** An interface used for it must extend `Record<string, unknown>`; a type alias works as is.
- **Accept a `cause` and pass it on** when the error wraps another one, instead of pasting the other error's message into your own. `toJSON()` carries the whole `cause` chain into every log: when the other error can hold personal data or secrets (an address, a password in a URL, a response body), pass its identifiers instead, such as its `code`, and document them.
- **Narrow with `declare readonly`**, not with generics: `declare` emits nothing, so the values set by the `BaseError` constructor stay, and instances expose the precise types.

## Handling an error

Recognize an error with `isBaseErrorLike`, and branch on `code`; never parse `message`, which is for humans.

```ts
try {
  await run();
} catch (error) {
  if (isBaseErrorLike(error) && error.code === "USER_NOT_FOUND") {
    // ...
  }
}
```

After the guard, `error.name` and `error.code` are `string` and `error.details` is `ErrorDetails | undefined`. The guard checks a brand that every `BaseError` carries, from 1.1.0 on, so it recognizes an error built by another copy or another major of this package, and one of another realm. The brand proves a convention, not a provenance.

`instanceof` with a specific class gives its typed `details`, but is reliable only where you and the code that throws the error share one copy of the package that declares the class. Never use `instanceof BaseError` to recognize an error: with two copies of this package it fails silently, and the other copy's errors lose their `code`.

A copy of 1.0.0 has no brand. While packages that allow 1.0.0 are in your tree, keep one copy of `@enardo/errors`, at 1.1.0 or later, with an override of your package manager (with pnpm 11, `overrides` in `pnpm-workspace.yaml`, which no longer reads the `pnpm` field of `package.json`).

`BaseError` takes no type parameters on purpose: `instanceof` with a generic class narrows to `BaseError<any>`, which would make `error.code` `any` wherever an error is caught.

## Logging: `toJSON()`

`message`, `stack` and `cause` are not enumerable, so `JSON.stringify` alone drops them: an error nested in log metadata used to come out as `{"code": …, "name": …}`. `toJSON()` returns:

- every own enumerable field (`code`, `details`, and fields a subclass adds), leaving out those whose value is `undefined`;
- `name`, `message`, and `stack` when defined;
- `cause` when defined: an `Error`, whether or not it is a `BaseError`, is serialized the same way, down the whole chain; any other value is kept as is; a cycle in the cause chain becomes `"[Circular]"`. Other fields are copied as they are: an error reachable from one of them that points back up the chain is not detected.

`JSON.stringify` calls it by itself, so it also applies to an error nested inside another object.

**Never send it in an HTTP response**: it carries `details` and the stack.

## Contributing

Run these inside `packages/errors`:

```sh
pnpm format && pnpm lint && pnpm typecheck && pnpm test
```

The tests check the types with `expectTypeOf` and `@ts-expect-error`, so `pnpm typecheck` catches, for example, a field that stopped being read-only. Rules for changing the package are in [CLAUDE.md](./CLAUDE.md).
