# 0007. A critic that sees only the spec judges it before the user does

- Status: accepted
- Date: 2026-10-16
- Spec: docs/specs/2026-10-16-spec-critic.md

## Context

The main agent writes a spec at the end of a discussion with the user, and over a long discussion its proposals drift toward the user's. Two cases on 2026-10-16, both on L specs of the workflow:

- The main agent turned the user's "minimal green, then refactor" into a refactoring rule with no case of the repo behind it; the user caught it at checkpoint 1 by asking (f90562c).
- In this ADR's first version, it wrote "the user has seen the drift since", more than the user had said, although a memory rule on judging the user's proposals on evidence already existed (93ade53).

The user reports the drift, above all after long discussions.

No one judged a spec's decisions independently. The `test-author` and the `reviewer` start from the spec and take it as given: the reviewer blocks on a requirement missed, not on a wrong one. Checkpoint 1 is the user, the source of the pull. A self-critique runs in the context that drifted.

ADR 0005 (point 6) had chosen no new subagents, since each run starts cold and re-reads the same context.

## Decision

1. A `critic` agent, read-only, judges a spec: whether its problem has been seen; for each decision, what the existing rules cover, the strongest alternative, doing nothing included, and the cost; what the spec leaves out. A decision marked as the user's gets no credit for it.
2. It runs after the commit of every L spec, and of every M spec whose *Why* says it or a decision comes from a discussion with the user; again after the user changes a decision it judged, on what changed; and on any proposal in the spec's form when the user asks, a rule of the learn step included.
3. It gets the path, and on a re-run the commit of the version it judged: no summary of the discussion, which would carry the drift.
4. The main agent weighs the report and applies what it accepts, in a commit of its own; an objection to a decision the user took goes to the user, with the main agent's view. The user sees the outcome: the verdict, what changed, and each rejected objection by the critic's own headline, with the main agent's reason. The report is kept in the scratchpad.
5. Each run is a row of `docs/critic-runs.md`, with its trigger. Once five L specs are logged, a backlog item counts the rows by trigger, and a trigger goes if none of its runs changed a decision.
6. This supersedes ADR 0005's "no new subagents" (point 6) for the critic; the rest of point 6 stands.

## Consequences

- A run reads about 1M input tokens, summed over its 15 to 20 calls, in 4 to 7 minutes; a reviewer's first round, about 1.3M. An L task pays at least one run, an M task from a discussion with the user too, and each change of a decision by the user one more.
- The critic sees the root `CLAUDE.md` and the user's memory index, as every subagent does, but not the conversation; a preference in the memory index is no evidence to it.
- The spec is written by the agent that drifted, and its *Why* may carry the drift's framing: the critic treats the problem as a claim to check.
- The user reads the outcome, not the report; the critic's own headlines show what the main agent set aside.
- A drift in a discussion that has no spec yet, or in a rule of the learn step, is checked only when the user asks.
- A critic asked to criticize may invent objections. A `holds` verdict is valid, an objection needs evidence, and the user decides.

## Alternatives considered

- **A self-critique in the main agent's context**, a rule of its own or of its memory included: it runs in the context that drifted, and the second case passed such a rule.
- **A critique triggered by a long discussion**: the agent that drifts cannot tell when it has.
- **The tier alone**: it misses an M designed at length with the user.
- **Every M spec**: the user is named in almost every *Why*, as whoever queued the item, so it would be a run on every task.
- **Every rule of the learn step**: no case of a learn rule that drifted, at about 1M input tokens a run.
- **The report as it came, to the user**: the user would read every run in full.
- **A prompt in the `spec` skill, run by a `general-purpose` agent**: the main agent would rewrite it each time, another way in for the drift.
- **The `reviewer`**: it reviews a diff against the spec, and takes the spec as given.
- **Commit bodies naming the critic, to count its runs**: the user keeps them out of the commits.
