---
name: spec
description: Write the spec of an M or L task of this repo (root `CLAUDE.md`, Workflow), before checkpoint 1. Holds the template, the rules for probing the facts a spec states, the questions for designing its test cases, and how to weigh the `critic`'s report on it. Not for S tasks, which have no spec.
argument-hint: "<slug>"
---

# Writing a spec

The spec goes in `docs/specs/YYYY-MM-DD-<slug>.md`, today's date, and is the first commit of the task's branch. It is as short as the task allows: an M task is often a page or two. It describes what will change and why, not the history of the work: review follow-ups go in commit messages, and the spec changes after checkpoint 1 only when a decision does, with the user's approval. After the merge it is never edited.

## Template

```markdown
---
status: draft
type: <feature | fix | refactor | chore | docs | test>
packages: ["@enardo/<name>"]
branch: <type>/<scope>/<description>
---

# <what the change does>

## Why

The problem, where it comes from (a backlog item, a review, the user, a discussion with the user), and for a bug its root cause.

## Probes

- <what was run, where> → <what it gave>

## Decisions

The choices taken with the user, and the options not taken.

## Changes

What changes, package by package or file by file.

## Test cases

Numbered, one behavior each, with the input and the expected outcome.

## Out of scope

## Plan

The steps, each ending green and committed; which ones are test-first.
```

At the merge, `status` becomes `done`.

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
- **Weigh the report yourself**, and apply what you accept to the spec, in a commit of its own. An objection to a decision the user took goes to the user, with your view: never undo that decision alone. After checkpoint 1, so does any change of a decision you accept, since the spec then changes only with the user's approval.
- **Save the report as it came** in your scratchpad, as `critic/<slug>-<n>.md`.
- **Show the user the outcome**, not the report: the verdict; what you changed; for each objection you rejected, its headline in the critic's words and your reason; the objections to the user's decisions, with your view; the report's path.
- **Log the run** in `docs/critic-runs.md`, as its header says, once the user has answered the objections brought to them.

A proposal outside a spec (a rule of the learn step, a discussion), when the user asks: the same, written in the spec's form in your scratchpad, one file per version (`<slug>-v<n>.md`). A re-run gets the previous version's path in place of a commit, and the row goes in the commit that applies the proposal.
