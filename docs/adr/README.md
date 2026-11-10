# Architecture decision records

Decisions that apply beyond a single task: why the monorepo works the way it does. Specs (`docs/specs/`) record how one task was done and are frozen after merge; an ADR records a decision that later tasks must respect or deliberately overturn.

An ADR is never edited after it is accepted, except for its status. To change a decision, write a new ADR that supersedes it, and set the old one's status to `superseded by NNNN`.

## Index

| # | Decision | Status |
| --- | --- | --- |
| [0001](0001-shared-configs-as-workspace-packages.md) | Shared TypeScript and ESLint configs live in workspace packages, with a local-override rule | accepted; `workspace:*` superseded by 0004; *A third package for vitest configs* overturned by 0010; point 2's moving into a preset of an override two packages need superseded by 0011 |
| [0002](0002-strict-compiler-and-type-aware-lint.md) | Strict compiler flags and type-aware linting; findings are fixed, not suppressed | accepted |
| [0003](0003-type-guards-claim-only-what-they-check.md) | A type guard never claims more than its check proves; `@enardo/http-status` splits class and membership guards | accepted |
| [0004](0004-shared-packages-published-to-a-private-registry.md) | The shared packages are published to a private registry, and depend on each other through `workspace:^` | accepted |
| [0010](0010-a-vitest-preset-package.md) | The browser test project lives in a vitest preset package | accepted |
| [0011](0011-only-a-block-moves-into-a-preset.md) | Only a block of configuration that a second package needs moves into a preset; a scalar is repeated with its comment, unless it fits every package on a preset | accepted |
| [0012](0012-errors-recognized-by-a-brand.md) | An error of the ecosystem is recognized by a brand and its `code`, never by `BaseError`'s identity | accepted; point 3's open question settled by 0013; point 5 settled by fix/database/error-contract-and-lifecycle (DatabaseError removed); point 6's test given by 0018 |
| [0013](0013-contract-peer-of-its-adapter.md) | A contract is a peer of the adapter that implements it | accepted |
| [0014](0014-a-package-logs-only-what-its-caller-cannot-see.md) | A package logs only what its caller cannot see, at `debug` or `warn`, and takes no `logger` without a log point | accepted |
| [0016](0016-passwords-argon2id-on-node-crypto.md) | Passwords are hashed with Argon2id on `node:crypto`, in one package | accepted |
| [0017](0017-types-take-no-i-prefix.md) | Types take no `I` prefix, and a contract takes the plain name | accepted |
| [0018](0018-where-the-refused-value-comes-from.md) | Where a refused value comes from decides between a `BaseError` and a native error | accepted; its `ENTITY_*` row has no subject since `@enardo/entities` 3.0.0 (ADR 0020) |
| [0019](0019-the-diff-compares-only-what-the-mapper-returns.md) | The diff compares only the fields the mapper returns, with the values the store read | accepted |
| [0020](0020-an-aggregate-raises-only-its-domain-events.md) | An aggregate raises only the domain events its class declares; what changed in the store is reported by the unit of work | accepted; point 3 superseded by 0021 |
| [0021](0021-the-unit-of-work-hands-over-domain-events-inside-the-transaction.md) | The unit of work hands the aggregates' domain events to the app inside the transaction; it reports no change set | accepted |

## Template

```markdown
# NNNN. <decision, as a short sentence>

- Status: proposed | accepted | superseded by NNNN
- Date: YYYY-MM-DD
- Spec: docs/specs/<the task that led to it>, if any

## Context

The forces at play: what problem, what constraints, what was measured.

## Decision

What we do, stated so that someone can check whether a change follows it.

## Consequences

What becomes easier, what becomes harder, what we accept.

## Alternatives considered

Each option not taken, and why.
```
