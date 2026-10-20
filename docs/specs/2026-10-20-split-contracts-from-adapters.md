---
status: draft
type: refactor
packages: ["@enardo/password-hasher", "@enardo/password-hasher-bcrypt", "@enardo/id-generator", "@enardo/id-generator-mongo", repo]
branch: refactor/repo/split-contracts-from-adapters
---

# Split `password-hasher` and `id-generator` into contracts and adapters

## Why

The item `refactor/repo/split-contracts-from-adapters` of `docs/backlog.md`, from the spec of `chore/repo/adapter-drivers`, queued by the user at its checkpoint 2 (2026-10-13).

Each package holds a contract with its only implementation: `@enardo/password-hasher` exports `IPasswordHasher` and `BcryptPasswordHasher`, with `bcrypt` as a peer; `@enardo/id-generator` exports `IdGenerator` and `ObjectIdGenerator`, with `mongodb` as a peer. The root `CLAUDE.md` asks for two packages: a contract that never depends on a technology, and a `<name>-<technology>` package that implements it.

The rule is what drives the task: no consumer pays for the merged packages today.

- A package that needs only the interface gets the driver's peer along with it. Cambusa's bounded contexts import the interfaces with `import type`, and only the api-server's composition root creates the classes.
- The one symptom seen is a deploy with `autoInstallPeers` off, which reports `@cambusa/identity` missing `bcrypt` (probed by the second review of `chore/repo/adapter-drivers`). Cambusa installs with `autoInstallPeers: true`, and has no production deploy yet.
- For `id-generator`, the split removes no dependency on `mongodb` from Cambusa: every bounded context lists `mongodb` itself, and stores its ids as `ObjectId`s (`new ObjectId(id.toString())`), so it relies on the adapter's id format.

What the split buys is the rule's: a contract that an app installs without the driver (either package installed alone reports its driver missing today, *Probes*), and a contract and an adapter developed and tested apart, as packages of their own repositories would be. It costs two packages of one class each, and no new code.

## Probes

On `main` (`d1d6f55`), in the dev container (Node 24.21.0, pnpm 11.1.3, bcrypt 5.1.1), after `pnpm exec turbo run build --filter=@enardo/password-hasher... --filter=@enardo/id-generator... --filter=@enardo/email-nodemailer... --force`. The install probes ran in a throwaway `node:24-bookworm` container with pnpm 11.1.3, the repo mounted read-only.

- Nothing in this repo depends on either package: outside frozen specs, `git grep` finds them only in `docs/backlog.md`.
- In Cambusa (`7cc4c1e`), `apps/api-server/src/composition-root.ts` imports `BcryptPasswordHasher` and `ObjectIdGenerator`, and the api-server lists `bcrypt` and `mongodb` in its `dependencies`. `identity` imports `IPasswordHasher` and `IdGenerator`, while `catalog`, `collaboration` and `shopping` import `IdGenerator`, all with `import type`. Cambusa's backlog already holds the move to the new packages, under *Work that `enardo-packages` hands over*.
- `pnpm pack` of each package, `pnpm add <tarball> --config.auto-install-peers=false` in an empty project, then `pnpm peers check` → `✕ missing peer bcrypt` (`^5.1.1`, wanted by `@enardo/password-hasher@1.0.0`) and `✕ missing peer mongodb` (`^7.5.0`, wanted by `@enardo/id-generator@1.0.0`).
- `dist/index.mjs` of `password-hasher` imports `bcrypt`, and that of `id-generator` imports `mongodb`. Both `dist/index.d.mts` import nothing, since they declare the interface and the class in the same file (`declare class BcryptPasswordHasher implements IPasswordHasher`).
- A contract of types only builds to an empty module: the `dist/index.mjs` of `@enardo/email` is `export {  };`. The `dist/index.d.mts` of `@enardo/email-nodemailer` imports `EmailSender` and the other types from `@enardo/email`, while its `dist/index.mjs` does not: an adapter needs its contract for its types only, not at runtime.
- `tsc --noEmit --strict --target es2022 --typeRoots /nonexistent` on `password-hasher.interface.ts` and on `id-generator.ts` → exit 0: the interfaces need only the ES lib, and no `@types/node`.
- `eslint src __nonexistent` and `prettier --check src __nonexistent` → exit 2, "No files matching the pattern": a package without `__tests__` lints and formats `src` alone.
- bcrypt 5.1.1 reads only the first 72 bytes of a password. The hash of 72 `a` followed by an `X` compares `true` against the 72 `a`. The hash of 36 `é` (72 bytes in UTF-8) followed by a `Y` compares `true` against the 36 `é`. The hash of 71 `a` and an `X` compares `false` against 71 `a` and a `Y`.
- Cambusa's lockfile sets `autoInstallPeers: true`. Its routes take a password as `z.string().min(1)` (`packages/api-contracts/src/routes/auth/register-user.route.ts`, `authenticate-user.route.ts`), with no maximum.

## Decisions

