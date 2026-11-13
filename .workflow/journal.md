# Task journal

branch: test/events/strict-failure-without-event-id
tier: S
phase: s/implement
base: e300a56
started: 2026-11-13T11:43:58Z
review_rounds: 0
verify_red_streak: 0
escalations: 0

## Intent

Backlog item: "toStrictEqual for a failure without eventId in @enardo/events' tests."

Problem: the test of an event that reaches SequentialEventBus without an eventId
asserts EventHandlersFailedError's details with toEqual, which takes a missing key
for undefined: a constructor that drops the eventId key would pass.

Goal: assert with toStrictEqual, so the test pins that the failure carries the
eventId key (with value undefined). Test-only; no change to src or to behavior.
Check it by mutation: dropping the key from the constructor turns the test red.
The backlog item is removed in a commit of its own.

Human: confirmed tier S.

## Open findings

## Lesson candidates

## Backlog candidates

## Log

- 2026-11-13T11:43:58Z opened on e300a56 of main
- 2026-11-13T11:44:09Z mutation (eventId key dropped from EventHandlersFailedError's failures) turns the test red with AssertionError: missing key; source restored
