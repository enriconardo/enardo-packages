---
status: draft
type: chore
packages: []
branch: chore/repo/orchestrated-workflow
---

# M and L tasks implement in a fresh session that orchestrates subagents

## Why

From a discussion with the user (2026-10-21): a task costs too much of the user's token budget; `refactor/repo/split-contracts-from-adapters` took about 80% of a five-hour window, by the user's estimate. Measured on the session transcripts, with tokens weighted by API price (input 1, cache write 1.25, cache read 0.1, output 5):

- split-contracts cost about 2.3M weighted tokens, `feature/email/send-errors` about 10M.
- By phase, split-contracts spent about 0.9M up to checkpoint 1 (intake, spec, critic), 0.9M from there to the merge (implementation 550k, review 290k, integration 60k), and 0.5M on the publish after it.
- Most of it is the main session's context, reread on every call. In split-contracts it was 41k at the first call, 130k at checkpoint 1 and 203k at the end; in send-errors it reached 490k, and the main session's cache reads alone weighed about 4.5M.
- After its merge, split-contracts' session published and edited cambusa's backlog: 20 calls, 492k, 76% of it rereading a 170k–200k context.
- Every subagent runs on Opus at the session's effort, `xhigh`, whatever its job.

The user also asked for tiers judged by impact, risk, uncertainty and reversibility, judging that the current table, by what a consumer sees and how many packages change, made some past tasks L too generously; and for the steps between the two checkpoints to run without them.

## Probes

- Transcripts, first call of each run, 2026-10-16 to 2026-10-21 → main session 40.9k–41.7k; `critic`, `reviewer` and `test-author` (four to six tools) 10.2k–11.2k; `general-purpose` (every tool) 31.9k–33.2k.
- Transcripts of the subagents → each message records `model` and `effort`: the critic and the reviewer of split-contracts ran on `claude-opus-5-5` at `xhigh`, the session's effort, with no `effort` in their definitions.
- Transcript of session 3c539fd8 → an `Agent` call with `model: "haiku"` ran a `general-purpose` agent on `claude-haiku-5-5`: the call's `model` overrides the definition's.
- `effort` in an agent's front matter → **not probed**: the `Agent` tool's description says that a definition sets an agent's effort, without naming the key. Plan step 1 probes it.
- The 18 specs implemented since 2026-10-02, here and in en-monorepo, user messages between checkpoint 1 and the first review → implementation stopped for the user twice, both for an action outside the repo: a publish (split-repos) and recreating the dev container (browser-tests). Never for a design decision.
- `docs/critic-runs.md` and the commits that weigh each run → all 5 runs changed 1 to 4 decisions; the main findings came from reading code and library sources: LMTP's refusals in nodemailer, the SMTP password leak, bcrypt's 72-byte limit.
- `wc -c CLAUDE.md` → 11 954 bytes, against a budget of 12 000.

## Decisions

1. **Triage rates four criteria**, each `low`, `medium` or `high` with a reason: impact (the modules, users, data and public contracts touched), risk (security, privacy, data correctness, compatibility, regressions), uncertainty (ambiguous requirements, code or dependencies not well known), reversibility (`high` when it is low: persisted data, an exposed secret; a breaking change is not, a later version fixes it). The number of files is a hint, not a rule, and impact is at least `medium` when a consumer sees the change. **S** when all four are `low`; **L** when one is `high`, or the change is to the workflow or the dev environment; **M** otherwise. A few lines in authentication or a data migration can be L, and the security fixes queued in the backlog become L, each with a critic run.
   - Not taken: the current table, alone or as the floor (critic). The user judges that it made some past tasks L too generously. The workflow and the dev environment, where critic runs changed decisions, stay L by name.
   - Not taken: the discussion's first draft, with L for low reversibility or a decision that outlives the task. Split-contracts and send-errors would have been M, without the critic runs that changed 7 of their decisions.
   - Not taken: a triage subagent. It would read the same code the spec then reads, from a cold start, and the user confirms the tier anyway.
2. **The brief.** The intake message gives one line per criterion, the open decisions, the tier, and the implementer's model and effort. The spec's front matter keeps `tier` and `implementer` (`<model>/<effort>`), so that both survive the `/clear`. The default is `sonnet/medium`, `opus/high` when risk or uncertainty is `high`.
3. **The spec stays in the main session**, written in discussion with the user. The template gains:
   - *Open questions*, what awaits the user at checkpoint 1;
   - in *Probes*, the code to reuse with `file:line`;
   - *Risks*, when risk is `medium` or `high`.

   No rollback section: a published version never changes, and a data rollback goes in *Plan*.
   - Not taken: an architect subagent. It cannot ask the user, and send-errors had four interventions of the user before its approval.
