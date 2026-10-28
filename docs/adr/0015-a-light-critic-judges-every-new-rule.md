# 0015. A light critic judges every new rule before the user does, from its evidence and the rules it would join

- Status: proposed
- Date: 2026-10-28
- Spec: docs/specs/2026-10-28-learn-rule-critic.md

## Context

The learn step (root `CLAUDE.md`, *Workflow*, step 6) proposes rules at checkpoints 1 and 2, written by the agent that worked the task, and the user judges them. The user reports (2026-10-28) that its proposals are at times superfluous, excess zeal, or wrong. The rejected ones leave no commit; one that passed may be the pair of narrow *Probing* rules that fa14383 merged after the fact. Rules also enter by other ways: an M spec's *Changes*, which the `critic` does not judge; an S task that is a rule (a2e0800); a reviewer's suggestion applied to a rule file (ec51cdd, 83625be), drawn from the code rather than from the rules it joins; an `arch-review` draft, once a branch writes it. No bad rule through them is shown; the user wants them judged all the same.

ADR 0007 set aside a `critic` run on every learn rule: "no case of a learn rule that drifted, at about 1M input tokens a run". ADR 0005 (point 6) allows no new subagents but the `critic`, and set aside narrower reviewers, each a cold start re-reading the same context. ADR 0009 ended the `critic`'s log, a log with no count. A rule is a text that joins other texts: whether it is needed, already held, too wide or in the wrong place shows in those texts and in the evidence behind it, without the code.

## Decision

1. **A read-only `rule-critic` agent judges every new rule that reaches the user**, whichever way it came, in every tier, S included: at checkpoint 1, the spec phase's lessons and, when the `critic` did not run, the spec's rule *Changes*; at checkpoint 2, the learn proposals and the diff of the rule files (the root and package `CLAUDE.md` files, the agents, the skills, `docker/README.md`) since the commit that closed checkpoint 1. A move or a rewording is listed, not judged; a hunk that carries out an approved spec change is listed too; a verdict against a rule the spec approved goes to the user as a departure. One run per checkpoint with rules, on all of them together. The S path's "no subagent" (ADR 0005 point 1, kept by the root `CLAUDE.md`) gets this exception.
2. **Its input is a proposals file and nothing else**: for each rule, its text or diff hunk, where it goes, and the evidence of the problem (a commit, a review finding quoted as it came, a failing check's output, a `file:line`). No summary of the discussion and no argument for the rule, as ADR 0007 point 3 says for the `critic`.
3. **It reads the rules, not the code**: it searches the `CLAUDE.md` files, READMEs, agents, skills, scripts and ADRs, and reads the target file and the hits; code only where the evidence cites it. No probes and no runs. What only the code or a run would settle goes under *Not verified*, and the user can ask for the `critic` on it.
4. **Its verdict per rule is `keep`, `revise` or `drop`**, on whether the problem was seen, is worth the rule's cost, is already held elsewhere, and whether the rule is wider than its evidence, conflicts with a rule or an ADR, or sits in the wrong place. A rule that records a decision has that decision as its evidence.
5. **Every rule reaches the user with its verdict**, a dropped one as one line; the main agent gives its reason where it rejects a verdict. The user decides.
6. **Each rule judged is a row of `docs/rule-critic-log.md`**: its way in, its verdict, whether the form alone would have given it, the user's outcome, the run's tokens and time. Once the log holds 25 rules, a backlog item reviews it, and the user keeps, changes or drops the agent or a way in. A figure is suggested before the count, and the user decides at the review: fewer than 3 verdicts that changed a rule, beyond the form alone, and that the user kept, suggests dropping it. No cost limit until then.
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
- A spec gets a `rules-judged` commit at checkpoint 1, so that checkpoint 2 judges nothing the user already approved.
- A rule outside the rule files (a check, a script, a hook, a package README line) added outside a learn proposal is not judged by it.

## Alternatives considered

- **Doing nothing**: the user judges every proposal, and reports the ones that should not have reached them.
- **The proposal form alone, without a run**: it screens out a rule with no problem seen, and a search shows one already held, but its width, conflicts and place stay judged by the context that proposed it.
- **The learn step's proposals only**: a rule from an M spec, an S task or a reviewer's suggestion costs the same when it is superfluous (the user).
- **The learn step's proposals only**, the other ways left to the log's review: the user wants every way in judged; the log's *way in* column lets the review drop one.
- **A run on the `arch-review` report itself**: the skill writes nothing and has no checkpoint or branch to log on; the branch that writes its draft is judged.
- **Every hunk of the rule files' diff**: a move or a rewording would cost a run and rows toward the review (25 of 53 merges since 2026-10-20 touched those files).
- **The `critic` on every rule**: it reads and probes code, which a rule's judgment does not need, at about 1M input tokens a run (ADR 0007).
- **A light mode of the `critic`**: one agent with two opposite instructions on what to read.
- **A self-critique by the main agent**: it runs in the context that proposed the rule (ADR 0007).
- **A summary of why the rules were proposed, as input**: it carries the drift the run is there to catch; the evidence replaces it (the user, 2026-10-28).
- **The `CLAUDE.md` files and READMEs only**: a rule is often held by a skill, an agent or a script, which they do not show.
- **A cost limit now**: no run has been measured; the log records the cost, and the review weighs it (the user).
