---
status: draft
type: chore
tier: L
implementer: sonnet/medium
packages: []
branch: chore/repo/learn-rule-critic
---

# A light critic judges every lesson the learn step proposes

## Why

From the user (2026-10-28): the lessons that agents propose at the learn step (root `CLAUDE.md`, *Workflow*, step 6) are at times superfluous, excess zeal, or simply wrong. The user wants a critic to judge every proposal before it reaches them, in a light run that reads the rules and the docs a lesson would join, not the code. Its object is the proposals of the learn step, and only those: rules already written, or entering the repo another way, are not its job (the user, 2026-10-28).

The case is the user's report. The proposals the user rejected or reworded at a checkpoint left no commit: they are in the session transcripts, which no agent reads, and the user has none to show today. So the lesson-critic's runs are logged from its introduction, and reviewed after a number of lessons (the user, 2026-10-28). fa14383 may be a lesson that passed: "One rule keyed on the claim's form replaces the two narrow ones", two lessons of the *Probing* list, each as narrow as its incident, merged after the fact; their origin is older than the reachable history. No learn commit since 2026-10-22 was later narrowed or removed (`git log a2c3739..main -- CLAUDE.md .claude/`).

ADR 0007 set aside a critic on every learn rule: "no case of a learn rule that drifted, at about 1M input tokens a run". The user's report answers the first half; the log measures the second.

## Probes

- The root `CLAUDE.md` is 11 832 bytes on `main` (22b1a36), of the 12 000 that `scripts/check-context-size.sh` allows: the lines this task adds there have 168 bytes, and the two edits of *Changes* take about 57. The agents of `.claude/agents/` are 4 407 to 4 817 bytes, of 6 000.
- Where the learn step is named outside the frozen specs (`git grep -n -i -E 'learn step|lesson' -- ':!docs/specs'`): the root `CLAUDE.md`, step 6; the `spec` skill, *The critic* (its last paragraph: the `critic` on "a rule of the learn step" when the user asks) and *Checkpoint 1* (the lessons of the spec phase); the `implement` skill, *6. Checkpoint 2*; ADR 0005, point 5; ADR 0007, point 2, a consequence (line 35) and an alternative (line 45).
- ADR 0005 point 6: "No new subagents"; ADR 0007 lifted it "for the critic; the rest of point 6 stands". ADR 0005 also set aside "more, narrower reviewers": each run starts cold and re-reads the same context. The S path's "no subagent" is ADR 0005 point 1, superseded by ADR 0008 without restating it, and kept by the root `CLAUDE.md`'s row.
- ADR 0009 ended the `critic`'s log: "logging with no count: a rule with no reader". The log here has one, the review of decision 8.
- The S path is written in the root `CLAUDE.md` only; no skill runs it. Its *Workflow*, step 6 included, is read by every session, an S task's main agent included.
- fa14383 merged two narrow *Probing* rules of the `spec` skill, "A type declaration is not a probe of a runtime… every one, not a sample" and "A tool that refuses a mismatch… probe every level", into one on a claim over a set, after "a spec stated that the server rejects every index change but two, from a sample of options": a known case of width and merging, for the trial.
- This spec's `critic` runs (2026-10-28), as the Agent tool reported them: 139 692 tokens, 40 tool calls, 450 s; then 145 258 tokens, 29 calls, 465 s. What that token figure counts is not probed: it is not comparable with ADR 0007's "about 1M input tokens, summed over its calls". The log takes the same tool's figure, so its rows compare with each other and with these runs.
- What the light run may search: about 300 KB (skills 30 KB, ADRs 62 KB, `CLAUDE.md` files 55 KB, READMEs 149 KB), from the critic's count. It searches them and reads the hits.
- Not probed: the cost of a light run. Plan step 4 records a first one, the log the rest.

## Decisions

1. **A new read-only agent, `lesson-critic`, separate from the `critic`** (the user, 2026-10-28, who also named it). The `critic` reads the code and settles a doubt by running it; a lesson is judged against the rules it would join. ADR 0005's objection to narrower agents (a cold start re-reading the same context) holds for the reviewer, whose runs each re-read the code; this one reads rule files, not the code. Not taken:
   - **doing nothing**: the user judges every proposal today, and reports the ones that should not have reached them;
   - **the proposal form alone**, decision 3 without a run: it screens out a lesson with no problem seen, and a `git grep` shows one already held, but the main agent that wrote the lesson judges its width, its conflicts and its place, in the context that proposed it. The trial and the log record, for each verdict, whether the form alone would have given it;
   - **a light mode of the `critic`**: one file with two opposite instructions on what to read;
   - **a self-critique by the main agent**: the context that proposed the lesson (ADR 0007, *Alternatives*).
