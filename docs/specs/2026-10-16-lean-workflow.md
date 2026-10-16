---
status: draft
type: chore
packages: []
branch: chore/repo/lean-workflow
---

# A workflow sized to the task

## Why

Small changes cost long sessions and hundreds of thousands of tokens (the user, 2026-10-16). Measured over the transcripts of `en-monorepo`, 2026-09-23 to 2026-10-16 (`~/.claude/projects/-home-enardo-Projects-en-monorepo/`, by a script that sums each API call's `usage` once per message id):

- **Input tokens:** main agent 866M (78%), `reviewer` 162M (15%), `test-author` 77M (7%). Most of a review round's cost is the main agent's: tens of calls on a context of 200k to 500k tokens.
- **Reviews:** 64 runs, about 9 minutes each; 36 of the 59 that reached a verdict asked for changes. `fix/email-nodemailer/contract-compliance` took 6 reviews, 8 `test-author` runs, 211 main-agent calls and about 126M tokens; its spec reached 66 KB, five sections of it review follow-ups. The blocking findings of its third and fifth reviews came from inputs built to break the code: a getter that answers differently on two reads, a Proxy, a falsy `from` that the reviewer itself called low severity.
- **Small tasks:** the nodemailer 6 → 10 bump took 94 calls, about 38 minutes of work, about 19M tokens and four merges.
- **Root `CLAUDE.md`:** from 9.6 KB (2026-09-23) to 32 KB (2026-10-16), in 50 commits. Step 2 of *Workflow* alone is 6 KB, and the file tells 20 stories of the form "In `<branch>`, …". Every session and every subagent loads it.
- **Not causes:** the `Stop` hook (`pnpm verify` on a clean tree takes 2.6 s) and the ADRs (4 files, 11 KB, read when they bear on a change).

Four mechanisms feed each other:

1. **Blocking has no bound.** Every rule of the spec without a case, every doc sentence not true for every input, is blocking. With "ask which wrong implementation would pass", the reviewer runs mutants by hand and always finds one. Each fix adds code, tests and sentences for the next round, and each round reviews the whole branch again.
2. ***Learn* only adds.** Each incident becomes a permanent rule of the root `CLAUDE.md`, which the reviewer then enforces on every branch as a stated convention.
3. **The spec is a journal.** Every round appends to it, and three agents re-read it whole at every round.
4. **One size for every task.** A dependency bump goes through the same nine steps as a new package.

## Decisions

Taken with the user on 2026-10-16:

1. **Three tiers, S, M and L.** The main agent proposes one at intake, the user confirms or changes it. S has no spec and no subagent.
2. **The review loop goes on while a round finds a blocking defect.** It converges through a narrower definition of blocking, and through rounds after the first that review only the fixes. From the fourth round on, the main agent asks the user before starting one (proposed; to confirm at checkpoint 1).
3. **Specs stay in the repo, shorter**, and are records, not references: they are not read to learn how the code works.
4. **No new subagents.** Rare procedures become skills, loaded when used; mechanical steps become scripts.

## Changes

### 1. Root `CLAUDE.md`, at most 12 000 bytes

| Section | Outcome |
| --- | --- |
| Intro, Layout | kept; Layout adds `scripts/` and `docker/README.md` |
| Development environment | kept: the container rule, the `dev.sh` interface, never `pnpm` on the host and its recovery, the throwaway-container probe, the mount path, the pnpm store. To `docker/README.md`: the `playwright` service, image rebuilds, what the dev image holds and why git stays, what is not mounted. Root keeps one line for the browser tests and one for the mounts, pointing there |
| Tooling & commands | kept, compressed; the turbo-key rule in two lines |
| Publishing | to a `publish` skill. Root keeps the registry, "never publish with npm", the user's approval of each publish, the versioning rule |
| Architecture, Code conventions | kept |
| Testing | kept: location, Mongo, `*.node.test.ts`, refactors keep their tests. To `packages/http-client/CLAUDE.md`, named as the reference: the browser projects, `__tests__/support/`, opting in, timing. To the `spec` skill and `test-author.md`: listing the tests that send a newly rejected input, and an input where a side effect would show |
| Test-first policy, Workflow | rewritten, below. The probe rules of step 2 go to the `spec` skill |
| Roles, Branches, Commits, Definition of done | kept; Roles follows the agents' new scope |

Every "In `<branch>`, …" story leaves the file: the specs and the history keep them.

**Tiers**, at the head of *Workflow*:

- **S:** nothing a consumer of a package sees changes (public API, documented behavior, dependency ranges), or only docs, config or tooling; one package or one area of the repo. Branch → change (a bug: its failing test first, by the main agent) → verify → commit → checkpoint 2 → merge. No spec file, the intent goes in the commit body; no subagent.
- **M:** what a consumer sees changes. Spec with the `spec` skill → checkpoint 1 → `test-author` for the initial suite of a test-first step → implement → verify → review → checkpoint 2 → integrate.
- **L:** a new package, a change across packages, the dev environment or the workflow. As M, with an ADR when a decision outlives the task.
- A task that turns out bigger than its tier changes tier, and the user is told.

**Review loop:** the first round reviews the whole branch. The loop goes on while a round finds a blocking defect. A later round gets the previous findings and the SHA the previous round reviewed: it checks those findings and reviews `git diff <sha>..HEAD`, nothing else. A change after the last round gets a round of its own when it touches code, not when it touches docs only. From the fourth round on, the main agent asks the user first.

**Follow-ups** go in commit messages, not in the spec. The spec changes only when a decision does, and the user approves that change.

**Test-first policy:**

- A bug fix starts with a test that reproduces the bug and fails with its symptom.
- The public API of `@enardo/*` and domain logic are test-first. In M and L the `test-author` writes the initial suite from the spec, in the foreground, a new run each time. The main agent writes the tests of review follow-ups, and sees each fail before the fix.
- Wiring may be tested after the fact.
- Each behavior the spec requires has a case, or the spec says why not.
- A test written first fails for the expected reason, and asserts what identifies it (the class, `code`, `details`).
- A wrong implementation is tried on a copy of the package outside the repo, never by editing the working tree and reverting it: `git checkout` and `git stash` take uncommitted work with them.

"For each rule, ask which wrong implementation would break it and still pass every case" leaves the root: it goes to the `spec` skill, as a question for whoever designs the cases.

***Learn*:**

- Only for a problem that could recur, and costs more than its rule costs to read in every task.
- Where, in this order: a check, script, hook or lint rule; the agent, skill or package file it applies to; the root `CLAUDE.md`, for what applies to every task only.
- The rule, not its story.
- On the task's branch, before the merge; on a branch of its own only when it comes after the merge.
- The size check keeps the root `CLAUDE.md` and the agents within budget: a new rule merges with an old one or replaces one.

**Specs** are records: they are read when the user, the current spec or a backlog item points to one. The current truth stays in READMEs and `CLAUDE.md` files.

**Backlog:** a new item takes a few lines (what, why, where from); its probe results go in the spec when it starts. Existing items stay as they are.

### 2. `.claude/agents/reviewer.md`, at most 6 000 bytes

- **Later rounds:** the input adds the previous findings and the reviewed SHA; the round checks those findings and reviews `git diff <sha>..HEAD` only.
- **Blocking, and only:**
  1. a bug a plausible caller meets, with an input the public types accept;
  2. a security defect with a plausible vector, which the finding states; an untrusted value that can reach the code without a cast counts, whatever the types say;
  3. a spec requirement missed, or a change outside the spec's scope;
  4. a spec case missing or vacuous, or a bug fix's test that passes without the fix;
  5. a convention of a `CLAUDE.md` or an ADR broken, which no tool checks, with its consequence;
  6. a doc that misleads a caller in normal use.
- **Not blocking:** inputs built to break the code (a getter or a Proxy that answers differently on two reads, an object from another realm, a value the types refuse, unless point 2 applies); a rule of the spec's text without a case of its own; a surviving mutant, unless it shows point 4; a doc that is imprecise only for such inputs.
- **Output:** verdict; blocking findings; at most five suggestions, one line each; pre-existing defects as one-line backlog candidates; *Not verified*, short. No list of what was found sound.
- The rule on probes that find themselves by name stays, in two lines.

### 3. `.claude/agents/test-author.md`, at most 6 000 bytes

- **Scope:** the initial suite of a test-first step in M and L, a bug's reproducing test included.
- **Gains:** a case that checks one rule gives an input where a wrong side effect would show.
- **Loses:** the rule on probes that find themselves by name, which its runs do not need.

### 4. Skills

- **`spec`** (`.claude/skills/spec/`), for the spec of an M or L task:
  - the template: front matter (`status: draft`, `type`, `packages`, `branch`), *Why*, *Probes* (one line per fact: what was run, what it gave; a claim not probed is marked), *Decisions*, *Changes*, *Test cases*, *Out of scope*, *Plan*;
  - the probe rules of step 2, one line each, without their stories;
  - the questions for designing cases: which wrong implementation would pass; which existing tests send an input the change starts rejecting; which input would show a side effect.
- **`publish`** (`.claude/skills/publish/`): the content of *Publishing*. Pack in the container after a forced build, publish from the host outside the repo with the user's login, `--dry-run` first, the user's approval of each publish.

### 5. Scripts, in `scripts/`

- **`check-context-size.sh`** fails when the root `CLAUDE.md` is over 12 000 bytes or a `.claude/agents/*.md` over 6 000, and names each such file, its size and its budget. Root `package.json` gets `lint:context`; `verify` and `verify:all` run it after `lint:playwright`, outside turbo.
- **`task-start.sh <branch>`**, on the host:
  - refuses a name outside the *Branches* format (`<type>/<scope>/<description>`, a type of the list), a dirty tree, or a current branch other than `main`;
  - pulls `main` with `--ff-only` when it has an upstream;
  - creates the branch.
- **`integrate.sh`**, on the host, from the branch to merge:
  - refuses a dirty tree, and a spec that the branch adds under `docs/specs/` without `status: done`;
  - runs `pnpm verify` through `./dev.sh exec`;
  - then `git switch main`, `git merge --no-ff <branch>` and `git branch -d <branch>`.

### 6. Moved text

`docker/README.md` (new) and `packages/http-client/CLAUDE.md` receive their paragraphs as they are, without stories.

### 7. Backlog

A new *To evaluate* item: `check-manifests` in `pnpm verify`. It would check `files`, `sideEffects`, the standard scripts, `publishConfig.registry`, `catalog:` for the shared tooling, and that a README names only the packages its package depends on. Today it would fail on the six READMEs of *Six READMEs name packages they do not depend on*, so it lands with that item or after it.

## Probes

- This clone has no remote (`git remote -v` prints nothing): `task-start.sh` skips the pull.
- A spec's first commit has `status: draft`, its merge `status: done` (the first version of `docs/specs/2026-10-15-package-files.md` in `en-monorepo`'s history; the 25 specs here are all `done`).
- Merges use git's default message, `Merge branch '<branch>'` (`en-monorepo`'s last eight merges), 15 characters plus the branch name; the `commit-msg` hook runs on `git merge` too.
- `lint:sh` lists tracked files only (`git ls-files '*.sh'`): a new script gets shellcheck once it is added to the index.
- `pnpm verify` on a clean `main`: 2.6 s.
- Not probed: that a skill's body enters the context only when the skill is invoked, while its description always does. That is Claude Code's documented behavior; the plan does not depend on it beyond the size it saves.

