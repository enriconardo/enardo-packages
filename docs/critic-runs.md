# Critic runs

The runs of the `critic` (`.claude/agents/critic.md`), one row each, added by the main agent once it has weighed the report and the user has answered the objections brought to them (`spec` skill, *The critic*). The queued backlog item `chore/repo/evaluate-critic` counts them.

- **Trigger:** `L spec`; `M spec`, from a discussion with the user; `re-run`, after the user changed a decision it judged; `asked`, by the user, a learn proposal included.
- **Branch:** the task's; for a run outside a task, the S task that logs it.
- **Raised:** the challenges and gaps of the report.
- **Decision:** those that changed a decision of the spec or proposal, whoever took the change.
- **Text only:** those that changed its text, or an ADR's, and no decision.

| Date | Branch | Trigger | Verdict | Raised | Decision | Text only |
| ---- | ------ | ------- | ------- | ------ | -------- | --------- |
| 2026-10-19 | `chore/repo/dev-sh-refuses-clones` | L spec | challenge | 5 | 2 | 3 |
| 2026-10-19 | `chore/repo/dev-sh-refuses-clones` | asked | challenge | 5 | 1 | 0 |
| 2026-10-20 | `refactor/repo/split-contracts-from-adapters` | L spec | challenge | 4 | 3 | 1 |
| 2026-10-20 | `feature/email/send-errors` | L spec | challenge | 5 | 4 | 1 |
| 2026-10-20 | `feature/email/send-errors` | re-run | challenge | 4 | 3 | 1 |
| 2026-10-21 | `chore/repo/orchestrated-workflow` | L spec | challenge | 12 | 6 | 5 |
| 2026-10-21 | `chore/repo/orchestrated-workflow` | re-run | challenge | 8 | 5 | 2 |
| 2026-10-21 | `chore/repo/orchestrated-workflow` | re-run | challenge | 8 | 3 | 3 |
