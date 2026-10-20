# @enardo/password-hasher

The contract for hashing passwords. The package holds one interface: implementations live in their own packages, so that code which checks passwords doesn't depend on a hashing library.

## Exports

| Type | Meaning |
| --- | --- |
| `IPasswordHasher` | Hashes a password with `hash(password)`, and checks a password against a stored hash with `compare(password, hashedPassword)` |

A caller depends on `IPasswordHasher` only, and gets an implementation from its composition root:

```ts
import type { IPasswordHasher } from "@enardo/password-hasher";

async function register(passwordHasher: IPasswordHasher, password: string) {
  const passwordHash = await passwordHasher.hash(password);
  // Store passwordHash, never password.
}

async function authenticate(passwordHasher: IPasswordHasher, password: string, passwordHash: string) {
  return passwordHasher.compare(password, passwordHash);
}
```

## Contract

- `hash` resolves to a string to store in place of the password.
- `compare` resolves `true` when given the password the stored string was made from, and `false` for a password the implementation reads as a different one.
- An implementation that reads two different strings as the same password says when in its documentation: one that reads only a prefix of a password says how long, and one that encodes a password says how. A caller that accepts such passwords caps or refuses them.

## Contributing

Run these inside `packages/password-hasher`:

```sh
pnpm format && pnpm lint && pnpm typecheck
```

The package has no tests: an interface has no runtime, and each implementation checks it with `implements` when it typechecks.
