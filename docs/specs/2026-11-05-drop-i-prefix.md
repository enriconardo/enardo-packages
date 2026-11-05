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
    "@enardo/entities",
  ]
branch: refactor/repo/drop-i-prefix
---

# Drop the `I` prefix from the exported types

## Why

Eleven exported types carry an `I` prefix; every other exported type of the repo has none, contracts (`EmailSender`, `IdGenerator`, `DataStore`) included. The queued backlog item *The `I` prefix of exported types*, from `docs/specs/2026-10-28-explicit-schema-sync.md`, asks to rename them, each package whole, with `@typescript-eslint/naming-convention` in the presets; the user dropped the rule at this spec (decision 3). `@enardo/uow-repository` 0.2.0 waits for this rename: published before it, it would cost a `0.3.0` and a second change of range in `cambusa`.

The item reads as a rename, but three of the eleven collide with a class their package already exports: `IRepository`, `IUnitOfWork` and `IMongoDatabase`. The decisions below come from a discussion with the user.

## Probes

- `git grep` of each exported `interface` or `type` starting with `I` in `packages/*` → the eleven names of the item, in five packages. `IPasswordHasher`, named by the 2026-10-28 spec, left with `@enardo/password-hasher` 3.0.0.
- `pnpm view <package> versions` on the registry, from outside the repo → `database` 1.0.0; `database-mongo` 1.0.0; `transaction-manager` 1.0.0; `transaction-manager-mongo` 0.1.0; `uow-repository` 0.1.0; `uow-repository-mongo` 0.1.0. The manifests are at 2.0.0, 2.0.0, 1.0.0, 0.2.0, 0.2.0, 0.2.0: only `transaction-manager` is at a published version.
- From the `critic`'s run, rerun in the dev container: `naming-convention` with a `^I[A-Z][a-z]` regex misses `IHTTPClient` and `export type { Plain as IFoo }`. `git log -p 2099677..HEAD -- 'packages/*/src/*'`, by the `critic`: 25 exported types added since the import, none with the prefix but a redeclared `IMongoDatabase`.
- `git grep` of prefixed names in READMEs and package `CLAUDE.md` files, outside the eleven → `packages/entities/README.md:72-84,131-139`: `IEntityCommonAttributes` and `IAggregateRootCommonAttributes`, which the package does not export (it exports them unprefixed, `src/entity.ts:4`, `src/aggregate-root.ts:10`), and the local `IProductAttributes`, `IUserAttributes`.
- `git grep` of the importers of the two transaction packages → `transaction-manager` is imported by `transaction-manager-mongo` and `uow-repository`; `transaction-manager-mongo` by `uow-repository-mongo`.
- `tsc --strict --verbatimModuleSyntax` of the old usage against declarations with the new names (a small copy of the shapes, not the real package), every line marked → `import { Repository, UnitOfWork }` TS1484; `IRepository`, `IUnitOfWork` TS2724; `extends Repository<…4>` TS2689; `new UnitOfWork<object>()` TS2693; `UnitOfWork<object>` TS2315; `Repository<…4>` as a type TS2314; `.register()` on a `UnitOfWork` TS2339. The unmarked lines compile. So the old use of a class fails to compile, and the one form that still compiles is a parameter-less `UnitOfWork` type, narrowed to `execute` and `hasPendingChanges`.
- In a throwaway clone, `transaction-manager` at 2.0.0 and `pnpm install --frozen-lockfile --lockfile-only` → passes, the lockfile unchanged.
- `cambusa`, `git grep` → none of the new names is declared there; none of its lines imports them from `mongodb` or a local file. Lines using an old name: `IMongoSchema` 32, `IMongoTransaction` 30, `IRepository` 14, `ITransactionManager` 8, `IUnitOfWork` 8; the other six names 0. Seven `extends Repository`, six `new UnitOfWork`, and their 13 imports: about 115 lines. It declares no type of its own with the prefix.
- `mongodb.d.ts` exports no `Transaction`, `MongoTransaction`, `MongoSchema`, `MongoIndex`, `MongoValidation`, `MongoDatabaseOptions` as a class, interface or type → `grep` of its `export` lines.
- `MongoDatabase` has `private` members (`src/mongo.database.ts:67`), so a plain object is not assignable to the class; its two sync methods carry their own JSDoc (`:259`, `:308`). Not probed: a `Pick<MongoDatabase, …>` fake, which case 3 compiles.
- Runtime reads of a class's name in `packages/uow-repository/src` (`git grep '\.name\b'`) → none; string literals naming either class there → none. `packages/database-mongo/src/mongo.database.ts:242` names `MongoDatabase` in a message, unchanged.
- `packages/cqrs/README.md:26` writes `() => UnitOfWork` in an example; `cqrs` does not depend on `uow-repository`, and only `execute` is called on it, which the new contract has. It stays.
- Upgrade notes: `database`, `database-mongo`, `uow-repository`, `uow-repository-mongo` have one; `transaction-manager`, `transaction-manager-mongo` have none. `CLAUDE.md` holds 11 940 of its 12 000 bytes.

## Decisions

Taken with the user at intake.

1. **The contract takes the plain name, the class a qualifier:** `Repository` and `UnitOfWork` are the interfaces, `TrackingRepository` and `TransactionalUnitOfWork` the classes. It follows `EmailSender` and `NodemailerEmailSender`; domain code keeps the plain name; old uses of the classes fail to compile (probe). Not taken: the classes keep their names and the contracts take a new one, which touches fewer lines in `cambusa` but puts the longer name on the type the domain depends on, and no good name came up.
2. **`IMongoDatabase` is removed, not renamed.** `MongoDatabase` the class is the type. Nothing outside the class uses the interface, in this repo or in `cambusa`. `Database` stays the contract; a fake takes `Pick<MongoDatabase, …>`. Not taken: a qualified interface name, for a type nobody asks for.
3. **No lint rule.** The queued item asked for `naming-convention` in the presets. No type took the prefix since the import, `cambusa` declares none, and once none is left to copy, review is enough: the reasoning that dropped `no-restricted-exports` on 2026-11-02. The rule would also bind the projects, its checks would be manual, and it would leave holes (probe). Added later, it costs a major of `@enardo/eslint-config` once 2.0.0 is out, which is accepted. Not taken: the rule, on every type-like declaration or on exported ones. It goes to *Dropped* in `docs/backlog.md`.
4. **Versions:** `transaction-manager` goes to 2.0.0; the other four renamed packages take the change in their unpublished version, with no bump.
5. **An ADR records the naming rule** (`docs/adr/0017-…`): it outlives the task. The root `CLAUDE.md` gains nothing: with no type left to copy, "match the surrounding code" already covers it (decision 3).
6. **The rename happens, for uniformity alone.** No harm from the names was reported, and leaving them alone was the other option: the benefit is one convention across the public types, a call of taste. It costs about 115 lines in `cambusa`, a major of `transaction-manager` with no other change (6 ranges in `cambusa` that would otherwise stay), and a migration path that can compile wrong (*Risks*). Now is the cheapest moment: the other renamed packages are at unpublished versions, and `cambusa` moves their ranges anyway.

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
- **READMEs:** every example and table takes the new names. In `uow-repository`, `interface UserRepository extends IRepository` becomes `extends Repository`, and `extends Repository<User, …>` becomes `extends TrackingRepository<User, …>`. An *Upgrading* note, new where the probe found none (`transaction-manager`, `transaction-manager-mongo`), holds that package's rows of the table, and:
  - `database-mongo`: line 79's "`IMongoDatabase` declares the two methods: a fake of it adds them" becomes the removal and the `Pick`;
  - `transaction-manager-mongo` and `uow-repository`: `@enardo/transaction-manager` `^2.0.0`;
  - `uow-repository`: what the probe found still compiling, a parameter-less `UnitOfWork` type, which no longer has the class's other members; and the order of a mechanical rename, the classes first (*Risks*);
- **`entities`, README only:** the two examples import the exported, unprefixed names, and their local types lose the prefix: today they do not compile, and they teach the prefix. No version change.
- **`docs/adr/`:** `0017`, and its row in the index.
- **`docs/backlog.md`:** the item leaves, and the rule goes to *Dropped* with its reason, in a commit of its own.

## Test cases

The behavior does not change: the existing suites are the check, with the names replaced. These cases cover what they cannot see: a suite imports from `~/repository`, so a missing export of `src/index.ts` passes it, and `@enardo/database` has no tests. Cases 1 to 3 go in a `__tests__/public-api.test.ts` of each package, importing from `~/index`, in the form of `packages/errors/__tests__/index.test.ts`: a `@ts-expect-error` on each old name's import, and `expectTypeOf`.

1. `uow-repository`: `new TransactionalUnitOfWork(manager)` is assignable to `UnitOfWork`, and `new TrackingRepository(store, mapper)` to `Repository<TDomain, TId>`. `IRepository` and `IUnitOfWork` fail to import. The module object has `TrackingRepository` and `TransactionalUnitOfWork`, and has no key `Repository` or `UnitOfWork`, which an `export { TrackingRepository as Repository }` would leave.
2. `transaction-manager` and `transaction-manager-mongo`: `Transaction`, `TransactionManager` and `MongoTransaction` import from `~/index`; `MongoTransaction` extends `Transaction`; `MongoTransactionManager` is assignable to `TransactionManager<MongoTransaction>`; each old name fails to import.
3. `database-mongo`: `MongoDatabaseOptions`, `MongoIndex`, `MongoSchema` and `MongoValidation` import from `~/index`; `MongoDatabase` is assignable to `Database`; a plain object with `syncSchema` and `dropStaleIndexes` is assignable to `Pick<MongoDatabase, "syncSchema" | "dropStaleIndexes">`; each old name, `IMongoDatabase` included, fails to import.
4. `database`, which has no test script (manual, and it stays so): `dist/index.d.mts` exports `Database`, and not `IDatabase`.
5. Existing suites: `pnpm verify` green, and a `git diff main -- 'packages/*/__tests__/*'` on the existing files that holds only renames (`--word-diff`), no changed assertion or case.
6. No old name survives: `git grep` of the eleven names, and `grep -r` over `packages/*/dist/*.d.mts`, after a forced build. Allowed hits: the *Upgrading* notes, the frozen specs, ADR 0017, this repo's `@ts-expect-error` lines of cases 1 to 3. `git grep -E '\bI[A-Z][a-z][A-Za-z]*\b'` (which leaves `IPv4`) over `packages/*/README.md` and `packages/*/CLAUDE.md` hits only the *Upgrading* notes.
7. Packing in a throwaway directory: the manifests of `uow-repository` and `transaction-manager-mongo` name `@enardo/transaction-manager` `^2.0.0`, `transaction-manager`'s is 2.0.0. Nothing is published.

## Risks

Risk is `low`. A consumer still on an old name fails to compile, which the probe shows for every form but the narrowed `UnitOfWork` type. The rename order can go wrong: renaming `IRepository` to `Repository` first merges it with the class, and a later rename would hit both. Here, step 4 renames the classes first; case 1 and the type check show the outcome. In a consumer, that order would compile and put `TransactionalUnitOfWork` where the application layer held the contract (`cambusa`'s `catalog-scope.ts:11` and its like): the upgrade note gives the order.

## Out of scope

- Publishing, in a session of its own: `transaction-manager` 2.0.0 goes before the packages whose range names it.
- The migration of `cambusa`, in its repo, from the *Upgrading* notes.
- `en-monorepo`, split on 2026-10-16: it uses `workspace:*` and no longer consumes these packages.
- Renaming files, or any other public name.

## Plan

Each step ends green on the package it names and its dependents, and committed. No step is test-first: the compiler is the failing check of a rename. Cases 1 to 3 go in the step of their package.

Each commit also takes its importers' use of the name it renames, in `src` and tests, so that no commit leaves a dependent red; `pnpm exec turbo run build --filter=<dependent>...` before checking it.

1. `@enardo/database`: rename, README; `database-mongo`'s use of `IDatabase` moves here. Commit `[@enardo/database] refactor: drop the I prefix`.
2. `@enardo/database-mongo`: rename, the removal, the JSDoc, README, case 3. Commit `[@enardo/database-mongo] refactor: drop the I prefix`.
3. `@enardo/transaction-manager`: rename, 2.0.0, README; the uses of `ITransaction` and `ITransactionManager` in `transaction-manager-mongo` and `uow-repository` move here. Commit `[@enardo/transaction-manager] refactor: drop the I prefix`. Then `@enardo/transaction-manager-mongo`: rename, README, case 2; the uses of `IMongoTransaction` in `uow-repository-mongo` move here. Commit `[@enardo/transaction-manager-mongo] refactor: drop the I prefix`.
4. `@enardo/uow-repository`: **first** the classes to `TrackingRepository` and `TransactionalUnitOfWork`, **then** `IRepository` and `IUnitOfWork` to the plain names, with word-bounded replacements; README, upgrade note, case 1. Commit `[@enardo/uow-repository] refactor: name the contracts plainly`.
5. `@enardo/uow-repository-mongo`: the classes' new names in tests, JSDoc and README. It moves in the commit of step 4, for the same reason as in step 3.
6. `@enardo/entities`: the README. Commit `[@enardo/entities] docs: use the exported names in the examples`. Cases 4, 6 and 7, and `pnpm verify`. The backlog item leaves, the rule goes to *Dropped*. Commit `[repo] docs: close the I prefix item`. ADR 0017 goes to `accepted`, and the spec to `done` at the merge.
