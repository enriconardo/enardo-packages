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

From the user (2026-10-28): the rules that agents propose at the learn step (root `CLAUDE.md`, *Workflow*, step 6) are at times superfluous, excess zeal, or simply wrong. The user wants a critic to judge every proposal before it reaches them, in a light run that reads the rules and the docs they would join, not the code.

The case is the user's report. The proposals the user rejected or reworded at a checkpoint left no commit: they are in the session transcripts, which no agent reads, so the git history cannot show them. fa14383 may be one that passed: "One rule keyed on the claim's form replaces the two narrow ones", two lessons of the *Probing* list, each as narrow as its incident, merged after the fact; their origin is older than the reachable history. No learn commit since 2026-10-22 was later narrowed or removed (`git log a2c3739..main -- CLAUDE.md .claude/`).

ADR 0007 set aside a critic on every learn rule: "no case of a learn rule that drifted, at about 1M input tokens a run". The user's report answers the first half; the second is what plan step 4 measures, against a limit this spec sets.

## Probes

- The root `CLAUDE.md` is 11 832 bytes on `main` (22b1a36), of the 12 000 that `scripts/check-context-size.sh` allows: the lines this task adds there have 168 bytes. The agents of `.claude/agents/` are 4 407 to 4 817 bytes, of 6 000.
- Where the learn step is named outside the frozen specs (`git grep -n -i -E 'learn step|lesson' -- ':!docs/specs'`): the root `CLAUDE.md`, step 6; the `spec` skill, *The critic* (its last paragraph: the `critic` on "a rule of the learn step" when the user asks) and *Checkpoint 1*; the `implement` skill, *6. Checkpoint 2*; ADR 0005, point 5; ADR 0007, point 2, a consequence (line 35) and an alternative (line 45).
- ADR 0005 point 6: "No new subagents"; ADR 0007 lifted it "for the critic; the rest of point 6 stands". ADR 0005 also set aside "more, narrower reviewers": each run starts cold and re-reads the same context.
- The S path is written in the root `CLAUDE.md` only (its row: "no subagent"); no skill runs it. Its step 6 is read by every session, an S task's main agent included.
- This spec's `critic` run (2026-10-28), as the Agent tool reported it: 139 692 tokens, 40 tool calls, 450 s. The figure the trial's limit compares against.
- What the light run may search: about 300 KB (skills 30 KB, ADRs 62 KB, `CLAUDE.md` files 55 KB, READMEs 149 KB), from the critic's count. It searches them and reads the hits.
- Not probed: the cost of a light run. Plan step 4 measures it.

## Decisions

1. **A new read-only agent, `rule-critic`, separate from the `critic`** (the user, 2026-10-28). The `critic` reads the code and settles a doubt by running it; a learn rule is judged against the rules it would join. ADR 0005's objection to narrower agents (a cold start re-reading the same context) holds for the reviewer, whose runs each re-read the code; this one reads rule files, not the code. Not taken:
   - **doing nothing**: the user judges every proposal today, and reports the ones that should not have reached them;
   - **the proposal form alone**, decision 3 without a run: it screens out a rule with no problem seen, and a `git grep` shows one already held, but the main agent that wrote the rule judges its width, its conflicts and its place, in the context that proposed it. The trial records, for each verdict, whether the form alone would have given it;
   - **a light mode of the `critic`**: one file with two opposite instructions on what to read;
   - **a self-critique by the main agent**: the context that proposed the rule (ADR 0007, *Alternatives*).
2. **It runs on every learn proposal**, at checkpoints 1 and 2, in every tier, S included (the user: "ad ogni lezione"): one run per checkpoint, on all its proposals together, and the checkpoint waits for it. A checkpoint with no proposal has no run. The S row's "no subagent" gets this exception.
3. **Its input is the path of a proposals file**, in the scratchpad as `learn/<slug>-<n>.md`, and nothing else. For each rule:
   - its text as it would land;
   - where: the file and section, or the check, script, hook or lint rule and what it refuses;
   - the evidence of the problem: a commit, a review finding quoted as it came, a failing check's output, a `file:line`.

   No summary of the discussion and no argument for the rule: ADR 0007 point 3 keeps them from the `critic`, since they carry the drift it is there to catch. The user asked for "a summary of why the rules were proposed", and approved evidence in its place (2026-10-28). The form lives in the agent's definition, which the agent's `description` points to, so that the description every session loads stays one or two lines.
4. **What it reads.** It searches (`git grep`) the `CLAUDE.md` files, the READMEs, the agents, the skills, the scripts and the ADRs for what each rule says, and reads the target file in full and the hits. It reads code only where the evidence cites it (`git show`, the cited lines). No probes, no runs, no package commands: a doubt that only the code or a run would settle goes under *Not verified*, and the user can ask for the `critic` on it (ADR 0007, point 2). A rule in the form of code is judged on whether it is needed, already held and in its place; whether the code works is the reviewer's, with the rest of the task (`spec` skill, *Checkpoint 1*), or verify's on an S task.
5. **What it judges**, for each rule:
   - **seen**: the evidence exists and shows the problem; a problem only foreseen is a `drop`. Evidence the run cannot check, a quoted finding or a check's output, is taken as quoted and said so;
   - **worth its cost**: the problem could recur, and costs more than the rule costs to read, the learn step's own test;
   - **covered**: a check, a rule, a skill, an agent or an ADR that already holds it, named;
   - **wider than its evidence**, or **in conflict** with a rule or an ADR;
   - **its place**: a check before text, the most specific file, the root `CLAUDE.md` only for what every task needs.

   Not its job: the wording. The verdict of each rule is `keep`, `revise` (narrower, merged with a named rule, or elsewhere, with the revised text) or `drop`, with a headline of one line and its evidence. If every rule holds, it says so.
