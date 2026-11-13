# 0024. An event carries an id its creator generates, and a `Date` that a JSON transport rebuilds

- Status: accepted
- Date: 2026-11-13
- Spec: .workflow/specs/2026-11-13-event-envelope.md

## Context

`@enardo/events` delivers at least once: the app's relay publishes the events of an outbox after the commit, and retries an event whose handlers failed (ADR 0021, ADR 0023). Its handlers must therefore be idempotent, but the envelope, `{ eventName, occurredAt, payload }`, identified no occurrence: a handler of every event could not deduplicate, and each app would put an id of its own in the payloads.

The relay is the app's code, and so is the outbox's storage. A Mongo outbox keeps `occurredAt` as a date; a JSON column or a message broker gives back a string.

## Decision

1. `Event` has a required `eventId: string`, the key a handler deduplicates by.
2. The id is fixed once, no later than when the event is stored durably (by the aggregate that raises it, by the unit of work's hook that writes the outbox, or as the outbox row's own key, which the relay reads back), and every delivery of that occurrence carries the same id; it is never generated per publish. The package generates no id and checks none; the format (a UUID, the outbox's key) is the app's.
3. `occurredAt` stays a `Date`. A transport that serializes events to JSON rebuilds it before `publish`, in the relay that already maps what it stored back to an `Event`.

## Consequences

- Every event carries an id, in an app that publishes in process with no outbox too. A relay never generates one per publish, or a retry would defeat the deduplication.
- A handler that must not repeat an effect records the `eventId`s it has handled, in the store its effect goes to.
- A relay over JSON maps `occurredAt` back to a `Date`; the type does not tell it, the package's README does.

## Alternatives considered

- **An optional `eventId`.** A handler of every event still could not rely on it.
- **A `createEvent` helper generating the id and the date.** A new public function that generates ids, and a choice of id format the app may want to make itself.
- **The id in the payload, as each app likes.** A generic handler cannot find it.
- **`occurredAt` as an ISO string.** It survives every transport, but every handler parses it to compare or format a date, while a Mongo outbox keeps the `Date` anyway.