## Test cases

No package code changes, so nothing is test-first. Checked by hand, each with its output in the *Verification* of the branch:

1. `pnpm verify` passes on the branch, with `lint:context` among its steps.
2. `check-context-size.sh`, on a copy of the repo outside it with a root `CLAUDE.md` of 12 001 bytes and an agent of 6 001, fails and names both files; at exactly 12 000 and 6 000 it passes.
3. `task-start.sh` refuses `foo`, `feature/x` (no description), `wip/repo/x` (unknown type), a dirty tree and a branch other than `main`, and creates `docs/repo/try-start` from a clean `main` (deleted afterwards).
4. `integrate.sh`, in a throwaway clone, refuses a branch whose spec is `draft` and a dirty tree, before it runs `verify`. Its merge path is not run in the clone: the clone's `./dev.sh exec` reaches the running container, which mounts this repo, not the clone (`dev.sh` runs one compose file, whose stack is already up). It runs for real when this branch is integrated, at checkpoint 2.
5. The new root `CLAUDE.md` loses no rule except those this spec moves or drops: each paragraph of the old file is accounted for in the review's diff.

## Out of scope

- The package `CLAUDE.md` files, beyond what `packages/http-client/CLAUDE.md` receives; the `arch-review` skill; the existing backlog items and specs.
- `check-manifests` itself (backlog).
- The agents' models, and the `Stop` hook.

## Plan

1. This spec, as the first commit.
2. `docker/README.md` and `packages/http-client/CLAUDE.md` receive the moved paragraphs; the `spec` and `publish` skills.
3. The root `CLAUDE.md`.
4. The two agents.
5. The scripts and `package.json`.
6. The backlog item.
7. Verify, then review: the first under the new rules, tier L.