2. **It runs on every learn proposal, and nothing else** (the user, 2026-10-28): at checkpoints 1 and 2, in every tier, S included; one run per checkpoint, on all its proposals together, and the user waits for it. A checkpoint with no proposal has no run. The S path's "no subagent" gets this exception. Not taken: rules already written, or entering by another way (a spec's *Changes*, an S task that is a rule, a reviewer's suggestion, an `arch-review` draft): the user keeps the agent to the lessons.
3. **Its input is the path of a proposals file**, in the scratchpad as `lesson-critic/<slug>-<n>-input.md`, and nothing else. For each lesson:
   - its text as it would land;
   - the tree it is judged against: a revision, `HEAD` when absent;
   - where: the file and section, or the check, script, hook or lint rule and what it refuses;
   - the evidence of the problem: a commit, a review finding quoted as it came, a failing check's output, a `file:line`. For a lesson that records a decision taken, the decision in one of two forms only: a spec's or an ADR's `file:line`, or the user's words quoted as they came, with their date.

   No summary of the discussion and no argument for the lesson: ADR 0007 point 3 keeps them from the `critic`, since they carry the drift it is there to catch. The user asked for "a summary of why the rules were proposed", and approved evidence in its place (2026-10-28). The form lives in the agent's definition, which the agent's `description` points to, so that the description every session loads stays one or two lines.
4. **What it reads**, at the tree the proposals file names (`git grep <rev>`, `git show <rev>:<path>`). It searches the `CLAUDE.md` files, the READMEs, the agents, the skills, the scripts and the ADRs for what each lesson says, and reads the target file in full and the hits. It reads code only where the evidence cites it (`git show`, the cited lines). No probes, no runs, no package commands: a doubt that only the code or a run would settle goes under *Not verified*, and the user can ask for the `critic` on it (ADR 0007, point 2). A lesson in the form of code is judged on whether it is needed, already held and in its place; whether the code works is the reviewer's, with the rest of the task (`spec` skill, *Checkpoint 1*), or verify's on an S task.
5. **What it judges**, for each lesson:
   - **seen**: the evidence exists and shows the problem; a problem only foreseen is a `drop`. Evidence the run cannot check, a quoted finding or a check's output, is taken as quoted and said so. A lesson that records a decision taken, so that later work does not undo it, has that decision as its evidence, in decision 3's two forms: it is judged on the points below, not on a problem seen, and its width against the decision's text. A decision the main agent reports without one of those forms is no evidence: the drift of ADR 0007's two cases (f90562c, 93ade53) went through the main agent's account of what the user said;
   - **worth its cost**: the problem could recur, and costs more than the lesson costs to read, the learn step's own test;
   - **covered**: a check, a rule, a skill, an agent or an ADR that already holds it, named;
   - **wider than its evidence**, or **in conflict** with a rule or an ADR;
   - **its place**: a check before text, the most specific file, the root `CLAUDE.md` only for what every task needs.

   Not its job: the wording. The verdict of each lesson is `keep`, `revise` (narrower, merged with a named rule, or elsewhere, with the revised text) or `drop`, with a headline of one line and its evidence. If every lesson holds, it says so.
