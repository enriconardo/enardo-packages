---
status: done
type: fix
tier: M
implementer: sonnet/medium
packages: ["@enardo/logger"]
branch: fix/logger/reserved-entry-fields
---

# The console logger keeps the entry's time, and the pretty format drops no metadata

## Why

From the first *Queued* item of `docs/backlog.md`, found by the architectural review of `@enardo/logger` (2026-10-22). The console formats treat three metadata fields in their own way, and the `LogMetadata` JSDoc names only `level` and `message` as reserved:

- **`timestamp`.** A `timestamp` in the metadata, from the call, a child or the defaults, takes the place of the entry's time in both formats. With `timestamp: false`, the pretty format prints it as the entry's time. Root cause: the adapter copies every metadata field into the entry, and logform's `timestamp()` sets the time only when `info.timestamp` is falsy. The likely trigger is not a caller who means it, but a spread of a domain object or a payload that has a `timestamp` field (`logger.info("webhook", { ...event })`): the entry's time is replaced silently, and a collector puts the line in the wrong place. With `timestamp: false` nothing is replaced, but the field still reads as the line's time to whoever parses it (a collector, a reader of the pretty line), so the same rule holds there. In the pretty format, a `timestamp` that is truthy and not a string loses both the time and the field (`{ timestamp: 123 }` → `info: msg`, from the `critic`'s run).
- **`context` and `stack`.** The pretty format takes both out of the metadata before printing the rest, and prints them only when they are strings (`context` only when not empty). Any other value is lost; the JSON format keeps it. An empty `context` is what `child({ context: "" })` sets, a typed call that means no context, and prints nothing (probed by the `critic`).

No test checks the console logger's `level`, `timestamp` and `format` options: an implementation that ignores `level` passes the suite.

## Probes

All through `dist/`, after `./dev.sh exec pnpm exec turbo run build --filter=@enardo/logger... --force`, with `node --input-type=module` in `packages/logger`:

- `{ format: "json" }`, metadata `{ timestamp: "FAKE" }` → `{"level":"info","message":"msg","timestamp":"FAKE"}`.
- `{ format: "pretty" }`, the same metadata → `FAKE info: msg`; with `timestamp: false` too → `FAKE info: msg`.
- `{ format: "json", timestamp: false }`, the same metadata → `"timestamp":"FAKE"` in the entry.
- `{ format: "json", defaultMetadata: { timestamp: "DEF" } }` → `"timestamp":"DEF"`.
- `{ format: "json" }`, metadata `{ timestamp: 0 }` → an ISO time: logform replaces a falsy value only.
- `{ format: "pretty" }`, metadata `{ context: { a: 1 }, stack: ["x"] }` → `<time> info: msg`, neither field printed; `{ format: "json" }` → both in the entry.
- `child({ context: "child" })`, then metadata `{ context: "meta" }` → `"context":"meta"`: the call's metadata wins over the child's.
- `{ format: "json", level: "warn" }`: `info("hidden")` writes nothing, `warn("shown")` writes its line.
- logform 2.7.0 `dist/timestamp.js` → `if (!info.timestamp) info.timestamp = new Date().toISOString();`.
- Capturing the console logger's lines in a test: replacing `winston.transports.Console.prototype.log` with a function that records `info[Symbol.for("message")]` and calls its callback captures each formatted line (probed through `dist/`, winston 3.19.0, the one version in the lockfile).
- `git grep` of `timestamp`, `context:` and `stack:` in `../cambusa`'s non-test sources → no log call passes any of them in its metadata (the hits are schema descriptions).
- Where the adapter builds the entry → `packages/logger/src/winston/winston.adapter.ts:60`; the pretty format's `printf` → `packages/logger/src/winston/winston-console.factory.ts:44`.

## Decisions

Taken with the user at intake:

- **`timestamp` is reserved, like `level` and `message`.** The entry's time comes from the logger alone. A metadata `timestamp`, from the call, a child or the defaults, is dropped silently, with `timestamp: true` and with `timestamp: false`. Not taken:
  - refusing the key in the type of `LogMetadata` (`{ timestamp?: never }`): it warns only typed callers, a payload typed `unknown` or parsed from JSON still reaches the logger, so the runtime drop is needed anyway; and it is a new major for a case no consumer has;
  - keeping the value under another key: an exception that `level` and `message` do not have, for no observed need;
  - documenting the current behavior: the time of an entry stays untrustworthy.
