---
status: draft
type: chore
tier: L
implementer: sonnet/medium
packages: []
branch: chore/repo/learn-rule-critic
---

# A light critic judges every rule the learn step proposes

## Why

From the user (2026-10-28): the rules that agents propose at the learn step (root `CLAUDE.md`, *Workflow*, step 6) are at times superfluous, excess zeal, or simply wrong. The user wants a critic to judge every proposal before it reaches them, in a light run that reads the rules and the docs they would join, not the code: the `critic` costs about 1M input tokens a run (ADR 0007), most of it reading code and probing.

What the history shows:

- 95fa060 (2026-10-22): the root `CLAUDE.md` had reached its cap, and some of its lines "already held by the implement and publish skills" were dropped: rules added where another file already had them.
- fa14383: "One rule keyed on the claim's form replaces the two narrow ones": two rules, each as narrow as its incident, merged after the fact.
- `chore/repo/narrow-preset-rule` (ADR 0011): a rule broader than the cases behind it, which the user judged rigid, narrowed after two `critic` runs.

ADR 0007 set aside a critic on every learn rule: "no case of a learn rule that drifted, at about 1M input tokens a run". The user's report is that case; the light run answers the cost.

Not counted: how many learn proposals the user rejected or reworded at a checkpoint. They are in the session transcripts, which no agent reads.

## Probes

- The root `CLAUDE.md` is 11 832 bytes on `main` (22b1a36), of the 12 000 that `scripts/check-context-size.sh` allows: the lines this task adds there have 168 bytes. The agents of `.claude/agents/` are 4 407 to 4 817 bytes, of 6 000.
- Where the learn step is named outside the frozen specs (`git grep -n -i -E 'learn step|lesson' -- ':!docs/specs'`): the root `CLAUDE.md`, step 6; the `spec` skill, *The critic* (its last paragraph: the `critic` on "a rule of the learn step" when the user asks) and *Checkpoint 1* (the lessons of the spec phase); the `implement` skill, *6. Checkpoint 2*; ADR 0005, point 5; ADR 0007, point 2, a consequence and an alternative.
- The S path is written in the root `CLAUDE.md` only (its row: "no subagent"); no skill runs it. An agent's `description` is in the list of agents of every session, so it reaches an S task's main agent without a skill.
- The size of what the light run may read: the skills are 30 KB together (`arch-review` 12.5 KB), the agents 14 KB, the ADRs and package `CLAUDE.md` files more. It searches them and reads the hits, not all of them.
- Not probed: the cost of a light run. Plan step 4 measures it.

## Decisions

1. **A new read-only agent, `rule-critic`, separate from the `critic`** (the user, 2026-10-28). The `critic` reads the code and settles a doubt by running it; a learn rule is judged against the rules it would join. Not taken:
   - a light mode of the `critic`: one file with two opposite instructions on what to read, and the light one loads the heavy one's text;
   - a self-critique by the main agent: it runs in the context that proposed the rule (ADR 0007, *Alternatives*).
2. **It runs on every learn proposal**, at checkpoints 1 and 2, in every tier, S included (the user: "ad ogni lezione"): one run per checkpoint, on all its proposals together. A checkpoint with no proposal has no run. The S row's "no subagent" gets this exception.
3. **Its input is the path of a proposals file**, in the scratchpad as `learn/<slug>-<n>.md`, and nothing else. For each rule:
   - its text as it would land;
   - where: the file and section, or the check, script, hook or lint rule and what it refuses;
   - the evidence of the problem: a commit, a review finding, a failing check's output, a `file:line`.

   No summary of the discussion and no argument for the rule: ADR 0007 point 3 keeps them from the `critic`, since they carry the drift it is there to catch. The user asked for "a summary of why the rules were proposed", and approved evidence in its place (2026-10-28).
4. **What it reads.** It searches (`git grep`) the `CLAUDE.md` files, the READMEs, the agents, the skills, the scripts and the ADRs for what each rule says, and reads the target file in full and the hits. It reads code only where the evidence cites it (`git show`, the cited lines). No probes, no runs, no package commands: a doubt that only the code or a run would settle goes under *Not verified*, where the user can ask for the `critic`.
5. **What it judges**, for each rule:
   - **seen**: the evidence exists and shows the problem; a problem only foreseen is a `drop`;
   - **worth its cost**: the problem could recur, and costs more than the rule costs to read, the learn step's own test;
   - **covered**: a check, a rule, a skill, an agent or an ADR that already holds it, named;
   - **wider than its evidence**, or **in conflict** with a rule or an ADR;
   - **its place**: a check before text, the most specific file, the root `CLAUDE.md` only for what every task needs.

   Not its job: the wording. The verdict of each rule is `keep`, `revise` (narrower, merged with a named rule, or elsewhere, with the revised text) or `drop`, with a headline of one line and its evidence. If every rule holds, it says so.
