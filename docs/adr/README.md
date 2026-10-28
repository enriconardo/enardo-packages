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
| [0005](0005-workflow-sized-to-the-task.md) | The workflow is sized to the task, and a review blocks only on defects a real caller meets | accepted; point 1 superseded by 0008; point 6's "no new subagents" superseded by 0007, and also lifted by 0015 for the `lesson-critic` |
| [0006](0006-test-author-suite-recorded-at-handoff.md) | The test-author's suite is recorded at handoff, and a change to it needs a reason | accepted |
| [0007](0007-critic-of-specs.md) | A critic that sees only the spec judges it before the user does | accepted; point 5 superseded by 0009; *Every rule of the learn step* overturned by 0015 |
| [0008](0008-implementation-on-the-specs-model.md) | Four ratings raise the tier, and an M or L task is implemented in a fresh session on the spec's model | accepted |
| [0009](0009-critic-runs-no-longer-logged.md) | The critic keeps its triggers, and its runs are no longer logged | accepted |
| [0010](0010-a-vitest-preset-package.md) | The browser test project lives in a vitest preset package | accepted |
| [0011](0011-only-a-block-moves-into-a-preset.md) | Only a block of configuration that a second package needs moves into a preset; a scalar is repeated with its comment, unless it fits every package on a preset | accepted |
| [0012](0012-errors-recognized-by-a-brand.md) | An error of the ecosystem is recognized by a brand and its `code`, never by `BaseError`'s identity | accepted; point 3's open question settled by 0013 |
| [0013](0013-contract-peer-of-its-adapter.md) | A contract is a peer of the adapter that implements it | accepted |
| [0014](0014-a-package-logs-only-what-its-caller-cannot-see.md) | A package logs only what its caller cannot see, at `debug` or `warn`, and takes no `logger` without a log point | accepted |
| [0015](0015-a-lesson-critic-judges-every-learn-proposal.md) | A light critic judges every lesson the learn step proposes, from its evidence and the rules it would join | accepted |

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
