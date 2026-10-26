# 0014. A package logs only what its caller cannot see

- Status: proposed
- Date: 2026-10-26
- Spec: docs/specs/2026-10-26-what-a-package-logs.md

## Context

Four packages take an optional `Logger`, a no-op by default, through a local structural copy of `@enardo/logger`'s interface: `@enardo/cqrs`, `@enardo/database-mongo`, `@enardo/email-nodemailer`, `@enardo/http-client`. What they log, and at what level, had no rule:

- `cqrs` logs at `debug` the start, the success and the expected failure of `execute()`, all of which the caller gets.
- `http-client` logs one entry per outcome: `debug` for a response or an abort, `warn` for a `NetworkError`, an `HttpResponseError` or a `TimeoutError`, each of which it then throws.
- `email-nodemailer` logs at `info` the success the caller awaits, and at `warn` each failure it then rejects with.
- `database-mongo` logs at `error` a failed `connect()` that it rethrows. Its `debug` logs, behind a `debug` flag of its own, include the changes it makes on its own: a collection created, a validator updated, an index dropped.

A failure that is both logged and thrown is logged twice once the caller logs it, and the package picked a level it cannot know: a 404 the caller handles, a send it retries. ADR 0012 point 7 already leaves to the app whether an error is expected, and at what severity. Every log point is also a place where personal data or secrets can leak: `http-client` logs the path of a URL as it is.

## Decision

1. **A package logs only what its caller cannot see** in the outcome of its call: a retry, a fallback, a reconnection, a change it makes on its own (an index dropped), an error it swallows (in a background task, a cleanup).
2. **Never what the caller gets.** No log of an error the package throws or rejects with, of a failure it returns as a value, or of a success the caller awaits.
3. **At `debug` or `warn` only.** `warn` for what the app may have to act on, `debug` for the rest. `info` and `error` are the app's.
4. **Through an optional `Logger`**, a no-op by default, as a local structural copy that holds the levels the package uses.
5. **A package with nothing to log takes no `logger`**: no option, no copy of `Logger`, no exported type. It takes one again, as a minor, with its first log point.

## Consequences

- `cqrs`, `email-nodemailer` and `http-client` have nothing left to log, and lose their `logger`, each in a new major. `cqrs`' base classes lose their `options` with it: without the logger they would hold a bag that only the subclass reads, so a handler takes its dependencies in its own constructor. `database-mongo` is judged against the rule in a branch of its own.
- An app that relied on a package's logs logs what it gets: the rejection, the response, the result. A log of every HTTP request or every command is a wrapper of the app's, around `request()`, `fetchImpl` or `execute()`.
- What reaches the logs from a package's failures is what its errors' `toJSON()` holds: their redaction rules carry the weight that the package's own logs shared.
- An app cannot react in code to an event that a package only logs, such as counting retries. A hook for it waits for an app that needs one.

## Alternatives considered

- **Hooks the app subscribes to** (`onRetry`, `onResponse`). Typed events, in browsers too, with the level and the fields left to the app. But each hook is public API to document, test and version, and needs a rule for a hook that throws or is async: on an error path, a throw replaces the error being reported. No app reacts to an event in code today. A hook comes with the first that needs one.
- **Node's `diagnostics_channel`**, which undici publishes to and OpenTelemetry reads. Nothing to configure, and free with no subscriber. But it is Node only, and `http-client` runs in browsers too. Its channels are global to the process, so a message names its instance, and a channel's name and payload are a contract no type checks for a subscriber. No consumer uses OpenTelemetry.
- **A decorator around a component**, such as a `cqrs` handler. It sees only what the caller already sees. That makes it the app's way to log outcomes, as the consequences above say, and no mechanism of the package's.
- **A `logger` kept with nothing to log**, for a future log point. An option that does nothing, documented and tested, until then. Taking one again is a minor.
