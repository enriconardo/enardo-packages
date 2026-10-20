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
- `compare` resolves `true` when given the password the stored string was made from, and `false` for a password that differs from it within the length the implementation reads.
- An implementation that reads only a prefix of a password says how long in its documentation. Past that length, two passwords that share the prefix match the same hash: a caller that accepts longer passwords caps them.

## Contributing

Run these inside `packages/password-hasher`:

```sh
pnpm format && pnpm lint && pnpm typecheck
```

The package has no tests: an interface has no runtime, and each implementation checks it with `implements` when it typechecks.
