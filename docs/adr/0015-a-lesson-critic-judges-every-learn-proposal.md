# 0015. A light critic judges every lesson the learn step proposes, from its evidence and the rules it would join

- Status: accepted
- Date: 2026-10-28
- Spec: `git show c337d77:docs/specs/2026-10-28-lesson-critic.md` (removed from the tree)

## Context

The learn step (root `CLAUDE.md`, *Workflow*, step 6) proposes lessons at checkpoints 1 and 2, written by the agent that worked the task, and the user judges them. The user reports (2026-10-28) that its proposals are at times superfluous, excess zeal, or wrong. The rejected ones leave no commit; one that passed may be the pair of narrow *Probing* rules that fa14383 merged after the fact.

ADR 0007 set aside a `critic` run on every learn rule: "no case of a learn rule that drifted, at about 1M input tokens a run". ADR 0005 (point 6) allows no new subagents but the `critic`, and set aside narrower reviewers, each a cold start re-reading the same context. ADR 0009 ended the `critic`'s log, a log with no count. A lesson is a text that joins other texts: whether it is needed, already held, too wide or in the wrong place shows in those texts and in the evidence behind it, without the code.

## Decision

1. **A read-only `lesson-critic` agent judges every learn proposal, and nothing else**, at checkpoints 1 and 2, in every tier: one run per checkpoint with proposals, on all of them together. The S path's "no subagent" (ADR 0005 point 1, kept by the root `CLAUDE.md`) gets this exception.
2. **Its input is a proposals file and nothing else**: for each lesson, its text, the tree to judge it against, where it goes, and the evidence of the problem (a commit, a review finding quoted as it came, a failing check's output, a `file:line`). No summary of the discussion and no argument for the lesson, as ADR 0007 point 3 says for the `critic`.
3. **It reads the rules, not the code**: it searches the `CLAUDE.md` files, READMEs, agents, skills, scripts and ADRs, and reads the target file and the hits; code only where the evidence cites it. No probes and no runs. What only the code or a run would settle goes under *Not verified*, and the user can ask for the `critic` on it.
4. **Its verdict per lesson is `keep`, `revise` or `drop`**, on whether the problem was seen, is worth the lesson's cost, is already held elsewhere, and whether the lesson is wider than its evidence, conflicts with a rule or an ADR, or sits in the wrong place. A lesson that records a decision taken has that decision as its evidence, as a spec's or an ADR's `file:line` or the user's words quoted with their date; the main agent's account of a decision is no evidence.
5. **Every lesson reaches the user with its verdict**, a dropped one as one line; the main agent gives its reason where it rejects a verdict. The user decides.
6. **Each lesson judged is a row of `docs/lesson-critic-log.md`**: its verdict, whether the form alone would have given it, the user's outcome, the run's tokens and time. Once the log holds 25 lessons, a backlog item reviews it, and the user keeps, changes or drops the agent. A figure is suggested before the count, and the user decides at the review: fewer than 3 verdicts that changed a lesson, beyond the form alone, and that the user kept, suggests dropping it. No cost limit until then.
7. It runs on `opus` at `medium` effort.

This overturns ADR 0007's set-aside alternative *Every rule of the learn step*, and lifts ADR 0005's "no new subagents" (point 6) for the `lesson-critic`. ADR 0007's run of the `critic` on a learn rule when the user asks stays.

## Consequences

- Every checkpoint with a proposal costs a run and waits for it, an S task's included; a checkpoint without one costs nothing. The spec's trial run on five past lessons (2026-10-28): 71 516 tokens, 12 tool calls, 81 s, against about 140 000 tokens and 450 s for the `critic` on this spec. The three cases with an expected verdict came out: a lesson with no evidence, held by its target file, `drop` (the form alone gives it); the narrow *Probing* rule held by the merged rule, `drop` (a `git grep` shows it); the index-change rule `revise`, merged with the two narrow rules at its tree into one on a claim over a set, as fa14383 did (the form alone does not give it). The control, the two lessons of f4c53cb that the user approved and no commit changed since, had no expected verdict and both were dropped as cited: the evidence of one was the commit that added it (circular, and it named the wrong section), the other recorded a decision with no spec, ADR or quote, and conflicts with ADR 0004 and the frozen specs that name a project. Both verdicts follow the evidence form the agent was given; the 25-lesson review should read them as a sign of how strict that form is, noise included.
- A lesson that is wrong about the code or a tool can pass the light run: it is listed under *Not verified*.
- A lesson in the form of code is judged on whether it is needed and where; whether the code works stays with the reviewer or verify.
- The main agent has to write the evidence of each lesson, which a lesson without a problem seen cannot give.
- The user reads verdicts and headlines, not the report, which stays in the scratchpad.
- Each checkpoint with a proposal adds rows to the log, on the task's branch.
- Rules already written, and rules entering by another way (a spec's *Changes*, an S task, a reviewer's suggestion, an `arch-review` draft), stay with the user and the existing runs.

## Alternatives considered

- **Doing nothing**: the user judges every proposal, and reports the ones that should not have reached them.
- **The proposal form alone, without a run**: it screens out a lesson with no problem seen, and a search shows one already held, but its width, conflicts and place stay judged by the context that proposed it.
- **Every rule a branch adds, whichever way it came**: the user keeps the agent to the lessons.
- **The `critic` on every lesson**: it reads and probes code, which a lesson's judgment does not need, at about 1M input tokens a run (ADR 0007).
- **A light mode of the `critic`**: one agent with two opposite instructions on what to read.
- **A self-critique by the main agent**: it runs in the context that proposed the lesson (ADR 0007).
- **A summary of why the lessons were proposed, as input**: it carries the drift the run is there to catch; the evidence replaces it (the user, 2026-10-28).
- **The `CLAUDE.md` files and READMEs only**: a lesson is often held by a skill, an agent or a script, which they do not show.
- **A cost limit now**: no run has been measured; the log records the cost, and the review weighs it (the user).