6. **`model: opus`, `effort: medium`.** The judgment needs the strongest model; the `critic`'s `xhigh` pays for reading and probing code, which this agent does not. Whether `medium` is enough is what plan step 4 shows.
7. **The outcome to the user.** The main agent applies the verdicts it accepts, and shows every proposal as it stands after the run, with its verdict and the agent's headline: a dropped rule stays as one line, so the user can take it back; a `revise` or `drop` the main agent rejects comes with its reason. The report is kept as it came in the scratchpad, as `rule-critic/<slug>-<n>.md`. The user decides, as today.
8. **ADR 0015**, drafted with this spec as `proposed`, records the decision beyond the task. It supersedes, for the rules of the learn step, ADR 0007's run "when the user asks"; ADR 0007's status says so. ADRs are never edited after acceptance but for their status (`docs/adr/README.md`).

## Open questions

None.

## Changes

- `.claude/agents/rule-critic.md` (new): read-only (`Read, Grep, Glob, Bash`), `model: opus`, `effort: medium`, within the 6 000 bytes of `check-context-size.sh`. Its `description` names the input of decision 3 and says to weigh the report as decision 7 says, so that an S task's main agent finds both. The body holds decisions 4 and 5, the rules of the `critic` on leaving the repository as it was and not reading under `~/.claude/`, and the output: per rule, its verdict, headline and evidence; then *Not verified*.
- Root `CLAUDE.md`, within its 12 000 bytes:
  - the S row: "no subagent" becomes "no subagent but the `rule-critic`";
  - step 6: "propose it, on the task's branch" becomes "propose it, after the `rule-critic`'s run, on the task's branch".
- `.claude/skills/spec/SKILL.md`:
  - *The critic*, last paragraph: "a rule of the learn step" leaves the proposals the `critic` judges when the user asks;
  - *Checkpoint 1*: the lessons of the spec phase go to the `rule-critic` before the user.
- `.claude/skills/implement/SKILL.md`, *6. Checkpoint 2*: "the learn step's proposals" after the `rule-critic`'s run.
- `docs/adr/0015-a-light-critic-judges-every-learn-rule.md` (new, `proposed`; `accepted` at checkpoint 1). ADR 0007's status: `accepted; point 5 superseded by 0009; point 2's run on a learn rule superseded by 0015`. `docs/adr/README.md`: the row of 0015, and 0007's status.

## Test cases

None of code: the change is to an agent, skills and docs. Plan step 4 is a trial run instead, and its outcome goes to checkpoint 2:

1. A proposals file, in decision 3's form, with the lessons of two past tasks as they were proposed: f4c53cb (the error brand spec) and adac590 (the cqrs spec), their evidence from the commits and specs they cite. The run judges them against the tree of each commit's parent, read with `git show <rev>:<path>`.
2. Expected: a report in the agent's output form, a verdict for each rule, and reads within decision 4 (no file of a package's `src/` beyond a cited line, no command but `git` and searches).
3. Recorded for the user: each verdict, the tokens and the time of the run. The verdicts themselves pass or fail nothing: the user judges whether they are useful.

## Risks

- **A wrong rule that only the code shows**, such as one on how a tool behaves: the light run cannot settle it. It lists it under *Not verified*, and the user can ask for the `critic`.
- **Noise.** Every run of the `critic` so far gave `challenge` (ADR 0009); a critic asked to criticize may invent objections. The agent may answer that every rule holds, an objection needs evidence, and the user sees each outcome and can drop the agent (as ADR 0009, point 3).
- **The main agent filters what the user sees.** Every proposal reaches the user with its verdict, a dropped one included.
- **A cost on every checkpoint with a proposal**, S tasks included. Plan step 4 measures it.

## Out of scope

- The `critic`, its triggers and its runs on a spec.
- The `arch-review` skill's drafted package `CLAUDE.md` and backlog items: an assessment, not the learn step.

## Plan

1. This spec, then ADR 0015 (`proposed`), ADR 0007's status and the ADR index, before checkpoint 1; the `critic`'s run on both.
2. `.claude/agents/rule-critic.md`.
3. The root `CLAUDE.md`, the `spec` and `implement` skills.
4. The trial run of *Test cases*.
5. `pnpm verify`, then checkpoint 2.
