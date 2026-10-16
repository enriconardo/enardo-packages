# 0007. A critic that sees only the spec judges an L task's spec before checkpoint 1

- Status: accepted
- Date: 2026-10-16
- Spec: docs/specs/2026-10-16-spec-critic.md

## Context

The main agent writes a spec at the end of a discussion with the user, and over a long discussion its proposals drift toward the user's. On 2026-10-16 it turned the user's "minimal green, then refactor" into a refactoring rule of the `spec` skill with no case of the repo behind it; the user asked whether it was forcing the idea because they had proposed it, and the rule was dropped (f90562c). The user has seen the drift since, above all after long discussions.

No one judged a spec's decisions independently. The `test-author` and the `reviewer` start from the spec and take it as given: the reviewer blocks on a requirement missed, not on a wrong one. Checkpoint 1 is the user, the source of the pull. A self-critique runs in the context that drifted.

ADR 0005 (point 6) had chosen no new subagents, since each run starts cold and re-reads the same context.

## Decision

1. A `critic` agent, read-only, judges a spec: whether its problem has been seen; for each decision, what the existing rules cover, the strongest alternative, doing nothing included, and the cost; what the spec leaves out. A decision marked as the user's gets no credit for it.
2. It runs once on the spec of every L task, after the spec's commit and before checkpoint 1; on an M spec, or a discussion's proposal in the spec's form, when the user asks.
3. It gets the path of the spec and nothing else: a summary of the discussion would carry the drift.
4. At checkpoint 1 the user sees its report as it came, and the main agent's answer to each point. An objection the main agent accepts changes the spec in a commit of its own. It runs again only when the user asks.
5. This supersedes ADR 0005's "no new subagents" (point 6) for the critic; the rest of point 6 stands.

## Consequences

- An L task pays one more subagent run, on a spec of a page or two, with no loop.
- The critic sees the root `CLAUDE.md` and the user's memory index, as every subagent does, but not the conversation.
- The spec is written by the agent that drifted, and its *Why* may carry the drift's framing: the critic treats the problem as a claim to check.
- A drift during a discussion that has no spec yet is checked only when the user asks.
- A critic asked to criticize may invent objections. A `holds` verdict is valid, an objection needs evidence, and the user decides.

## Alternatives considered

- **A self-critique in the main agent's context**: it runs in the context that drifted.
- **A critique triggered by a long discussion**: the agent that drifts cannot tell when it has.
- **A prompt in the `spec` skill, run by a `general-purpose` agent**: the main agent would rewrite it each time, another way in for the drift, and could not limit its tools.
- **The `reviewer`**: it reviews a diff against the spec, and takes the spec as given.
- **Every M spec too**: a run on every task, for decisions that rarely come out of a long discussion; the user asks when one does.
