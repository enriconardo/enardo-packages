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
- Every subagent runs on Opus at the session's effort, `xhigh`, whatever its job.

The user also asked that impact, risk, uncertainty and reversibility weigh in the tier, and for the steps between the two checkpoints to run without them.

## Probes

- Transcripts, first call of each run, 2026-10-16 to 2026-10-21 → main session 40.9k–41.7k; `critic`, `reviewer` and `test-author` (four to six tools) 10.2k–11.2k; `general-purpose` (every tool) 31.9k–33.2k.
- Transcripts of the subagents → each message records `model` and `effort`: the critic and the reviewer of split-contracts ran on `claude-opus-5-5` at `xhigh`, the session's effort, with no `effort` in their definitions.
- Transcript of session 3c539fd8 → an `Agent` call with `model: "haiku"` ran a `general-purpose` agent on `claude-haiku-5-5`: the call's `model` overrides the definition's.
- `effort` in an agent's front matter → **not probed**: the `Agent` tool's description says that a definition sets an agent's effort, without naming the key. Plan step 1 probes it.
- The installed Claude Code 2.1.306 binary, the schema of a skill's front matter →
  - **`model`:** "Model override (`haiku`, `sonnet`, `opus`, `fable`, or a full ID). Use `inherit` to match the parent conversation".
  - **`effort`:** "`low`, `medium`, `high`, `max`, or an integer".
  - **Other keys:** `context` (`inline`, or `fork` for a subagent), `user-invocable`, `disable-model-invocation`.
  - **The Skill tool** takes `skill` and `args` only, and its result has "Resolved model the skill turn runs on when a frontmatter model override took effect".
  - **Not probed:** whether an override takes effect when the model launches the skill, and how long it lasts. Plan step 1 probes both.
- A skill written during a session, launched through the Skill tool in that session → "Unknown skill": skills load when a session starts.
- The 18 specs implemented since 2026-10-02, here and in en-monorepo, user messages between checkpoint 1 and the first review → implementation stopped for the user twice, both for an action outside the repo: a publish (split-repos) and recreating the dev container (browser-tests). Never for a design decision.
- `docs/critic-runs.md` and the commits that weigh each run → all 5 runs changed 1 to 4 decisions; the main findings came from reading code and library sources: LMTP's refusals in nodemailer, the SMTP password leak, bcrypt's 72-byte limit.
- `wc -c CLAUDE.md` → 11 954 bytes, against a budget of 12 000.

## Decisions

1. **Triage rates four criteria**, each `low`, `medium` or `high` with a reason: impact (the modules, users, data and public contracts touched), risk (security, privacy, data correctness, compatibility, regressions), uncertainty (ambiguous requirements, code or dependencies not well known), reversibility (`high` when it is low: persisted data, an exposed secret; a breaking change is not, a later version fixes it). The number of files is a hint, not a rule. The current table stays as the floor, and a rating of `high` makes the task L. A few lines in authentication or a data migration can be L, and the security fixes queued in the backlog become L, each with a critic run.
   - Not taken: the ratings alone, with the workflow and the dev environment L by name. Of the six L tasks since ADR 0005, split-contracts alone would have become M, and its critic run changed 3 decisions.
   - Not taken: the current table alone (critic). The ratings would only pick the model, and a few lines in authentication would stay M.
   - Not taken: the discussion's first draft, with L for low reversibility or a decision that outlives the task. Split-contracts and send-errors would have been M, without the critic runs that changed 7 of their decisions.
   - Not taken: a triage subagent. It would read the same code the spec then reads, from a cold start, and the user confirms the tier anyway.
2. **The brief.** The intake message gives one line per criterion, the open decisions, the tier, and the model and effort of the implementation. The spec's front matter keeps `tier` and `implementer` (`<model>/<effort>`), so that both survive the `/clear`. The default is `sonnet/medium`, `opus/high` when risk or uncertainty is `high`. These are the only two values, one per skill variant (decision 4). The dispatch asks the user for any other value, or for a spec without one.
3. **The spec stays in the main session**, written in discussion with the user. The template gains:
   - *Open questions*, what awaits the user at checkpoint 1;
   - in *Probes*, the code to reuse with `file:line`;
   - *Risks*, when risk is `medium` or `high`.

   No rollback section: a published version never changes, and a data rollback goes in *Plan*.
   - Not taken: an architect subagent. It cannot ask the user, and send-errors had four interventions of the user before its approval.
