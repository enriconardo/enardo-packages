# Lesson-critic log

One row per lesson that the `lesson-critic` judged at a learn step (root `CLAUDE.md`, *Workflow*, step 6), added on the task's branch after the user's answer at the checkpoint, whether the lesson is kept or dropped. The trial run of ADR 0015 is not logged.

The user reads it at the review that the backlog queues, once it holds 25 lessons (`docs/adr/0015-a-lesson-critic-judges-every-learn-proposal.md`, point 6). It counts the verdicts that changed a lesson, that the form alone (no evidence, or a `git grep` hit) would not have given, and that the user did not take back; the user's overrides; the cost.

- **Verdict:** `keep`, `revise` or `drop`.
- **Form alone:** whether the proposal form alone would have given the verdict (`yes`, `no`).
- **Main agent:** what it did with the verdict (`applied`, `rejected: <reason>`, `not judged` for a rewrite other than the revised text).
- **Outcome:** the user's (`applied`, `reworded`, `dropped`, `taken back`).
- **Cost:** the tokens the Agent tool reported, and the time.

| Date | Branch | Checkpoint | Lesson | Verdict | Form alone | Main agent | Outcome | Cost |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| 2026-10-29 | `fix/database/error-contract-and-lifecycle` | 1 | A value a method hands out (`spec` skill, *Probing*) | `revise` | no | applied | applied | 31 925 tokens, 49 s |
| 2026-11-02 | `refactor/database-mongo/named-export` | 2 | A glob in a `git grep` pathspec (root `CLAUDE.md`, *Code conventions*) | `revise` | no | applied | applied | 38 789 tokens, 115 s (one run, both lessons) |
| 2026-11-02 | `refactor/database-mongo/named-export` | 2 | A check paired with a fix is an open decision (`spec` skill, *Intake*) | `keep` | no | applied | dropped | same run |
| 2026-11-02 | `fix/uow-repository/native-misuse-errors` | 1 | A stub is not a probe of what it stands for (`spec` skill, *Probing*) | `revise` | no | applied | dropped | 32 180 tokens, 70 s |
| 2026-11-05 | `fix/email-nodemailer/native-misuse-errors` | 1 | A fact of the `critic`'s report is probed before it enters the spec (`spec` skill, *The critic*) | `drop` | no | applied | dropped | 33 450 tokens, 63 s |
