# Task journal

branch: docs/repo/entities-events-backlog
tier: S
phase: s/implement
base: b48b750
started: 2026-11-10T09:50:22Z
review_rounds: 1
verify_red_streak: 0
escalations: 0

## Intent

Problem: an analysis of `@enardo/entities` (asked as "is it still sensible, architecturally valid, does it meet best practice", independently of its consumers and of its bugs) found the core sound and three design choices questionable; the user asked whether `@enardo/events` changes too.

Findings the user accepted ("mi hai convinto su tutto"):
- Sound: identity equality of `Entity`; the aggregate collecting its own events and handing them over with `pullEvents`; the state as an immutable snapshot; protected `setAttribute`.
- Questionable: one `EntityId` class for every aggregate (no type distinction between ids); the attribute bag in the persisted shape; timestamps and soft delete in the base class; runtime deep freeze that leaves Map, Set and Date mutable.
- Events: the generic `<model>.created/updated/deleted` with `changedKeys` are change notifications (CDC), not domain events, and merging them only makes sense for notifications. The change tracker of `uow-repository` already knows what is new, changed and removed: the notifications belong to the infrastructure, the domain keeps the events with a meaning.
- Consequences on `@enardo/events`: `MergeableEvent` and `isMergeableEvent` lose their only use; `entities` can drop the dependency by taking the event type as a generic; `uow-repository` exposes a change set at commit, and the app or an outbox turns it into events. Three doubts on `events` itself: `subscribe` does not tie the name to the type, `EventContext.session` carries the transaction into handlers, `SyncEventBus` is async and stops at the first failing handler.

Goal: record the work as backlog items. The user approved every proposed item, so they go to *Queued*.

Decisions: no ADR ("non sono sicuro sia necessario un ADR per questo genere di decisioni"); the items carry the direction, and each branch's spec will.

Constraints: docs only, `docs/backlog.md`.

## Open findings

## Lesson candidates

## Backlog candidates

## Log

- 2026-11-10T09:50:22Z opened on b48b750 of chore/repo/overload-trial
- 2026-11-10T09:50:25Z tier S confirmed; no ADR (user); all four backlog items approved, to Queued
- 2026-11-10T09:53:15Z review round 1 on 86fb043: 1 blocking (attribute bag not recorded)
