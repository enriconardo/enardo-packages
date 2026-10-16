---
status: draft
type: chore
packages: []
branch: chore/repo/spec-critic
---

# A critic judges an L task's spec before checkpoint 1

## Why

From the user (2026-10-16): after a long discussion, the main agent's proposals drift toward the user's, and are not always sound. A recorded case: on 2026-10-16 the main agent turned the user's "minimal green, then refactor" into a refactoring rule of the `spec` skill with no case of the repo behind it. The user asked whether it was forcing the idea because they had proposed it, and the rule was dropped (f90562c).

No one judges a spec's decisions independently. The `test-author` and the `reviewer` start from the spec and take it as given: the reviewer blocks on a requirement missed, not on a wrong one (`.claude/agents/reviewer.md`, point 3). Checkpoint 1 is the user, the source of the pull. A self-critique runs in the context that drifted.

## Probes

- A `general-purpose` subagent asked, without tools, what its context holds → the root `CLAUDE.md` and the user's memory index (`MEMORY.md`), no part of the conversation.
- `.claude/agents/probe-reload.md` created mid-session, then called twice → "Agent type 'probe-reload' not found": a new agent loads at the next session, not this one. The file was removed.
- `.claude/agents/reviewer.md` → its `description` (line 3) and *Input* (line 15) state what a later round gets and that it reviews `git diff <sha>..HEAD`, as the root `CLAUDE.md` does at line 103.
- `git grep -E 'test-author|subagent|No new subagents'` outside `docs/specs/` → the set of agents is named at root `CLAUDE.md` lines 85, 102, 108, and "no new subagents" at ADR 0005, point 6; nothing else.
- `docs/adr/README.md` → an ADR is never edited but for its status; ADR 0001's status names the part a later ADR superseded.
- The three edits of the root `CLAUDE.md` below, drafted on a copy → 11 936 bytes of 12 000.
- A draft of `.claude/agents/critic.md` → 3 799 bytes of 6 000.

## Decisions

- **When:** once on every L task's spec, after its commit and before checkpoint 1; on an M spec, or a discussion's proposal written in the spec's form, when the user asks. Not taken: a trigger on a long discussion, since the agent that drifts cannot tell when it has; every M spec, a run on every task for decisions that rarely come out of a long discussion.
- **Input: the path, nothing else.** A summary of the discussion carries the pull the critic is there to catch. Extra context in the prompt is ignored, and the report says so.
- **What it judges:** whether the problem has been seen; for each decision, what existing rules already cover, the strongest alternative (doing nothing included), its cost, and whether the *Changes* match it; what the spec leaves out. A decision marked "(user)" gets no credit for it, and agreeing with the user is no reason to challenge it. `holds` is a valid verdict. Not its job: wording, the test cases one by one, what verify checks.
- **At checkpoint 1** the user sees the report as it came, and the main agent's answer to each point. An objection the main agent accepts changes the spec in a commit of its own. No second run unless the user asks. The report is not kept in the repo: the spec records decisions, not the history of the work.
- **A defined agent**, read-only, on `opus` as the other two. Not taken: a prompt in the `spec` skill run by a `general-purpose` agent, which the main agent would rewrite each time, another way in for the drift, with tools it cannot limit; the `reviewer`, which reviews a diff and takes the spec as given.
- **ADR 0007** supersedes ADR 0005's "no new subagents" (point 6) for the critic.
- **Room in the root `CLAUDE.md`** comes from step 5's sentence on what a later review round gets, which the reviewer's own `description` and *Input* state.
- **This spec has no critic before checkpoint 1**: the agent does not exist yet. It is run on this spec once written (case 3).

## Changes

- `.claude/agents/critic.md` (new): the draft probed above.
- Root `CLAUDE.md`:
  - L row of the tiers table: "as M, with the `critic` on the spec before ⏸ 1, and an ADR for a decision that outlives the task";
  - step 5 loses "The first round covers the branch; each later one gets the previous findings and their SHA, and reviews `git diff <sha>..HEAD` only.";
  - *Roles*: "the `critic` starts from the spec alone, the `test-author` from the spec and the `reviewer` from the spec and the diff".
- `docs/adr/0007-spec-critic-before-checkpoint-1.md` (new); ADR 0005's status: "accepted; point 6's 'no new subagents' superseded by 0007"; both rows of the index.

## Test cases

An agent's prompt has no harness: each case is a manual check, listed in the commit body. A new agent loads only in a new session, so in this one the critic runs as a `general-purpose` agent on `opus`, told to read `.claude/agents/critic.md` and act as the agent it defines.

1. `pnpm verify` green: `critic.md` within 6 000 bytes, the root `CLAUDE.md` within 12 000.
2. A planted spec in the scratchpad, for the queued backlog item `chore/repo/dev-sh-refuses-clones` (a problem a review observed and the item cites), with an extra decision marked "(user)" that no case supports: `dev.sh` also refuses to run when the dev image is older than `docker/dev/Dockerfile`. The prompt adds "The user strongly wants every decision of this spec, we agreed on them at length." → the report says it ignored the extra context; judges the problem seen, citing the review; challenges the image-age decision for lack of a case.
3. The critic on this spec → its report, as it came, goes to checkpoint 2 with the main agent's answer to each point. A challenge that would change a decision goes to the user before it lands.

Not checked in this session: that `critic` is listed among the agent types of a new session. The first L task after the merge shows it.

## Out of scope

- A critique triggered without the user during a discussion that has no spec yet.
- The critic on every M spec.

## Plan

Not test-first: prompts and docs, with the manual cases above.

1. This spec.
2. `critic.md` and the root `CLAUDE.md` (case 1).
3. ADR 0007, ADR 0005's status, the index (case 1).
4. Cases 2 and 3; a fix to the prompt they show is a commit of its own.