- **Names.** The contracts keep the packages' names, `@enardo/password-hasher` and `@enardo/id-generator`, which the bounded contexts already import. The adapters are `@enardo/password-hasher-bcrypt` and `@enardo/id-generator-mongo`, as the backlog item names them, matching `database-mongo`, `transaction-manager-mongo` and `uow-repository-mongo`, the other adapters on `mongodb`.
  - Not chosen: a peer on `bson`, where `ObjectId` comes from (`mongodb` re-exports it). The api-server and every other Mongo adapter already peer on `mongodb`, so a `bson` peer would add a driver for an app to list, with a version to keep aligned with the one `mongodb` brings.
- **Versions.** Each contract goes to 2.0.0: it loses its class and its peer, a breaking change, and a published version never changes (`publish` skill). Each adapter starts at 1.0.0: its code is that of the published 1.0.0 class, unchanged, and `email-nodemailer` started at 1.0.0 too. Cambusa stays on `^1.0.0` of the old packages until it moves.
- **Symbols and files keep their names.** The adapters do not re-export their contract's interface, as `email-nodemailer` does not re-export `EmailSender`. `IPasswordHasher` keeps its `I`: the repo uses both styles (`IDatabase`, `ITransactionManager`, `IUnitOfWork`; `EmailSender`, `IdGenerator`), and a rename is no part of the split.
- **An adapter depends on its contract** through `dependencies`, `workspace:^`, which packs as `^2.0.0`. `email-nodemailer` does the same with `email`: the adapter's `.d.mts` imports the interface for its `implements`, so a consumer's typecheck needs the contract installed.
- **A contract's manifest** is `@enardo/email`'s without its test tooling and without `@types/node`. Nothing in a contract runs, so it has no tests: no `vitest`, no `test` or `test:watch` script, no `vitest.config.ts`, and `lint` and `format` cover `src` alone. It has no `dependencies` and no `peerDependencies`.
- **An adapter's manifest** is today's manifest of the package it comes from, renamed, plus the dependency on its contract. The driver stays a peer and a dev dependency with today's ranges.
- **Not test-first, no `test-author`.** The split adds or changes no behavior: each test file moves with the class it tests, unchanged, since it imports through `~/` and the source files keep their names (root `CLAUDE.md`: refactors keep the existing tests unchanged). Each adapter's `implements` checks its contract at typecheck. What the split changes, which package depends on what, is a property of the packed packages, which checks 6 to 9 test by hand (*Test cases*). Its automated form is the manifest check of *To evaluate*.
  - The bcrypt adapter's README starts documenting a behavior it already has, the 72-byte limit, and cases 4 and 5 pin it. They describe today's behavior, so they pass at once: they have no failing first state for a `test-author` to write. They fail when a bcrypt upgrade changes the limit, and the README with it.
- **READMEs.** Neither package has one today. The split makes two packages a consumer has to choose between, so each of the four gets a short README, and the interfaces and classes get JSDoc (root `CLAUDE.md`: JSDoc on the public API).
  - A contract's README says what a caller may rely on and what an implementation must do, without naming the adapter.
  - An adapter's README names its contract and its driver, which the app installs beside it, and documents the constructor. For bcrypt, it also documents the 72-byte limit.
  - Not chosen: no READMEs, as today. A consumer would then learn about the driver only from the manifest, or from pnpm's warning.
- **No ADR.** Each decision follows from rules already recorded: the ports-and-adapters rule of the root `CLAUDE.md`, and the version rule of the `publish` skill.

## Changes

### `@enardo/password-hasher` 2.0.0, the contract

- `src/bcrypt.password-hasher.ts` and `__tests__/bcrypt.password-hasher.test.ts` move to `password-hasher-bcrypt` (`git mv`). `src/index.ts` exports `IPasswordHasher` only.
- `package.json`: version `2.0.0`; description "Password hasher contract."; no `peerDependencies`; `bcrypt`, `@types/bcrypt`, `@types/node` and `vitest` leave `devDependencies`; `test` and `test:watch` leave `scripts`, and `lint`, `lint:fix`, `format` and `format:check` cover `src` alone. `vitest.config.ts` is removed.
- JSDoc on `IPasswordHasher`.
- `README.md`, new. `hash` resolves to a string to store in place of the password. `compare` resolves `true` when given the password that string was made from, and `false` for a password that differs from it within the length the implementation reads. An implementation that reads only a prefix of a password says how long in its documentation, and a caller that accepts longer passwords caps them. Implementations live in their own packages.

### `@enardo/password-hasher-bcrypt` 1.0.0, new

- `src/bcrypt.password-hasher.ts`, moved: it imports `IPasswordHasher` from `@enardo/password-hasher`, with `import type`. `src/index.ts` exports `BcryptPasswordHasher`.
- `__tests__/bcrypt.password-hasher.test.ts`, moved unchanged, then given cases 4 and 5.
- `package.json`: today's manifest of `password-hasher`, with the name `@enardo/password-hasher-bcrypt`, version `1.0.0`, the description "bcrypt adapter for @enardo/password-hasher.", and `"dependencies": { "@enardo/password-hasher": "workspace:^" }`. `tsconfig.json`, `eslint.config.js` and `vitest.config.ts` are copies of today's.
- JSDoc on `BcryptPasswordHasher` and on its `saltRounds` (default 12).
- `README.md`, new: the app installs `bcrypt` `^5.1.1` beside the package; `saltRounds`; bcrypt reads only the first 72 bytes of a password, in UTF-8.