6. **`model: opus`, `effort: medium`.** The judgment needs the strongest model; the `critic`'s `xhigh` pays for reading and probing code, which this agent does not. Plan step 4 shows whether `medium` is enough.
7. **The outcome to the user.** The main agent applies the verdicts it accepts, and shows every proposal as it stands after the run, with its verdict and the agent's headline: a dropped rule stays as one line, so the user can take it back; a `revise` or `drop` the main agent rejects comes with its reason; a rule the main agent rewrites other than as the verdict's revised text is marked as not judged. A rule the user adds or rewords at the checkpoint is theirs, with no second run. The report is kept as it came in the scratchpad, as `rule-critic/<slug>-<n>.md`.
8. **ADR 0015**, drafted with this spec, stays `proposed` until checkpoint 2, where it is accepted with the trial's cost in its *Consequences*, or the task goes back to the user. It supersedes no decision: it overturns ADR 0007's set-aside alternative "Every rule of the learn step", in the form ADR 0001's status uses for 0010, and lifts ADR 0005's "no new subagents" (point 6) for the `rule-critic`. The `critic` keeps its run on a learn rule when the user asks.

## Open questions

- **Which proposals did you reject or reword, that the run should have caught?** One or two, as you remember them, become cases of the trial with a known verdict (*Test cases*), and the *Why*'s case.
- **The trial's limit**, at most half of this spec's `critic` run: 70 000 tokens and 225 s. A lower or higher bound is yours to set.

## Changes

- `.claude/agents/rule-critic.md` (new): read-only (`Read, Grep, Glob, Bash`), `model: opus`, `effort: medium`, within the 6 000 bytes of `check-context-size.sh`.
  - Its `description`, one or two lines: it judges the learn step's proposals at a checkpoint; give it the path of a proposals file in the form of its *Input*; weigh it as its *Output* says.
  - The body: *Input* (decision 3), what it reads (decision 4), what it judges (decision 5), the rules of the `critic` on leaving the repository as it was and not reading under `~/.claude/`, and *Output*: per rule, its verdict, headline and evidence, then *Not verified*; and how the main agent weighs it (decision 7).
- Root `CLAUDE.md`, within its 12 000 bytes:
  - the S row: "no subagent" becomes "no subagent but the `rule-critic`";
  - step 6: "propose it, on the task's branch" becomes "propose it, after the `rule-critic`'s run, on the task's branch".
- `.claude/skills/spec/SKILL.md`, *Checkpoint 1*: the lessons of the spec phase go to the `rule-critic` before the user. *The critic* is unchanged.
- `.claude/skills/implement/SKILL.md`, *6. Checkpoint 2*: "the learn step's proposals" after the `rule-critic`'s run.
- `docs/adr/0015-a-light-critic-judges-every-learn-rule.md` (new, `proposed`). The statuses, in its commit at checkpoint 2: ADR 0007, "*Every rule of the learn step* overturned by 0015"; ADR 0005, "point 6's 'no new subagents' also lifted by 0015 for the `rule-critic`". `docs/adr/README.md`: the row of 0015 and both statuses.

## Test cases

None of code: the change is to an agent, skills and docs. Plan step 4 is a trial run on one proposals file, in decision 3's form, each case judged against the tree it names (read with `git show <rev>:<path>`):

1. "Publishing and follow-ups go in a session of their own", proposed for the root `CLAUDE.md`, against the tree of 95fa060 → `drop`: already held by `.claude/skills/implement/SKILL.md` there.
2. "A tool that refuses a mismatch: probe every level it could compare", proposed for the `spec` skill's *Probing*, against the tree of fa14383 → `drop` or `revise`: held by its rule on a claim over a set.
3. The lessons of f4c53cb (the error brand spec), as they landed, against the tree of its parent → no expected verdict: the user approved them, and no commit changed them since.
4. The proposals the user names (*Open questions*), against the tree of the time → `drop` or `revise`, as the user judged them.

It passes when:

- cases 1, 2 and 4 get their expected verdict, each with the rule or file that holds it;
- the run stays within the limit of *Open questions*, as the Agent tool reports it;
- it reads within decision 4: no file of a package's `src/` beyond a cited line, no command but `git` and searches.

Recorded for checkpoint 2: each verdict, whether the form alone would have given it, the tokens and the time. A failure goes back to the user before ADR 0015 is accepted.

## Risks

- **A wrong rule that only the code shows**, such as one on how a tool behaves: the light run cannot settle it. It lists it under *Not verified*, and the user can ask for the `critic`.
- **Noise.** Every run of the `critic` so far gave `challenge` (ADR 0009); a critic asked to criticize may invent objections. The agent may answer that every rule holds, an objection needs evidence, and the user sees each outcome and can drop the agent (as ADR 0009, point 3).
- **The main agent filters what the user sees.** Every proposal reaches the user with its verdict, a dropped one included.
- **A cost and a wait on every checkpoint with a proposal**, S tasks included. Plan step 4 measures it against its limit.

## Out of scope

- The `critic`, its triggers and its runs.
- Other paths by which a rule enters the repo: a spec's *Changes* (judged by the `critic` on L specs), an S task whose change is a rule, the reviewer's suggestions applied to a rule file, and the `arch-review` skill's drafts. The user judges them as today.

## Plan

1. This spec and ADR 0015 (`proposed`), before checkpoint 1; the `critic`'s run on both.
2. `.claude/agents/rule-critic.md`.
3. The root `CLAUDE.md`, the `spec` and `implement` skills.
4. The trial run of *Test cases*.
5. ADR 0015 `accepted` with the trial's cost, the statuses of ADRs 0005 and 0007, the index.
6. `pnpm verify`, then checkpoint 2.
