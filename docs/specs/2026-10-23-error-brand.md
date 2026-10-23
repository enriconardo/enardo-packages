---
status: draft
type: feature
tier: L
implementer: sonnet/medium
packages: ["@enardo/errors", "@enardo/entities", "@enardo/uow-repository", "@enardo/uow-repository-mongo"]
branch: feature/errors/brand-recognition
---

# Recognize an error of the ecosystem by a brand, and declare every code

## Why

The backlog item *How the ecosystem recognizes an error: by a brand, not by `BaseError`'s identity*, from the architectural review of `@enardo/cqrs` (2026-10-23) and the discussion that followed it. `error instanceof BaseError` fails silently when an app has two copies of `@enardo/errors`, which every package declares as a `dependency`: an error built on the other copy loses its `code` in `@enardo/cqrs`. No app has two copies yet, but a brand only helps the copies that carry it: it has to ship before copies diverge, and 1.1.0 is the first version that can sit beside another. The direction was decided with the user in that discussion. ADR 0012, drafted with this spec, records it. This branch carries the parts that `@enardo/errors` and the repo can carry alone: the brand, the guard, the codes declared by every class, and the docs.

## Probes

- A copy of `packages/errors` with the brand set in a static block and a guard, built with its own `tsdown` command, imported twice from two folders (dev container, Node 24.21.0) → `instanceof` with the other copy's `BaseError` `false`, the other copy's guard `true`. The built `index.mjs` keeps the `static` block (target `es2022`, `typescript-config/base.json`).
  - The key's descriptor on the prototype is `{ value: true, writable: false, enumerable: false, configurable: false }`.
  - `Reflect.ownKeys` of an instance has no symbol, `toJSON()` has the keys `code, details, name, message, stack`, and `JSON.stringify` does not hold the key.
  - The guard gives `false` for a native `Error`, for an `Error` with `code: "ECONNREFUSED"`, for a revoked `Proxy` and for a `Proxy` whose `get` throws (in a `try`), and `true` for a subclass of a subclass.
  - From a `vm` context, `e[Symbol.for("@enardo/errors.BaseError")]` on an instance of the main realm gives `true`.
