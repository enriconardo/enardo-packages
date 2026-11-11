# 0023. The event bus carries no transaction and runs every handler

- Status: accepted
- Date: 2026-11-11
- Spec: `.workflow/specs/2026-11-11-typed-dispatch.md`

## Context

`@enardo/events` 2.0.0, before this decision, offered an `EventContext` with a `session` documented as the way to run handlers "in the same database transaction", and a `SyncEventBus` that stopped at the first handler that threw, without saying which handlers did not run.

ADR 0021 decided that the unit of work hands the domain events to an app hook inside the transaction, to write an outbox, and that a relay of the app publishes them after the commit, at least once, to idempotent handlers. It rejected dispatching to a bus inside the transaction: side effects before the commit, handlers re-run by a retried transaction, a use case rolled back by a secondary handler. The bus's own context and docs suggested exactly that dispatch.

## Decision

1. **The bus carries no transaction of its own.** Its context is a type parameter the app fills (a correlation id, a tenant), passed through to the handlers unread. The package's docs describe the after-commit model: a handler opens its own transaction when it needs one and is idempotent. An app that puts its transaction in the context and dispatches inside the unit of work's hook does it knowingly, as ADR 0021 says.
2. **A failing handler does not deny the event to the others.** Every handler of every event runs, in order; the failures are reported together, after the last handler, in one `BaseError` with a `code`, so a relay recognizes it and retries the event.
3. **The bus is typed by the union of the events it carries**: a handler subscribes only under its event's name.

## Consequences

- A relay that retries an event after a partial failure re-runs the handlers that succeeded: they must be idempotent, which at-least-once delivery requires anyway.
- A handler cannot rely on an earlier handler's failure to stop it.
- An app with untyped events keeps the default `Event` and the loose checks.
- `@enardo/events` depends on `@enardo/errors`.

## Alternatives considered

- **Keep `session`, correct the docs.** The type would still invite the dispatch ADR 0021 rejected, and stay an untyped bag where the app knows its type.
- **Stop at the first failure, documented.** One secondary handler's failure would keep the event from every handler after it, and a retry re-runs the successful ones anyway.
- **Rethrow a native `AggregateError`.** It has no `code`, so the relay could not recognize it by the ecosystem's rule.
- **Dispatch in parallel.** It changes the order handlers may rely on, for a throughput no consumer has asked for.
