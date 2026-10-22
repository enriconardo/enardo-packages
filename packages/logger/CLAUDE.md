# @enardo/logger

A structured `Logger` interface, a console logger over winston, and a noop logger. This file holds the rules for changing the package.

## Layout

```
src/logger.ts                          Logger and the option types
src/create-logger.ts                   createLogger, by transport type
src/winston/winston.adapter.ts         WinstonLoggerAdapter (internal)
src/winston/winston-console.factory.ts the console logger and its formats (internal)
src/serialize/to-loggable.ts           toLoggable (internal)
src/noop/noop.logger.ts                the noop logger, one shared instance
__tests__/                             mirrors src/
```

## Invariants

- **Opaque.** Winston is an implementation detail: the app picks a transport, never an engine, so the package is not split into a contract and an adapter (root `CLAUDE.md`, *Architecture conventions*), and winston stays a dependency. No winston type reaches `dist/index.d.mts`.
- **No metadata makes a log call throw**: not the call's, not a child's, not the defaults.
- **The adapter builds each entry**, `{ ...bound, ...metadata, level, message }`, and passes it to `logger.log()` as one object. Never winston's `log(level, message, metadata)`, `defaultMeta` or `child()`: the first scans the message for printf tokens and appends a metadata `message`, the others change the precedence.
- **Precedence**: the call's `level` and `message`, then the call's metadata, then the child's (an inner child over an outer one), then the defaults.
- **Bound metadata** (the defaults, a child's) is converted once, when the logger is created: a later mutation does not reach the logs.
- **`toLoggable`** calls a value's `toJSON()` before treating it as an `Error`, so a `BaseError` keeps control of what it logs; reads one field at a time, so a field that throws costs only itself; and writes fields with `defineProperty`, so a `__proto__` key stays a field.

## Tests

- Adapter tests write through `createConsoleFormat({ format: "json", timestamp: false })` to a winston `Stream` transport over a `Writable`, which receives each line synchronously.
- A metadata case is tested on the call's metadata, a child's and the defaults: each is converted on its own path.

## Public API changes

- JSDoc on every export, and the README updated in the same commit.
- `cqrs`, `database-mongo`, `email-nodemailer` and `http-client` keep a local copy of the part of `Logger` they use (`src/logger.ts`), so they depend on no logger, and an app passes them this package's `Logger`. Nothing here compiles one against the other: a change to `Logger`'s shape is checked against each copy by hand.
