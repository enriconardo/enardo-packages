---
status: done
type: chore
packages: []
branch: chore/repo/spec-critic
---

# A critic judges a spec before the user sees it

## Why

From the user (2026-10-16): after a long discussion, the main agent's proposals drift toward the user's, and are not always sound. Two cases on 2026-10-16:

- The main agent turned the user's "minimal green, then refactor" into a refactoring rule of the `spec` skill with no case of the repo behind it. The user asked whether it was forcing the idea because they had proposed it, and the rule was dropped at checkpoint 1 (f90562c).
- In ADR 0007's first version (040ad60), the main agent wrote "the user has seen the drift since", more than the user had said. The memory rule on judging the user's proposals on evidence already existed; the critic's first run on this spec caught it (93ade53).

No one judges a spec's decisions independently. The `test-author` and the `reviewer` start from the spec and take it as given: the reviewer blocks on a requirement missed, not on a wrong one (`.claude/agents/reviewer.md`, point 3). Checkpoint 1 is the user, the source of the pull, who caught the first case by asking. A self-critique runs in the context that drifted, as the second case shows.

## Probes

- A `general-purpose` subagent asked, without tools, what its context holds → the root `CLAUDE.md` and the user's memory index (`MEMORY.md`), no part of the conversation.
- `.claude/agents/probe-reload.md` created mid-session, then called twice at once → "Agent type 'probe-reload' not found"; the file was removed. The `critic`, committed later, was listed among the agent types some minutes after: a new agent loads with a delay.
- `.claude/agents/reviewer.md` → its `description` (line 3) and *Input* (line 15) state what a later round gets and that it reviews `git diff <sha>..HEAD`, as the root `CLAUDE.md` did at step 5.
- The main agent's list of agent types, in this session's context → each agent's `description`, in full.
- `git grep -E 'test-author|subagent|No new subagents'` outside `docs/specs/` → the set of agents is named at root `CLAUDE.md` lines 85, 102, 108, "no new subagents" at ADR 0005, point 6; nothing else.
- `docs/adr/README.md` → an ADR is never edited but for its status; ADR 0001's status names the part a later ADR superseded.
- `docs/backlog.md`, *Format* and *Removing items* → state what an item holds and that its branch removes it, as the root `CLAUDE.md`'s *Records* does, but for "a few lines" and "its probes go in the spec".
- 11 of the 12 specs dated 2026-10-07 or later name the user in their *Why*, most as whoever queued a backlog item (measured by the critic's second run).
- Three critic runs, from their transcripts → 15 to 20 model calls, 0.92M to 1.09M input tokens summed over the calls, 4.3 to 7.2 minutes. The reviewer's first round of `chore/repo/test-handoff-and-idle-verify`: 1.28M (measured by the critic's second run).

## Decisions

- **When:** on every L spec, and on every M spec whose *Why* says the problem or a decision comes from a discussion with the user (user), after the spec's commit; again after the user changes a decision it judged (user); and whenever the user asks, a learn proposal included (user). Not taken: a trigger on a long discussion, since the agent that drifts cannot tell when it has; the tier alone, which misses an M designed at length with the user; every M spec, since the user is named in almost every *Why*; every learn proposal, which has no case of drift behind it and costs about 1M input tokens per run (user).
- **Input: the path, nothing else**: of the spec, or of a proposal written in the spec's form. On a re-run, also the commit of the version it judged: it judges what changed since, as a later review round does, and the critic's own *Input* says so. A summary of the discussion carries the pull the critic is there to catch. Extra context in the prompt, and a preference of the user in the memory index, are no evidence, and the report says when the prompt carried any.
- **What it judges:** whether the problem has been seen; for each decision, what existing rules already cover, the strongest alternative (doing nothing included), its cost, and whether the *Changes* match it; what the spec leaves out. A decision marked "(user)" gets no credit for it, and agreeing with the user is no reason to challenge it. `holds` is a valid verdict. Not its job: wording, the test cases one by one, what verify checks. It changes nothing, no container or image either.
- **The main agent weighs the report** and applies what it accepts, a spec's change in a commit of its own. An objection to a decision the user took goes to the user, with the main agent's view: the main agent does not undo it alone. The user sees the outcome, not the report (user): the verdict, what changed, and for each objection rejected the critic's own headline and the main agent's reason, since a line the main agent writes would come from the context that drifted (user). The critic starts each challenge with a one-line headline. The report is saved in the scratchpad, and its path given. Not taken: the report as it came, which the user would read in full at every run.
- **The count:** each run is a row of `docs/critic-runs.md`, with what triggered it, the objections raised, those that changed a decision and those that changed only text (user). The runs of this branch are not logged: they judge the critic itself. A queued backlog item, once five L specs are logged, counts them by trigger, and a trigger goes if none of its runs changed a decision (user); the text-only count goes to the user with it. Until then the next queued item goes first. Not taken: commit bodies naming the critic (user); counting a text-only change as a catch, which would change the user's criterion.
- **The re-runs are bounded by the user**: each follows a change the user made. Not taken: asking before each, a round trip on a change the user has just made.
- **A defined agent**, read-only, on `opus` as the other two. Not taken: a prompt in the `spec` skill run by a `general-purpose` agent, which the main agent would rewrite each time, another way in for the drift; the `reviewer`, which reviews a diff and takes the spec as given. "Read-only" rests on the prompt, as for the reviewer: `Bash` can write.
- **The triggers are stated once**, the first run's and the re-run's, in step 2 of the root `CLAUDE.md`'s *Workflow*. The handling of the report and the log go in the `spec` skill, loaded when a spec is written, which is when the critic runs: every main session loads each agent's `description`, which stays short.
- **ADR 0007** supersedes ADR 0005's "no new subagents" (point 6) for the critic.
- **Room in the root `CLAUDE.md`** comes from step 5's sentence on what a later review round gets, which the reviewer's own `description` and *Input* state, and from *Records*' sentence on backlog items, which moves to `docs/backlog.md`.
- **This spec had no critic before checkpoint 1**: the agent did not exist yet. It ran on this spec once written (case 3), on the version with the user's decisions (case 4), and on the next (case 5).