4. **`/clear` at checkpoint 1, then `/implement <spec>`: the new session implements on the spec's model.**
   - **Dispatch.** `/implement`, with model `inherit`, reads `implementer` in the spec's front matter and launches one of two variants through the Skill tool: `implement-sonnet` (`sonnet`, `medium`) or `implement-opus` (`opus`, `high`). Each variant is its front matter and a pointer to the shared steps.
     - A skill's `model` and `effort` are fixed in its front matter, and the Skill tool takes only a name and arguments (*Probes*).
     - So the choice among variants is how the model gets picked for each task, without the user.
   - **The session implements by itself.** The test-author and the reviewer run as subagents, as today; the code, the fixes and the README are the session's.
   - **If the override lasts only until the user's next message,** the session launches its variant again before going on.
   - **Fallback:** if plan step 1 shows that the override does not take effect when the model launches the skill, the spec is amended with the user for the orchestrator of its earlier version (172b6ef to a0113ed).
     - The session coordinates and never reads the code.
     - An `implementer` subagent with Read, Grep, Glob, Edit, Write and Bash takes each plan step and each fix in a new foreground run, on the model and effort the session passes.
   - **Estimated cost, on split-contracts' 0.9M from checkpoint 1 to the merge:** about 0.6M for this flow, and about the same for the orchestrator, since both start the context over. This flow has no cold start per step; the orchestrator keeps the session's context small. A rough estimate, from the calls and contexts measured.
   - Not taken: a `/clear` after the triage. The triage's reading is the spec's input: 73k at split-contracts' intake question, 41k of it fixed.
   - Not taken: implementing in the spec's session, whose context every call rereads.
   - Not taken: a fresh session on a model the user sets by hand, and in stages (critic). The user prefers to automate now, and the variants pick the model without them.
   - Not taken: the orchestrator first. It needs one agent more, though two skills fewer, and an exception to ADR 0005's "no new subagents". It adds a cold start for every step and review round, for about the same estimated cost. It stays as the fallback.
5. **The work between the checkpoints.**
   - **Who works:** the session works each plan step, each red verify and each review round's findings.
   - **When it stops for the user:** two fixes in a row that leave the same check red, a departure from the spec, and an action outside the repo.
   - **README:** it is written in the same commit as the public API change, from the spec's decisions.
   - **Docs and learn step:** the learn step, the spec's amendments after a decision of the user, and the backlog's items stay with the session, as today.
   - Not taken: a docs subagent, a cold start for about one call of output.
   - Not taken: the spec's author writing the README. The text would be duplicated in a record frozen at the merge.
6. **The test-author stays on Opus, at medium effort**, set in its definition, since the session may run on other models. The user takes it as an experiment toward this task's goal, measured on the next tasks; the critic and the reviewer keep the session's effort.
   - Not taken: the session's effort, as for the critic and the reviewer (critic, second run). Nothing measured says a lower effort keeps its findings, and the user chooses to try.
   - Not taken: Sonnet (critic). It saves little, the test-author used 7% of the input tokens in en-monorepo (ADR 0005) and 10% of send-errors. It is the independent check that ADR 0006 protects, and with an implementation on Sonnet the reviewer would be the only Opus run on the code.
7. **The gate before checkpoint 2:** verify green, and the reviewer's last round without a blocking finding. Otherwise the session fixes and checks again, and the user sees nothing, except a finding that needs a decision the spec does not take, which goes to the user before the fix.
   - Not taken: `scripts/check-cases.sh`, a script that checks that every case of the spec maps to a test that passed (critic). No case has been seen slipping past the reviewer, who blocks on a missing or vacuous one, and the map would come from the agents it checks. It comes when a case slips.
   - Not taken: a gate agent explaining why all is well, another cold start whose "all is well" proves nothing.
8. **The checkpoint 2 report is assembled from data**:
   - verify's result;
   - each case and the test that covers it, from the test-author's reports and the session's own tests;
   - the test-author's tests changed since handoff, with the commits that changed them;
   - the reviewer's findings by round, and their fixes;
   - departures from the spec, with their reasons;
   - the README changes;
   - backlog candidates and follow-ups;
   - `git diff --stat main...HEAD`, the full diff being the user's to read.

   One line for what passed, detail for the exceptions.
9. **The critic is unchanged** (the user, from the *Probes*): ADR 0007's triggers, and it reads code.
10. **The reviewer stays on Opus**, the last check before the merge.
    - **Effort:** today's, `xhigh`, set in its definition, so that a variant's override does not lower it.
    - **No override at launch:** the steps launch the test-author and the reviewer without `model` or `effort`.
    - **README:** point 6 of *What is blocking* also names a public API change that its README does not describe.
11. **Publish and follow-ups go in a session of their own**, after the integration.
12. **ADR 0008** records 1, 2, 4, 5, 7 and 11, and supersedes ADR 0005's point 1 (the tiers).

## Changes

