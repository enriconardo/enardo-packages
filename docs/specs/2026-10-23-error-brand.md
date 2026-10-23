---
status: draft
type: feature
tier: L
implementer: sonnet/medium
packages: ["@enardo/errors", "@enardo/entities", "@enardo/uow-repository", "@enardo/uow-repository-mongo"]
branch: feature/errors/brand-recognition
---

# Recognize an error of the ecosystem by a brand, and check that its codes are unique

## Why

The backlog item *How the ecosystem recognizes an error: by a brand, not by `BaseError`'s identity*, from the architectural review of `@enardo/cqrs` (2026-10-23) and the discussion that followed it. `error instanceof BaseError` fails silently when an app has two copies of `@enardo/errors`, which every package declares as a `dependency`: an error built on the other copy loses its `code` in `@enardo/cqrs`. The direction was decided with the user in that discussion. ADR 0012, drafted with this spec, records it. This branch carries the parts that `@enardo/errors` and the repo can carry alone: the brand, the guard, the check on codes, and the docs.

## Probes

- A copy of `packages/errors` with the brand set in a static block and a guard, built with its own `tsdown` command, imported twice from two folders (dev container, Node 24.21.0) → `instanceof` with the other copy's `BaseError` `false`, the other copy's guard `true`. The built `index.mjs` keeps the `static` block (target `es2022`, `typescript-config/base.json`).
  - The key's descriptor on the prototype is `{ value: true, writable: false, enumerable: false, configurable: false }`.
  - `Reflect.ownKeys` of an instance has no symbol, `toJSON()` has the keys `code, details, name, message, stack`, and `JSON.stringify` does not hold the key.
  - The guard gives `false` for a native `Error`, for an `Error` with `code: "ECONNREFUSED"`, for a revoked `Proxy` and for a `Proxy` whose `get` throws (in a `try`), and `true` for a subclass of a subclass.
  - From a `vm` context, `e[Symbol.for("@enardo/errors.BaseError")]` on an instance of the main realm gives `true`.
- `vi.resetModules()` and then `await import("~/index")` in a test of `packages/errors` → a second `BaseError`, not `===` to the first, and its instances are not `instanceof` the first.
- `ErrorDetails` takes no array, function or `Date`: assigning `[1, 2]`, `() => 1` and `new Date()` to it is TS2322 (a probe file in `packages/cqrs/src`, `tsc --noEmit`).
- A script run with `node` in the dev container builds a program per package from its `tsconfig.json` (`ts.getParsedCommandLineOfConfigFile`, files under `src/`), and reads each class's `extends` and its own `code` declaration through `checker.getTypeFromTypeNode`, with no package built: `EntityLifecycleError` resolves its alias to `ENTITY_ALREADY_MARKED_FOR_REMOVAL|ENTITY_NOT_MUTABLE`, `BaseError` gives `string`. Node 24.21.0 runs a `.ts` file directly. `typescript` does not resolve from the repo's root (`require.resolve` fails): the root lists only `turbo`.
- The same script lists 22 error classes in `packages/*/src` besides `BaseError`, all names distinct. Concrete ones without a `code` declaration of their own or of an ancestor: `DatabaseError` (`database`); `InvalidEntityIdError` (`entities`); `DuplicateEntityError`, `UnsupportedIdentityError`, `UnitOfWorkAlreadyUsedError`, `DuplicateRecordKeyError`, `InvalidRecordSetError`, `ConcurrencyConflictError` (`uow-repository`); `InvalidDataStoreOptionsError`, `MissingCollectionChangesError` (`uow-repository-mongo`). The others declare one. No literal is declared by two classes.
- `node --test "scripts/*.test.mjs"` in the dev container runs the files the glob matches (a probe in `/tmp`).
- `git grep -n "instanceof BaseError"` → in `src/`, `packages/cqrs/src/command-handler.ts:70` and `query-handler.ts:67` only; in docs, `packages/errors/README.md:44`.
- `wc -c CLAUDE.md` → 11 196 bytes, of the 12 000 that `scripts/check-context-size.sh` allows.
- Versions: `errors` 1.0.0, `entities` 1.1.0, `uow-repository` and `uow-repository-mongo` 0.1.0. A branch bumps the version of the packages it changes (`git log -G'"version"'`).