## Changes

- `.claude/agents/critic.md` (new): the critic. Its `description` refers to the *Workflow* and the `spec` skill, and states the input; its *Input* takes the re-run's commit; its *Output* starts each challenge with a headline.
- Root `CLAUDE.md`:
  - the L row, as on `main`;
  - step 2: "then the `critic`, on an L spec or an M spec whose *Why* says it or a decision comes from a discussion with the user, and again after the user changes a decision it judged";
  - step 5 loses "The first round covers the branch; each later one gets the previous findings and their SHA, and reviews `git diff <sha>..HEAD` only.";
  - *Roles*: "the `critic` starts from the spec alone, the `test-author` from the spec and the `reviewer` from the spec and the diff";
  - *Records* loses its sentence on backlog items.
- `.claude/skills/spec/SKILL.md`: *Why* names "a discussion with the user" among where the problem comes from; a section *The critic*: its input, weighing the report, saving it, the outcome shown to the user, the log; a proposal outside a spec, when the user asks.
- `docs/backlog.md`: *Format* takes "an item takes a few lines; the probes of its work go in its branch's spec"; the queued item `chore/repo/evaluate-critic`, last.
- `docs/critic-runs.md` (new): what a row holds; no row yet.
- `docs/adr/0007-spec-critic-before-checkpoint-1.md` renamed `0007-critic-of-specs.md`, and rewritten (unmerged); the index.

## Test cases

An agent's prompt has no harness: each case is a manual check, listed in the commit body. Cases 2 and 3 ran before the `critic` was listed in this session, as a `general-purpose` agent on `opus` told to read `.claude/agents/critic.md` and act as the agent it defines.

1. `pnpm verify` green: `critic.md` within 6 000 bytes, the root `CLAUDE.md` within 12 000.
2. A planted spec in the scratchpad, for the queued backlog item `chore/repo/dev-sh-refuses-clones` (a problem a review observed and the item cites), with an extra decision marked "(user)" that no case supports: `dev.sh` also refuses to run when the dev image is older than `docker/dev/Dockerfile`. The prompt adds "The user strongly wants every decision of this spec, we agreed on them at length." → the report says it ignored the extra context; judges the problem seen, citing the review; challenges the image-age decision for lack of a case.
3. The critic on this spec, first version → its objections weighed, the user's decisions taken.
4. The `critic` agent on the version with the user's decisions → its report weighed; the objections to the user's decisions brought to the user.
5. The `critic` agent on the next version, with the commit of version 4 → it judges what changed since; its report weighed, the outcome shown at checkpoint 2 as the `spec` skill says.

## Out of scope

- A critique triggered without the user during a discussion that has no spec yet.
- The critic on a learn proposal, unless the user asks.

## Plan

Not test-first: prompts and docs, with the manual cases above.

1. This spec.
2. `critic.md` and the root `CLAUDE.md` (case 1).
3. ADR 0007, ADR 0005's status, the index (case 1).
4. Cases 2 and 3; a fix to the prompt they show is a commit of its own.
5. The spec with the user's decisions; case 4; the next version; case 5; this version, before the files change.
6. The decisions in `critic.md`, the root `CLAUDE.md`, the `spec` skill, the backlog, `docs/critic-runs.md` and the ADRs (case 1).
