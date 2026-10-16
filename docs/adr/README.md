# Architecture decision records

Decisions that apply beyond a single task: why the monorepo works the way it does. Specs (`docs/specs/`) record how one task was done and are frozen after merge; an ADR records a decision that later tasks must respect or deliberately overturn.

An ADR is never edited after it is accepted, except for its status. To change a decision, write a new ADR that supersedes it, and set the old one's status to `superseded by NNNN`.

## Index

| # | Decision | Status |
| --- | --- | --- |
| [0001](0001-shared-configs-as-workspace-packages.md) | Shared TypeScript and ESLint configs live in workspace packages, with a local-override rule | accepted; `workspace:*` superseded by 0004 |
| [0002](0002-strict-compiler-and-type-aware-lint.md) | Strict compiler flags and type-aware linting; findings are fixed, not suppressed | accepted |
| [0003](0003-type-guards-claim-only-what-they-check.md) | A type guard never claims more than its check proves; `@enardo/http-status` splits class and membership guards | accepted |
| [0004](0004-shared-packages-published-to-a-private-registry.md) | The shared packages are published to a private registry, and depend on each other through `workspace:^` | accepted |
| [0005](0005-workflow-sized-to-the-task.md) | The workflow is sized to the task, and a review blocks only on defects a real caller meets | accepted; point 6's "no new subagents" superseded by 0007 |
| [0006](0006-test-author-suite-recorded-at-handoff.md) | The test-author's suite is recorded at handoff, and a change to it needs a reason | accepted |
| [0007](0007-critic-of-specs.md) | A critic that sees only the spec judges it before the user does | accepted |

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