## Decisions

Taken with the user, in the discussion that followed the review (the backlog item) and at intake:

1. **A brand on the prototype and a guard**, as ADR 0012 points 1–3 say. `@enardo/errors` stays a `dependency`. Rejected: a peer dependency, `Symbol.hasInstance`, a guard on `code` or its prefix (the ADR).
2. **`code` identifies one condition, and `pnpm verify` checks it** (ADR 0012, point 4).
3. **`DatabaseError` stays as it is**, named as the check's one exception, and its form waits for the architectural review of the database packages, which this branch adds to the backlog. No ADR of its own: ADR 0012 names it.
4. **This branch does not change which classes extend `BaseError`, nor `@enardo/cqrs`.** The review of the `BaseError`s that report misuse or misconfiguration goes to the backlog, one branch per package, each a breaking change. `@enardo/cqrs` moves off `instanceof BaseError` in the branch of its own item.

Taken by this spec:

5. **The brand is set in a static block** of `BaseError`, with `Object.defineProperty` on `this.prototype`. A getter with a computed key would put the symbol in the public types; a statement after the class would run apart from it. The symbol is not exported: the guard is the API, and the key's string is the contract the ADR names.
6. **The guard reads `details` as an object, not an array, or `undefined`.** `ErrorDetails` takes no array, so a guard that let one through would claim a type its check does not prove. It does not check the prototype of `details`: an object of another realm has another `Object.prototype`.
7. **The guard catches what a read throws, and returns `false`.** It runs in error handlers, where a throw would replace the error being reported.
8. **The check reads the declarations, not the values passed to `super`**: a code passed through a parameter, as in `EntityLifecycleError`, is only in its type. It therefore needs every concrete class to narrow `code`, which nine classes of three packages do not yet do: they get a `declare readonly code` with the literal their tests already pin. Owner of a literal is the class that declares it; a descendant that declares it again is not a duplicate.
9. **The check is a Node script with tests of its own**: `scripts/check-error-codes.mjs`, with `typescript` from the catalog as a root `devDependency`, and its tests under `node:test` on fixture trees it writes in a temporary folder. No new library. It runs outside turbo, so no cache hides it.

## Open questions

1. **The guard's name.** Proposed: `isBaseErrorLike` and `BaseErrorLike`, after `PromiseLike` and `ArrayLike`: the name says the shape, not the class. Alternatives: `isEnardoError`/`EnardoError`, which says the provenance, though a project's errors pass it too; `isCodedError`/`CodedError`, which says the shape but reads as any error with a `code`, Node's included.

## Changes

### `@enardo/errors` (1.0.0 → 1.1.0)

- `src/base/base-error.ts`: the brand, in a static block of `BaseError`, under `Symbol.for("@enardo/errors.BaseError")`.
- `src/base/is-base-error-like.ts` (new): `isBaseErrorLike`; `BaseErrorLike` in `base-error.types.ts`. Both exported from `src/base/index.ts` and `src/index.ts`.
- `README.md`:
  - the opening says which errors extend `BaseError` (ADR 0012, point 6);
  - *Exports* lists the guard and the interface;
  - *Writing an error* says that `declare readonly code` is required in this repo, that a code belongs to one class and is public API;
  - *Handling an error* recognizes with `isBaseErrorLike`, narrows with a specific class imported from the package that throws it, and says why `instanceof BaseError` is not for recognizing.
- `CLAUDE.md`: the opening line as in the README; an invariant for the brand's key and `BaseErrorLike`, a contract between majors (ADR 0012, point 2); `isBaseErrorLike` in *Layout*.

### `@enardo/entities` (1.1.0 → 1.2.0), `@enardo/uow-repository` and `@enardo/uow-repository-mongo` (0.1.0 → 0.1.1)

- Each class listed in *Probes* gets `declare readonly code: "<its code>";`, with the literal it passes to `super`. A narrower type for readers: a patch below 1.0.0, a minor above.
- `uow-repository/README.md`, *Contributing*: a new error declares its `code`.

