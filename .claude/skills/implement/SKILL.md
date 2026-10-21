---
name: implement
description: Implement an M or L task of this repo from its approved spec, in a fresh session after checkpoint 1 (root `CLAUDE.md`, Workflow): the plan's steps, verify, the reviewer's rounds, checkpoint 2 and the integration. The user launches it with the spec's path.
argument-hint: "[<spec>]"
model: inherit
---

# Implementing a spec

The spec: `$ARGUMENTS`. If that is empty, the file the branch's first commit adds under `docs/specs/`:

```sh
git log --reverse --diff-filter=A --format= --name-only main..HEAD -- docs/specs/ | head -n 1
```

Read it, and the `CLAUDE.md` of each package it touches. The spec's decisions were taken with the user: don't reopen them.

## 1. The model

The spec's front matter names `implementer: <model>/<effort>`. Compare its model with the one this session runs on, which the system prompt names. On a mismatch, or with no `implementer`, stop and ask the user to set that model and effort in the interface, then go on at their answer, after checking again. The session does not see its effort: name it in the message.

## 2. Each plan step

- **A test-first step:** launch the `test-author` with the spec's path and the step's cases, without `model` or `effort`, which its definition sets. It runs in the background: end the turn with one line saying so, and write the production code only after its report. A test of its suite changes only where it is wrong, with the reason in the commit body.
- **The code**, in small steps, each green and committed. A public API change carries its README in the same commit, written from the spec's decisions.
- **Wiring** may be tested after.

## 3. Verify and review

- **`./dev.sh exec pnpm verify`** after the last step. Nothing runs it for you: a red verify is fixed before the review.
- **The `reviewer`**, launched without `model` or `effort`: the spec's path; on a later round, the previous findings and the SHA they were made on. Wait for its report as for the test-author's.
- **A blocking finding** is fixed, the tests of review follow-ups first, each seen failing. A fix looks for the other paths through the same mechanism. Then verify again, and a new round: a later change to code gets one, to docs only not.
- **The gate:** verify green, and the last round without a blocking finding.

## 4. When the user decides

Stop for the user on:

- a finding that needs a decision the spec does not take, before the fix;
- each review round from the fourth on, before it;
- two fixes in a row that leave the same check red, naming the check;
- an action outside the repo: a publish, a container to recreate, another repository;
- a departure from the spec, with its reason: the spec changes only with the user's approval.

Anything else, the session works through by itself.

## 5. Follow-ups

Follow-ups go in commit messages, not in the spec. Collect the backlog candidates for the report.

## 6. Checkpoint 2

Run `./dev.sh exec pnpm verify` again, then report, one line for what passed and detail for the exceptions:

- verify's result;
- each test case of the spec and the test that covers it, from the test-author's reports and the session's own tests;
- the test-author's tests changed since handoff, with the commits that changed them: `scripts/test-handoff.sh changes`;
- the reviewer's findings by round, and their fixes;
- the departures from the spec, with their reasons;
- the README changes;
- the backlog candidates and the follow-ups;
- `git diff --stat main...HEAD`: the full diff is the user's to read.

Then the learn step's proposals (root `CLAUDE.md`, *Workflow*), and wait for the go-ahead.

## 7. The integration

On the go-ahead:

1. The spec's `status` becomes `done`, in a commit of its own.
2. `scripts/integrate.sh`, which runs verify before the merge.
3. Remind the user to set their model and effort back in the interface: the next session, a publish or a task's intake, starts on the current ones. Publishing goes in a session of its own, with the `publish` skill.

Then stop.
