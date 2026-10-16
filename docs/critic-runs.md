# Critic runs

The runs of the `critic` (`.claude/agents/critic.md`), one row each, added by the main agent once it has weighed the report and the user has answered the objections brought to them (`spec` skill, *The critic*). The queued backlog item `chore/repo/evaluate-critic` counts them.

- **Trigger:** `L spec`; `M spec`, from a discussion with the user; `re-run`, after the user changed a decision it judged; `asked`, by the user, a learn proposal included.
- **Raised:** the challenges and gaps of the report.
- **Decision:** those that changed a decision of the spec or proposal, whoever took the change.
- **Text only:** those that changed its text, or an ADR's, and no decision.

| Date | Branch | Trigger | Verdict | Raised | Decision | Text only |
| ---- | ------ | ------- | ------- | ------ | -------- | --------- |
