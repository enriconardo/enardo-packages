# 0006. The test-author's suite is recorded at handoff, and a change to it needs a reason

- Status: accepted
- Date: 2026-10-16
- Spec: docs/specs/2026-10-16-test-handoff-and-idle-verify.md

## Context

The `test-author` writes the initial suite of a test-first step from the spec, in a fresh context, so that the tests do not share the implementer's blind spots. A red suite is never committed: the main agent commits the tests together with the implementation that makes them green. The reviewer reads `main...HEAD`, where the tests appear as committed. An assertion the main agent loosened on the way to green looked like one the `test-author` wrote, and the independence ended at handoff.

## Decision

1. The `test-author` records its suite as its last step, with `scripts/test-handoff.sh record`: a commit under `refs/test-author/<branch>/<n>`, outside `refs/heads`, built through a temporary index. The branch, the index and the working tree stay as they are, and a red suite never lands on the branch.
2. The main agent changes a test of a recorded suite only where the test is wrong, and says why in the commit body.
3. On its first round, the reviewer reads `scripts/test-handoff.sh diff`. An assertion of a recorded suite removed or loosened without a reason in a commit body is blocking; a case added later is not.
4. `integrate.sh` removes the branch's records after the merge.

## Consequences

- The suite as the `test-author` wrote it outlives its run, until the merge.
- The record is taken by the agent that wrote the suite, not by the one whose changes it checks.
- A branch abandoned without `integrate.sh` keeps its records, until `scripts/test-handoff.sh clear <branch>`.
- A second `test-author` run on the same step adds a record; the reviewer reads a change between two records as the second run's.

## Alternatives considered

- **Committing the red suite as `it.fails`**: it changes the tests the `test-author` wrote, and a later commit has to change them again.
- **A patch file in a scratchpad**: the reviewer runs in another context and may not see it.
- **The main agent records the suite**: it is the party whose changes the record checks.