4. **`/clear` at checkpoint 1, then `/implement <spec>`.** The skill makes the new main session the orchestrator. It reads the spec, the subagents' reports and the scripts' output, never the code.
   - **What it edits:** the docs that belong to no package. The spec after a decision of the user, the backlog's items, and the rules of the learn step, which it proposes at checkpoint 2.
   - **Estimated cost, on split-contracts' 0.9M from checkpoint 1 to the merge:** about 0.6M for this flow, and about the same for a fresh session that implements by itself, since both start the context over. The difference is that this flow puts the implementation's output on the brief's model and effort without the user. A rough estimate, from the calls and contexts measured.
   - Not taken: a `/clear` after the triage. The triage's reading is the spec's input: 73k at split-contracts' intake question, 41k of it fixed.
   - Not taken: implementing in the spec's session, whose context every call rereads.
   - Not taken: a fresh session that implements by itself. The model would be the user's choice in the interface for every step, not the brief's.
   - Not taken: in stages (critic). That means a fresh session that implements by itself on the brief's model, set by the user, then measuring the next task and building the orchestrator only if that phase still costs the most. The user prefers to automate now.
5. **An `implementer` subagent**:
   - **Tools:** Read, Grep, Glob, Edit, Write and Bash.
   - **Model and effort:** the orchestrator passes those of `implementer` on every run.
   - **One run per piece of work:** each plan step, each fix of a red verify, and each review round's findings, all in one run, is a new foreground run, never a resumed one. Two runs in a row that leave the same check red go to the user.
   - **Stops:** an action outside the repo, or a departure from the spec, ends the run with a report, and the orchestrator asks the user.
   - **README:** it writes the README in the same commit as the public API change, from the spec's decisions.
   - Not taken: resuming a run. It goes to the background, where the `Stop` hook blocks on red tests.
   - Not taken: a docs subagent, a cold start for about one call of output.
   - Not taken: the spec's author writing the README. The text would be duplicated in a record frozen at the merge.
6. **The test-author stays on Opus, at medium effort**, set in its definition.
   - Not taken: Sonnet (critic). It saves little, the test-author used 7% of the input tokens in en-monorepo (ADR 0005) and 10% of send-errors. It is the independent check that ADR 0006 protects, and with a Sonnet implementer the reviewer would be the only Opus run on the code.
7. **The gate before checkpoint 2:** verify green, and the reviewer's last round without a blocking finding. Otherwise the implementer runs again, and the user sees nothing.
   - Not taken: `scripts/check-cases.sh`, a script that checks that every case of the spec maps to a test that passed (critic). No case has been seen slipping past the reviewer, who blocks on a missing or vacuous one, and the map would come from the agents it checks. It comes when a case slips.
   - Not taken: a gate agent explaining why all is well, another cold start whose "all is well" proves nothing.
8. **The checkpoint 2 report is assembled from data**:
   - verify's result;
   - each case and the test that covers it, from the test-author's and the implementer's reports;
   - the test-author's tests changed since handoff, with the commits that changed them;
   - the reviewer's findings by round, and their fixes;
   - departures from the spec, with their reasons;
   - the README changes;
   - backlog candidates and follow-ups.

   One line for what passed, detail for the exceptions.
9. **The critic is unchanged** (the user, from the *Probes*): ADR 0007's triggers, and it reads code.
10. **The reviewer stays on Opus**, the last check before the merge. Point 6 of *What is blocking* also names a public API change that its README does not describe.
11. **Publish and follow-ups go in a session of their own**, after the integration.
12. **ADR 0008** records 1, 2, 4, 5, 7 and 11. It supersedes ADR 0005's point 1 (the tiers) and, for the implementer, point 6's "no new subagents".

## Changes