- **`context` and `stack` stay ordinary metadata fields.** The pretty format prints a non-empty string `context` as its prefix and a string `stack` on the lines after the entry, as today; an empty `context` prints nothing, as today, since `child({ context: "" })` means no context; any other value of either goes in its metadata suffix, as the JSON format keeps it. Not taken: reserving `context` for `child()`, since it is data the caller may set.
- **A patch release**, chosen by the user: no consumer passes a metadata `timestamp` (*Probes*). Not taken: a new major, which the drop with `timestamp: false` would call for, since the 1.0.0 JSDoc of `LogMetadata` names only `level` and `message` as dropped; dropping the field only when the logger stamps the entry, which makes the rule depend on an option.

## Open questions

None.

## Changes

`packages/logger`:

- `src/winston/winston.adapter.ts`: the entry carries no `timestamp` from the bound metadata or the call's.
- `src/winston/winston-console.factory.ts`: the pretty format takes `context` and `stack` out of the metadata only when it prints them in their own place.
- `src/logger.ts`: the `LogMetadata` JSDoc names `level`, `message` and `timestamp` as reserved, and says that the entry's time comes from the logger.
- `CLAUDE.md`, *Invariants*: the entry the adapter builds carries no metadata `timestamp`.
- `__tests__/`: the cases below.

`docs/backlog.md`: the item leaves.

## Test cases

Adapter cases use `captureLines()` of `__tests__/winston/winston.adapter.test.ts` (JSON format, `timestamp: false`). Console logger cases go through `createConsoleLogger` with the `Console.prototype.log` capture of *Probes*, and strip the ANSI codes of a pretty line.

Reserved `timestamp`:

1. `info("msg", { timestamp: "FAKE", other: 1 })` → the entry is exactly `{ level: "info", message: "msg", other: 1 }`.
2. A child with metadata `{ timestamp: "FAKE" }`, then `info("msg")` → no `timestamp` in the entry.
3. An adapter with bound metadata `{ timestamp: "FAKE" }`, then `info("msg")` → no `timestamp` in the entry.
4. Console logger, `{ format: "json" }`, metadata `{ timestamp: "2000-01-01T00:00:00.000Z" }` → the entry's `timestamp` is an ISO string between the times read before and after the call.
5. Console logger, `{ format: "pretty" }`, the same metadata → the line starts with an ISO time between those times, and does not contain `2000-01-01`.
6. Console logger, `{ format: "pretty", timestamp: false }`, the same metadata → the line is exactly `info: msg`.

Pretty `context` and `stack`, with `timestamp: false`:

7. Metadata `{ context: { a: 1 } }` → exactly `info: msg {"context":{"a":1}}`.
8. Metadata `{ stack: ["x"] }` → exactly `info: msg {"stack":["x"]}`.
9. `child({ context: "" })`, then `info("msg")` → exactly `info: msg`; metadata `{ context: "" }` → the same line.
10. Metadata `{ context: "api", stack: "trace" }` → exactly `info: [api] msg\ntrace`.

Options of the console logger:

11. `{ level: "warn", format: "json" }`: `info("a")`, then `warn("b")` → one line, with message `b`.
12. No `level`, `{ format: "json" }`: `debug("a")`, then `info("b")` → one line, with message `b`.
13. `{ format: "json" }` with no `timestamp` → the entry has a `timestamp` that is an ISO string; with `timestamp: false` → none.
14. No `format`, `{ timestamp: false }` → the line, stripped, is exactly `info: msg`, and `JSON.parse` of it throws.
15. `{ format: "json", timestamp: false }` → the line parses to exactly `{ level: "info", message: "msg" }`.

## Risks

Low: only log output changes. A collector query on a metadata `timestamp` loses its field, and none of Cambusa's log calls passes one (*Probes*). A line of the pretty format grows when `context` or `stack` is not a string, which is the point.

## Out of scope

- Colors when stdout is not a terminal, `createLogger` with a `LoggerTransportType`, the README: the next items of the backlog.
- Refusing reserved keys in the type of `LogMetadata` (*Decisions*).

## Plan

1. Cases 11 to 15, which pass on `main`: they pin the options before the change. Commit.
2. Test-first: cases 1 to 6, failing because the metadata's value is kept; then the adapter, the `LogMetadata` JSDoc and the package `CLAUDE.md`. Commit.
3. Test-first: cases 7 and 8, failing because the field is missing from the line (cases 9 and 10 pass on `main` and guard the strings); then the pretty format. Commit.
4. The backlog item leaves, in a commit of its own.
