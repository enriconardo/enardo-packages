# 0017. Types take no `I` prefix, and a contract takes the plain name

- Status: accepted
- Date: 2026-11-05
- Spec: `git show 3dedb3e:docs/specs/2026-11-05-drop-i-prefix.md` (removed from the tree)

## Context

Eleven exported types of five packages carried an `I` prefix (`IDatabase`, `IRepository`, `IMongoSchema`…), while every other exported type had none, contracts such as `EmailSender` and `IdGenerator` included. All eleven came with the import of the packages: no type added since took the prefix. Three of the eleven could not simply lose the prefix: `Repository`, `UnitOfWork` and `MongoDatabase` were already the names of classes in the same package.

## Decision

1. **No type takes an `I` prefix.** Review keeps it out: no lint rule, since no type took the prefix after the import.
2. **When a contract and its implementation would share a name, the contract keeps it and the implementation takes a qualifier:** `Repository` and `TrackingRepository`, `UnitOfWork` and `TransactionalUnitOfWork`, as with `EmailSender` and `NodemailerEmailSender`. Code that depends on the contract reads plainly, and the qualifier says what the implementation adds.
3. **A class that no caller needs a contract for is its own type.** `MongoDatabase` has no interface of its own: `Database` is the contract, and a fake takes `Pick<MongoDatabase, …>`.

## Consequences

- One convention, kept by review: a project's own types are its own to name.
- A breaking change in each package that exported such a type, and a migration in the projects built on them: about 115 lines in `cambusa`.

## Alternatives considered

- **Leave the names alone.** It costs nothing and no harm was reported; the benefit of the rename is uniformity alone, which the user chose over its cost.
- **Keep the prefix on all contracts.** It would rename more of the repo's types than it spares, against the common TypeScript convention.
- **Keep the classes' names, and give the contracts a new one.** Fewer lines in `cambusa`, but the longer name lands on the type the domain depends on.
- **`@typescript-eslint/naming-convention` in the presets.** It answers a recurrence nobody has seen, binds the projects, and leaves holes: `IHTTPClient`, `export type { Plain as IFoo }`. `no-restricted-exports` was dropped on 2026-11-02 on the same ground: no recurrence, and one rename caught at review. Added later, it costs a major of `@enardo/eslint-config`.
