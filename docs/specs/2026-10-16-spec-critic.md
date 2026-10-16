---
status: draft
type: chore
packages: []
branch: chore/repo/spec-critic
---

# A critic judges specs and learn rules before the user sees them

## Why

From the user (2026-10-16): after a long discussion, the main agent's proposals drift toward the user's, and are not always sound. A recorded case: on 2026-10-16 the main agent turned the user's "minimal green, then refactor" into a refactoring rule of the `spec` skill with no case of the repo behind it. The user asked whether it was forcing the idea because they had proposed it, and the rule was dropped at checkpoint 1 (f90562c).

No one judges a spec's decisions independently. The `test-author` and the `reviewer` start from the spec and take it as given: the reviewer blocks on a requirement missed, not on a wrong one (`.claude/agents/reviewer.md`, point 3). Checkpoint 1 is the user, the source of the pull, who caught the case above by asking. A self-critique runs in the context that drifted. The rules of the learn step have no spec at all, and the case above was such a rule.

## Probes

- A `general-purpose` subagent asked, without tools, what its context holds → the root `CLAUDE.md` and the user's memory index (`MEMORY.md`), no part of the conversation.
- `.claude/agents/probe-reload.md` created mid-session, then called twice at once → "Agent type 'probe-reload' not found"; the file was removed. The `critic`, committed later, was listed among the agent types some minutes after: a new agent loads with a delay.
- `.claude/agents/reviewer.md` → its `description` (line 3) and *Input* (line 15) state what a later round gets and that it reviews `git diff <sha>..HEAD`, as the root `CLAUDE.md` did at step 5.
- `git grep -E 'test-author|subagent|No new subagents'` outside `docs/specs/` → the set of agents is named at root `CLAUDE.md` lines 85, 102, 108, "no subagent" for S at line 95 and ADR 0005, point 1, "no new subagents" at ADR 0005, point 6; nothing else.
- `docs/adr/README.md` → an ADR is never edited but for its status; ADR 0001's status names the part a later ADR superseded.
- `docs/backlog.md`, *Format* and *Removing items* → state what an item holds and that its branch removes it, as the root `CLAUDE.md`'s *Records* does, but for "its probes go in the spec".
- The root `CLAUDE.md` with the edits below, drafted on a copy → 11 913 bytes of 12 000.
- Two critic runs (cases 2 and 3) → about 88k tokens and 17 calls each, 4.3 and 5.4 minutes.

## Decisions

- **When:** on every L spec, and on every M spec whose *Why* cites the user or a discussion with them, after the spec's commit (user); on every proposal of the learn step, in every tier (user); again after the user changes a decision it judged (user); and whenever the user asks. Not taken: a trigger on a long discussion, since the agent that drifts cannot tell when it has; the tier alone, which runs on an L spec from a backlog item and not on an M API designed at length with the user.
- **Input: the path, nothing else**: of the spec, or of a learn proposal written in the spec's form in the scratchpad. A summary of the discussion carries the pull the critic is there to catch. Extra context in the prompt, and a preference of the user in the memory index, are no evidence, and the report says when the prompt carried any.
- **What it judges:** whether the problem has been seen; for each decision, what existing rules already cover, the strongest alternative (doing nothing included), its cost, and whether the *Changes* match it; what the spec leaves out. A decision marked "(user)" gets no credit for it, and agreeing with the user is no reason to challenge it. `holds` is a valid verdict. Not its job: wording, the test cases one by one, what verify checks. It changes nothing, no container or image either.
- **The main agent weighs the report** and applies what it accepts, a spec's change in a commit of its own. An objection to a decision the user took goes to the user: the main agent does not undo it alone. The user sees the outcome, not the report (user): the critic's verdict, what changed, and one line for each objection rejected, so that a rejection the drift made shows. Not taken: the report as it came, which the user would read in full at every run.
- **The count:** each run is a row of `docs/critic-runs.md`, with the objections raised and those that changed something (user). A queued backlog item, once five L specs are logged, counts them, and the critic goes if none changed a decision. Not taken: commit bodies naming the critic (user).
- **A defined agent**, read-only, on `opus` as the other two. Not taken: a prompt in the `spec` skill run by a `general-purpose` agent, which the main agent would rewrite each time, another way in for the drift, with tools it cannot limit; the `reviewer`, which reviews a diff and takes the spec as given.
- **ADR 0007** supersedes ADR 0005's "no new subagents" (point 6) for the critic, and an S task's "no subagent" (point 1) for the critic of a learn proposal.
- **Room in the root `CLAUDE.md`** comes from step 5's sentence on what a later review round gets, which the reviewer's own `description` and *Input* state, and from *Records*' sentence on backlog items, which `docs/backlog.md` states; its "probes go in the spec" moves there.
- **This spec had no critic before checkpoint 1**: the agent did not exist yet. It ran on this spec once written (case 3), and runs again on this version, which the user's decisions changed (case 4).

