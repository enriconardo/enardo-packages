# 0017. Types take no `I` prefix, and a contract takes the plain name

- Status: proposed
- Date: 2026-11-05
- Spec: `docs/specs/2026-11-05-drop-i-prefix.md`

## Context

Eleven exported types of five packages carried an `I` prefix (`IDatabase`, `IRepository`, `IMongoSchema`…), while every other exported type had none, contracts such as `EmailSender` and `IdGenerator` included. All eleven came with the import of the packages: no type added since took the prefix. Three of the eleven could not simply lose the prefix: `Repository`, `UnitOfWork` and `MongoDatabase` were already the names of classes in the same package.

## Decision

1. **No type takes an `I` prefix.** `@typescript-eslint/naming-convention` in the presets of `@enardo/eslint-config` reports every type-like declaration matching `^I[A-Z][a-z]`, exported or not.
2. **When a contract and its implementation would share a name, the contract keeps it and the implementation takes a qualifier:** `Repository` and `TrackingRepository`, `UnitOfWork` and `TransactionalUnitOfWork`, as with `EmailSender` and `NodemailerEmailSender`. Code that depends on the contract reads plainly, and the qualifier says what the implementation adds.
3. **A class that no caller needs a contract for is its own type.** `MongoDatabase` has no interface of its own: `Database` is the contract, and a fake takes `Pick<MongoDatabase, …>`.

## Consequences

- One convention, kept by lint rather than by review.
- A breaking change in each package that exported such a type, and a migration in the projects built on them: about 115 lines in `cambusa`.
- The presets bind the projects too: a project on `@enardo/eslint-config` 2 with a prefixed type of its own renames it or overrides the rule.
- A name such as `IPv4Address` is reported though it holds no prefix. A package that needs one overrides the rule, with a comment. `IOError` passes.

## Alternatives considered

- **Keep the prefix on all contracts.** It would rename more of the repo's types than it spares, against the common TypeScript convention.
- **Keep the classes' names, and give the contracts a new one.** Fewer lines in `cambusa`, but the longer name lands on the type the domain depends on.
- **A convention in `CLAUDE.md`, without a rule.** Review would have to catch each case, and the projects would not get it.