### `@enardo/id-generator` 2.0.0 and `@enardo/id-generator-mongo` 1.0.0

The same split:

- `IdGenerator` (`src/id-generator.ts`) stays in the contract, described as "ID generator contract.". Its README says that `generate` returns a new id at each call, which no other call returns, and that the id's format is the implementation's: a caller that relies on a format, for instance to store ids as another type, depends on the implementation, not on the contract.
- `ObjectIdGenerator` (`src/object-id.id-generator.ts`) and its test (`__tests__/object-id-generator.test.ts`) move to the adapter, described as "MongoDB ObjectId adapter for @enardo/id-generator.". `mongodb` stays its peer (`^7.5.0`) and dev dependency (`^7.6.0`). Its README says that an id is the hex string of a new `ObjectId`, 24 lowercase hex characters.

### Repo

- `pnpm-lock.yaml`, from `pnpm install`.
- `docs/backlog.md`:
  - In the `pnpm audit` item, "the paths through `password-hasher`" becomes "the paths through `password-hasher-bcrypt`". The `tar` path above it stays as it is, since it records `en-monorepo`'s lockfile of 2026-10-14.
  - A new item in *To evaluate*: `BcryptPasswordHasher` reads only the first 72 bytes of a password, and Cambusa caps no password length (its routes take `z.string().min(1)`), so a password longer than 72 bytes is matched by any password with the same first 72 bytes. Options: the adapter rejects a longer password (a behavior change, and a new major), or Cambusa caps the length (Cambusa's repo). From the `critic`'s run on this spec.
  - The item of this task is removed, in a commit of its own.

## Test cases

The existing ones move unchanged:

1. `BcryptPasswordHasher(4)`: the hash of `P@ssword123` differs from it, and `compare` of `P@ssword123` with it resolves `true`.
2. `BcryptPasswordHasher(4)`: `compare("wrong-password", <hash of "correct-password">)` resolves `false`.
3. `ObjectIdGenerator.generate()` returns a match of `/^[a-f0-9]{24}$/`.

Two new ones pin the 72-byte limit the README documents (*Decisions*):

4. `BcryptPasswordHasher(4)` reads the 72nd byte: `compare` of 71 `a` and a `Y` with the hash of 71 `a` and an `X` resolves `false`.
5. `BcryptPasswordHasher(4)` reads no byte past the 72nd, counted in UTF-8: `compare` of 36 `é` (72 bytes) with the hash of 36 `é` and a `Y` resolves `true`. A limit counted in characters would read the `Y`, and resolve `false`.

Checks by hand, after `pnpm exec turbo run build --filter=@enardo/password-hasher-bcrypt... --filter=@enardo/id-generator-mongo... --force` and a `pnpm pack` of the four packages, in a throwaway container as in *Probes*:

6. Each contract's tarball, installed alone with `auto-install-peers=false`: `pnpm peers check` reports no issue (on `main`: `missing peer bcrypt`, `missing peer mongodb`).
7. Each contract's packed `package.json` has no `dependencies` and no `peerDependencies`, and its `dist/index.mjs` imports nothing.
8. In each adapter's packed `package.json`, the contract sits under `dependencies` as `^2.0.0`, and the driver under `peerDependencies` with today's range. Its `dist/index.d.mts` imports the interface from the contract. Its `dist/index.mjs` imports the driver and not the contract.
9. A composition root, as the api-server has. In an empty project, install each adapter's tarball, with its contract resolved from its tarball through an `overrides` entry (the contracts are not published yet; how pnpm 11 takes it is not probed), and its driver. A TypeScript file assigns `new BcryptPasswordHasher()` to a variable of type `IPasswordHasher`, and `new ObjectIdGenerator()` to one of type `IdGenerator`, each type imported from the contract. The file typechecks under `tsc --strict`, and run, it hashes and compares a password and generates an id.

## Out of scope

- Cambusa's move to the new packages: its repo, after the publish, under its own backlog item.
- Publishing the four packages, through the `publish` skill, when the user asks. Each contract goes first: its adapter's `^2.0.0` resolves to nothing until the contract's 2.0.0 is on the registry.
- Renaming `IPasswordHasher`; splitting `@enardo/logger` (*To evaluate*); bcrypt 6 and the `tar` advisories (*To evaluate*, the `pnpm audit` item).

## Plan

Each step ends green and committed. None is test-first (*Decisions*).

1. This spec, the `critic`, checkpoint 1.
2. Split `password-hasher`: `git mv` the class and its test into `password-hasher-bcrypt`, write both manifests and the adapter's configs, run `pnpm install`.
3. Split `id-generator` the same way.
4. Cases 4 and 5.
5. JSDoc and READMEs of the four packages.
6. Checks 6 to 9 by hand.
7. `docs/backlog.md`: the `pnpm audit` line and the new item; then, in a commit of its own, this task's item removed.
8. The `reviewer`, checkpoint 2, integrate.
