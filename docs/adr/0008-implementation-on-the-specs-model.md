# 0008. Four ratings raise the tier, and an M or L task is implemented in a fresh session on the spec's model

- Status: accepted
- Date: 2026-10-21
- Spec: docs/specs/2026-10-21-orchestrated-workflow.md

## Context

A task cost too much of the user's token budget: `refactor/repo/split-contracts-from-adapters` took about 80% of a five-hour window. Measured on the transcripts, with tokens weighted by API price:

- split-contracts cost about 2.3M weighted tokens, `feature/email/send-errors` about 10M.
- Most of it was the main session's context, reread on every call: 41k at split-contracts' first call, 130k at checkpoint 1, 203k at the end; 490k in send-errors, whose cache reads alone weighed about 4.5M.
- After checkpoint 1, split-contracts spent 0.9M to the merge and 0.5M on a publish in the same session.
- Every subagent ran on Opus at the session's effort, whatever its job.

The tiers of ADR 0005 looked at what a consumer sees, not at what a change could break: a few lines in authentication, or a data migration, were M.

Claude Code 2.1.306, probed on the transcripts' API requests:

- A skill's `model` has no effect when the model launches the skill, and its `effort` lasts until the next turn.
- An agent's `effort` takes effect; an agent without the key runs at the session's live effort.
- The `Agent` tool runs every subagent in the background.

## Decision

1. **Four ratings raise the tier.** At intake the brief rates impact, risk, uncertainty and reversibility, each `low`, `medium` or `high` with a reason (the `spec` skill). The table of the root `CLAUDE.md` is the floor, and a `high` makes the task L. The number of files is a hint.
2. **The brief names the implementation's model and effort**, `sonnet/medium`, or `opus/high` when risk or uncertainty is `high`; another value needs a reason. The spec keeps them as `implementer`, with its `tier`.
3. **After checkpoint 1 the user sets that model and effort in the interface, then `/clear` and `/implement <spec>`.** The skill checks its model against `implementer` and stops on a mismatch. At the next intake the `spec` skill checks that the session runs on Opus.
4. **The fresh session implements by itself**: each plan step, each red verify, each review round's findings, the README in the commit of its public API change. It stops for the user on a decision the spec does not take, a review round from the fourth on, two fixes in a row that leave the same check red, an action outside the repo, and a departure from the spec.
5. **The gate before checkpoint 2** is verify green and a last review round without a blocking finding; the report is assembled from data (verify, the cases and their tests, the changes to the test-author's suites that the reviewer's first round lists, the findings by round).
6. **Publishing and follow-ups go in a session of their own**, after the integration, on the user's model.
7. **No `Stop` hook.** `pnpm verify` runs where the steps name it: the S path's verify step, `/implement` before each review round and checkpoint 2, and `integrate.sh` before the merge, which stays the mechanical gate.

This supersedes point 1 of ADR 0005.

## Consequences

- The implementation rereads a context that starts over at checkpoint 1: an estimated 0.6M against split-contracts' 0.9M.
- The model of the implementation follows the task's risk, but the switch is the user's: a forgotten one is caught for the model, not for the effort, which the session does not see.
- The test-author, the reviewer and the critic set their effort in their definitions, so a session on a lower effort does not lower theirs.
- A red tree can reach the user at a checkpoint when a session skips verify; `integrate.sh` still refuses to merge it.
- A few lines in authentication, or a security fix, are L, with a critic run.

## Alternatives considered

- **A skill variant per model**, launched by `/implement`: a skill's `model` has no effect when the model launches it.
- **An orchestrator that never reads the code**, with an `implementer` subagent on the model it passes: it picks the model without the user, but adds an agent and a cold start per step and review round, for about the same estimated cost.
- **Implementing in the spec's session**: its context is reread on every call.
- **The ratings alone, or the table alone**: the ratings alone would have made split-contracts M, whose critic run changed 3 decisions; the table alone keeps a few lines in authentication M.
- **A `Stop` hook that skips while the test-author writes**, on the uncommitted changes under `__tests__/` or on a marker: the user prefers the simpler flow, with `integrate.sh` as the gate.