### Repo

- `scripts/check-error-codes.mjs` (new). Takes the folder of the packages (default `packages`). For every package with a `src/` and a `tsconfig.json`, it reads the classes under `src/`. An error class is one whose `extends` chain, by class name across packages, reaches `BaseError`. It fails, with every finding on its own line naming the package, the class and the code, when:
  - two error classes share a name (the chain is followed by name);
  - a class declares `code` with a type that is not a string literal or a union of them;
  - a concrete error class finds no such declaration on itself or an ancestor other than `BaseError`, unless it is in the exception list, which holds `DatabaseError` with a comment that points to the backlog item;
  - a literal is declared by two classes, neither an ancestor of the other;
  - a package's `tsconfig.json` cannot be parsed or resolved.

  On success it prints the number of error classes it read.
- `scripts/check-error-codes.test.mjs` (new): the test cases C1–C12, under `node:test`.
- Root `package.json`: `typescript: "catalog:"` in `devDependencies`; scripts `lint:error-codes` (`node scripts/check-error-codes.mjs`) and `test:scripts` (`node --test "scripts/*.test.mjs"`), both in `verify` and `verify:all`, before `turbo`. The lockfile follows.
- Root `CLAUDE.md`: the line on errors states ADR 0012 in short (which errors extend `BaseError`, the declared unique `code`s, `isBaseErrorLike` and never `instanceof BaseError`); `pnpm verify` lists the codes check.
- `docs/adr/0012-errors-recognized-by-a-brand.md`: `accepted` at the merge; the index of `docs/adr/README.md`.
- `docs/backlog.md`:
  - *To evaluate*: the review of the `BaseError`s that report misuse or misconfiguration (`UOW_ALREADY_USED`, `MISSING_COLLECTION_CHANGES`, `UNSUPPORTED_IDENTITY`, `INVALID_DATA_STORE_OPTIONS`, `INVALID_EMAIL_SENDER_OPTIONS`, perhaps `ENV_MISSING` and `ENV_MALFORMED`), against ADR 0012 point 6, one branch per package; and the native throws the item listed, consistent with the rule, need nothing;
  - *To evaluate*: the architectural review of `@enardo/database` and `@enardo/database-mongo`, starting from `DatabaseError`'s free `code`, the check's one exception;
  - *`@enardo/cqrs` sends the message of a native error to the client*: ADR 0012 points 3 and 7 apply; that branch replaces `instanceof BaseError` and adds a lint rule against it in the presets once no use is left;
  - this item leaves, in a commit of its own.

## Test cases

### `isBaseErrorLike` (`packages/errors/__tests__/base/is-base-error-like.test.ts`)

1. An instance of a concrete subclass of `BaseError` → `true`.
2. An instance of a subclass of a concrete subclass → `true`.
3. An instance of a subclass of a second copy of `BaseError` (`vi.resetModules()`, then `import("~/index")`) → `true`, while `instanceof BaseError` of the first copy is `false`.
4. A plain object with `[Symbol.for("@enardo/errors.BaseError")]: true`, `name: "X"`, `code: "X"` → `true`. This pins the key's string, the contract between majors.
5. The same object with `details: undefined`, and with no `details` key → `true`; with `details: { a: 1 }` → `true`.
6. Without the brand → `false`: a native `Error`; an `Error` with `code: "ECONNREFUSED"` and a `name`; a plain object with `name`, `code`, `details`.
7. Not an object → `false`: `null`, `undefined`, `"BaseError"`, `42`, a function carrying the brand key.
8. The brand with a value other than `true` (`1`, `"true"`) → `false`.
9. The brand with a wrong shape → `false`, one case each: `code` a number, `code` missing, `name` a number, `details` `null`, `details` an array, `details` a string.
10. A read that throws → `false`, not a throw: a revoked `Proxy`; an object with the brand whose `code` getter throws.
11. The key on `BaseError.prototype` has the descriptor `{ value: true, writable: false, enumerable: false, configurable: false }`; an instance has no own symbol key; `toJSON()` of an instance has no symbol key, and `JSON.stringify` of it does not contain `@enardo/errors`.

