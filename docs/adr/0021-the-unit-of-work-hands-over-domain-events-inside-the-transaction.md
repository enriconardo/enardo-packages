# 0021. The unit of work hands the aggregates' domain events to the app inside the transaction; it reports no change set

- Status: accepted
- Date: 2026-11-10
- Spec: docs/specs/2026-11-10-collect-domain-events.md

## Context

ADR 0020 point 3 decided that what changed in the store is reported by the unit of work at commit, from the change tracker, for the app or an outbox to turn into notifications: the replacement of the `<model>.created/updated/deleted` events `@enardo/entities` 3.0.0 removed.

The packages serve a DDD architecture. There a created/updated/deleted notification carries no intent, and the aggregate decides its events: `AggregateRoot` already queues them. Change notifications, where projections, a search index or a cache need them, come from the domain events or from the store's change data capture (Mongo change streams). No consumer asked for a change set, and a record-level one carries the storage schema across the aggregate's boundary.

What the persistence lacks is the other side of the domain events: nothing collects them at commit, so an app cannot write them atomically with the aggregate (a transactional outbox).

## Decision

1. **The unit of work reports no change set.** ADR 0020 point 3 is superseded.
2. **It collects the domain events of the aggregates its repositories track**, through a function the app gives each repository (`pullEvents`), so the package depends on no entity or event package. It collects them before the transaction, with the writes, so a retried transaction hands over the same events.
3. **It hands them to a hook of the app inside the transaction, after the writes, with the transaction context**: there the app writes them to an outbox. The package publishes to no bus.
4. **A domain event is never dropped silently**: events collected with no hook throw before the transaction.

## Consequences

- An app gets an atomic outbox by writing the events in the hook; a relay of its own publishes them after the commit, at least once, to idempotent handlers.
- An app that dispatches the events synchronously in the hook does it knowingly: its handlers run before the commit, again on a retried transaction, and roll the use case back when they fail.
- An app that needs CRUD notifications takes them from the domain events or from the store's change streams.
- `@enardo/uow-repository` 0.3.0 changes the constructor of `TrackingRepository` (an options object) and adds an optional member to `UnitOfWorkParticipant`.

## Alternatives considered

- **The record-level change set of ADR 0020 point 3.** No intent, no consumer, the storage schema exposed, and a duplicate of the change streams.
- **A notification per aggregate, `{ name, id, change, version }`.** The same objections but the schema, and a `name` the package has no place for.
- **The events handed over after the commit.** The outbox would not be atomic: a crash between the commit and the hook loses them.
- **Dispatching to an event bus inside the transaction.** Side effects before the commit, handlers re-run by a retried transaction, several aggregates in one transaction, and a use case rolled back by a secondary handler.
- **Doing nothing.** Every handler pulls the events by hand, outside the transaction.