- `vi.resetModules()` and then `await import("~/index")` in a test of `packages/errors` → a second `BaseError`, not `===` to the first, and its instances are not `instanceof` the first.
- `ErrorDetails` takes no array, function or `Date`: assigning `[1, 2]`, `() => 1` and `new Date()` to it is TS2322 (a probe file in `packages/cqrs/src`, `tsc --noEmit`).
- A script on TypeScript's compiler API, run in the dev container with a program per package from its `tsconfig.json`, reads each class's `extends` and its own `code` declaration: it lists 22 error classes in `packages/*/src` besides `BaseError`, all names distinct. Concrete ones without a `code` declaration of their own or of an ancestor: `DatabaseError` (`database`); `InvalidEntityIdError` (`entities`); `DuplicateEntityError`, `UnsupportedIdentityError`, `UnitOfWorkAlreadyUsedError`, `DuplicateRecordKeyError`, `InvalidRecordSetError`, `ConcurrencyConflictError` (`uow-repository`); `InvalidDataStoreOptionsError`, `MissingCollectionChangesError` (`uow-repository-mongo`). The others declare one. No literal is declared by two classes: the two concrete subclasses of `EntityLifecycleError` inherit its union.
- `git grep -n "instanceof BaseError"` → in `src/`, `packages/cqrs/src/command-handler.ts:70` and `query-handler.ts:67` only; in docs, `packages/errors/README.md:44`.
- pnpm 11.1.3, the version both `packageManager` fields pin, warns `The "pnpm" field in package.json is no longer read by pnpm` and ignores its keys (`dist/pnpm.mjs` of corepack's copy, in the dev container).
- `wc -c CLAUDE.md` → 11 196 bytes, of the 12 000 that `scripts/check-context-size.sh` allows.
- Versions: `errors` 1.0.0, `entities` 1.1.0, `uow-repository` and `uow-repository-mongo` 0.1.0. A branch bumps the version of the packages it changes (`git log -G'"version"'`).

## Decisions

Taken with the user, in the discussion that followed the review (the backlog item) and at intake:

1. **A brand on the prototype and a guard**, as ADR 0012 points 1–3 say. `@enardo/errors` stays a `dependency`. Rejected: a peer dependency, `Symbol.hasInstance`, a guard on `code` or its prefix (the ADR).
2. **`code` identifies one condition, and every concrete class declares its codes** (ADR 0012, point 4). The nine classes that do not yet do it get a `declare readonly code` with the literal their tests already pin; the two concrete subclasses of `EntityLifecycleError`, which inherit its union and so also list each other's code, narrow it to their own.
3. **No check in `pnpm verify` for the codes' uniqueness, for now.** The `critic`'s first run measured its cost (one program per package, about 1.6 s per verify with shared source files, 8 s without, plus fixture tests and `typescript` at the root) against a collision never seen, in this repo alone. The review checks a new code; the check goes to the backlog.
4. **`DatabaseError` stays as it is**, the one exception to point 4 of the ADR, and its form waits for the architectural review of the database packages, which this branch adds to the backlog. No ADR of its own: ADR 0012 names it.
5. **This branch does not change which classes extend `BaseError`, nor `@enardo/cqrs`, nor how a contract's errors thrown by its adapter are recognized.** ADR 0012 point 3 leaves the last one to its own item, which the user leans to settle with the contract as a peer of its adapter. The review of the `BaseError`s that report misuse or misconfiguration goes to the backlog, one branch per package, each a breaking change. `@enardo/cqrs` moves off `instanceof BaseError` in the branch of its own item.
6. **The guard is `isBaseErrorLike`, and its type `BaseErrorLike`**, after `PromiseLike` and `ArrayLike`: the name says the shape, not the class. Not taken: `isEnardoError`, which says a provenance a project's errors share; `isCodedError`, which reads as any error with a `code`, Node's included.

Taken by this spec:

7. **The brand is set in a static block** of `BaseError`, with `Object.defineProperty` on `this.prototype`. A getter with a computed key would put the symbol in the public types; a statement after the class would run apart from it. The symbol is not exported: the guard is the API, and the key's string is the contract the ADR names.
8. **The guard reads `details` as any object, or `undefined`.** `ErrorDetails` is `Readonly<Record<string, unknown>>`: every key of any object reads as `unknown`, so an object proves it, an array or a `Date` included, though the compiler refuses to assign them to it for want of an index signature. A check of the prototype would refuse an object of another realm, which has another `Object.prototype`.
9. **The guard catches what a read throws, and returns `false`.** It runs in error handlers, where a throw would replace the error being reported.

## Open questions

None.

## Changes

### `@enardo/errors` (1.0.0 → 1.1.0)

- `src/base/base-error.ts`: the brand, in a static block of `BaseError`, under `Symbol.for("@enardo/errors.BaseError")`.
- `src/base/is-base-error-like.ts` (new): `isBaseErrorLike`; `BaseErrorLike` in `base-error.types.ts`. Both exported from `src/base/index.ts` and `src/index.ts`.
- `README.md`:
  - the opening says which errors extend `BaseError` (ADR 0012, point 6);
  - *Exports* lists the guard and the interface;
  - *Writing an error* says that a concrete class declares its codes with `declare readonly code` (on itself or an ancestor), that a code belongs to one concrete class and is public API;
  - *Handling an error* recognizes with `isBaseErrorLike` and the `code`, says that `instanceof` with a specific class needs one copy of the package that declares it, for its typed `details` (ADR 0012, point 3), and why `instanceof BaseError` is not for recognizing;
  - *Handling an error* also says that a copy of 1.0.0 has no brand: while packages that allow 1.0.0 are in its tree, an app keeps one copy of `@enardo/errors` at 1.1.0 or later, with an override of its package manager (with pnpm 11, `overrides` in `pnpm-workspace.yaml`: it no longer reads the `pnpm` field of `package.json`).
- `CLAUDE.md`: the opening line as in the README; an invariant for the brand's key and `BaseErrorLike`, a contract between majors (ADR 0012, point 2); `isBaseErrorLike` in *Layout*.

### `@enardo/entities` (1.1.0 → 1.2.0), `@enardo/uow-repository` and `@enardo/uow-repository-mongo` (0.1.0 → 0.1.1)

- Each class listed in *Probes*, and `EntityAlreadyMarkedForRemovalError` and `EntityNotMutableError`, gets `declare readonly code: "<its code>";`, with the literal it passes to `super`. A narrower type for readers: a patch below 1.0.0, a minor above.
- `entities/__tests__/entity-lifecycle.error.test.ts:46` and `:83` pin `EntityLifecycleErrorCode` as the type of each subclass's `code`: they now pin its literal (`"ENTITY_NOT_MUTABLE"`, `"ENTITY_ALREADY_MARKED_FOR_REMOVAL"`), as the narrowing requires.
- `uow-repository/README.md`, *Contributing*: a new error declares its `code`.

### Repo

- Root `CLAUDE.md`, *Architecture conventions*: the line on errors becomes

  > - An error a caller may handle by `code` extends `BaseError` from `@enardo/errors`; misuse and misconfiguration throw native errors. A concrete class declares its `name` as a field and its codes with `declare readonly code`; a code belongs to one concrete class across packages. Recognize an error with `isBaseErrorLike` and its `code`, never `instanceof BaseError`; `instanceof` with a specific class only as ADR 0012 point 3 says ([its README](packages/errors/README.md)).
- `docs/adr/0012-errors-recognized-by-a-brand.md`: `accepted` at the merge; the index of `docs/adr/README.md`.
- `docs/backlog.md`:
  - *To evaluate*: the review of the `BaseError`s that report misuse or misconfiguration (`UOW_ALREADY_USED`, `MISSING_COLLECTION_CHANGES`, `UNSUPPORTED_IDENTITY`, `INVALID_DATA_STORE_OPTIONS`, `INVALID_EMAIL_SENDER_OPTIONS`, perhaps `ENV_MISSING` and `ENV_MALFORMED`), against ADR 0012 point 6, one branch per package; and the native throws the item listed, consistent with the rule, need nothing;
  - *To evaluate*: the architectural review of `@enardo/database` and `@enardo/database-mongo`, starting from `DatabaseError`'s free `code`, the one exception to point 4 of ADR 0012;
  - *To evaluate*: a check of the codes' uniqueness in `pnpm verify`, with the design and the cost of decision 3, for when a first collision is seen; a literal declared by a class and by its ancestor is not a collision;
  - *`@enardo/cqrs` sends the message of a native error to the client*: ADR 0012 points 3 and 7 apply; that branch replaces `instanceof BaseError` and adds a lint rule against it in the presets once no use is left;
  - *To evaluate*: a contract's errors thrown by its adapter (ADR 0012, point 3). The adapter throws them from its own copy of the contract, so `instanceof` with the class fails silently when an app has two copies: `@enardo/email`'s README advises it for the classes `@enardo/email-nodemailer` throws, `retryOnConflict` of `@enardo/uow-repository` does it for `ConcurrencyConflictError`, which `@enardo/uow-repository-mongo` throws, and `@enardo/database-mongo` throws `DatabaseError` of `@enardo/database`. Options: the guard and `code`, with `details` checked at runtime; a guard per class; the contract as a peer of its adapter, as a driver is, which keeps one copy and the typed `details` (the direction the user prefers, 2026-10-23, after the practice of `@langchain/core`, `@opentelemetry/api` and `@nestjs/common`, not probed), though, as ADR 0012 says of a peer, a mismatch is then an install warning and correctness depends on the install. An ADR of its own;
  - this item leaves, in a commit of its own.

## Test cases

### `isBaseErrorLike` (`packages/errors/__tests__/base/is-base-error-like.test.ts`)

1. An instance of a concrete subclass of `BaseError` → `true`.
2. An instance of a subclass of a concrete subclass → `true`.
3. An instance of a subclass of a second copy of `BaseError` (`vi.resetModules()`, then `import("~/index")`) → `true`, while `instanceof BaseError` of the first copy is `false`.
4. A plain object with `[Symbol.for("@enardo/errors.BaseError")]: true`, `name: "X"`, `code: "X"` → `true`. This pins the key's string, the contract between majors.
5. The same object with `details: undefined`, and with no `details` key → `true`; with `details: { a: 1 }` → `true`; with `details: []` → `true` (decision 8).
6. Without the brand → `false`: a native `Error`; an `Error` with `code: "ECONNREFUSED"` and a `name`; a plain object with `name`, `code`, `details`.
7. Not an object → `false`: `null`, `undefined`, `"BaseError"`, `42`, a function carrying the brand key.
8. The brand with a value other than `true` (`1`, `"true"`) → `false`.
9. The brand with a wrong shape → `false`, one case each: `code` a number, `code` missing, `name` a number, `details` `null`, `details` a string.
10. A read that throws → `false`, not a throw: a revoked `Proxy`; an object with the brand whose `code` getter throws.
11. The key on `BaseError.prototype` has the descriptor `{ value: true, writable: false, enumerable: false, configurable: false }`; an instance has no own symbol key; `toJSON()` of an instance has no symbol key, and `JSON.stringify` of it does not contain `@enardo/errors`.

### Types (`packages/errors/__tests__/types.test.ts`)

12. After `if (isBaseErrorLike(value))` on an `unknown`, `value` is `BaseErrorLike`: `value.code` is exactly `string`, `value.details` is `ErrorDetails | undefined`, and `value.toJSON` does not compile.
13. A `BaseError` subclass instance is assignable to `BaseErrorLike`.

### Entry point (`packages/errors/__tests__/index.test.ts`)

14. The runtime exports are exactly `BaseError` and `isBaseErrorLike`. This changes an existing test, as the new export requires.

## Risks

- **A guard that lets through what it should not, or misses what it should not**: cases 6–10 for the first, 1–5 for the second.
- **The transition from 1.0.0**, which has no brand: a tree with 1.0.0 beside 1.1.0 recognizes the errors of neither copy from the other, through the guard or through `instanceof`. The three packages this branch bumps require `^1.1.0` (`workspace:^`), so they are what brings 1.1.0 next to a locked 1.0.0. Whether pnpm keeps both when an app upgrades only some dependents is not probed: the README tells apps to keep one copy, which removes the question. Whether an override reaches a `pnpm deploy` is not run: pnpm 11.1.3's source keeps the versions of a shared lockfile there (the `critic`'s third run).
- **The brand in a log**: case 11.
- **A declared literal that differs from the value passed to `super`**: the compiler does not see it, since `BaseErrorOptions.code` is `string`. The existing tests of each class pin the runtime `code`; the review compares the two in step 3.
- **Two classes declaring one code**, which nothing checks (decision 3): today none does (*Probes*); the review checks every new code.

## Out of scope

- `@enardo/cqrs` and the lint rule against `instanceof BaseError` (decision 5).
- Turning the `BaseError`s that report misuse or misconfiguration into native errors (decision 5).
- `DatabaseError`'s form (decision 4).
- A check of the codes in `pnpm verify` (decision 3).
- Running `errors`' tests in browsers: its backlog item.

## Plan

1. This spec and ADR 0012 as `proposed`: the branch's first commit.
2. `@enardo/errors`: the brand, `isBaseErrorLike`, `BaseErrorLike`, test-first (cases 1–14, by the `test-author`); README and `CLAUDE.md`; version 1.1.0.
3. `declare readonly code` in `entities`, `uow-repository`, `uow-repository-mongo`, one commit per package with its version; the `uow-repository` README line.
4. Root `CLAUDE.md`; ADR 0012 in the index of `docs/adr/README.md`.
5. The backlog: the new items and the change to the `cqrs` item.
6. At the merge: this spec `done`, ADR 0012 `accepted`, the backlog item removed in a commit of its own.
