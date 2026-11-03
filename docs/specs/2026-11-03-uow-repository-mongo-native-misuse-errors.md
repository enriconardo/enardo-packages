---
status: draft
type: fix
tier: M
implementer: sonnet/medium
packages: ["@enardo/uow-repository-mongo"]
branch: fix/uow-repository-mongo/native-misuse-errors
---

# Report the misuses of `@enardo/uow-repository-mongo` with native errors

## Why

From the backlog item *Review the `BaseError`s that report misuse or misconfiguration* (Queued), which applies ADR 0012 point 6 package by package, and from a discussion with the user at intake, which took this package first and settled the native types.

ADR 0012 point 6 gives a `BaseError` to a condition a caller may handle by `code`, and a native error to a misuse or a misconfiguration, which a caller fixes in its code. The two errors of this package report such a fault and are `BaseError`s, written before the rule: they offer a public `code` for a case with no handling but fixing the code, and every `code` is public API (point 4). `@enardo/uow-repository`, the contract this package implements, already throws native errors for the same kind of fault.

Nothing is broken today: this is a matter of a coherent contract.

## Probes

- `pnpm view @enardo/uow-repository-mongo versions --registry https://npm.enriconardo.com` (host) → `0.1.0` only. The manifest's `0.2.0` is unpublished, so this change takes it as it is, with no bump.
- The throw sites, every one → `InvalidDataStoreOptionsError` `src/mongo-data-store.ts:145`; `MissingCollectionChangesError` `src/mongo-data-store.ts:107`, in `changesOf`, called at `:264` for the root and `:286` for each child.
- `git grep` for the two classes and codes, outside `packages/uow-repository-mongo` and `docs/specs` → `docs/backlog.md:14` alone.
- `grep -r` for the two classes and codes in `~/Projects/cambusa`, without `node_modules` and `dist` → no match. Six of its packages depend on `^0.1.0`.
- The messages and `details`, on `main`, after `./dev.sh exec pnpm exec turbo run build --filter=@enardo/uow-repository-mongo... --filter=@enardo/logger... --force`, from `dist/`:
  - two mappings and no root, and `collections: {}` → `Exactly one collection must be the root, but none is.`, `details: { roots: [] }`;
  - two roots → `Exactly one collection must be the root, but 2 are: a, b.`, `details: { roots: ["a", "b"] }`; three the same, with `3 are: a, b, d`;
  - one root and a child with `root: false` → no throw;
  - `apply` with `changes: {}` → `The change set has no entry for collection "a".`, `details: { collection: "a" }`.

  Each `details` is already in its message.
- What the errors expose, through `createLogger("console", { format: "json" })` of `@enardo/logger`, same build → `MissingCollectionChangesError` logs `name`, `message`, `stack`, `code` and `details`; a `TypeError` with its message logs `name`, `message` and `stack`. No throw site sets a `cause`. `InvalidDataStoreOptionsError` was not logged: same class shape, and its throw site passes no options either.
- `git grep -n -E "catch|instanceof|isBaseErrorLike"` over `packages/uow-repository-mongo/src` → no match. A caller's handling, over the `src/` of the other packages:
  - `retryOnConflict` (`packages/uow-repository/src/retry-on-conflict.ts:32`) retries on `CONCURRENCY_CONFLICT` alone, and rethrows the rest;
  - `@enardo/cqrs` (`src/command-handler.ts:36`, `src/query-handler.ts:34`) treats what fails `isBaseErrorLike` as a code it does not expect, as it treats these errors' codes unless a handler lists them.
- The driver's `withTransaction`, `mongodb` 7.6.0, `lib/sessions.js:578` → aborts and rethrows anything that is not a `MongoError`: a `BaseError` and a native error take one path, so the rollback stays as it is.
- Removing `@enardo/errors` from the manifest, with the two classes, in a throwaway clone, in a throwaway container of the dev image → the lockfile loses three lines, the importer's entry; `turbo run build --filter=@enardo/uow-repository-mongo...` passes; `dist/index.mjs` and `dist/index.d.mts` import no `@enardo/errors`; `import("./dist/index.mjs")` loads and exports `MongoDataStore` alone. `@enardo/uow-repository` keeps its own dependency for `ConcurrencyConflictError`.
- Doc lines that name this package and `@enardo/errors` → `README.md:289` alone, outside the source and the tests.

## Decisions

Taken with the user at intake.

The test is point 6's: can a caller handle the condition by `code`, or does it fix its code? Both conditions are faults in code, with nothing to handle.

1. **`INVALID_DATA_STORE_OPTIONS`: a native `Error`.** Every value has the right type, and the mappings together name the wrong number of roots, as with `DUPLICATE_RECORD_KEY` of `@enardo/uow-repository`. Not a `RangeError`, which `retryOnConflict` uses for one argument out of range: no single argument is.
2. **`MISSING_COLLECTION_CHANGES`: a native `TypeError`.** A change set must hold every collection, and an entry that is not there breaks that contract, as with `INVALID_RECORD_SET` of `@enardo/uow-repository`.
3. **The two classes go**, with their codes, from the public API, and `src/errors/` with them. No class is kept over a native base: a class of the package's own would invite the `instanceof` that point 6 means to remove the need for.
4. **The messages stay as they are.** They already hold what `details` held (probes).
5. **`@enardo/errors` leaves the `dependencies`**, as the backlog item asks once no use of it is left. Not a devDependency either: the tests identify a native error by its exact `constructor` and the absence of `code`, which `isBaseErrorLike` would only repeat.

