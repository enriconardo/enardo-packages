# 0009. The critic keeps its triggers, and its runs are no longer logged

- Status: accepted
- Date: 2026-10-22
- Spec: `git show c337d77:docs/specs/2026-10-22-evaluate-critic.md` (removed from the tree)

## Context

ADR 0007 (point 5) logged each run of the `critic` in `docs/critic-runs.md`, with its trigger, and planned one count once five L specs were logged: a trigger goes if none of its runs changed a decision, and one without runs is left to the user.

The count, over the ten rows up to 2026-10-21:

| Trigger | Runs | Runs that changed a decision | Decision | Text only |
| --- | --- | --- | --- | --- |
| L spec | 5 | 5 | 16 | 12 |
| re-run | 4 | 4 | 14 | 7 |
| asked | 1 | 1 | 1 | 0 |
| M spec, from a discussion with the user | 0 | – | – | – |

Every run changed one to six decisions, and every verdict was `challenge`. ADR 0007 estimates about 1M input tokens a run, about 10M for the ten; not measured.

The M trigger's zero is no evidence either way: the only M spec since the critic, `fix/email-nodemailer/redact-transport-errors`, had a decision taken with the user at intake, so it qualified under the trigger's wording, and had no run. The main agent decides which M specs qualify.

The user reads the outcome of every run, each rejected objection by the critic's own headline (ADR 0007, point 4).

## Decision

1. Every trigger of ADR 0007's point 2 stays: `L spec`, `re-run` and `asked` by ADR 0007's rule, each having changed a decision in every run; the M trigger by the user.
2. The runs are no longer logged, and no further count is planned (the user). `docs/critic-runs.md` is deleted; this ADR keeps its count.
3. Dropping the critic, or one of its triggers, is the user's call, on the outcomes of its runs.

This supersedes ADR 0007's point 5.

## Consequences

- A run costs no log row, and a task no commit to log it.
- A critic whose runs turn to noise shows only in the outcomes the user reads, with no figure to point to.
- A later decision on the critic counts its runs from git history: the deleted log, up to this ADR, then the commit subjects that weigh a run ("weigh the critic's run on …"), which no rule requires. That count will be incomplete: the subjects are not uniform (some read "apply the critic's … report"), and a run where nothing was accepted leaves no commit. ADR 0008 drew evidence from a row of the log.

## Alternatives considered

- **A second count under the same rule**: it would remove a trigger only if none of its new runs changed a decision, after every run so far changed one to six; it would keep everything, at the cost of another L task.
- **A second count under a rule that can fail** (a share of runs, decisions against cost): a new rule to calibrate, for a measure the run outcomes already show the user.
- **Logging with no count**: a rule with no reader.
- **Removing the M trigger**: it would leave unguarded the case ADR 0007 is about, on no evidence. Its wording is a backlog item instead.
