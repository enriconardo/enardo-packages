---
status: draft
type: chore
tier: L
implementer: sonnet/medium
packages: []
branch: chore/repo/evaluate-critic
---

# The critic keeps its triggers, and its runs are counted again

## Why

The queued backlog item `chore/repo/evaluate-critic`, due once `docs/critic-runs.md` logs five L specs (ADR 0007, point 5): count the `critic`'s runs by trigger, remove each trigger none of whose runs changed a decision, and leave a trigger with no run to the user. The log now has five L specs.

ADR 0007 provides for one count. Once it is done, the log's header points to a backlog item that has left, and nothing reads the rows the log keeps getting.

## Probes

- The rows of `docs/critic-runs.md` on `main` (cab2021), by trigger:

  | Trigger | Runs | Runs that changed a decision | Decision | Text only |
  | --- | --- | --- | --- | --- |
  | L spec | 5 | 5 | 16 | 12 |
  | re-run | 4 | 4 | 14 | 7 |
  | asked | 1 | 1 | 1 | 0 |
  | M spec, from a discussion with the user | 0 | – | – | – |

  Text only, all runs: 19.
- The specs since the critic (2026-10-16 on), by `tier`: one M, `2026-10-21-nodemailer-redact-transport-errors.md`. Its *Why* comes from a bug in the code, but a decision of it was "taken with the user at intake", so it qualifies under the trigger's wording and had no run. The zero shows how the main agent reads the clause, not that no M spec came from a discussion.
- Cost: ADR 0007 estimates about 1M input tokens a run, so about 10M for the ten runs; not measured.
- Where the log is named: `git grep -n critic-runs` → the root `CLAUDE.md` does not name it; the `spec` skill (*The critic*, "Log the run") and ADR 0007 (point 5) do, and the log's header names the backlog item.
- ADRs are never edited after acceptance, except for their status (`docs/adr/README.md`): changing point 5 of ADR 0007 takes a new ADR.

## Decisions

- **Every trigger stays**, by ADR 0007's rule: each of `L spec`, `re-run` and `asked` changed a decision in every run.
- **The M trigger stays** (the user, 2026-10-22). Its zero runs is no evidence either way (*Probes*), and removing it would leave unguarded the case ADR 0007 is about.
- **The runs are still logged, and counted again** (the user, 2026-10-22, among: stop logging; log and count again; log with no count). Not taken: stopping the log, which would end the measure after one sample; logging with no count, a rule with no reader.
- **The second count reads only the rows after the first count**, the last of which is the 2026-10-21 run on `fix/email-nodemailer/non-string-content`. The whole log would keep every trigger whatever the new runs show, since each has already changed a decision.
- **It is due at five more L specs**, as the first, under the same rule. Its item also asks the user whether the log goes on, so that counting does not become a standing rule by default.

- **This branch's critic runs are not logged**, as the spec of `chore/repo/spec-critic` left out the runs that judged the critic itself: a run on its own evaluation is not a sample of its use.

## Open questions

- Is the count after the second one decided then, as above, or now (for example: stop logging after the second count unless a trigger was removed)?

## Changes

- `docs/adr/0009-critic-runs-counted-again.md` (new): context, the first count and its table; decision, the points above; it supersedes ADR 0007's point 5. ADR 0007's status: `accepted; point 5 superseded by 0009`. `docs/adr/README.md`: the index row of 0009, and 0007's status.
- `docs/critic-runs.md`: the header names ADR 0009 and the new item in place of `chore/repo/evaluate-critic`, and says where the first count ended. The rows do not change.
- `docs/backlog.md`: a queued item `chore/repo/recount-critic`, with *When* (five L specs logged after the first count), *What* (the rule of ADR 0007's point 5 on those rows, the text-only count, and the user's choice on the log), *Why* and *From*; the item `chore/repo/evaluate-critic` removed, in a commit of its own.

## Test cases

None: the change is to docs only. `pnpm verify` runs the context-size check and the shell checks; no package changes.

## Out of scope

- The critic's agent definition, the `spec` skill's steps, and the triggers' wording in the root `CLAUDE.md`: none changes.

## Plan

1. This spec (committed by the main agent).
2. ADR 0009, ADR 0007's status, the ADR index.
3. The log's header and the new backlog item.
4. The removal of `chore/repo/evaluate-critic` from the backlog.
5. `pnpm verify`, then checkpoint 2.