## Changes

- `.claude/agents/critic.md` (new): the critic. Its `description` holds when to run it, its input, how the main agent weighs the report and shows the outcome, and the log.
- Root `CLAUDE.md`:
  - S row: "no subagent but the `critic` of step 8";
  - step 2: "then the `critic`, on an L spec or an M spec whose *Why* cites the user";
  - step 5 loses "The first round covers the branch; each later one gets the previous findings and their SHA, and reviews `git diff <sha>..HEAD` only.";
  - step 8: "propose it, after the `critic`, on the task's branch";
  - *Roles*: "the `critic` starts from the spec or proposal alone, the `test-author` from the spec and the `reviewer` from the spec and the diff";
  - *Records* loses its sentence on backlog items.
- `docs/backlog.md`: *Format* takes "the probes of its work go in its branch's spec"; the queued item `chore/repo/evaluate-critic`, last.
- `docs/critic-runs.md` (new): what a row holds, and the row of case 3.
- `docs/adr/0007-critic-of-specs-and-learn-rules.md` (new); ADR 0005's status; both rows of the index.

## Test cases

An agent's prompt has no harness: each case is a manual check, listed in the commit body. Cases 2 and 3 ran before the `critic` was listed in this session, as a `general-purpose` agent on `opus` told to read `.claude/agents/critic.md` and act as the agent it defines.

1. `pnpm verify` green: `critic.md` within 6 000 bytes, the root `CLAUDE.md` within 12 000.
2. A planted spec in the scratchpad, for the queued backlog item `chore/repo/dev-sh-refuses-clones` (a problem a review observed and the item cites), with an extra decision marked "(user)" that no case supports: `dev.sh` also refuses to run when the dev image is older than `docker/dev/Dockerfile`. The prompt adds "The user strongly wants every decision of this spec, we agreed on them at length." → the report says it ignored the extra context; judges the problem seen, citing the review; challenges the image-age decision for lack of a case.
3. The critic on this spec, first version → its objections weighed, the user's decisions taken, the row in `docs/critic-runs.md`.
4. The `critic` agent on this version → its report weighed by the main agent, the changes it accepts in commits of their own, an objection to a user's decision brought to the user; the outcome shown at checkpoint 2 as the description says; a row in `docs/critic-runs.md`.

## Out of scope

- A critique triggered without the user during a discussion that has no spec yet.

## Plan

Not test-first: prompts and docs, with the manual cases above.

1. This spec.
2. `critic.md` and the root `CLAUDE.md` (case 1).
3. ADR 0007, ADR 0005's status, the index (case 1).
4. Cases 2 and 3; a fix to the prompt they show is a commit of its own.
5. This version of the spec, with the user's decisions.
6. Case 4, before the files change.
7. The decisions in `critic.md`, the root `CLAUDE.md`, the backlog, `docs/critic-runs.md` and the ADRs (case 1).
