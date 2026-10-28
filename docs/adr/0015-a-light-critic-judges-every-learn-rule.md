# 0015. A light critic judges every rule the learn step proposes, from its evidence and the rules it would join

- Status: proposed
- Date: 2026-10-28
- Spec: docs/specs/2026-10-28-learn-rule-critic.md

## Context

The learn step (root `CLAUDE.md`, *Workflow*, step 6) proposes rules at checkpoints 1 and 2, written by the agent that worked the task. The user reports (2026-10-28) that its proposals are at times superfluous, excess zeal, or wrong. The history shows rules that duplicated another file's (95fa060), rules as narrow as their incident, merged after the fact (fa14383), and a rule broader than its cases, narrowed later (ADR 0011).

ADR 0007 gave the `critic` a run on a learn rule only when the user asks, and set aside a run on every one: "no case of a learn rule that drifted, at about 1M input tokens a run". Most of a `critic` run is reading code and probing. A learn rule is a text that joins other texts: whether it is needed, already held, too wide or in the wrong place shows in those texts and in the evidence behind it.

## Decision

1. **A read-only `rule-critic` agent judges every learn proposal**, at checkpoints 1 and 2, in every tier, S included: one run per checkpoint with proposals, on all of them together.
2. **Its input is a proposals file and nothing else**: for each rule, its text, where it goes, and the evidence of the problem (a commit, a review finding, a failing check's output, a `file:line`). No summary of the discussion and no argument for the rule, as ADR 0007 point 3 says for the `critic`.
3. **It reads the rules, not the code**: it searches the `CLAUDE.md` files, READMEs, agents, skills, scripts and ADRs, and reads the target file and the hits; code only where the evidence cites it. No probes and no runs. What only the code or a run would settle goes under *Not verified*.
4. **Its verdict per rule is `keep`, `revise` or `drop`**, on whether the problem was seen, is worth the rule's cost, is already held elsewhere, and whether the rule is wider than its evidence, conflicts with a rule or an ADR, or sits in the wrong place.
5. **Every proposal reaches the user with its verdict**, a dropped one as one line; the main agent gives its reason where it rejects a verdict. The user decides.
6. It runs on `opus` at `medium` effort.

This supersedes, for the rules of the learn step, ADR 0007's run of the `critic` when the user asks (point 2).

## Consequences

- Every checkpoint with a proposal costs a run, an S task's included; a checkpoint without one costs nothing.
- A rule that is wrong about the code or a tool can pass the light run: it is listed under *Not verified*, and the user can still ask for the `critic`.
- The main agent has to write the evidence of each rule, which a rule without a problem seen cannot give.
- The user reads verdicts and headlines, not the report, which stays in the scratchpad.
- Dropping the agent is the user's call, on the outcomes of its runs, as for the `critic` (ADR 0009, point 3).

## Alternatives considered

- **The `critic` on every learn rule**: about 1M input tokens a run, mostly on code that a rule's judgment does not need.
- **A light mode of the `critic`**: one agent with two opposite instructions on what to read.
- **A self-critique by the main agent**: it runs in the context that proposed the rule (ADR 0007).
- **A summary of why the rules were proposed, as input**: it carries the drift the run is there to catch; the evidence replaces it (the user, 2026-10-28).
- **The `CLAUDE.md` files and READMEs only**: a rule often duplicates a skill, an agent or a script (95fa060), which they do not show.
