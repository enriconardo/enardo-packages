# Task journal

branch: docs/repo/drop-events-instanceof-item
tier: S
phase: s/implement
base: 81045ed
started: 2026-11-12T08:32:53Z
review_rounds: 0
verify_red_streak: 0
escalations: 0

## Intent

Problem: backlog item "Most failure tests of @enardo/events recognize EventHandlersFailedError by its class." proposes asserting isBaseErrorLike and code in every failure test of packages/events/__tests__/sync.event-bus.test.ts.

Analysis: the fact holds, but the change does not follow the project's practice. The CLAUDE.md rule on isBaseErrorLike is for code that catches errors; in a test, which shares one copy of the package, instanceof with a specific class is reliable (ADR 0012 point 3), and the root CLAUDE.md lists the class among what a test asserts. The brand and code are already asserted once on the class and once on the bus's rejection; toBeInstanceOf is the convention across the repo's tests.

Decision (human, 2026-11-12): "si spostalo pure in dropped" - move the item to Dropped in .workflow/backlog.md. No code change.

## Open findings

## Lesson candidates

## Backlog candidates

## Log

- 2026-11-12T08:32:53Z opened on 81045ed of main
