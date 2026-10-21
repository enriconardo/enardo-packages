---
name: spec
description: The intake of a change to this repo, and the spec of an M or L task up to checkpoint 1 (root `CLAUDE.md`, Workflow). Holds the model check and the brief of the intake, the template, the rules for probing the facts a spec states, the questions for designing its test cases, how to weigh the `critic`'s report, and checkpoint 1. An S task stops after the brief: it has no spec.
argument-hint: "<slug>"
---

# Intake and spec

## Intake

- **The model first.** The session runs on Opus, which the system prompt names. On another model, a session left on an implementation's, ask the user to switch it in the interface before the triage.
- **The brief**, in the intake message:
  - one line per criterion, `low`, `medium` or `high` with its reason; a `high` makes the task L, whatever the root `CLAUDE.md`'s tier table says, and the number of files is a hint, not a rule:
    - **impact:** the modules, users, data and public contracts touched;
    - **risk:** security, privacy, data correctness, compatibility, regressions;
    - **uncertainty:** ambiguous requirements, code or dependencies not well known;
    - **reversibility:** `high` when it is low, such as persisted data or an exposed secret; a breaking change is not, a later version fixes it;
  - the open decisions;
  - the tier;
  - for M and L, the model and effort of the implementation: `sonnet/medium`, or `opus/high` when risk or uncertainty is `high`. Another value needs a reason.

The user confirms or changes the tier and the values.

## The spec

The spec goes in `docs/specs/YYYY-MM-DD-<slug>.md`, today's date, and is the first commit of the task's branch. It is as short as the task allows: an M task is often a page or two. It describes what will change and why, not the history of the work: review follow-ups go in commit messages, and the spec changes after checkpoint 1 only when a decision does, with the user's approval. After the merge it is never edited.

## Template

```markdown
---
status: draft
type: <feature | fix | refactor | chore | docs | test>
tier: <M | L>
implementer: <sonnet/medium | opus/high>
packages: ["@enardo/<name>"]
branch: <type>/<scope>/<description>
---

# <what the change does>

## Why

The problem, where it comes from (a backlog item, a review, the user, a discussion with the user), and for a bug its root cause.

## Probes

- <what was run, where> → <what it gave>
- <the code to reuse> → `<file>:<line>`

## Decisions

The choices taken with the user, and the options not taken.

## Open questions

What awaits the user at checkpoint 1; none once approved.

## Changes

What changes, package by package or file by file.

## Test cases

Numbered, one behavior each, with the input and the expected outcome.

## Risks

When risk is `medium` or `high`: what could go wrong, and what shows it.

## Out of scope

## Plan

The steps, each ending green and committed; which ones are test-first. A data rollback goes here: a published version never changes, so there is no rollback section.
```

`tier` and `implementer` survive the `/clear` of checkpoint 1. At the merge, `status` becomes `done`.

## Probing

Each fact the plan relies on is probed in the dev container before the spec states it, and goes under *Probes* in one line. A claim that was not probed is marked as such.

- **Tools and existing code.** How a tool behaves (an API, a flag, what a build emits), and how the existing code behaves wherever the spec describes it. A manual check meant to show unchanged behavior runs on `main` first.
- **A fresh build.** A probe through a package's `dist/` first rebuilds it and its dependencies, with `pnpm exec turbo run build --filter=<package>... --force`, and the spec names that command: a `dist/` imports its dependencies' `dist/`.
- **Where a dependency is declared.** Why it sits where it does is a claim: remove it in a throwaway clone and see what breaks, including an app that loads the package.
- **A library's documentation is not a probe.** The cases a library produces (its errors, their types or statuses, its options) come from its installed source, or from running them.
- **A type declaration is not a probe of a runtime.** What a runtime defines (its globals, its modules) is enumerated in that runtime, every one, not a sample.
- **Advisories.** The version that closes a module's advisories is read from the `patched_versions` of every one of them (`pnpm audit --json`), not from one. The version an upgrade moves to is audited itself, with `npm audit` on a lockfile of that version in a throwaway container: it can bring advisories of its own.
- **Commands for agents.** A command that a skill, an agent or a `CLAUDE.md` gives to agents is probed on every package it can run on, not on the one at hand.
- **What an error exposes** is probed on its serialized form (its `toJSON()`, the log it lands in), with the whole `cause` chain, not on its message.
- **Absence is a claim too** ("nothing else changes", "no blind spot"). When a change closes one way into a gap, describe the mechanism behind it, and look for its other triggers before removing it from the docs.
- **A removed dependency between two packages:** look for every doc line that names both, not only for the symbols that move.
- **A value the code does not control.** When the code starts reading one where it used to pass it along (a rejection, an abort reason, a parsed body), the spec states what happens when a read throws, and when the value is cyclic or very deep. On an error path, a throw replaces the error being reported.
- **A copy of a caller's value** changes what a library reads downstream: a spread keeps own enumerable properties only, and loses the prototype, its getters and the non-enumerable ones. Check what the library produced from the value.
- **A tool that refuses a mismatch** (a version, a protocol): probe every level it could compare, patch, minor and major, not only one it refuses.

## Designing the test cases

- **Every behavior the spec requires has a case, or the spec says why not:** an order, a count, a sequence, an edge that passes.
- **For each rule, ask which wrong implementation would break it and still pass every case**, and add the case that catches it.
- **An input where the side effect would show.** A case that checks one rule gives an input on which a wrong implementation gives another result: to test that a failing read keeps the `cause`, the error needs a `cause`.
- **An input the change starts rejecting:** list every existing test that sends it. Search for the value, then for the uses of every constant that holds it.
- **What identifies the outcome:** the expected error's class, `code` and `details`, not only that something is thrown.

## The critic

When step 2 of the root `CLAUDE.md`'s *Workflow* calls for the `critic`, after the spec's commit:

- **Its input** is the spec's path; on a re-run, after the user changed a decision it judged, also the commit of the version it judged. Nothing else: no summary of the discussion, no argument.
- **Weigh the report yourself**, and apply what you accept to the spec, in a commit of its own. An objection to a decision the user took goes to the user, with your view: never undo that decision alone. After checkpoint 1, so does any change you accept, since the spec then changes only with the user's approval.
- **Save the report as it came** in your scratchpad, as `critic/<slug>-<n>.md`.
- **Show the user the outcome**, not the report: the verdict; what you changed; for each objection you rejected, its headline in the critic's words and your reason; the objections to the user's decisions, with your view; the report's path.
- **Log the run** in `docs/critic-runs.md`, as its header says, once the user has answered the objections brought to them.

A proposal outside a spec (a rule of the learn step, a discussion), when the user asks: the same, written in the spec's form in your scratchpad, one file per version (`<slug>-v<n>.md`). A re-run gets the previous version's path in place of a commit. The row goes on the current task's branch, whether the proposal is kept or dropped; with no task, in an S task of its own, right after the user's answers.

## Checkpoint 1

- **The spec and its open questions** go to the user, who approves it before any production code.
- **The lessons of the spec phase**, proposed in the learn step's form (root `CLAUDE.md`, *Workflow*), since the `/clear` loses them. The approved ones are committed on the branch before the `/clear`; one in the form of code is reviewed with the rest of the task.
- **Then end with the three steps**, filled in:
  1. set the model and effort of `implementer` in the interface;
  2. `/clear`;
  3. `/implement <the spec's path>`.
