---
status: draft
type: chore
tier: L
implementer: sonnet/medium
packages: []
branch: chore/repo/evaluate-critic
---

# The critic keeps its triggers, and its runs are no longer logged

## Why

The queued backlog item `chore/repo/evaluate-critic`, due once `docs/critic-runs.md` logs five L specs (ADR 0007, point 5): count the `critic`'s runs by trigger, remove each trigger none of whose runs changed a decision, and leave a trigger with no run to the user. The log now has five L specs.

The log exists for this count. Once it is done, its header points to a backlog item that has left, and no rule reads the rows it keeps getting; ADR 0008 drew evidence from one.

## Probes

- The rows of `docs/critic-runs.md` on `main` (cab2021), by trigger:

  | Trigger | Runs | Runs that changed a decision | Decision | Text only |
  | --- | --- | --- | --- | --- |
  | L spec | 5 | 5 | 16 | 12 |
  | re-run | 4 | 4 | 14 | 7 |
  | asked | 1 | 1 | 1 | 0 |
  | M spec, from a discussion with the user | 0 | – | – | – |

  Text only, all runs: 19. All ten verdicts are `challenge`.
- The specs since the critic (2026-10-16 on), by `tier`: one M, `2026-10-21-nodemailer-redact-transport-errors.md`. Its *Why* comes from a bug in the code, but a decision of it was "taken with the user at intake", so it qualifies under the trigger's wording and had no run. The zero shows how the main agent reads the clause, not that no M spec came from a discussion.
- Cost: ADR 0007 estimates about 1M input tokens a run, so about 10M for the ten runs; not measured.
- Where the log is named, outside the frozen specs (`git grep -n -i -E "critic-runs|log the run|the row goes"`): the `spec` skill (*The critic*, the bullet "Log the run" and the sentence "The row goes on the current task's branch…" of its last paragraph), ADR 0007 (point 5), the backlog item; the root `CLAUDE.md`, the agents and the other ADRs do not.
- ADRs are never edited after acceptance, except for their status (`docs/adr/README.md`): ending point 5 of ADR 0007 takes a new ADR.

## Decisions

- **Every trigger stays**, by ADR 0007's rule: each of `L spec`, `re-run` and `asked` changed a decision in every run.
- **The M trigger stays** (the user, 2026-10-22). Its zero runs is no evidence either way (*Probes*), and removing it would leave unguarded the case ADR 0007 is about. Its wording, which the main agent reads for itself, goes to the backlog's *To evaluate* (the user, 2026-10-22).
- **The measure ends here: the runs are no longer logged** (the user, 2026-10-22). The user reads the outcome of every run, each rejected objection included (`spec` skill, *The critic*): a critic whose runs turn to noise shows there, and the user can drop it or a trigger at any time. Not taken:
  - **a second count under the same rule**: it would remove a trigger only if none of its new runs changed a decision, after every run so far changed one to six; it would keep everything, at the cost of another L task;
  - **a second count under a rule that can fail** (a share of runs, decisions against cost): a new rule to calibrate, for a measure the run outcomes already show the user;
  - **logging with no count**: a rule with no reader.
- **`docs/critic-runs.md` is deleted**; its table by trigger goes into ADR 0009, and its rows stay in git history.
- **This branch's critic runs are not logged**, as the spec of `chore/repo/spec-critic` left out the runs that judged the critic itself: a run on its own evaluation is not a sample of its use.

## Open questions

None.

## Changes

- `docs/adr/0009-critic-runs-no-longer-logged.md` (new, written with this spec so that the user reads it at checkpoint 1: no critic run follows it): it supersedes ADR 0007's point 5. ADR 0007's status: `accepted; point 5 superseded by 0009`. `docs/adr/README.md`: the index row of 0009, and 0007's status.
- `.claude/skills/spec/SKILL.md`, *The critic*: the bullet "Log the run" goes, and so does the sentence "The row goes on the current task's branch, whether the proposal is kept or dropped; with no task, in an S task of its own, right after the user's answers."
- `docs/critic-runs.md`: deleted.
- `docs/backlog.md`, *To evaluate*: an item on the M trigger's wording. "a decision comes from a discussion with the user" covers, read as written, every M spec with a decision taken with the user, as the template defines *Decisions*; the main agent, whom ADR 0007 deems unable to tell when it has drifted, decides which qualify. Options: a condition it does not judge, such as the user saying at intake whether the spec gets a run, or every M spec with a decision marked as the user's. From the `critic`'s run on this spec (2026-10-22).
- `docs/backlog.md`: the item `chore/repo/evaluate-critic` removed, in a commit of its own.

## Test cases

None: the change is to docs only. `pnpm verify` runs the shell checks; no package changes.

## Out of scope

- The critic's agent definition and the triggers' wording in the root `CLAUDE.md`.

## Plan

1. This spec (committed by the main agent).
2. ADR 0009, ADR 0007's status, the ADR index (committed by the main agent, before checkpoint 1).
3. The `spec` skill's two sentences, and the deletion of `docs/critic-runs.md`.
4. The *To evaluate* item on the M trigger.
5. The removal of `chore/repo/evaluate-critic` from the backlog.
6. `pnpm verify`, then checkpoint 2.
