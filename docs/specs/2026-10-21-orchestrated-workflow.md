---
status: draft
type: chore
packages: []
branch: chore/repo/orchestrated-workflow
---

# M and L tasks implement in a fresh session, on the model the spec names

## Why

From a discussion with the user (2026-10-21): a task costs too much of the user's token budget; `refactor/repo/split-contracts-from-adapters` took about 80% of a five-hour window, by the user's estimate. Measured on the session transcripts, with tokens weighted by API price (input 1, cache write 1.25, cache read 0.1, output 5):

- split-contracts cost about 2.3M weighted tokens, `feature/email/send-errors` about 10M.
- By phase, split-contracts spent about 0.9M up to checkpoint 1 (intake, spec, critic), 0.9M from there to the merge (implementation 550k, review 290k, integration 60k), and 0.5M on the publish after it. send-errors spent about 3.9M up to checkpoint 1 and 6.3M from there to the merge, 3.3M of it the main session rereading a 366k–490k context.
- Most of it is the main session's context, reread on every call. In split-contracts it was 41k at the first call, 130k at checkpoint 1 and 203k at the end; in send-errors it reached 490k, and the main session's cache reads alone weighed about 4.5M.
- After its merge, split-contracts' session published and edited cambusa's backlog: 20 calls, 492k, 76% of it rereading a 170k–200k context.
- Every subagent runs on Opus at the session's effort, `xhigh` in the sessions measured, whatever its job.

The user also asked that impact, risk, uncertainty and reversibility weigh in the tier, and for the steps between the two checkpoints to run without them.

## Probes

- Transcripts, first call of each run, 2026-10-16 to 2026-10-21 → main session 40.9k–41.7k; `critic`, `reviewer` and `test-author` (four to six tools) 10.2k–11.2k; `general-purpose` (every tool) 31.9k–33.2k.
- Transcripts of the subagents → each message records `model` and `effort`: the critic and the reviewer of split-contracts ran on `claude-opus-5-5` at `xhigh`, the session's effort, with no `effort` in their definitions.
- Transcript of session 3c539fd8 → an `Agent` call with `model: "haiku"` ran a `general-purpose` agent on `claude-haiku-5-5`: the call's `model` overrides the definition's.
- The installed Claude Code 2.1.306 binary, the schema of a skill's front matter → `model` ("`haiku`, `sonnet`, `opus`, `fable`, or a full ID. Use `inherit` to match the parent conversation"), `effort` ("`low`, `medium`, `high`, `max`, or an integer"), `user-invocable`, `disable-model-invocation`, `context`.
- Plan step 1, session 9d66493f: the user launched a skill with `model: inherit`, which launched through the Skill tool one with `model: sonnet`, `effort: medium`, `user-invocable: false`, which launched three agents on `opus`. The API requests' `model` and `output_config.effort` →
  - **The skill's `model`:** no effect. Every request stayed on `claude-opus-5-5`, while the system prompt named Sonnet 5.5.
  - **The skill's `effort`:** `medium` from the skill's launch, back to the session's `high` at the next turn, a subagent's notification.
  - **An agent's `effort`:** `medium` and `xhigh` ran as set; an agent without the key ran at the override's `medium`, the live effort.
  - **The `Agent` tool:** every run in the background, with no foreground option; so did the critic's re-run, launched from this session without a skill.
- The binary and its settings schema → `/model` and `/effort <level>` set the session's model and effort by hand, as the interface does; `modelSettings.<model>.effortLevel` persists an effort per model.
- `scripts/stop-hook.sh` and `scripts/integrate.sh` → the `Stop` hook runs `pnpm verify` at the end of every turn and blocks it on a red state; `integrate.sh` runs it before the merge, and merges only on green.
- Skills and agents written during this session → listed in it right away: they load mid-session.
- The 18 specs implemented since 2026-10-02, here and in en-monorepo, user messages between checkpoint 1 and the first review → implementation stopped for the user twice, both for an action outside the repo: a publish (split-repos) and recreating the dev container (browser-tests). Never for a design decision.
- `docs/critic-runs.md` and the commits that weigh each run → all 5 runs changed 1 to 4 decisions; the main findings came from reading code and library sources: LMTP's refusals in nodemailer, the SMTP password leak, bcrypt's 72-byte limit.
- `wc -c CLAUDE.md` → 11 954 bytes, against a budget of 12 000.

## Decisions

