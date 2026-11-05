---
status: draft
type: refactor
tier: L
implementer: sonnet/medium
packages:
  [
    "@enardo/database",
    "@enardo/database-mongo",
    "@enardo/transaction-manager",
    "@enardo/transaction-manager-mongo",
    "@enardo/uow-repository",
    "@enardo/uow-repository-mongo",
    "@enardo/eslint-config",
  ]
branch: refactor/repo/drop-i-prefix
---

# Drop the `I` prefix from the exported types, and keep it out with a lint rule

## Why

Eleven exported types carry an `I` prefix; every other exported type of the repo has none, contracts (`EmailSender`, `IdGenerator`, `DataStore`) included. The queued backlog item *The `I` prefix of exported types*, from `docs/specs/2026-10-28-explicit-schema-sync.md`, asks to rename them, each package whole, with `@typescript-eslint/naming-convention` in the presets. `@enardo/uow-repository` 0.2.0 waits for this rename: published before it, it would cost a `0.3.0` and a second change of range in `cambusa`.

The item reads as a rename, but three of the eleven collide with a class their package already exports: `IRepository`, `IUnitOfWork` and `IMongoDatabase`. The decisions below come from a discussion with the user.

## Probes

- `git grep` of each exported `interface` or `type` starting with `I` in `packages/*` → the eleven names of the item, in five packages. `IPasswordHasher`, named by the 2026-10-28 spec, left with `@enardo/password-hasher` 3.0.0.
- `pnpm view <package> versions` on the registry, from outside the repo → `database` 1.0.0; `database-mongo` 1.0.0; `transaction-manager` 1.0.0; `transaction-manager-mongo` 0.1.0; `uow-repository` 0.1.0; `uow-repository-mongo` 0.1.0; `eslint-config` 1.0.0, 1.1.0. The manifests are at 2.0.0, 2.0.0, 1.0.0, 0.2.0, 0.2.0, 0.2.0, 2.0.0: only `transaction-manager` is at a published version.
- `pnpm exec turbo run build --force`, then `eslint . --rule` with `{ selector: "typeLike", format: null, custom: { regex: "^I[A-Z][a-z]", match: false } }` on each package with an `eslint.config.js` → flags exactly the eleven declarations. On `eslint-config` and `vitest-config` the run printed no JSON, cause not investigated: neither holds a `.ts` under the rule's reach, and step 6 runs their `lint`.
- The same rule on a fixture, through the parser alone → flags an exported interface, a local interface, a type alias, a class, an enum and a type parameter, and `IPv4Address`; leaves `IOError`, `Item`, `I`, `Ideal`, a `const IConst` and an imported `IImported`. Not yet run through the `node` and `react` presets, or on a `.tsx`: case 8.
- `tsc --strict --verbatimModuleSyntax` of the old usage against declarations with the new names (a small copy of the shapes, not the real package), every line marked → `import { Repository, UnitOfWork }` TS1484; `IRepository`, `IUnitOfWork` TS2724; `extends Repository<…4>` TS2689; `new UnitOfWork<object>()` TS2693; `UnitOfWork<object>` TS2315; `Repository<…4>` as a type TS2314; `.register()` on a `UnitOfWork` TS2339. The unmarked lines compile. So the old use of a class fails to compile, and the one form that still compiles is a parameter-less `UnitOfWork` type, narrowed to `execute` and `hasPendingChanges`.
- In a throwaway clone, `transaction-manager` at 2.0.0 and `pnpm install --frozen-lockfile --lockfile-only` → passes, the lockfile unchanged.
- `cambusa`, `git grep` → none of the new names is declared there; none of its lines imports them from `mongodb` or a local file. Lines using an old name: `IMongoSchema` 32, `IMongoTransaction` 30, `IRepository` 14, `ITransactionManager` 8, `IUnitOfWork` 8; the other six names 0. Seven `extends Repository`, six `new UnitOfWork`. It declares no type of its own with the prefix.
- `mongodb.d.ts` exports no `Transaction`, `MongoTransaction`, `MongoSchema`, `MongoIndex`, `MongoValidation`, `MongoDatabaseOptions` as a class, interface or type → `grep` of its `export` lines.
- `MongoDatabase` has `private` members (`src/mongo.database.ts:67`), so a plain object is not assignable to the class; its two sync methods carry their own JSDoc (`:259`, `:308`). Not probed: a `Pick<MongoDatabase, …>` fake, which case 3 compiles.
- Runtime reads of a class's name in `packages/uow-repository/src` (`git grep '\.name\b'`) → none; string literals naming either class there → none. `packages/database-mongo/src/mongo.database.ts:242` names `MongoDatabase` in a message, unchanged.
- `packages/cqrs/README.md:26` writes `() => UnitOfWork` in an example; `cqrs` does not depend on `uow-repository`, and only `execute` is called on it, which the new contract has. It stays.
- Upgrade notes: `database`, `database-mongo`, `uow-repository`, `uow-repository-mongo` have one; `transaction-manager`, `transaction-manager-mongo`, `eslint-config` have none. `CLAUDE.md` holds 11 940 of its 12 000 bytes.

