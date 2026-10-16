---
status: draft
type: chore
packages: []
branch: chore/repo/test-handoff-and-idle-verify
---

# The test-author's suite is recorded at handoff, and a turn with nothing to verify skips verify

## Why

From a discussion of the workflow with the user (2026-10-16):

1. **The test-author's independence ends at handoff.** The main agent commits its tests together with the implementation, since a red suite is never committed. The reviewer sees `main...HEAD`, never the suite as the test-author wrote it, so an assertion loosened on the way to green does not show.
2. **A discussion runs verify.** The `Stop` hook runs `pnpm verify` at the end of every turn, a question's too, and `./dev.sh exec` fails when the dev container is stopped: a turn that changed nothing is blocked.
3. **A question gets the intake of a task.** "The main agent proposes a tier at intake" does not say that a question or a discussion is no task.
4. **The root `CLAUDE.md` is at 11 994 bytes of 12 000**, and holds two rules that only one role needs.

## Probes

- `./dev.sh exec pnpm verify` on a clean tree at `main`'s commit, container up → exit 0 in 6.1 s.
- `dev.sh`, `require_running` → with the service stopped, `exec` prints "Service 'dev' is not running" and exits 1: the hook exits 2.
- In a clone (scratchpad), a temporary index from `HEAD` + `git add -A -- ':(glob)**/__tests__/**'` + `write-tree` + `commit-tree -p HEAD` + `update-ref refs/test-author/chore/repo/x/1` → the commit holds a modified test and a new one in a nested folder, not a change under `src/` nor an ignored `__tests__/node_modules/` file; `git status --porcelain` and the real index (`write-tree`) are unchanged, a staged deletion included.
- `git commit-tree` with a `commit-msg` hook that exits 1 → the commit is created: plumbing runs no hook.
- `git for-each-ref refs/test-author/chore/repo/x` → lists `…/x/1`, not `…/x-other/1`; `update-ref -d` on each removes the branch's refs only.
- After a commit that changes a recorded test, `git diff <ref> HEAD -- <the files of git diff --name-only <ref>^ <ref>>` → shows the change.
- `git ls-files --others --exclude-standard -- ':(glob)**/__tests__/.reference/**'` → lists a reference model left in place.
- The main agent's list of agent types shows each agent's `description`: it is what the main agent reads when it calls one.
- The four edits of the root `CLAUDE.md` below, drafted on a copy → 11 996 bytes.
- `.claude/skills/spec/SKILL.md:72` already states "Every behavior the spec requires has a case, or the spec says why not" (root `CLAUDE.md:86`).

## Decisions

- **A question or a discussion is not a task**: no tier, no branch, until it leads to a change. Not a tier T: proposing it and waiting for a confirmation would add a round trip to every question.
- **The hook skips verify when the tree is clean at `main`'s commit.** `integrate.sh` merges only after a green verify, so that tree has passed it. Not taken: a stamp of the last green tree, which would also skip a discussion on a branch, but keys the result on the tree alone; on a branch the container is up, and a cached verify takes seconds.
- **The test-author records its suite**, as its last step, under `refs/test-author/<branch>/<n>`: a commit outside `refs/heads`, so that a red suite never lands on the branch, built through a temporary index, so that the working tree, the index and the branch stay as they are. The test-author records, not the main agent, whose changes the record checks. Not taken: committing the red suite as `it.fails`, which changes the tests; a patch file in a scratchpad, which the reviewer may not see.
- **A removed or loosened assertion of a recorded suite is blocking** (reviewer, point 4), unless a commit body says why the test was wrong. A case added later is not.
- **Refactoring:** a restructuring the change needs is a step of the plan of its own, before the step that changes behavior, with the tests unchanged. Not a phase of every task, nor a separate agent.
- **No implementer** for now (user).

## Changes

