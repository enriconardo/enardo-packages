# 0005. The workflow is sized to the task, and a review blocks only on defects a real caller meets

- Status: accepted
- Date: 2026-10-16
- Spec: docs/specs/2026-10-16-lean-workflow.md

## Context

In `en-monorepo`, from 2026-09-23 to 2026-10-16, small changes cost long sessions. Measured over the transcripts of its sessions:

- The main agent took 78% of the input tokens, the `reviewer` 15%, the `test-author` 7%. Most of a review round's cost was the main agent's: tens of calls on a context of 200k to 500k tokens.
- 64 reviews, about 9 minutes each; 36 of the 59 with a verdict asked for changes. One fix took 6 reviews, about 126M tokens and a 66 KB spec; its later blocking findings came from inputs built to break the code, such as a getter that answers differently on two reads.
- A dependency bump took 94 calls and four merges.
- The root `CLAUDE.md` grew from 9.6 KB to 32 KB in 50 commits, each incident adding a rule and its story. Every session and subagent loads it, and the reviewer enforced each rule as a stated convention.

Four mechanisms fed each other: blocking had no bound, each round reviewed the whole branch again, the learn step only added rules, and the spec logged every round. Every task went through the same nine steps.

## Decision

1. **Three tiers.** S (nothing a consumer sees changes) has no spec and no subagent; M (what a consumer sees changes) has a spec, both checkpoints, the `test-author` for the initial suite and the review; L (a new package, a change across packages, the dev environment or the workflow) adds an ADR for a lasting decision. The main agent proposes the tier, the user confirms it.
2. **A review blocks on six kinds of defect only**, listed in `.claude/agents/reviewer.md`: a bug a plausible caller meets with an input the types accept, a security defect with a plausible vector, a spec requirement missed, a spec case missing or vacuous, an unchecked convention broken with a consequence, a doc that misleads in normal use. Inputs built to break the code, rules without a case of their own and surviving mutants are suggestions.
3. **The review loop goes on while a round finds a blocking defect.** A later round reviews only the fixes, `git diff <sha>..HEAD`, and the main agent asks the user before each round from the fourth on.
4. **Follow-ups go in commit messages.** A spec changes only with a decision the user approves, and after the merge it is a record: it is read when something points to it.
5. **The learn step prefers a check to a rule**, and a rule to a story. `pnpm verify` holds the root `CLAUDE.md` to 12 000 bytes and each agent to 6 000.
6. **No new subagents.** Rare procedures are skills (`spec`, `publish`), loaded when used; mechanical steps are scripts (`task-start.sh`, `integrate.sh`, `check-context-size.sh`).

## Consequences

- A small task skips the spec and the subagents; its only checks are `pnpm verify` and checkpoint 2.
- The review converges: on the branch that made this decision, three rounds took 9.5, 3.4 and 2.4 minutes, the last one with no blocking finding.
- Defects found only through inputs built to break the code reach the backlog, not the branch.
- A new rule in the root `CLAUDE.md` or an agent has to merge with an old one or replace it.
- `integrate.sh` merges only a branch that contains `main`: when `main` moves during a task, the branch merges it first, so that verify checks the tree that lands.

## Alternatives considered

- **Stop the review after two rounds**: the user prefers to go on while a real blocking defect remains; the narrower definition and the delta rounds make the loop converge instead.
- **More, narrower reviewers**: each run starts cold and re-reads the same context, so the cost grows with the number of runs.
- **Removing specs after the merge**: a spec at rest costs nothing, and `git grep` would no longer find it.
