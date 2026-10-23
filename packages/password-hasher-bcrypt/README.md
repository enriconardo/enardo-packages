# @enardo/password-hasher-bcrypt

The bcrypt implementation of [`@enardo/password-hasher`](../password-hasher/README.md)'s `IPasswordHasher`.

```ts
import { BcryptPasswordHasher } from "@enardo/password-hasher-bcrypt";

const passwordHasher = new BcryptPasswordHasher();

const passwordHash = await passwordHasher.hash(password);
await passwordHasher.compare(password, passwordHash); // true
```

> Published to the `@enardo` registry. `bcrypt` `^5.1.1` and `@enardo/password-hasher` `^2.0.0` are peer dependencies: install them beside the package.

## Exports

| Export | Meaning |
| --- | --- |
| `BcryptPasswordHasher` | Implements `IPasswordHasher` |

## Options

- **`saltRounds`** (the constructor's argument, default `12`): bcrypt's cost. Each round more doubles the time `hash` takes, and `compare` against the hashes it makes.

## How a password is read

The password is encoded in UTF-8, and bcrypt reads the bytes. Two passwords match the same hash when their bytes do, so two different strings do in two cases:

- **Length.** bcrypt reads only the first 72 bytes: 72 ASCII characters, fewer when some take more than one byte (`é` takes two). A caller that accepts longer passwords caps them at 72 bytes, counting bytes, not characters.
- **Lone surrogates.** Each half of a UTF-16 surrogate pair that stands alone is encoded as U+FFFD, the replacement character: `"pw\uD800"`, `"pw\uDC00"` and `"pw�"` match the same hash. A caller that refuses a password that is not well-formed (`String.prototype.isWellFormed`) avoids it.

## Contributing

Run these inside `packages/password-hasher-bcrypt`:

```sh
pnpm format && pnpm lint && pnpm typecheck && pnpm test
```
