# @enardo/password-hasher

Hashes passwords with Argon2id, on `node:crypto`: no driver, native binary or install script. It needs Node 24.7 or later, and on an older one fails at load.

## Exports

| Export | Meaning |
| --- | --- |
| `createPasswordHasher(options?)` | Creates a `PasswordHasher` |
| `PasswordHasher` | `hash(password)`, `compare(password, hashedPassword)` and `needsRehash(hashedPassword)` |
| `PasswordHasherOptions` | `memoryKiB`, `passes` |
| `InvalidPasswordError` | What `hash` rejects with for a password it refuses, with its `code` |

The composition root creates the hasher, and domain code depends on the interface alone:

```ts
import { createPasswordHasher } from "@enardo/password-hasher";

const passwordHasher = createPasswordHasher();
```

```ts
import type { PasswordHasher } from "@enardo/password-hasher";

async function register(passwordHasher: PasswordHasher, password: string) {
  const passwordHash = await passwordHasher.hash(password);
  // Store passwordHash, never password.
}
```

## Options

| Option | Range | Default |
| --- | --- | --- |
| `memoryKiB` | 8 to 1048576 (1 GiB) | 65536 (64 MiB) |
| `passes` | 1 to 16 | 3 |

`createPasswordHasher` throws a `RangeError` for a value out of range or not an integer, so a bad one stops the app at startup and not at its first login. New hashes always use a parallelism of 1. The defaults take about 150 ms on the machine they were measured on: measure yours.

**Costs below the defaults are for tests.**

**Peak memory** is `memoryKiB` times `UV_THREADPOOL_SIZE` (4 by default), so about 256 MiB plus the process at the defaults. An overrun gets the process killed, which no `catch` sees. The 1 GiB cap stops a corrupt value, and is no sizing advice: a smaller machine can still be killed below it.

Hashes run on libuv's pool, which `fs` and `dns.lookup` share: a burst of logins delays them.

## Behavior

### `hash`

Resolves to a string to store. The derive runs off the main thread.

### `compare`

Derives with the `m`, `t`, `p`, salt and tag length that the stored string holds, not the hasher's, and compares in constant time. It resolves `false` for a wrong password, and for a password `hash` would refuse. It reads the hash first, so an unreadable one rejects whatever the password.

### `needsRehash`

`true` when the stored `m`, `t` or `p` differ from the hasher's, up or down: lowering a cost is also a decision to apply.

## Passwords

- Every byte of a password counts, up to the maximum, and a NUL is a byte like any other.
- A password is normalized to NFC before hashing and comparing: `café` matches however a device composes it. A password holding a code point unassigned in the runtime's ICU may normalize differently after a Node upgrade, and then stop matching.
- An empty password hashes: a minimum length, and any other policy, is the caller's.
- `hash` and `compare` take strings: on input that is not yet validated, the caller checks the type. Other values are unsupported, and most reject with an incidental `TypeError`.

`hash` refuses two kinds of password, which a client can send, with an `InvalidPasswordError`. Its `code` says which; it has no `details`, and never holds the password.

| `code` | Password |
| --- | --- |
| `PASSWORD_TOO_LONG` | Over 1024 UTF-16 code units. The check comes first, since normalizing a long string can stall the event loop |
| `PASSWORD_MALFORMED` | Holds a lone surrogate, which would otherwise match the same hash as U+FFFD |

## Errors

Recognize a refused password by its `code`. An unreadable hash and a bad option are native errors, to fix and not to answer a client with:

```ts
import { isBaseErrorLike } from "@enardo/errors";

try {
  await passwordHasher.hash(password);
} catch (error) {
  if (isBaseErrorLike(error) && error.code === "PASSWORD_TOO_LONG") {
    // Answer the client.
  }
  throw error;
}
```

| Error | When |
| --- | --- |
| `InvalidPasswordError` | `hash` refuses the password |
| `TypeError` | `compare` or `needsRehash` cannot read the stored string. A hash of another algorithm or a corrupt row is a fault, which `false` would report as a wrong password. The message never holds the hash |
| `RangeError` | `createPasswordHasher` gets an option out of range |

## The hash format

The PHC string format, which other Argon2 libraries read:

```
$argon2id$v=19$m=65536,t=3,p=1$<salt>$<tag>
```

New hashes have a salt of 16 bytes and a tag of 32. Salt and tag are unpadded standard base64.

The parser is strict: this exact shape, integers without a leading zero, base64 that re-encodes to the same text, and no `keyid` or `data`. It takes `m` up to 1048576 and at least `8 * p`, `t` from 1 to 16, `p` from 1 to 16, a salt of 8 to 64 bytes and a tag of 4 to 64. A large `m` would otherwise get the process killed. A hash outside these limits throws, loudly.

**Another library must normalize too.** A hash of ours verifies there only on the NFC form of the password, and a hash it made from an NFD password does not verify here.

## Rehashing at login

Raising a cost reaches the stored hashes only when a password is at hand:

```ts
if (await passwordHasher.compare(password, stored)) {
  if (passwordHasher.needsRehash(stored)) {
    await saveHash(userId, await passwordHasher.hash(password));
  }
  // Logged in.
}
```

## Moving from another algorithm

`compare` throws on a hash of another algorithm. The app checks the prefix of the stored hash, verifies it with its old code while it migrates, and stores a new hash at the next login:

```ts
const valid = stored.startsWith("$argon2id$")
  ? await passwordHasher.compare(password, stored)
  : await verifyWithOldCode(password, stored);
```

## Contributing

Run these inside `packages/password-hasher`:

```sh
pnpm format && pnpm lint && pnpm typecheck && pnpm test
```
