---
status: draft
type: feature
tier: L
implementer: opus/high
packages: ["@enardo/password-hasher", "@enardo/password-hasher-bcrypt", repo]
branch: feature/password-hasher/argon2id-single-package
---

# Hash passwords with Argon2id on `node:crypto`, in one package

## Why

From the backlog item on `BcryptPasswordHasher` and a discussion with the user (2026-11-02 and 03). The item asks what to do about bcrypt's 72-byte limit and its lone surrogates. OWASP's Password Storage Cheat Sheet puts Argon2id first and keeps bcrypt for legacy systems where Argon2 and scrypt are not available, so the user chose to change the algorithm rather than patch the adapter.

Node has had Argon2 in `node:crypto` since 24.7. With no driver for the app to provide, the root `CLAUDE.md`'s rule asks for one package named for its role, until a second implementation or a driver calls for a split. The split of 2026-10-20 bought a contract installed without its driver: with no driver, that benefit holds in one package.

The user states there are no real consumers yet, so breaking changes carry no migration here.

## Probes

Throwaway `node:24-bookworm` (Node 24.21.0, OpenSSL 3.5.8) unless stated; `argon2` 0.45.2 and `@node-rs/argon2` 2.2.2 installed there only.

- `crypto.argon2` on Node 24.21.0 and 24.22.1 (alpine): a function. On 22.23.4 it is undefined, and an ESM `import { argon2 } from "node:crypto"` fails at load with `SyntaxError: ... does not provide an export named 'argon2'`.
- The docs of Node 24.x and 26.x show `Added in: v24.7.0`, no `Stability:` line on the function, and `Stability: 2 - Stable` on the module. No `ExperimentalWarning` in the runs.
- `m=64 MiB, t=3, p=1`: 137 to 165 ms. Eight at once: 414 ms, on the 4 threads of the default pool, so at most about 256 MiB at a time. With `m=128 MiB, t=3`, a 5 ms timer ticked 73 times during a 379 ms hash: `crypto.argon2` itself leaves the main thread free. Peak memory is `m` times the threads of the libuv pool: maxRSS 306 MiB against 50 at rest, for eight concurrent hashes (the `critic`'s run).
- Cost of the derive by password length at those parameters: 1 kB 139 ms, 1 MB 143 ms, 10 MB 172 ms, 100 MB 615 ms.
- **`normalize("NFC")` runs on the main thread, and is quadratic on alternating combining marks** (U+0301, U+0323; dev container, Node 24.21.0, ICU 78.3): 1024 code units 0.34 ms, 2048 1.32 ms, 8192 22.75 ms, 51 200 (a 100 KiB JSON body of those marks, at two UTF-8 bytes each) 833 ms, with `isWellFormed`. Other shapes at 1024 units (Hangul jamo, one repeated mark, NFD Latin): 0.02 ms. One MiB of ASCII: 8.49 ms.
- A password's every byte counts: 1000-byte passwords differing in the last byte, and `"a\0b"` against `"a\0c"`, derive different keys. Lone surrogates still collide with each other and with U+FFFD. NFC and NFD forms differ. `""` derives a key. `normalize("NFC")` leaves a lone surrogate in place, and maps NFD `café` to NFC.
- Interop: a PHC string built from `node:crypto` output verifies with `argon2` and `@node-rs/argon2` (right password `true`, wrong `false`). Hashes of both libraries, `p=1` and `p=4`, re-derive to the same tag with `node:crypto`. Those passwords are NFC: with normalization, a hash that another library made from an NFD password does not verify here, and a hash of ours verifies there only on the NFC form (reasoned from the NFC and NFD probe, not run).
- `argon2`'s `needsRehash` answers `true` when `m`, `t` or `p` differ, up or down, and `false` when all are equal. Its `verify` answers `false` on a bcrypt hash.
- Bad parameters give a `RangeError`, `ERR_OUT_OF_RANGE`, before any work: `memory` 7 or 1.5, `passes` 0, `parallelism` 0, `nonce` of 7 bytes, `tagLength` 3, `memory` under `8 * parallelism`, `memory` 2^32.
- **A large `memory` in range is not an error.** With `--memory=2g`: `m=1 GiB` passes (`t=1` 1595 ms, `t=4` 3460 ms); `m=4 GiB` and `m=2^32-1` get the process killed (exit 137), which no `catch` sees. On the machine's own limit, too, `m=2^32-1` was `Killed`.
- `Buffer.from(s, "base64")` accepts garbage (`"!!!not base64###"` decodes to 6 bytes). `timingSafeEqual` on different lengths throws a `RangeError`.
- Dev container, on `@enardo/password-hasher-bcrypt`'s config: `"x".isWellFormed()` fails with `TS2550` under `lib: ["ES2022"]` of `library.json`. `promisify(argon2)` compiles under `lib: ["ES2024"]` and gives `Promise<Buffer>`.
- Registry, on the host: `@enardo/password-hasher` has 1.0.0 and 2.0.0, `@enardo/password-hasher-bcrypt` has 1.0.0. Nothing in this repo depends on either package (`git grep`).
- `git grep` names bcrypt outside the two packages and frozen specs at: root `CLAUDE.md:34` and `:54`, `pnpm-workspace.yaml:4`, `docs/backlog.md`, ADR 0013 (accepted, not edited), `.claude/skills/arch-review/SKILL.md:57` (an example of an audit's output, still true).
- No package declares `engines` today. `createLogger` of `@enardo/logger` is the precedent for a factory that hides its technology. The code below is new (`git grep` on `WELL_FORMED`, `InvalidPassword`).

Fixtures made with `argon2` 0.45.2, for the test cases:

| Password | Hash |
| --- | --- |
| `P@ssword123` | `$argon2id$v=19$m=1024,t=1,p=1$Pt1RAjrZoLbGkgAzMx50AQ$t0+r5GK5fEH7yWcUkRng8o5I73owQxp4dIGyttHBTlA` |
| `P@ssword123` | `$argon2id$v=19$m=1024,t=2,p=2$uNgbAqSpLM/meHf2XJLR5g$kCOc5cQXqWVZJAa69UqZzeCa550V5vTNOlQZHoqquss` |
| `P@ssword123` (16-byte tag) | `$argon2id$v=19$m=1024,t=1,p=1$nKmutj2bbZz+v+FVa2MxWw$fl27dxNMjDWIONGgOjXOyA` |
| `café` (NFC) | `$argon2id$v=19$m=1024,t=1,p=1$j5fUHlX0a4XftdkQfmZgQQ$Xu4rqQ4fEZciUHlmy627xkyJdvmOnqCBfvX5TpFIcNs` |
| `"a".repeat(100)` | `$argon2id$v=19$m=1024,t=1,p=1$p/Zre/2BHtEnIJm+TY2Kug$uwPoXdIK5v/j1FaA13EIltaJD1r6JK83h5yCozaM9H8` |

## Decisions

Taken with the user:

1. **`node:crypto`, not the `argon2` package.** No driver, native binary or install script; `engines` asks for Node `>=24.7`. The cost is the PHC encoding and parsing, about 40 lines of ours. Not taken: `argon2` as a dependency of one package, or as a driver in an adapter.
2. **`needsRehash(hashedPassword)` joins the interface.** Without it, a raised cost never reaches the stored hashes.
3. **`compare` throws a native error on a hash it cannot read**, rather than resolving `false`. A leftover bcrypt hash or a corrupt row is a fault to fix, and `false` would report it as a wrong password. `needsRehash` does the same.
4. **`hash` refuses a password that is not well-formed**, kept after the `critic` objected that no harm is shown: with decision 17's error class it adds one code and one check. Whether a maximum length is needed was left to the probes: with NFC it is (decision 17).
5. **`@enardo/password-hasher-bcrypt` leaves the repo, and the registry** after the merge (*Out of scope*), for tidiness: `@enardo/password-hasher` 1.0.0 stays there, with `bcrypt` as a peer. The backlog item moves to *Dropped*.
6. **Defaults `m=64 MiB, t=3, p=1`**, above OWASP's minimums, about 150 ms here.
7. **`IPasswordHasher` becomes `PasswordHasher`** in this major.
18. **Passwords are normalized to NFC before hashing and comparing**, as NIST SP 800-63B-4 asks (`SHOULD`): `café` matches however a device composes it, and with no stored hashes it costs nothing now, while later it would invalidate hashes of non-NFC passwords. With plain `normalize("NFC")`, not NIST's process for stabilized strings, which refuses unassigned code points (*Risks*).

Taken here, following from those and the repo's rules:

8. **`createPasswordHasher(options?)`**, returning a `PasswordHasher`, as `createLogger` does. The name hides the technology; the interface stays, so that domain code imports it with `import type` and tests can fake it. Options: `memoryKiB`, `passes`. New hashes always use `p=1`; a stored hash's `p` is read.
9. **`InvalidPasswordError`, codes `PASSWORD_MALFORMED` and `PASSWORD_TOO_LONG`, extends `BaseError`**: a client can send either (a JSON `"\ud800"`, a long body), so the caller handles them by `code` (ADR 0012, point 6). It carries no `details`, and never the password. The package gains `@enardo/errors` as a dependency.
10. **`compare` resolves `false` for a password `hash` would refuse**, without throwing: `hash` could not have made a hash from it, and otherwise `compare("pw\uD800", hash("pw�"))` is `true`. The hash is read first, so an unreadable one throws whatever the password.
11. **Caps on what a hash may ask for**: `m` at most 1 GiB, `t` at most 16, `p` at most 16, salt 8 to 64 bytes, tag 4 to 64 bytes. An `m` read from a stored string can kill the process with no error (*Probes*). The options take the same caps on `memoryKiB` and `passes`, with Node's minimums (8, 1). A smaller machine can still be killed at 1 GiB: the cap stops a corrupt value, it is no sizing advice.
12. **The parser is strict**: the exact shape `$argon2id$v=19$m=<int>,t=<int>,p=<int>$<salt>$<tag>`, integers without a leading zero, unpadded standard base64 that re-encodes to the same text. No `keyid`, no `data`.
13. **`needsRehash` is `true` when `m`, `t` or `p` differ from the hasher's, up or down**, as `argon2`'s does: lowering a cost is also a decision to apply.
14. **Options are checked when the hasher is created**, with a `RangeError`, so a bad value stops the app at startup and not at its first login.
15. **`lib: ["ES2024"]` in the package's `tsconfig.json`**, with a comment, for `isWellFormed`: one package needs it, so no preset changes (ADR 0011).
16. **An ADR** records the choice of `node:crypto` and the single package: `docs/adr/0016-*.md`, in this spec's commit.
17. **A maximum of 1024 UTF-16 code units, checked on `password.length` before `normalize`**, so that no request can stall the event loop (*Probes*: under 1 ms at the maximum). It stays above NIST's 64 characters even at two units each. NFC (decision 18) is what calls for it.

## Open questions

None.

## Changes

### `@enardo/password-hasher` 3.0.0

- `src/password-hasher.interface.ts`: `PasswordHasher`, with `hash`, `compare` and `needsRehash(hashedPassword): boolean`. JSDoc states the behaviors below.
- `src/create-password-hasher.ts`: `createPasswordHasher` and `PasswordHasherOptions`.
  - `hash`: refuses a password over the maximum, then one that is not well-formed; normalizes to NFC; a random 16-byte salt, a 32-byte tag; resolves to the PHC string.
  - `compare`: reads the hash; `false` for a password `hash` would refuse; normalizes; derives with the hash's `m`, `t`, `p` and tag length; `timingSafeEqual`.
- `src/argon2id-hash.ts`: internal, encodes and parses the string and holds the caps. Its error message never holds the hash.
- `src/errors/invalid-password.error.ts`.
- `src/index.ts`: exports `createPasswordHasher`, `PasswordHasher`, `PasswordHasherOptions`, `InvalidPasswordError`.
- `package.json`: version `3.0.0`, description, `"engines": { "node": ">=24.7" }`, `dependencies` on `@enardo/errors`; `@types/node` and `vitest` in `devDependencies`; `test` and `test:watch`; lint and format over `src __tests__`.
- `tsconfig.json`: decision 15. `vitest.config.ts`: as the bcrypt adapter's.
- `README.md`, rewritten: the API, the options and their caps, peak memory (`memoryKiB` times `UV_THREADPOOL_SIZE`, 4 by default), the hash format and that another library must normalize too, what is refused and how to tell the errors apart, Node `>=24.7`, rehashing at login, and moving from another algorithm (the app checks the prefix of a stored hash and verifies it with the old code). It warns that costs below the defaults are for tests.

### Repo

- `packages/password-hasher-bcrypt`: removed.
- `pnpm-workspace.yaml`: `bcrypt` leaves `allowBuilds`. `pnpm-lock.yaml`: `pnpm install` in the dev container; `bcrypt` and `@types/bcrypt` leave it.
- Root `CLAUDE.md`: line 34 names `mongodb-memory-server` alone as the native module, line 54 drops `bcrypt` from the drivers.
- `docs/adr/README.md`: the row of ADR 0016. Its status goes to `accepted` at the merge.
- `docs/backlog.md`, in a commit of its own: the bcrypt item moves to *Dropped*, with the reason; `IPasswordHasher` leaves the `I` prefix item.

## Test cases

In `packages/password-hasher/__tests__/`, with `{ memoryKiB: 8, passes: 1 }` unless stated. "Unreadable" means rejected with a `TypeError` whose message does not hold the hash.

1. Default options: `hash("pw")` matches `^\$argon2id\$v=19\$m=65536,t=3,p=1\$` with a salt of 16 bytes and a tag of 32.
2. Options `{ memoryKiB: 16, passes: 2 }`: the string holds `m=16,t=2,p=1`.
3. Two `hash("pw")` give different strings.
4. `compare` of the right password `true`, of another `false`.
5. Every byte counts: `"a".repeat(72) + "X"` against `… + "Y"`, and `"a".repeat(999) + "X"` against `… + "Y"`, `false`; `"a\0b"` against `"a\0c"` and against `"a"`, `false`.
6. An empty password hashes and compares `true`: the policy is the caller's.
7. Each fixture compares `true` with its password and `false` with `"P@ssword124"`, on a hasher with default options: `p=2`, `t=2` and the 16-byte tag fail on an implementation that uses its own parameters.
8. `hash("pw\uD800")` and `hash("pw\uDC00")` reject with `InvalidPasswordError`, `code` `PASSWORD_MALFORMED`, recognized by `isBaseErrorLike`; its `toJSON()` holds no `pw`.
9. A valid pair is accepted: `hash("pw😀")` compares `true`, and `hash("pw�")` compares `true`.
10. `compare("pw\uD800", hash("pw�"))` and `compare("pw\uDC00", …)` resolve `false`, with no throw.
11. `compare("café", <the café fixture>)` is `true`: NFD against a hash of NFC.
12. `hash("café")` compares `true` with `"café"`, and the reverse.
13. `compare` on each of these is unreadable, and so is `needsRehash`, which throws: `$2b$04$K3jkotAxEI6VAxGGMsYVBua0nImI9fCxSsOQhpjcvi0DKZ/zmbUWS`; `""`; a fixture with `argon2i`, with `argon2d`, with `v=16`, with no `v`; with a part missing; with a trailing newline; with a salt or tag in `!!!`; with `=` padding; with non-canonical base64 (the last character changed so that it decodes to the same bytes); with `m=0`, `m=01024`; with `keyid=abc` among the parameters.
14. `compare` with a password that is not well-formed on the bcrypt hash is unreadable: the hash is read first.
15. Caps, on the parser: `m=1048576`, `t=16`, `p=16` and a salt and a tag of 64 bytes parse; `m=1048577`, `t=17`, `p=17`, `m` under `8 * p`, a salt of 7 or 65 bytes and a tag of 3 or 65 bytes do not.
16. `compare` on a fixture with `m=4294967295` is unreadable: the case ends, and the process lives.
17. `needsRehash`: `false` on the hasher's own hash; `true` for `m` higher and lower, `t` higher and lower, and `p=2` on a hasher with that fixture's `m` and `t`.
18. `createPasswordHasher` throws a `RangeError` for `memoryKiB` 0, 7, 1.5, `NaN` and 1048577, and `passes` 0, 1.5 and 17; it accepts `memoryKiB` 8 and `passes` 1. It throws at the call, not at the first `hash`.
19. With default options, a 1 ms timer ticks at least once during `hash`: `argon2Sync` fails it.
20. The maximum: `hash("a".repeat(1024))` compares `true`; `hash("a".repeat(1025))` rejects with `InvalidPasswordError`, `code` `PASSWORD_TOO_LONG`, and its `toJSON()` holds no run of `a`; 512 `😀` (1024 units) are accepted; `compare("a".repeat(1025), <a fixture>)` resolves `false`, and an unreadable hash with that password still rejects.
21. With a spy on `String.prototype.normalize` and `"x" + "̣́".repeat(50000)`: `hash` rejects with `PASSWORD_TOO_LONG` and `compare` on a fixture resolves `false`, and neither calls `normalize` on it. An implementation that normalizes first passes case 20 and fails this one.

Without a case in the suite, with the reason:

- The other direction of the interop, a hash of ours read by `argon2`: the suite would need that package. The implementation runs it once in a throwaway container, with a real `hash` output, and reports it.
- Loading on Node 22: probed, and the suite runs on one Node.
- The packed manifest: `pack` in the dev container, then check that it has `engines` and `@enardo/errors`, with no `bcrypt`.

No existing test sends these inputs: the only tests are the adapter's, which leave with it.

## Risks

- **A mistake in the parser or the comparison weakens or blocks every login.** Shown by cases 4, 7 and 13 and the interop in both directions, which rests on a second implementation rather than on our own output.
- **`crypto.argon2` needs a Node built with an OpenSSL that has it.** A build with a shared, older OpenSSL is not probed. It would fail at the first `hash`, not silently.
- **An unknown cost on another machine.** 150 ms here is one measure; the options exist for that, and `needsRehash` applies a change.
- **Too small a cap would refuse a legitimate hash of the future.** It throws, loudly, and a minor raises it.
- **Memory.** The defaults peak at about 256 MiB plus the process on the default pool, and raising `memoryKiB` or `UV_THREADPOOL_SIZE` multiplies it. An overrun is a kill, which no `catch` sees: the README says so.
- **A password holding a code point unassigned in this ICU** may normalize differently after a Node upgrade, and then stop matching. It takes a character that no current keyboard produces, and a reset fixes it.

## Out of scope

- **The registry**, in a session of its own after the merge (root `CLAUDE.md`, *Workflow*, step 5), each step approved by the user: publishing `@enardo/password-hasher` 3.0.0, and unpublishing `@enardo/password-hasher-bcrypt`, once `unpublish` is probed on a local Verdaccio.
- A pepper (`secret` of `crypto.argon2`), and a helper that migrates from bcrypt.
- `@enardo/id-generator`'s split: its adapter has a driver.
- Any password policy other than the refusals above: a minimum length is the caller's.

## Plan

1. **The hasher, test-first** (the `test-author`, cases 1 to 21): interface, parser, factory, error, manifest, `tsconfig.json`. Green with `pnpm --filter @enardo/password-hasher test`.
2. **The README**, and the interop run in a throwaway container.
3. **The removal of the adapter**: the package, `allowBuilds`, the lockfile, `CLAUDE.md`. Green with `pnpm verify`.
4. **The backlog**, in a commit of its own.
5. The reviewer's rounds and checkpoint 2, as the `implement` skill says.