- **`scripts/test-handoff.sh`** gains `changes`: for each recorded suite, the files that differ in `HEAD`, and the commits since the record that touched them (hash, subject, body).
- **`.claude/agents/implementer.md`** (new), within 6 000 bytes:
  - **Front matter:** the tools of decision 5, with `sonnet` and medium effort as defaults.
  - **Input:** the spec, the step or the findings, and the record and report of a test-first step.
  - **Rules:**
    - the root and package `CLAUDE.md`s;
    - each commit green, and never pushed;
    - a test-author test changes only where it is wrong, with the reason in the commit body;
    - the tests of review follow-ups are written first and seen failing;
    - a fix looks for the other paths through the same mechanism, and follow-ups go in commit messages (from the root `CLAUDE.md`'s steps that move to the skill);
    - the README goes in the same commit as the public API change;
    - for each test it writes, the spec case it covers, in its output;
    - stop and report on an action outside the repo or a departure from the spec;
    - no integration and no publish.
  - **Output:** commits, the cases its tests cover, departures, actions needed, verify's state.
- **`.claude/agents/test-author.md`:** medium effort, still on Opus.
- **`.claude/agents/reviewer.md`:** point 6 of *What is blocking*, as decision 10.
- **`.claude/skills/implement/SKILL.md`** (new), the orchestrator:
  1. The input is the argument, or the branch's spec.
  2. **Each plan step** runs a test-author then an implementer for a test-first step, an implementer otherwise.
  3. **Then:** `pnpm verify` and the reviewer. A red verify or a round with a blocking finding goes to a new implementer run. The user is asked before each review round from the fourth on, and for each action outside the repo or departure from the spec.
  4. **Checkpoint 2:** the report of decision 8.
  5. **On the go-ahead:** the spec's `done` commit and `integrate.sh`, then stop.
  6. **Never read** `src/`, `__tests__/` or a diff of them.
- **`.claude/skills/spec/SKILL.md`:** the template of decisions 2 and 3, and the brief in the intake message.
- **Root `CLAUDE.md`**, within 12 000 bytes:
  - *Workflow*'s tier table becomes decision 1;
  - M and L read branch → spec → ⏸ 1 → `/clear`, `/implement` → ⏸ 2 → integrate;
  - the detail of the implementation, review and checkpoint 2 moves to the skill;
  - publishing goes in a session of its own;
  - in *Testing* and *Roles*, the implementer takes the main agent's part in the code.
- **`docs/adr/0008-orchestrated-implementation.md`** (new); the ADR index; ADR 0005's status.

## Test cases

Run on a clone of the repo, as the scripts of earlier workflow tasks were.

1. `test-handoff.sh changes`: a record, then a commit that changes one of its tests → the file, and the commit's hash, subject and body; an untouched suite → "unchanged".
2. A test-author run → its transcript records `claude-opus-5-5` and `medium` on every message.
3. An implementer run without a `model` → Sonnet at medium; with `model: "opus"` and `effort: "high"` → Opus at high.
4. `pnpm verify` → `check-context-size.sh` passes with the new `CLAUDE.md` and `implementer.md`.

## Risks

- **The orchestrator could read code anyway**, and its context would grow again. Only the skill's rule stops it; the next tasks' transcripts show whether it holds.
- **An implementer on Sonnet may need more review rounds**, each an Opus run. The next M and L tasks measure it.
- **The first run of `/implement` from start to end** is the next M or L task. Its transcripts are measured as these were.
- **The weights are one price list.** How the user's budget counts Sonnet against Opus is unknown: the saving of a Sonnet run shows only on the user's usage meter.

## Out of scope

- **The critic** (decision 9).
- **The effort of the critic and the reviewer**, which keep the session's. They are the independent judgments, and nothing measured says a lower effort keeps their findings.
- **The main session's model and effort, and the claude.ai connectors:** the user's environment.
- **A script that measures a session's cost.**
- **The README gaps found in the discussion:** four packages without one, and exports that their README does not name.
- **The S path**, unchanged.
- **`chore/repo/evaluate-critic`**, which counts the critic's runs by trigger. Its `L spec` rows from this task on count L by decision 1.

## Plan

Tooling, tested after: each step runs its cases on a clone before its commit. The task itself is implemented after checkpoint 1 in a fresh session, under the current `CLAUDE.md`, since `/implement` does not exist yet.

1. **Probe the effort key.**
   - A throwaway agent definition with `model: sonnet` and `effort: medium`, run once; its transcript shows both or not.
   - The definition is removed, and the result goes in step 4's commit body.
   - If the key does not work, the skill passes `effort` on every run of the test-author too.
2. **`test-handoff.sh changes`**: case 1.
3. **The implementer, test-author and reviewer definitions**: cases 2–3.
4. **The `implement` skill and the `spec` skill.**
5. **Root `CLAUDE.md`, ADR 0008, the ADR index, ADR 0005's status**: case 4.
