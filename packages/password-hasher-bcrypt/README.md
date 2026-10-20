# @enardo/password-hasher-bcrypt

The bcrypt implementation of [`@enardo/password-hasher`](../password-hasher/README.md)'s `IPasswordHasher`.

```ts
import { BcryptPasswordHasher } from "@enardo/password-hasher-bcrypt";

const passwordHasher = new BcryptPasswordHasher();

const passwordHash = await passwordHasher.hash(password);
await passwordHasher.compare(password, passwordHash); // true
```

> Published to the `@enardo` registry. `bcrypt` `^5.1.1` is a peer dependency: install it beside the package.

## Exports

| Export | Meaning |
| --- | --- |
| `BcryptPasswordHasher` | Implements `IPasswordHasher` |

## Options

- **`saltRounds`** (the constructor's argument, default `12`): bcrypt's cost. Each round more doubles the time `hash` takes, and `compare` against the hashes it makes.

## Password length

bcrypt reads only the first 72 bytes of a password, counted in UTF-8: 72 ASCII characters, fewer when some take more than one byte (`é` takes two). Two passwords that share their first 72 bytes match the same hash. A caller that accepts longer passwords caps them at 72 bytes, counting bytes, not characters.

## Contributing

Run these inside `packages/password-hasher-bcrypt`:

```sh
pnpm format && pnpm lint && pnpm typecheck && pnpm test
```
