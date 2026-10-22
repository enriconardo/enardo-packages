---
status: draft
type: fix
tier: M
implementer: sonnet/medium
packages: ["@enardo/logger"]
branch: fix/logger/create-logger-transport-union
---

# Let `createLogger` take a `LoggerTransportType`

## Why

`createLogger` has one overload per transport literal, `"console"` and `"noop"`, so a transport typed `LoggerTransportType`, as one chosen from configuration, matches neither and does not compile, although the package exports `LoggerTransportType` and `LoggerOptionsByTransport` for that use. The root cause: the implementation signature, the only one that takes the union, is not callable.

From the backlog's *Queued* item, out of the architectural review of `@enardo/logger` (2026-10-22).

## Probes

In the dev container, `tsc --noEmit` in `packages/logger`, with a probe file in `__tests__/` (removed after):

- On the branch's base (`5d09776`), with a `t: LoggerTransportType` → `createLogger(t)`, `createLogger(t, { level: "debug" })`, `createLogger(t, o)` with `o: LoggerOptions<LoggerTransportType>`, `createLogger(t, { format: "json" })`: each TS2769. `createLogger("noop", { format: "json" })` and `createLogger("console", { foo: 1 })`: TS2769. `createLogger(s)` with `s: string`: TS2769.
- The two overloads removed, the implementation signature made `createLogger<TTransport extends LoggerTransportType>(transportType: TTransport, options: LoggerOptions<TTransport> = {})` → the four union calls compile; `"noop"` with `format` gives TS2353 (`'format' does not exist in type 'LoggerBaseOptions'`), `"console"` with `foo` TS2353, `string` TS2345. `createLogger("console", { format: "json", colors: true })` compiles. The body compiles unchanged: `options` passes to both creators, whose options are all optional.
- Same change → `pnpm test`: 81 passed; `pnpm lint`: only `ConsoleLoggerOptions` and `NoopLoggerOptions` unused in `src/create-logger.ts`; `pnpm build`: `dist/index.d.mts` declares the generic signature.
- `git grep createLogger` outside `packages/logger` → only docs: no other package of this repo calls it.
- Type tests in this repo → `packages/email/__tests__/email.types.test.ts`: `assertType`, `// @ts-expect-error <reason>` above the offending line, enforced by `pnpm typecheck` (`tsconfig.json` includes `__tests__`).

## Decisions

Approved by the user at intake:

- **One generic signature** in place of the two overloads, as probed. With the union, `options` is `ConsoleLoggerOptions | NoopLoggerOptions`, so `createLogger(t, { format: "json" })` compiles: the noop logger ignores its options, so a console option passed to it does nothing. A third overload for the union, keeping the two, was the other option: three signatures for what one says.
- **The runtime does not change**: the dispatch and the `Error` for an unsupported transport stay as they are.

## Open questions

- **The version.** The change is additive, a minor. 1.1.0, bumped by `fix/logger/color-only-on-tty`, is not published yet as far as this session can tell (the registry asks for a login): if so, it ships in 1.1.0 with no bump; if 1.1.0 is published, 1.2.0. To confirm at checkpoint 1.

## Changes

`@enardo/logger`:

- `src/create-logger.ts`: the generic signature replaces the two overloads and the implementation signature; JSDoc on it: the transport, its options typed by it, a `LoggerTransportType` accepted. The unused type imports go.
- `__tests__/create-logger.types.test.ts`: new, the type cases below.
- `__tests__/create-logger.test.ts`: case 7.
- `package.json`: `version` as the open question decides.
- `docs/backlog.md`: the item leaves, in a commit of its own.

## Test cases

Type cases 1–6 in `__tests__/create-logger.types.test.ts`, enforced by `pnpm typecheck`, in the form of `email.types.test.ts`. A rejection is a `// @ts-expect-error <reason>` on the line of the offending property or argument, so that an error elsewhere in the call does not satisfy it. `transport` is declared `LoggerTransportType`, not inferred from a literal.

1. `createLogger(transport)` compiles, and its result is a `Logger` (`expectTypeOf(...).toEqualTypeOf<Logger>()`).
2. `createLogger(transport, { level: "debug", defaultMetadata: { service: "api" } })` compiles.
3. `createLogger(transport, options)` with `options: LoggerOptions<LoggerTransportType>` compiles.
4. `createLogger("noop", { format: "json" })` is rejected on `format`: a literal transport keeps its own options. Catches a signature that types `options` as `ConsoleLoggerOptions`.
5. `createLogger("console", { foo: 1 })` is rejected on `foo`.
6. `createLogger(name)` with `name: string` is rejected.

The literal console options (`format`, `colors`) are already compiled by the existing tests (`__tests__/winston/console-colors.test.ts`), which catch a signature that types `options` as `LoggerBaseOptions`.

Runtime, in `__tests__/create-logger.test.ts`, with its mocks:

7. A transport read as `LoggerTransportType` from a record (`{ transport: "console" }` declared `{ transport: LoggerTransportType }`), with `{ format: "json" }` → `createConsoleLogger` called once with those options, `createNoopLogger` not called, its logger returned.

## Out of scope

- Validating a transport read from configuration at runtime (`string` to `LoggerTransportType`): the app's job; the existing `Error` covers a JS caller.
- The README of `@enardo/logger`: the next *Queued* item.

## Plan

1. Test-first: cases 1–7, red under `pnpm typecheck`: 1–3 and 7 with TS2769; 4–5 because the base reports the error on the call (column 1 in the probe), not on the property line, so their `@ts-expect-error` is unused; 6 already rejected. Then the signature and its JSDoc. Green, committed.
2. The version, if the open question bumps it. Committed.