- **`scripts/test-handoff.sh`** gains `changes`: for each recorded suite, the files that differ in `HEAD`, and the commits since the record that touched them (hash, subject, body).
- **`.claude/agents/test-author.md`:** medium effort, still on Opus.
- **`.claude/agents/reviewer.md`:** `effort: xhigh`, and point 6 of *What is blocking*, as decision 10.
- **`.claude/skills/implement/SKILL.md`** (new), `model: inherit`: the dispatch of decision 4. The input is the argument, or the spec the branch's first commit adds; the variant is the one `implementer` names.
- **`.claude/skills/implement-sonnet/SKILL.md` and `implement-opus/SKILL.md`** (new): their `model` and `effort`, `user-invocable: false`, and the instruction to follow the shared steps for the spec in their arguments.
- **`.claude/skills/implement/steps.md`** (new), the shared steps:
  1. **Each plan step:** the test-author first for a test-first step, then the code, in green commits. A public API change carries its README in the same commit, from the spec's decisions. The test-author and the reviewer are launched without `model` or `effort`.
  2. **Then:** `pnpm verify` and the reviewer. A red verify or a round with a blocking finding is fixed, the tests of review follow-ups first, each fix looking for the other paths through the same mechanism.
  3. **The user decides:** a finding that needs a decision the spec does not take; each review round from the fourth on; two fixes in a row that leave the same check red; an action outside the repo; a departure from the spec. When the session stops on a red check, the `Stop` hook blocks it once: it names the check and stops again.
  4. **Follow-ups** go in commit messages.
  5. **Checkpoint 2:** the report of decision 8, and the learn step's proposals.
  6. **On the go-ahead:** the spec's `done` commit and `integrate.sh`, then stop. Publishing goes in a new session.
  7. **After each message of the user:** the variant is launched again, if plan step 1 shows the override ends there.
- **`.claude/skills/spec/SKILL.md`:** the template of decisions 2 and 3, and the brief in the intake message.
- **Root `CLAUDE.md`**, within 12 000 bytes:
  - *Workflow*'s tier table becomes decision 1;
  - M and L read branch → spec → ⏸ 1 → `/clear`, `/implement` → ⏸ 2 → integrate;
  - the detail of the implementation, review and checkpoint 2 moves to the skill's steps;
  - publishing goes in a session of its own.
- **`docs/adr/0008-implementation-on-the-specs-model.md`** (new); the ADR index; ADR 0005's status.

## Test cases

Run on a clone of the repo, as the scripts of earlier workflow tasks were.

1. `test-handoff.sh changes`: a record, then a commit that changes one of its tests → the file, and the commit's hash, subject and body; an untouched suite → "unchanged".
2. A test-author run → its transcript records `claude-opus-5-5` and `medium` on every message.
3. In a new session, `/implement` on a spec with `implementer: sonnet/medium` → the messages after the variant's launch record `claude-sonnet-5-5` and `medium`; with `opus/high` → `claude-opus-5-5` and `high`.
4. The same, with a message of the user in the middle → the messages after it record the variant's model and effort again.
5. A reviewer run from `implement-sonnet` → its transcript records `claude-opus-5-5` and `xhigh`.
6. `pnpm verify` → `check-context-size.sh` passes with the new `CLAUDE.md`.

## Risks

- **The session's context grows during the implementation**, from the fresh start to the merge. The next tasks' transcripts show how far.
- **A session that forgets to launch its variant again** runs on the session's model, if the override ends at the user's message. The transcripts show it.
- **An implementation on Sonnet may need more review rounds**, each an Opus run. The next M and L tasks measure it.
- **A test-author at medium effort may miss cases**: the reviewer's findings on its suites show it.
- **The first run of `/implement` from start to end** is the next M or L task. Its transcripts are measured as these were.
- **The weights are one price list.** How the user's budget counts Sonnet against Opus is unknown: the saving of a Sonnet run shows only on the user's usage meter.

## Out of scope

- **The critic** (decision 9).
- **A lower effort for the critic and the reviewer.** The critic keeps the session's, the reviewer today's `xhigh` (decision 10). They are the independent judgments, and nothing measured says a lower effort keeps their findings.
- **The main session's model and effort, and the claude.ai connectors:** the user's environment.
- **A script that measures a session's cost.**
- **The README gaps found in the discussion:** four packages without one, and exports that their README does not name.
- **The S path**, unchanged.
- **`chore/repo/evaluate-critic`**, which counts the critic's runs by trigger. Its `L spec` rows from this task on count L by decision 1.

## Plan

Tooling, tested after: each step runs its cases on a clone before its commit. The task itself is implemented after checkpoint 1 in a fresh session, under the current `CLAUDE.md`, since `/implement` does not exist yet.

1. **Probe the overrides**, in a session the user opens after the throwaway files exist, since skills and agents load when a session starts.
   - **Files:**
     - a skill with a variant's front matter (`model: sonnet`, `effort: medium`, `user-invocable: false`), launched by the model from a second skill;
     - an agent with `effort: medium`, and one with `effort: xhigh`;
     - one with no `effort`, launched from the first skill.
   - **What the transcripts show:**
     - whether the skill's override takes effect;
     - whether it holds after a message of the user;
     - whether the agent's key works, `xhigh` included;
     - what an agent without the key inherits under the override.
   - **Afterwards:** the files are removed, and the results go in the next commit's body.
   - **If the skill's override does not take effect:** stop, and amend the spec with the user for the fallback of decision 4.
   - **If the agent's key, or `xhigh`, does not work:** the steps pass `effort` on every run of the test-author and the reviewer.
2. **`test-handoff.sh changes`**: case 1.
3. **The test-author and reviewer definitions**: case 2.
4. **The `implement` skills and the `spec` skill**: cases 3–5, in a session the user opens.
5. **Root `CLAUDE.md`, ADR 0008, the ADR index, ADR 0005's status**: case 6.