## Decisions

Taken with the user at intake.

1. **The contract takes the plain name, the class a qualifier:** `Repository` and `UnitOfWork` are the interfaces, `TrackingRepository` and `TransactionalUnitOfWork` the classes. It follows `EmailSender` and `NodemailerEmailSender`; domain code keeps the plain name; old uses of the classes fail to compile (probe). Not taken: the classes keep their names and the contracts take a new one, which touches fewer lines in `cambusa` but puts the longer name on the type the domain depends on, and no good name came up.
2. **`IMongoDatabase` is removed, not renamed.** `MongoDatabase` the class is the type. Nothing outside the class uses the interface, in this repo or in `cambusa`. `Database` stays the contract; a fake takes `Pick<MongoDatabase, …>`. Not taken: a qualified interface name, for a type nobody asks for.
3. **The rule covers every type-like declaration, in every file the preset lints**, not only exported ones: the `exported` modifier would let through a local type re-exported with `export type { … }`. The regex is `^I[A-Z][a-z]`, so an acronym such as `IOError` passes. `IPv4Address` is flagged, which is accepted: no such type exists in the repo or in `cambusa`, and a package may override the rule with a comment.
4. **Versions:** `transaction-manager` goes to 2.0.0; the other six packages take the change in their unpublished version, with no bump.
5. **An ADR records the naming rule** (`docs/adr/0017-…`): it outlives the task. The root `CLAUDE.md` gains nothing: the lint rule keeps the prefix out, and the file has no room.

## Open questions

None.

## Changes

| Package | Old | New |
| --- | --- | --- |
| `database` | `IDatabase` | `Database` |
| `database-mongo` | `IMongoDatabase` | removed |
| | `IMongoDatabaseOptions` | `MongoDatabaseOptions` |
| | `IMongoIndex` | `MongoIndex` |
| | `IMongoSchema` | `MongoSchema` |
| | `IMongoValidation` | `MongoValidation` |
| `transaction-manager` | `ITransaction` | `Transaction` |
| | `ITransactionManager` | `TransactionManager` |
| `transaction-manager-mongo` | `IMongoTransaction` | `MongoTransaction` |
| `uow-repository` | class `Repository` | class `TrackingRepository` |
| | class `UnitOfWork` | class `TransactionalUnitOfWork` |
| | `IRepository` | `Repository` |
| | `IUnitOfWork` | `UnitOfWork` |

Files keep their names (`repository.ts`, `unit-of-work.ts`). No logic changes.

- **`database-mongo`:** `MongoDatabase implements Database`. The `{@link IMongoDatabase…}` of `src/mongo.database.ts` and `src/mongo.database.types.ts` point to the class. The interface's export leaves `src/index.ts`. `src/mongo.database.types.ts` drops the import of `IDatabase`.
- **`uow-repository-mongo`:** its names follow, in `src`, tests and README. It exports nothing renamed.
- **`transaction-manager`:** `version` 2.0.0. Through `workspace:^`, `transaction-manager-mongo` and `uow-repository` then pack with `^2.0.0`.
- **`eslint-config`:** the rule, with a comment saying why, in the block of `createConfig` that holds the TypeScript rules, so `node`, `react` and `runtimeNeutral` all get it. Its README says so.
- **READMEs:** every example and table takes the new names. In `uow-repository`, `interface UserRepository extends IRepository` becomes `extends Repository`, and `extends Repository<User, …>` becomes `extends TrackingRepository<User, …>`. An *Upgrading* note, new where the probe found none, holds that package's rows of the table, and:
  - `database-mongo`: line 79's "`IMongoDatabase` declares the two methods: a fake of it adds them" becomes the removal and the `Pick`;
  - `transaction-manager-mongo` and `uow-repository`: `@enardo/transaction-manager` `^2.0.0`;
  - `uow-repository`: what the probe found still compiling, a parameter-less `UnitOfWork` type, which no longer has the class's other members;
  - `eslint-config`: the new rule, which fails on a type named with the prefix.
- **`docs/adr/`:** `0017`, and its row in the index.
- **`docs/backlog.md`:** the item leaves, in a commit of its own.

## Test cases

The behavior does not change: the existing suites are the check, with the names replaced. These cases cover what they cannot see: a suite imports from `~/repository`, so a missing export of `src/index.ts` passes it, and `@enardo/database` has no tests. Cases 1 to 4 go in a `__tests__/public-api.test.ts` of each package, importing from `~/index`, in the form of `packages/errors/__tests__/index.test.ts`: a `@ts-expect-error` on each old name's import, and `expectTypeOf`.

