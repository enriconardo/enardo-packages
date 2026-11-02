---
status: draft
type: fix
tier: M
implementer: sonnet/medium
packages: ["@enardo/uow-repository"]
branch: fix/uow-repository/native-misuse-errors
---

# Report the misuses of `@enardo/uow-repository` with native errors

## Why

From the backlog item *Review the `BaseError`s that report misuse or misconfiguration* (Queued), which applies ADR 0012 point 6 package by package, and from a discussion with the user at intake, which changed its list.

ADR 0012 point 6 gives a `BaseError` to a condition a caller may handle by `code`, and a native error to a misuse or a misconfiguration, which a caller fixes in its code. Four errors of this package report a misuse and are `BaseError`s, written before the rule: they offer a public `code` for a case with no handling but fixing the code, and every `code` is public API (point 4). The package contradicts itself: `retryOnConflict` reports a bad argument with a `RangeError`.

Nothing is broken today: this is a matter of a coherent contract.

## Probes

- `pnpm view <package> versions --registry https://npm.enriconardo.com` (host) → `@enardo/uow-repository`: `0.1.0`; `@enardo/uow-repository-mongo`: `0.1.0`. The manifests' `0.1.2` and `0.2.0` are unpublished. A breaking change over `0.1.0` is a new minor, so `@enardo/uow-repository` goes to `0.2.0`; `-mongo`, unpublished at `0.2.0`, needs no bump of its own.
- `pnpm-lock.yaml:692` → the importer of `-mongo` holds `specifier: workspace:^`, `version: link:../uow-repository`: a version bump leaves the lockfile as it is.
- `git grep` for the four classes and codes, outside `packages/uow-repository` and `docs/specs` → only `docs/backlog.md:14`, for three of them.
- `grep -r` for the four classes and codes in `~/Projects/cambusa`, the one active project in `~/Projects` that depends on the package, on `^0.1.0` → no match. Projects elsewhere: none known to the user (2026-11-02).
- The throw sites, every one → `UnitOfWorkAlreadyUsedError` `src/unit-of-work.ts:108`; `UnsupportedIdentityError` `src/identity-key.ts:14`; `InvalidRecordSetError` `src/record-set.ts:123`; `DuplicateRecordKeyError` `src/record-set.ts:179`.
- `git grep -n -E "catch|instanceof|isBaseErrorLike"` over the `src/` of the package and of `-mongo` → the one catch of an error is `retryOnConflict` (`src/retry-on-conflict.ts:32`), which retries on `CONCURRENCY_CONFLICT` alone: a native error passes through it as these errors do today.
- `@enardo/cqrs`, `src/command-handler.ts:25` and `:36`, and `src/query-handler.ts:34` → an error that fails `isBaseErrorLike` is rethrown, as is one whose `code` is not expected.
- Where `INVALID_RECORD_SET` comes from → `next`: `mapper.toRecords` (`src/repository.ts:260`). `previous`: the records the `DataStore` returned, through `toSnapshot(records)` (`src/repository.ts:271`), which the *DataStore contract* of the README requires to hold every collection, and `MongoDataStore` always fills with an array (`packages/uow-repository-mongo/src/mongo-data-store.ts:344`). Both sides are a fault in code.
- Where `DUPLICATE_RECORD_KEY` comes from → `next`: the mapper. `previous`: the records the `DataStore` returned; `__tests__/repository.test.ts:467` shows it with a stubbed store. On `MongoDataStore` the key is `record[idField]`, by default `_id` (`packages/uow-repository-mongo/src/mongo-data-store.ts:168`), so a stored duplicate needs an `idField` that is not unique, a fault of the mapping (not run on a replica set: it rests on `_id`'s unique index). `grep -r idField` in `cambusa` → no match. The README lists uniqueness as a rule of `recordKeys` (`:277`), and says the failure hits every commit, so a caller can only report it.
- The messages, on `main`, after `./dev.sh exec pnpm exec turbo run build --filter=@enardo/uow-repository... --filter=@enardo/logger... --force`, from `dist/` → `identityKeyOf` of `null`, `[]`, `{}`, `undefined`, a symbol and a function gives `Cannot derive an identity key from <null | an array | an object | a undefined | a symbol | a function>. Supply identityKey for composite identities.`; a second `execute()` gives `This unit of work has already been used; create a new one, with new repositories, for each execute call.` The messages of `InvalidRecordSetError` and `DuplicateRecordKeyError` are pinned in `__tests__/record-set.test.ts`, at `*invalid record sets*`.
- Each `details` is already in its message: `identityType`; `collection` and `recordSet`; `collection`, `key` and `recordSet`; `UnitOfWorkAlreadyUsedError` has none.
- What the errors expose, through `createLogger("console", { format: "json" })` of `@enardo/logger`, same build → a `TypeError` logs `name`, `message` and `stack`; the `BaseError` logs those plus `code` and `details`. No `cause` is ever set at the throw sites. `isBaseErrorLike(new TypeError(...))` → `false`.
- `@enardo/database`'s README, *Upgrading from 1.x* → the form of the upgrade note.
- Where `DUPLICATE_ENTITY` comes from → `ChangeTracker.add` (`src/change-tracker.ts:79`), for an identity tracked in this unit of work; "the repository never checks the store" (`README.md:315`).
- `cambusa`'s error handler (`apps/api-server/src/middleware/error-handler.middleware.ts:44`) → a `BaseError` with a code it does not map and a native error get the same result: `logger.error` and a 500.

## Decisions

The list and the native types were taken with the user at intake; decisions 6 and 8 changed with the user after the `critic`'s first run.

1. **`UOW_ALREADY_USED`: a native `Error`.** The call comes at the wrong moment, as with the "not connected" of `MongoDatabase`. Not a `RangeError` or a `TypeError`: no argument is wrong.
2. **`UNSUPPORTED_IDENTITY`: a native `TypeError`.** The value has a type the function cannot take.
3. **`INVALID_RECORD_SET`: a native `TypeError`.** A collection is not an array. It joins the list: the backlog item did not name it, and it is the same case as `MISSING_COLLECTION_CHANGES`, a contract broken by code.
4. **The four classes go**, with their codes, from the public API. No class is kept over a native base: a class of the package's own would invite the `instanceof` that point 6 means to remove the need for.
5. **The messages stay as they are.** They already hold what `details` held (probes). The `a undefined` of the identity's message is left: it is not this task's.
6. **`DUPLICATE_RECORD_KEY`: a native `Error`.** Uniqueness is a rule of `recordKeys`, broken by a mapper or by a mapping's `idField`, and a caller can only report it. Not a `TypeError`: every value has the right type, and two of them collide. Not taken: keeping a `BaseError` for the `previous` side, since a stored duplicate takes a mapping fault, and has no handling either (probes).
7. **`DUPLICATE_ENTITY` stays a `BaseError`.** It fires for an identity already tracked in this unit of work, never for one the store holds: a use case that already loaded or added the id, or a batch that repeats one. A well-typed value repeated in a request's data is no fault in the code, and a caller may answer it by `code`; an ill-typed identity (decision 2) is fixed by validating at the boundary.
8. **`@enardo/env`'s `ENV_MISSING` and `ENV_MALFORMED` are not decided here.** They stay on the item, to evaluate in `@enardo/env`'s own branch, with its probes. A variable is a misconfiguration, yet it is not fixed in the caller's code, as point 6 says; the same reading would reach the `default-from` and `transport-options` reasons of `INVALID_EMAIL_SENDER_OPTIONS`, when an app reads them from its environment.
9. **`@enardo/entities`' lifecycle errors are left to their own evaluation.** Its README shows a caller catching one with `instanceof`, so they are no plain case.
10. **The backlog item stays open**, with its list updated, until the last package.

Not taken: a native error with a `code`, as Node's `ERR_INVALID_ARG_TYPE`. ADR 0012 keeps a `code` for what a caller may handle.

## Open questions

None.

## Changes

`@enardo/uow-repository`, `0.1.2` → `0.2.0`:

- `src/errors/unit-of-work-already-used.error.ts`, `unsupported-identity.error.ts`, `invalid-record-set.error.ts`, `duplicate-record-key.error.ts`: deleted, and out of `src/errors/index.ts`.
- `src/unit-of-work.ts:108`: throws `new Error(<the message>)`; the JSDoc's `@throws {Error}`.
- `src/identity-key.ts:14`: throws `new TypeError(<the message>)`; a `@throws {TypeError}` on `identityKeyOf`.
- `src/record-set.ts:123`: throws `new TypeError(<the message>)`; `src/record-set.ts:179`: throws `new Error(<the message>)`; the JSDoc, where it names a class.
- `package.json`: `version` `0.2.0`.
- `README.md`:
  - `:15`: version 0.2.0.
  - `:255`: *A second `execute()` rejects* with a native `Error`.
  - `:277`: a key that is not unique fails with a native `Error`.
  - `:281`: a listed collection that a record set lacks fails with a `TypeError`.
  - *Composite identities* (`:385`): any other identity without an `identityKey` throws a `TypeError`.
  - *Errors* (`:474`): the table drops the four rows; the sentence above it says that these errors extend `BaseError`, and that a misuse throws a native error, with no `code`: the four cases and `retryOnConflict`'s `RangeError` on a bad `attempts`, each with its type, and that the messages of the record sets name the side: `previous`, the snapshot, or `next`, what the mapper produced, in place of `:487`.
  - *Contributing › Conventions* (`:535`): a new error extends `BaseError` when a caller may handle it by `code`; a misuse throws a native error.
  - A section *Upgrading from 0.1*, before *Contributing*, and in *Contents*: the four classes and codes are removed, a misuse throws a native error, and a caller that read them fixes the call instead.

Repo:

- `docs/backlog.md`:
  - the item's list becomes `MISSING_COLLECTION_CHANGES`, `INVALID_DATA_STORE_OPTIONS`, `INVALID_EMAIL_SENDER_OPTIONS`; to evaluate, `ENV_MISSING` and `ENV_MALFORMED`, with the reason of decision 8, and `ENTITY_NOT_MUTABLE` and `ENTITY_ALREADY_MARKED_FOR_REMOVAL`, with that of decision 9;
  - its list of native throws that need nothing gains `@enardo/database-mongo`.

`@enardo/uow-repository-mongo` has no change of code: its peer is `workspace:^`, which `pack` turns into `^0.2.0`.

## Test cases

"The native `X`" is a thrown value whose `constructor` is exactly `X`, whose `name` is `X`'s, with the exact message given, no `code` property, and for which `isBaseErrorLike` is `false`. The exact `constructor` catches a subclass named like the old class.

"The used-unit message" is `This unit of work has already been used; create a new one, with new repositories, for each execute call.`

In `__tests__/unit-of-work.test.ts`, *single use*:

1. `execute()` after one that resolved → rejects with the native `Error`, the used-unit message.
2. `execute()` after one that rejected → the same.
3. `execute()` nested in the work of another → the same.
4. `execute()` during another → the same; the running call then resolves with `"first"`.
5. `execute(work)` on a used unit → the same; `work` is not called.

In `__tests__/identity-key.test.ts`:

6. `identityKeyOf` of each of `null`, `[]`, `{ accountId: "account-1" }`, `undefined`, a symbol, a function → throws the native `TypeError`, with the message of the *Probes* for that value.

In `__tests__/record-set.test.ts`, *invalid record sets*:

7. `next` without the collection `members` → throws the native `TypeError`, `Collection "members" of the next record set is not an array of records.`
8. `previous` without it → the same, naming `previous`.
9. `next` whose `members` is a string → the same as case 7: an array is what is checked, not the presence of the key.
10. `next` with two records of one key → throws the native `Error`, `Collection "members" of the next record set holds more than one record with key "g-1:u-2".`
11. `previous` with two records of one key → the same, naming `previous`.

In `__tests__/repository.test.ts`:

12. A store that returns two records with one key, in a unit of work that only reads → `execute()` rejects with the native `Error`, naming `previous` and the key; `apply` is not called.

In `__tests__/error-codes.test.ts`:

13. `~/index` exports none of `UnitOfWorkAlreadyUsedError`, `UnsupportedIdentityError`, `InvalidRecordSetError`, `DuplicateRecordKeyError`.
14. `DuplicateEntityError` and `ConcurrencyConflictError` pass `isBaseErrorLike`, each with its `code`.

The old usage: an import of a removed class fails to compile; `error.code === "UOW_ALREADY_USED"` behind `isBaseErrorLike` compiles and is never reached, as `isBaseErrorLike` is `false` (cases 1 to 12).

No case at `Repository` level for the identity: `identityKeyOf` has one throw site, and nothing catches between it and the caller (*Probes*).

Existing tests that change:

- `__tests__/unit-of-work.test.ts:6` (the import) and `:175`, `:186`, `:198`, `:211`, `:224`: become cases 1 to 5.
- `__tests__/identity-key.test.ts:14`: becomes case 6.
- `__tests__/record-set.test.ts:266`: becomes case 7; `:251`: becomes case 10.
- `__tests__/repository.test.ts:6` (the import of `DuplicateRecordKeyError`) and `:477`: become case 12.
- `__tests__/error-codes.test.ts:5`, `:6`, and the tests at `:17` and `:24`: removed; the file gains cases 13 and 14.

## Out of scope

- `@enardo/uow-repository-mongo`, `@enardo/email-nodemailer`, `@enardo/env`, `@enardo/entities`: their own branches.
- `ADR 0012`: point 6 already decides the case, and an accepted ADR is not edited.
- Publishing: a session of its own, after the branch of `@enardo/uow-repository-mongo`, this package first. `-mongo`'s review is also breaking: published in between, it would cost a `0.3.0` and a second change of range in `cambusa`, which moves when it wants to, from `^0.1.0`.

## Plan

1. This spec, commit `[repo] docs: spec the native misuse errors of uow-repository`; the `critic`'s run.
2. Test-first (`test-author`): cases 1 to 14, the existing tests changed as listed. Then decisions 1 to 6, the JSDoc, the manifest and the README; the suite and `typecheck` green. Commit `[@enardo/uow-repository] fix: throw native errors on misuse` (body: the breaking change).
3. `pnpm verify`; the backlog changes, commit `[repo] docs: narrow the misuse errors item`.