1. **Triage rates four criteria**, each `low`, `medium` or `high` with a reason: impact (the modules, users, data and public contracts touched), risk (security, privacy, data correctness, compatibility, regressions), uncertainty (ambiguous requirements, code or dependencies not well known), reversibility (`high` when it is low: persisted data, an exposed secret; a breaking change is not, a later version fixes it). The number of files is a hint, not a rule. The current table stays as the floor, and a rating of `high` makes the task L. A few lines in authentication or a data migration can be L, and the security fixes queued in the backlog become L, each with a critic run.
   - Not taken: the ratings alone, with the workflow and the dev environment L by name. Of the six L tasks since ADR 0005, split-contracts alone would have become M, and its critic run changed 3 decisions.
   - Not taken: the current table alone (critic). The ratings would only pick the model, and a few lines in authentication would stay M.
   - Not taken: the discussion's first draft, with L for low reversibility or a decision that outlives the task. Split-contracts and send-errors would have been M, without the critic runs that changed 7 of their decisions.
   - Not taken: a triage subagent. It would read the same code the spec then reads, from a cold start, and the user confirms the tier anyway.
2. **The brief.** The intake message gives one line per criterion, the open decisions, the tier, and the model and effort of the implementation. The spec's front matter keeps `tier` and `implementer` (`<model>/<effort>`), so that both survive the `/clear`. The default is `sonnet/medium`, `opus/high` when risk or uncertainty is `high`; another value needs a reason in the brief.
3. **The spec stays in the main session**, written in discussion with the user. The template gains:
   - *Open questions*, what awaits the user at checkpoint 1;
   - in *Probes*, the code to reuse with `file:line`;
   - *Risks*, when risk is `medium` or `high`.

   No rollback section: a published version never changes, and a data rollback goes in *Plan*.

   At checkpoint 1 the session also proposes the lessons of the spec phase, in the learn step's form, since the `/clear` would lose them. The approved ones are committed on the branch before it; one in the form of code is reviewed with the rest of the task.
   - Not taken: an architect subagent. It cannot ask the user, and send-errors had four interventions of the user before its approval.
4. **After checkpoint 1 the user sets the spec's model by hand, then `/clear` and `/implement <spec>`.**
   - **At checkpoint 1** the session ends with the three steps: the model and effort of `implementer`, set in the interface; `/clear`; `/implement <spec>`.
   - **`/implement`**, with model `inherit`, compares the model it runs on with `implementer`. On a mismatch it stops and asks for the switch. The session does not see its effort: the checkpoint's steps name it.
   - **The session implements by itself.** The test-author and the reviewer run as subagents, as today; the code, the fixes and the README are the session's.
   - **After the integration** the session reminds the user to set back their model and effort, since the next session, a publish or a task's intake, starts on the current ones.
   - **At the next intake** the `spec` skill checks that the session runs on Opus, and otherwise asks for the switch before the triage: a session stopped before the integration never gives the reminder (critic, fourth run).
   - **Estimated cost, on split-contracts' 0.9M from checkpoint 1 to the merge:** about 0.6M, since the session starts the context over. A rough estimate, from the calls and contexts measured.
   - Not taken: a skill variant per model, `implement-sonnet` and `implement-opus`, launched by `/implement` (d222f6a to 0524247). A skill's `model` has no effect when the model launches it, and its `effort` lasts one turn (plan step 1, *Probes*).
   - Not taken: an orchestrator that never reads the code, with an `implementer` subagent per plan step and fix on the model it passes (172b6ef to a0113ed). It picks the model without the user, at the price of an agent more, an exception to ADR 0005's "no new subagents", and a cold start per step and review round, for about the same estimated cost. The user prefers the switch by hand.
   - Not taken: a `/clear` after the triage. The triage's reading is the spec's input: 73k at split-contracts' intake question, 41k of it fixed.
   - Not taken: implementing in the spec's session, whose context every call rereads.
5. **The work between the checkpoints.**
   - **Who works:** the session works each plan step, each red verify and each review round's findings.
   - **When it stops for the user:** two fixes in a row that leave the same check red, a departure from the spec, and an action outside the repo.
   - **README:** it is written in the same commit as the public API change, from the spec's decisions.
   - **Docs and learn step:** the learn step, the spec's amendments after a decision of the user, and the backlog's items stay with the session, as today.
   - Not taken: a docs subagent, a cold start for about one call of output.
   - Not taken: the spec's author writing the README. The text would be duplicated in a record frozen at the merge.