### Types (`packages/errors/__tests__/types.test.ts`)

12. After `if (isBaseErrorLike(value))` on an `unknown`, `value` is `BaseErrorLike`: `value.code` is exactly `string`, `value.details` is `ErrorDetails | undefined`, and `value.toJSON` does not compile.
13. A `BaseError` subclass instance is assignable to `BaseErrorLike`.

### Entry point (`packages/errors/__tests__/index.test.ts`)

14. The runtime exports are exactly `BaseError` and `isBaseErrorLike`. This changes an existing test, as the new export requires.

### The codes check (`scripts/check-error-codes.test.mjs`)

Each case writes a fixture tree of packages (`src/`, a `tsconfig.json`, a stand-in `BaseError`), runs the script on it, and asserts its exit code and that its output names the package, the class and the code.

- C1. Distinct literal codes, each concrete class declaring its own → exit 0.
- C2. Two classes of two packages declaring the same literal → exit 1, both classes and the code named.
- C3. A literal in a union of one class and alone in another (`"A" | "B"` and `"B"`) → exit 1.
- C4. A class and its descendant declaring the same literal → exit 0.
- C5. Concrete subclasses of an abstract class that declares a union, through an alias imported from another file of its package by `~/` → exit 0.
- C6. A concrete class extending `BaseError` with no `code` declaration → exit 1, naming it.
- C7. A class declaring `code: string` → exit 1, naming it.
- C8. A concrete class named `DatabaseError` with no declaration → exit 0.
- C9. An abstract class with no declaration, and no concrete subclass → exit 0.
- C10. A class with a duplicate code under `__tests__/` → exit 0: only `src/` counts.
- C11. Two error classes with the same name in two packages → exit 1, naming them.
- C12. A package whose `tsconfig.json` cannot be parsed or resolved (an `extends` that resolves to nothing) → exit 1, naming it: a package skipped would hide its classes.
- C13. The repo's own `packages/` → exit 0, and the output gives 22 error classes read (`pnpm lint:error-codes`, in `pnpm verify`). Removing one of the declarations of step 3 makes it fail, naming that class: run by hand in step 4, not committed.

## Risks

- **A guard that lets through what it should not, or misses what it should not**: cases 6–10 for the first, 1–5 for the second.
- **The brand in a log**: case 11.
- **A declared literal that differs from the value passed to `super`**: the compiler does not see it, since `BaseErrorOptions.code` is `string`. The existing tests of each class pin the runtime `code`; the review compares the two in step 3.
- **The check passes on a tree it does not read** (a package skipped, a class missed): the script prints the number of error classes it read, which C13 compares with the 22 of *Probes*; C12 makes an unreadable package a failure; C13's manual run shows that a missing declaration in the real tree fails.

## Out of scope

- `@enardo/cqrs` and the lint rule against `instanceof BaseError` (decision 4).
- Turning the `BaseError`s that report misuse or misconfiguration into native errors (decision 4).
- `DatabaseError`'s form (decision 3).
- Running `errors`' tests in browsers: its backlog item.
- Cambusa's errors: its repo follows ADR 0012 when it moves to `@enardo/errors` 1.1.0.

## Plan

1. This spec and ADR 0012 as `proposed`: the branch's first commit.
2. `@enardo/errors`: the brand, `isBaseErrorLike`, `BaseErrorLike`, test-first (cases 1–14, by the `test-author`); README and `CLAUDE.md`; version 1.1.0.
3. `declare readonly code` in `entities`, `uow-repository`, `uow-repository-mongo`, one commit per package with its version; the `uow-repository` README line.
4. The codes check, test-first (C1–C12, by the `test-author`); C13 by running it on the repo; root `package.json`, the lockfile (`./dev.sh exec pnpm install`), `verify` and `verify:all`.
5. Root `CLAUDE.md`; ADR 0012 in the index of `docs/adr/README.md`.
6. The backlog: the new items and the change to the `cqrs` item.
7. At the merge: this spec `done`, ADR 0012 `accepted`, the backlog item removed in a commit of its own.