Not taken: a native error with a `code`, as in the spec of `fix/uow-repository/native-misuse-errors`: ADR 0012 keeps a `code` for what a caller may handle.

## Open questions

None.

## Changes

`@enardo/uow-repository-mongo`, staying at `0.2.0`:

- `src/errors/`: deleted; `export * from "./errors"` leaves `src/index.ts`.
- `src/mongo-data-store.ts`:
  - `:145`: throws `new Error(<the message>)`; `:107`: throws `new TypeError(<the message>)`.
  - The JSDoc takes over the *why* of the deleted classes. On the constructor, `@throws {Error}`: the root holds the version, so without one no write could be checked, and with two the aggregate would have two versions. On `changesOf`, `@throws {TypeError}`: a change set carries every collection of its record set, even those with nothing to write, so a missing entry is a bug in the caller, not an empty set of changes.
- `package.json`: `@enardo/errors` leaves `dependencies`; `pnpm-lock.yaml` follows, through `./dev.sh exec pnpm install`.
- `README.md`:
  - `:31`: the row of `InvalidDataStoreOptionsError` leaves the table.
  - `:179`: the constructor throws a native `Error`.
  - *Errors* (`:287`): the two-row table and the sentence on `BaseError` go. The package adds no error class. A misuse throws a native error, with no `code`: the constructor an `Error` when the collections name no root, or more than one; `apply` a `TypeError` when a change set has no entry for a mapped collection, since a `ChangeSet` must carry every collection, even those with nothing to write. The link to the core errors stays.
  - *Layout* (`:323`): the lines of `errors/` and `error-codes.test.ts` go.
  - A section *Upgrading from 0.1*, before *Contributing*, and in *Contents*: the two classes and codes are removed, each misuse throws a native error with the same message, and a caller that read them fixes the cause instead: the mappings or the change set. As `@enardo/uow-repository`'s section does. It does not name `@enardo/errors`: a README names only the packages its package depends on.

Repo:

- `docs/backlog.md`, the item stays open:
  - its list of what is left becomes `INVALID_EMAIL_SENDER_OPTIONS`;
  - `@enardo/uow-repository` 0.2.0 is published only after the rename of the `I` prefix: this branch no longer holds it back;
  - only the branch of `@enardo/email-nodemailer` is left to drop the dependency on `@enardo/errors`.

## Test cases

"The native `X`" is a thrown value whose `constructor` is exactly `X`, whose `name` is `X`'s, with the exact message given, and with no `code` and no `details` property. The exact `constructor` catches a subclass named like the old class; `toThrow(Error)` and `toBeInstanceOf(Error)` would accept any.

In `__tests__/mongo-data-store.test.ts`, the constructor:

1. Two child mappings and no root → throws the native `Error`, `Exactly one collection must be the root, but none is.`
2. `collections: {}` → the same: a count of `Object.entries`, not a search among the children.
3. Two roots, `groups` and `members` → throws the native `Error`, `Exactly one collection must be the root, but 2 are: groups, members.`
4. One root and a child with `root: false` → does not throw: `root: false` counts as no root.

In `__tests__/mongo-data-store.test.ts`, `apply`:

5. A change set with no entry for the child `members` → rejects with the native `TypeError`, `The change set has no entry for collection "members".`
6. A change set with no entry for the root `groups` → the same, naming `groups`.
7. A change set that inserts the root `groups` and has no entry for `members`, in a transaction → rejects with the native `TypeError` of case 5, and neither collection holds a document: the root was written before the throw, and the rollback removes it.
8. `{}` as the change set of the one-collection product store → the same, naming `products`.

In a new `__tests__/public-api.test.ts`:

9. `Object.keys` of `~/index` is exactly `["MongoDataStore"]`: an export of a class left behind fails it.

The old usage: an import of a removed class fails to compile; `error.code === "MISSING_COLLECTION_CHANGES"` behind `isBaseErrorLike` compiles and is never reached, as cases 1 to 8 show no `code`, and a native error has no brand.

No case for `retryOnConflict` or `@enardo/cqrs` with these errors: both rethrow on a test that a native error fails, and their own suites pin it (`@enardo/uow-repository`'s `RangeError` and native misuse errors, `@enardo/cqrs`'s handlers). No test for the dependency's removal: `pnpm verify` builds and typechecks without it, and the clone's probe loaded the package.

Existing tests that change:

- `__tests__/mongo-data-store.test.ts:11` (the import of `BaseError`), `:24` and `:25` (the two classes): removed.
- `:94` becomes case 1; `:107` becomes case 3; `:548` becomes case 5; `:571` becomes case 6; `:595` becomes case 7; `:612` becomes case 8.
- `__tests__/error-codes.test.ts`: deleted, as it pins the removed code alone.

## Out of scope

- `@enardo/email-nodemailer`, `@enardo/env`, `@enardo/entities`: their own branches.
- The rename of the `I` prefix, and the README's unique index on a custom `idField`: their own backlog items.
- `ADR 0012`: point 6 already decides the case, and an accepted ADR is not edited.
- Publishing: a session of its own, after the rename of the `I` prefix.

## Plan

1. This spec, commit `[repo] docs: spec the native misuse errors of uow-repository-mongo`; the `critic`'s run.
2. Test-first (`test-author`): cases 1 to 9, the existing tests changed as listed. Then decisions 1 to 5, the JSDoc, the manifest, the lockfile and the README; the suite and `typecheck` green. Commit `[@enardo/uow-repository-mongo] fix: throw native errors on misuse` (body: the breaking change).
3. `pnpm verify`; the backlog changes, commit `[repo] docs: narrow the misuse errors item`.