1. `uow-repository`: `new TransactionalUnitOfWork(manager)` is assignable to `UnitOfWork`, and `new TrackingRepository(store, mapper)` to `Repository<TDomain, TId>`. `IRepository` and `IUnitOfWork` fail to import. The module object has `TrackingRepository` and `TransactionalUnitOfWork`, and has no key `Repository` or `UnitOfWork`, which an `export { TrackingRepository as Repository }` would leave.
2. `transaction-manager` and `transaction-manager-mongo`: `Transaction`, `TransactionManager` and `MongoTransaction` import from `~/index`; `MongoTransaction` extends `Transaction`; `MongoTransactionManager` is assignable to `TransactionManager<MongoTransaction>`; each old name fails to import.
3. `database-mongo`: `MongoDatabaseOptions`, `MongoIndex`, `MongoSchema` and `MongoValidation` import from `~/index`; `MongoDatabase` is assignable to `Database`; a plain object with `syncSchema` and `dropStaleIndexes` is assignable to `Pick<MongoDatabase, "syncSchema" | "dropStaleIndexes">`; each old name, `IMongoDatabase` included, fails to import.
4. `database`, which has no test script (manual, and it stays so): `dist/index.d.mts` exports `Database`, and not `IDatabase`.
5. Existing suites: `pnpm verify` green, and a `git diff main -- 'packages/*/__tests__/*'` on the existing files that holds only renames (`--word-diff`), no changed assertion or case.
6. No old name survives: `git grep` of the eleven names, and `grep -r` over `packages/*/dist/*.d.mts`, after a forced build. Allowed hits: the *Upgrading* notes, the frozen specs, ADR 0017, and `@ts-expect-error` lines of cases 1 to 3.
7. Packing in a throwaway directory: the manifests of `uow-repository` and `transaction-manager-mongo` name `@enardo/transaction-manager` `^2.0.0`, `transaction-manager`'s is 2.0.0. Nothing is published.
8. The rule, through the presets (`eslint-config` has no tests, so manual, on a fixture removed afterward): through `node(rootDir)`, `react(rootDir)` on a `.tsx`, and `runtimeNeutral(rootDir)`, each of `export interface IFoo`, `interface ILocal`, `type IAlias` is reported; `IOError`, `Item` and an imported `IImported` are not.
9. A package's `lint` fails on the rule: adding `interface IFoo { a: string }` to a `src/` file of `@enardo/errors`, where it would otherwise pass, makes `pnpm --filter @enardo/errors lint` exit non-zero; removed afterward.

## Risks

Risk is `low`. A consumer still on an old name fails to compile, which the probe shows for every form but the narrowed `UnitOfWork` type. The rename order can go wrong: renaming `IRepository` to `Repository` first merges it with the class, and a later rename would hit both. Step 4 renames the classes first; case 1 and the type check show the outcome.

## Out of scope

- Publishing, in a session of its own: `transaction-manager` 2.0.0 goes before the packages whose range names it.
- The migration of `cambusa`, in its repo, from the *Upgrading* notes.
- `en-monorepo`, split on 2026-10-16: it uses `workspace:*` and no longer consumes these packages.
- Renaming files, or any other public name.

## Plan

Each step ends green on the package it names and its dependents, and committed. No step is test-first: the compiler is the failing check of a rename. Cases 1 to 3 go in the step of their package.

1. `@enardo/database`: rename, README. Commit `[@enardo/database] refactor: drop the I prefix`.
2. `@enardo/database-mongo`: rename, the removal, the JSDoc, README, case 3. `pnpm exec turbo run build --filter=@enardo/database-mongo...` first. Commit `[@enardo/database-mongo] refactor: drop the I prefix`.
3. `@enardo/transaction-manager` and `@enardo/transaction-manager-mongo`: rename, 2.0.0, READMEs, case 2. One commit each. `uow-repository` and `uow-repository-mongo` no longer compile until step 4 unless they move with them, so their imports of these types change in the `transaction-manager` commit, to keep no red state.
4. `@enardo/uow-repository`: **first** the classes to `TrackingRepository` and `TransactionalUnitOfWork`, **then** `IRepository` and `IUnitOfWork` to the plain names, with word-bounded replacements; README, upgrade note, case 1. Commit `[@enardo/uow-repository] refactor: name the contracts plainly`.
5. `@enardo/uow-repository-mongo`: the classes' new names in tests, JSDoc and README. It moves in the commit of step 4, for the same reason as in step 3.
6. `@enardo/eslint-config`: the rule, README; cases 8 and 9; `pnpm verify:all`, since every package lints with it. Commit `[@enardo/eslint-config] feat: forbid the I prefix on types`.
7. Cases 4, 6 and 7. The backlog item leaves. Commit `[repo] docs: close the I prefix item`. ADR 0017 goes to `accepted`, and the spec to `done` at the merge.
