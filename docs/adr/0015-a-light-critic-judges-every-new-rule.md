# 0015. A light critic judges every new rule before the user does, from its evidence and the rules it would join

- Status: proposed
- Date: 2026-10-28
- Spec: docs/specs/2026-10-28-learn-rule-critic.md

## Context

The learn step (root `CLAUDE.md`, *Workflow*, step 6) proposes rules at checkpoints 1 and 2, written by the agent that worked the task, and the user judges them. The user reports (2026-10-28) that its proposals are at times superfluous, excess zeal, or wrong. The rejected ones leave no commit; one that passed may be the pair of narrow *Probing* rules that fa14383 merged after the fact. Rules also enter by other ways that no independent run judges: an M spec's *Changes*, an S task that is a rule (a2e0800), a reviewer's suggestion applied to a rule file (ec51cdd, 83625be).

ADR 0007 set aside a `critic` run on every learn rule: "no case of a learn rule that drifted, at about 1M input tokens a run". ADR 0005 (point 6) allows no new subagents but the `critic`, and set aside narrower reviewers, each a cold start re-reading the same context. ADR 0009 ended the `critic`'s log, a log with no count. A rule is a text that joins other texts: whether it is needed, already held, too wide or in the wrong place shows in those texts and in the evidence behind it, without the code.

## Decision

1. **A read-only `rule-critic` agent judges every rule that reaches the user**, in every tier, S included: the learn step's proposals, every rule a branch adds or changes in the root or a package `CLAUDE.md`, an agent or a skill, and the rules of the `arch-review` skill's draft of a package `CLAUDE.md`; except a rule a `critic` or `rule-critic` run already judged, unchanged since. One run per checkpoint or `arch-review` report with rules, on all of them together.
2. **Its input is a proposals file and nothing else**: for each rule, its text or diff hunk, where it goes, and the evidence of the problem (a commit, a review finding quoted as it came, a failing check's output, a `file:line`). No summary of the discussion and no argument for the rule, as ADR 0007 point 3 says for the `critic`.
3. **It reads the rules, not the code**: it searches the `CLAUDE.md` files, READMEs, agents, skills, scripts and ADRs, and reads the target file and the hits; code only where the evidence cites it. No probes and no runs. What only the code or a run would settle goes under *Not verified*, and the user can ask for the `critic` on it.
4. **Its verdict per rule is `keep`, `revise` or `drop`**, on whether the problem was seen, is worth the rule's cost, is already held elsewhere, and whether the rule is wider than its evidence, conflicts with a rule or an ADR, or sits in the wrong place.
5. **Every rule reaches the user with its verdict**, a dropped one as one line; the main agent gives its reason where it rejects a verdict. The user decides.
6. **Each rule judged is a row of `docs/rule-critic-log.md`**: its verdict, the user's outcome, the run's tokens and time. Once the log holds 25 rules, a backlog item reviews it, and the user keeps, changes or drops the agent. No cost limit until then.
7. It runs on `opus` at `medium` effort.

This overturns ADR 0007's set-aside alternative *Every rule of the learn step*, and lifts ADR 0005's "no new subagents" (point 6) for the `rule-critic`. ADR 0007's run of the `critic` on a learn rule when the user asks stays.

## Consequences

- Every checkpoint with a rule costs a run and waits for it, an S task's included; a checkpoint without one costs nothing. The spec's trial run: (to be filled at checkpoint 2).
- A rule that is wrong about the code or a tool can pass the light run: it is listed under *Not verified*.
- A rule in the form of code is judged on whether it is needed and where; whether the code works stays with the reviewer or verify.
- The main agent has to write the evidence of each rule, which a rule without a problem seen cannot give.
- The user reads verdicts and headlines, not the report, which stays in the scratchpad.
- Each checkpoint with a rule adds rows to the log, on the task's branch.
- On an `arch-review` draft, which describes code the agent does not read, the run judges duplication, width and place, not whether the rule is true of the code.

## Alternatives considered

- **Doing nothing**: the user judges every proposal, and reports the ones that should not have reached them.
- **The proposal form alone, without a run**: it screens out a rule with no problem seen, and a search shows one already held, but its width, conflicts and place stay judged by the context that proposed it.
- **The learn step's proposals only**: a rule from an M spec, an S task or a reviewer's suggestion costs the same when it is superfluous (the user).
- **Leaving out the `arch-review` skill's drafts**, which describe code this agent does not read: it still judges whether their rules are held elsewhere, too wide or misplaced (the user).
- **The `critic` on every rule**: it reads and probes code, which a rule's judgment does not need, at about 1M input tokens a run (ADR 0007).
- **A light mode of the `critic`**: one agent with two opposite instructions on what to read.
- **A self-critique by the main agent**: it runs in the context that proposed the rule (ADR 0007).
- **A summary of why the rules were proposed, as input**: it carries the drift the run is there to catch; the evidence replaces it (the user, 2026-10-28).
- **The `CLAUDE.md` files and READMEs only**: a rule is often held by a skill, an agent or a script, which they do not show.
- **A cost limit now**: no run has been measured; the log records the cost, and the review weighs it (the user).
