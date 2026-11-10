# 0016. Passwords are hashed with Argon2id on `node:crypto`, in one package

- Status: accepted
- Date: 2026-11-03
- Spec: `git show 3dedb3e:docs/specs/2026-11-03-argon2id-single-package.md` (removed from the tree)

## Context

`@enardo/password-hasher` was a contract with one implementation, `@enardo/password-hasher-bcrypt`, split on 2026-10-20 so that the contract installs without the `bcrypt` driver. bcrypt reads only the first 72 bytes of a password, and OWASP keeps it for legacy systems where Argon2 and scrypt are not available.

Node has had `crypto.argon2` since 24.7. It returns raw bytes: the string to store, with its parameters, is the caller's to build. The `argon2` package builds it and offers `needsRehash`, at the cost of a native binary and an install script. An `m` read from a stored string can get the process killed, with no error to catch.

## Decision

1. **Passwords are hashed with Argon2id, through `node:crypto`.** The package has no driver, and declares `engines` on Node `>=24.7`.
2. **One package, named for its role.** `@enardo/password-hasher` exports `createPasswordHasher` and the `PasswordHasher` interface: domain code still depends on the interface alone, with `import type`. The rule of the root `CLAUDE.md` applies: no second implementation, and no driver the app must provide.
3. **Hashes are stored in the PHC string format**, which other Argon2 libraries read, given a password normalized the same way, and parsed strictly, with caps on the costs a string may ask for.

## Consequences

- The package holds about 40 lines of encoding and parsing that a library would hold. Tests pin them against hashes made by the `argon2` package.
- Consumers need Node 24.7 or later. On an older one the package fails at load.
- `@enardo/password-hasher-bcrypt` is removed. An app with bcrypt hashes keeps its own bcrypt code while it migrates.
- A second implementation, or an algorithm that needs a driver, splits the package again.

## Alternatives considered

- **Keep bcrypt, and refuse longer passwords.** It closes the truncation, not the preference for a memory-hard algorithm.
- **The `argon2` package, as a dependency of one package.** Less code of ours, but every package that imports the interface installs a native binary.
- **The `argon2` package, as a driver in an adapter.** It keeps the split, and the cost of two packages and a peer, for a driver `node:crypto` makes unnecessary.