6. **The test-author stays on Opus, at medium effort**, set in its definition, since the session may run on other models. The user takes it as an experiment toward this task's goal, measured on the next tasks.
   - Not taken: the session's effort (critic, second run). Nothing measured says a lower effort keeps its findings, and the user chooses to try.
   - Not taken: Sonnet (critic). It saves little, the test-author used 7% of the input tokens in en-monorepo (ADR 0005) and 10% of send-errors. It is the independent check that ADR 0006 protects, and with an implementation on Sonnet the reviewer would be the only Opus run on the code.
7. **The gate before checkpoint 2:** verify green, and the reviewer's last round without a blocking finding. Otherwise the session fixes and checks again, and the user sees nothing, except a finding that needs a decision the spec does not take, which goes to the user before the fix.
   - Not taken: `scripts/check-cases.sh`, a script that checks that every case of the spec maps to a test that passed (critic). No case has been seen slipping past the reviewer, who blocks on a missing or vacuous one, and the map would come from the agents it checks. It comes when a case slips.
   - Not taken: a gate agent explaining why all is well, another cold start whose "all is well" proves nothing.
8. **The checkpoint 2 report is assembled from data**:
   - verify's result;
   - each case and the test that covers it, from the test-author's reports and the session's own tests;
   - the changes to the test-author's suites since handoff, each with its reason, from the reviewer's first round, which reads `scripts/test-handoff.sh diff`;
   - the reviewer's findings by round, and their fixes;
   - departures from the spec, with their reasons;
   - the README changes;
   - backlog candidates and follow-ups;
   - `git diff --stat main...HEAD`, the full diff being the user's to read.

   One line for what passed, detail for the exceptions.
   - Not taken: a `changes` subcommand of `scripts/test-handoff.sh` that tells the main agent's commits from the test-author's (the user, after four review rounds). Each round found a history that hid a changed test: a record holds the whole tree, and suites overlap on a file. The reviewer already reads `diff`, and blocks on a change without a reason.
9. **The critic keeps ADR 0007's triggers, and reads code** (the user, from the *Probes*). Only its effort changes: `xhigh`, set in its definition as the reviewer's (decision 10), since a session left on `sonnet/medium` would run it at `medium` (critic, fourth run; the user).
10. **The reviewer stays on Opus**, the last check before the merge.
    - **Effort:** `xhigh`, that of the sessions measured, set in its definition: an agent without the key runs at the session's live effort (*Probes*), `medium` in a session on `sonnet/medium`.
    - **No override at launch:** the steps launch the test-author and the reviewer without `model` or `effort`.
    - **README:** point 6 of *What is blocking* also names a public API change that its README does not describe.
11. **Publish and follow-ups go in a session of their own**, after the integration.
12. **The `Stop` hook goes** (the user). The `Agent` tool runs every subagent in the background (*Probes*): the session ends its turn while the test-author writes its red tests, and the hook runs `pnpm verify` on them and blocks the session. Each launch costs a verify, a call that rereads the context, and two test runs at once in the dev container.
    - **Where verify runs:** the S path's verify step; `/implement`, before each review round and before checkpoint 2; `integrate.sh`, before the merge, which stays the mechanical gate.
    - Not taken: the hook skipping when every uncommitted change is under `__tests__/`. A red change to tests alone would reach the user, and `integrate.sh` would stop it at the merge. The user prefers the simpler flow.
    - Not taken: the hook skipping while a marker, set before the launch and removed by `test-handoff.sh record`, is in place: one state more, which needs an expiry for a test-author that fails before `record`.
13. **ADR 0008** records 1, 2, 4, 5, 7, 11 and 12, and supersedes ADR 0005's point 1 (the tiers).

## Changes

- **`scripts/stop-hook.sh`** and **`.claude/settings.json`**, which holds only the hook, are removed.
- **`.claude/agents/test-author.md`:** `effort: medium`, still on Opus; its description says it runs in the background, and the session waits for its notification, in place of the foreground run.
- **`.claude/agents/critic.md`:** `effort: xhigh`.
- **`.claude/agents/reviewer.md`:** `effort: xhigh`, point 6 of *What is blocking*, as decision 10, and the changes to the recorded suites in its first round's output, for decision 8.
- **`.claude/skills/implement/SKILL.md`** (new), `model: inherit`. The input is the argument, or the spec the branch's first commit adds. The steps:
  1. **The model:** decision 4's check against `implementer`.
  2. **Each plan step:** the test-author first for a test-first step, and its notification awaited, then the code, in green commits. A public API change carries its README in the same commit, from the spec's decisions. The test-author and the reviewer are launched without `model` or `effort`.
  3. **Then:** `pnpm verify` and the reviewer. A red verify or a round with a blocking finding is fixed, the tests of review follow-ups first, each fix looking for the other paths through the same mechanism.
  4. **The user decides:** a finding that needs a decision the spec does not take; each review round from the fourth on; two fixes in a row that leave the same check red; an action outside the repo; a departure from the spec. A stop on a red check names it.
  5. **Follow-ups** go in commit messages.
  6. **Checkpoint 2:** a fresh `pnpm verify`, the report of decision 8, and the learn step's proposals.
  7. **On the go-ahead:** the spec's `done` commit and `integrate.sh`; then the reminder of decision 4, and stop. Publishing goes in a new session.