- `scripts/stop-hook.sh` (new): the hook's command, moved out of `.claude/settings.json`, which calls it; exits 0 when `git status --porcelain` is empty and `HEAD` is `main`'s commit, and when the input has `"stop_hook_active": true`; otherwise as now, exit 2 with the tail of a red verify.
- `scripts/test-handoff.sh` (new), run on the host:
  - `record`: the changes under `__tests__/` against `HEAD` as `refs/test-author/<branch>/<n>`, `n` counting from 1, and prints them. Refuses on `main` or a detached `HEAD`, with a reference model left under `__tests__/.reference/`, and with no change to record.
  - `diff`: for each recorded suite, in order, the diff from it to `HEAD` of the files it holds, or that they are unchanged; says when there is none.
  - `clear <branch>`: removes that branch's records.
- `scripts/integrate.sh`: `clear` after deleting the branch.
- `.claude/agents/test-author.md`: records the suite last, nothing under `__tests__/` changes after it; the output names the ref. The `description` takes the invocation rule of the root: a new foreground run each time (`run_in_background: false`), since a resumed one runs in the background, where the `Stop` hook blocks on its red tests.
- `.claude/agents/reviewer.md`: on the first round, `scripts/test-handoff.sh diff`; point 4 covers a removed or loosened assertion of a recorded suite without a reason in a commit body.
- Root `CLAUDE.md`: the hook skips a clean tree at `main`'s commit (line 49); the test-author records its suite, and the main agent changes one of its tests only where the test is wrong, with the reason in the commit body (line 85, which loses the invocation rule); line 86 removed; a question or a discussion is no task (line 92). Within 12 000 bytes.
- `.claude/skills/spec/SKILL.md`, *Plan*: the refactoring step.
- `docs/adr/0006-…`: the recorded suite and the rule on changing it; the index.

## Test cases

Shell scripts, which the repo tests with shellcheck only: each case is a manual check, run in a clone in the scratchpad, on a copy of a script whose verify is replaced by a stub where the case needs one, and listed in the commit body.

1. Hook, input with `"stop_hook_active": true` → exit 0, verify not run.
2. Hook, clean tree at `main`'s commit (on `main`, and on a new branch) → exit 0, verify not run.
3. Hook, an untracked file at `main`'s commit → verify runs.
4. Hook, clean tree one commit past `main` → verify runs.
5. Hook, no `main` branch → verify runs.
6. Hook, a red verify → exit 2, the tail of its output and "verify failed" on stderr.
7. `record`, with a modified test and a new one in two packages, a change under `src/` and an ignored file under `__tests__/` → `refs/test-author/<branch>/1` holds the two tests only; status, index and `HEAD` unchanged.
8. `record` again → `…/2`.
9. `record` with no change under `__tests__/` → exit 1, no ref.
10. `record` with a file under `__tests__/.reference/` → exit 1, the file named, no ref.
11. `record` on `main`, and on a detached `HEAD` → exit 1, no ref.
12. `diff` after a commit that changes a recorded test → its diff; a recorded suite left as it was → "unchanged"; no record → says so, exit 0.
13. `diff` with eleven records → in the order 1 … 11.
14. `clear <branch>` → removes that branch's refs, not those of a branch whose name extends it; `clear` without a branch → usage, exit 2, nothing removed.
15. `integrate.sh` (verify stubbed) → after the merge, no ref of the branch left.
16. `pnpm verify` green: shellcheck on both scripts, the context-size budgets.

## Out of scope

- An implementer agent.
- The records of a branch abandoned without `integrate.sh`: removed by hand, `scripts/test-handoff.sh clear <branch>`.

## Plan

Not test-first: the repo has no harness for its scripts; the cases above are run by hand at each step.

1. This spec.
2. `stop-hook.sh`, `settings.json`, root `CLAUDE.md` line 49 (cases 1–6, 16).
3. `test-handoff.sh`, `integrate.sh`, both agents, root `CLAUDE.md` line 85 (cases 7–16).
4. Root `CLAUDE.md` lines 86 and 92, the `spec` skill's *Plan*.
5. ADR 0006 and the index.
