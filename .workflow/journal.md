# Task journal

branch: feature/events/drop-mergeable-event
tier: L
phase: l/chunk-2/implement
base: f88e993
started: 2026-11-11T14:08:14Z
review_rounds: 0
verify_red_streak: 0
escalations: 0

spec: .workflow/specs/2026-11-11-drop-mergeable-event.md

spec_review_rounds: 1

step_review_rounds: 1

## Intent

### Intent: drop MergeableEvent from @enardo/events

Problem: `MergeableEvent` and `isMergeableEvent` (packages/events/src/mergeable-event.ts) have no use left. The only one, the merge of the `updated` events of `@enardo/entities`, left with `feature/entities/lean-aggregate-core` (entities 3.0.0, which no longer depends on `@enardo/events`). Domain events are facts and are never merged.

Goal: remove both symbols, their re-exports in src/index.ts and their test file (__tests__/mergeable-domain-event.test.ts, deleted on purpose: the spec says so). `Event`, `EventBus`, `EventHandler`, `EventContext` and `SyncEventBus` stay unchanged, as the contract of dispatch. `@enardo/events` goes from 1.1.0 to 2.0.0 (a breaking change is a new major). The branch removes its own backlog item in a commit of its own.

Decisions of the human:
- Tier L, as the backlog item says.
- No publish now ("non è necessario pubblicare per ora").
- ADR 0020: left to me ("vedi tu"). Decision: leave it unchanged; it already records that the symbols can leave `@enardo/events` on this branch, and ADRs are records, not current truth.

Out of scope: the "Three doubts on the dispatch of @enardo/events" backlog item.

## Open findings

## Lesson candidates

## Backlog candidates

## Log

- 2026-11-11T14:08:14Z opened on f88e993 of main
- 2026-11-11T14:08:22Z map: /tmp/claude-1000/-workspaces-enardo-packages/4b4a5a95-6c43-42cf-9bd0-0884af7c9173/scratchpad/map.md
- 2026-11-11T14:08:22Z human: tier L (backlog); no publish now; ADR 0020 left to the agent, kept unchanged
- 2026-11-11T14:09:58Z spec review 1: holds; 2 minor (grep claim scope, backlog item removal) fixed; lockfile gap settled in What
- 2026-11-11T14:11:30Z human approved the spec: "si"