- **`.claude/skills/spec/SKILL.md`:** the model check at its start, the template of decisions 2 and 3, the brief in the intake message, the lessons proposed at checkpoint 1, and the checkpoint's three steps of decision 4.
- **Root `CLAUDE.md`**, within 12 000 bytes:
  - *Workflow*'s tier table becomes decision 1;
  - M and L read branch → spec → ⏸ 1 → model, `/clear`, `/implement` → ⏸ 2 → integrate;
  - the detail of the implementation, review and checkpoint 2 moves to the skill's steps;
  - the learn step proposes at checkpoints 1 and 2;
  - *Tooling*'s line on the `Stop` hook becomes decision 12's places where verify runs;
  - publishing goes in a session of its own.
- **`docs/adr/0008-implementation-on-the-specs-model.md`** (new); the ADR index; ADR 0005's status.

## Test cases

Run on a clone of the repo, as the scripts of earlier workflow tasks were; a model and an effort are read in the transcript's API requests (`model`, `output_config.effort`).

1. A test-author run → its requests record `claude-opus-5-5` and `medium`.
2. `/implement` on a spec with `implementer: sonnet/medium`, in a session set to Sonnet at `medium` → it goes on, and its requests record `claude-sonnet-5-5` and `medium`; in a session on Opus → it stops and asks for the switch.
3. A reviewer run and a critic run from a session on `sonnet/medium` → their requests record `claude-opus-5-5` and `xhigh`.
4. The `spec` skill in a session on Sonnet → it asks for the switch before the triage.
5. `pnpm verify` → `check-context-size.sh` passes with the new `CLAUDE.md`.

## Risks

- **The session's context grows during the implementation**, from the fresh start to the merge. The next tasks' transcripts show how far.
- **A switch forgotten:** `/implement`'s check stops a session on the wrong model, not one on the wrong effort, which the transcripts show.
- **A switch back forgotten:** the next session, a task's intake or a publish, runs on Sonnet. The reminder after the integration and the `spec` skill's check guard the intake; a publish has neither.
- **A red state reaching the user:** without the hook, a session that skips verify hands over a red tree at a checkpoint or at the end of an S task. `integrate.sh` refuses to merge it.
- **An implementation on Sonnet may need more review rounds**, each an Opus run. The next M and L tasks measure it.
- **A test-author at medium effort may miss cases**: the reviewer's findings on its suites show it.
- **The first run of `/implement` from start to end** is the next M or L task. Its transcripts are measured as these were.
- **The weights are one price list.** How the user's budget counts Sonnet against Opus is unknown: the saving of a Sonnet run shows only on the user's usage meter.

## Out of scope

- **The critic** (decision 9).
- **A lower effort for the critic and the reviewer.** Both run at `xhigh` (decisions 9 and 10). They are the independent judgments, and nothing measured says a lower effort keeps their findings.
- **The main session's model and effort, and the claude.ai connectors:** the user's environment.
- **A script that measures a session's cost.**
- **The README gaps found in the discussion:** four packages without one, and exports that their README does not name.
- **The S path**, unchanged.
- **`chore/repo/evaluate-critic`**, which counts the critic's runs by trigger. Its `L spec` rows from this task on count L by decision 1.

## Plan

Tooling, tested after: each step runs its cases on a clone before its commit. The task itself is implemented after checkpoint 1 under the current `CLAUDE.md`, since `/implement` does not exist yet.

1. **Probe the overrides**: done, results in *Probes*.
2. **The agent definitions and the hook's removal**: case 1.
3. **The `implement` skill and the `spec` skill**: cases 2 to 4, in sessions the user opens on each model.
4. **Root `CLAUDE.md`, ADR 0008, the ADR index, ADR 0005's status**: case 5.