6. **`model: opus`, `effort: medium`.** The judgment needs the strongest model; the `critic`'s `xhigh` pays for reading and probing code, which this agent does not. The log shows whether `medium` is enough.
7. **The outcome to the user.** The main agent applies the verdicts it accepts, and shows every lesson as it stands after the run, with its verdict and the agent's headline: a dropped lesson stays as one line, so the user can take it back; a `revise` or `drop` the main agent rejects comes with its reason; a lesson the main agent rewrites other than as the verdict's revised text is marked as not judged. A lesson the user adds or rewords at the checkpoint is theirs, with no second run. The report is kept as it came in the scratchpad, as `lesson-critic/<slug>-<n>.md`.
8. **A log and a review, with no cost limit for now** (the user, 2026-10-28). `docs/lesson-critic-log.md` gets a row per lesson judged: the date, the branch, the checkpoint, the lesson's headline, the verdict, whether the form alone would have given it (no evidence, or a `git grep` hit), the main agent's call on it, the user's outcome (applied, reworded, dropped, taken back), and the run's tokens and time. The rows go on the task's branch, after the user's answer at the checkpoint, whether the lesson is kept or dropped. A queued backlog item reviews the log once it holds 25 lessons (the user's number to change).
   - **What it counts:** the verdicts that changed a lesson, that the form alone would not have given, and that the user did not take back; the user's overrides; the cost.
   - **A figure suggested now, for the user to decide on at the review** (the user, 2026-10-28): fewer than 3 such verdicts in 25 lessons suggests dropping the agent. Since the user reads the verdict before deciding, agreeing with it counts for nothing: only a change the user kept, and an override, do.
9. **ADR 0015**, drafted with this spec, stays `proposed` until checkpoint 2, where it is accepted with the trial's outcome, or the task goes back to the user. It supersedes no decision: it overturns ADR 0007's set-aside alternative "Every rule of the learn step", in the form ADR 0001's status uses for 0010; lifts ADR 0005's "no new subagents" (point 6) for the `lesson-critic`; and states the exception to the S path's "no subagent". The `critic` keeps its run on a learn rule when the user asks.

## Open questions

None.

## Changes

- `.claude/agents/lesson-critic.md` (new): read-only (`Read, Grep, Glob, Bash`), `model: opus`, `effort: medium`, within the 6 000 bytes of `check-context-size.sh`.
  - Its `description`, one or two lines: it judges the learn step's proposals at a checkpoint; give it the path of a proposals file in the form of its *Input*; weigh it as its *Output* says.
  - The body: *Input* (decision 3), what it reads (decision 4), what it judges (decision 5), the rules of the `critic` on leaving the repository as it was and not reading under `~/.claude/`, and *Output*: per lesson, its verdict, headline and evidence, then *Not verified*; how the main agent weighs it (decision 7) and logs it (decision 8).
- Root `CLAUDE.md`, within its 12 000 bytes, merging with a line it already has where the room asks:
  - the S row: "no subagent" becomes "no subagent but the `lesson-critic`";
  - step 6: "propose it, on the task's branch" becomes "propose it, after the `lesson-critic`'s run, on the task's branch".
- `.claude/skills/spec/SKILL.md`, *Checkpoint 1*: the lessons of the spec phase go to the `lesson-critic` before the user; the log's rows after the user's answer. *The critic* is unchanged.
- `.claude/skills/implement/SKILL.md`, *6. Checkpoint 2*: the learn step's proposals after the `lesson-critic`'s run; the log's rows after the user's answer.
- `docs/lesson-critic-log.md` (new): a header saying what it logs and who reads it (decision 8), and the table.
- `docs/backlog.md`, *Queued*: the review of decision 8, due at 25 lessons logged.
- `docs/adr/0015-a-lesson-critic-judges-every-learn-proposal.md` (new, `proposed`). The statuses, in its commit at checkpoint 2: ADR 0007, "*Every rule of the learn step* overturned by 0015"; ADR 0005, "point 6's 'no new subagents' also lifted by 0015 for the `lesson-critic`". `docs/adr/README.md`: the row of 0015 and both statuses.

## Test cases

None of code: the change is to an agent, skills and docs. Plan step 4 is a trial run on one proposals file, in decision 3's form, each case judged against the tree it names (read with `git show <rev>:<path>`):

1. "Publishing and follow-ups go in a session of their own", proposed for the root `CLAUDE.md`, against the tree of 95fa060 → `drop`: already held by the target file itself there (`CLAUDE.md`, *Workflow*, step 5).
2. "A tool that refuses a mismatch: probe every level it could compare", proposed for the `spec` skill's *Probing*, against the tree of fa14383 → `drop` or `revise`: held by its rule on a claim over a set.
3. "An index change is probed on every option the server compares, not a sample", proposed for the `spec` skill's *Probing*, against the tree of fa14383's parent → `revise`: merged with the two narrow rules there (a runtime's globals, a tool's levels) into one rule on a claim over a set, as fa14383 did. The case of width that a `git grep` alone does not give.
4. The lessons of f4c53cb (the error brand spec), as they landed, against the tree of its parent → no expected verdict: the user approved them, and no commit changed them since.

It passes when cases 1, 2 and 3 get their expected verdict, each citing the rule or file that holds it at the case's tree (case 3 cites the two narrow rules of fa14383's parent, not the merged rule of `HEAD`), and the run reads within decision 4: no file of a package's `src/` beyond a cited line, no command but `git` and searches. Recorded for checkpoint 2: each verdict, whether the form alone would have given it, the tokens and the time. A failure goes back to the user before ADR 0015 is accepted. The trial's rows are not logged: a run on past lessons is not a sample of its use.

## Risks

- **A wrong lesson that only the code shows**, such as one on how a tool behaves: the light run cannot settle it. It lists it under *Not verified*, and the user can ask for the `critic`.
- **Noise.** Every run of the `critic` so far gave `challenge` (ADR 0009); a critic asked to criticize may invent objections. The agent may answer that every lesson holds, an objection needs evidence, and the log counts the user's overrides.
- **The main agent filters what the user sees.** Every lesson reaches the user with its verdict, a dropped one included.
- **A cost and a wait on every checkpoint with a proposal**, S tasks included, with no limit for now: the log records it, and the review weighs it.

## Out of scope

- The `critic`, its triggers and its runs.
- Rules already written, and rules entering the repo by another way than the learn step (decision 2).

## Plan

1. This spec and ADR 0015 (`proposed`), before checkpoint 1; the `critic`'s run on both, and its re-runs after the user's changes.
2. `.claude/agents/lesson-critic.md`, and `docs/lesson-critic-log.md`.
3. The root `CLAUDE.md`, the `spec` and `implement` skills; the backlog's review item.
4. The trial run of *Test cases*.
5. ADR 0015 `accepted` with the trial's outcome, the statuses of ADRs 0005 and 0007, the index.
6. `pnpm verify`, then checkpoint 2, with this task's own lessons, if any, as the agent's first logged run.
