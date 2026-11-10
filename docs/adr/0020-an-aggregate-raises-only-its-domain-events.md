# 0020. An aggregate raises only the domain events its class declares; what changed in the store is reported by the unit of work

- Status: accepted; point 3 superseded by 0021
- Date: 2026-11-10
- Spec: `git show 3dedb3e:docs/specs/2026-11-10-lean-aggregate-core.md` (removed from the tree)

## Context

`AggregateRoot` of `@enardo/entities` 2.0.0 queues `<model>.created` on `create`, `<model>.deleted` on `markForRemoval`, and offers a mergeable `<model>.updated` that the public `addEvent` merges per key. For these it needs a `modelName`, `createdAt`/`updatedAt`, a removal lifecycle of its own and the `Event` and `MergeableEvent` types of `@enardo/events`.

These are change notifications: they say a record was created, changed or removed. They are not facts of the domain. The aggregate builds them before the store has confirmed anything. Removal is held twice, by `markForRemoval` and by the repository's `remove`, which the change tracker of `@enardo/uow-repository` records. The change tracker also knows at commit which entities are new, changed and removed, and which fields change (ADR 0019). Merging is the only use of `MergeableEvent`. A fact of the domain is never merged.

## Decision

1. **The base class of an aggregate raises no event of its own.** It queues the events its subclass raises, with a protected `raise`, and hands them over with `pullEvents`. It has no generic lifecycle event, no merge, no `modelName`, no timestamps and no removal lifecycle. A domain whose aggregates have a real end names it (`archive()`, `close()`) and raises its own event.
2. **The type of the events is the app's.** `AggregateRoot` takes it as a type parameter, typically a union of the aggregate's events, with no constraint. `@enardo/entities` depends on no event package. An app that publishes the events makes its type extend the `Event` of its event package.
3. **What changed in the store is reported by the unit of work**, at commit, from the change tracker (`feature/uow-repository/commit-change-set`). The app, or an outbox, turns it into notifications.

## Consequences

- `@enardo/entities` 3.0.0 drops the lifecycle events, `markForRemoval`, the timestamps and its dependency on `@enardo/events`. The `ENTITY_*` row of ADR 0018 has no subject from then on.
- An app that read `<model>.created`, `updated` or `deleted` reads the commit's change set once it exists. None did at the time of this decision: no package of this monorepo depends on `@enardo/entities`. `cambusa` at `9cc4f5f` calls neither `pullEvents` nor `addEvent`, and reads no lifecycle event name (`git grep`, 2026-11-10). It does read `createdAt` and `updatedAt`, and these go with the base's timestamps.
- `MergeableEvent` has no use left, and can leave `@enardo/events` (`feature/events/drop-mergeable-event`).
- Each aggregate declares its events. Nothing is raised for it.

## Alternatives considered

- **Keep the lifecycle events, opt-in.** They would still be notifications built before the store confirms them, duplicating what the change tracker knows, and they would keep `modelName` and `@enardo/events` in the base.
- **Constrain the event type to `Event` of `@enardo/events`.** That keeps a dependency for a constraint an aggregate whose events never leave the process does not need.
- **Notifications built by the repository from the aggregate's events.** The repository would have to know which events mean a change of state, which is the domain's business.
