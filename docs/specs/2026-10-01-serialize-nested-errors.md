---
status: done
type: fix
packages: ["@enardo/logger"]
branch: fix/logger/serialize-nested-errors
---

# Errors nested in log metadata lose their message and stack

## Report

Consumers log errors as metadata: `logger.error("Unhandled error.", { error })` in the api-server's error handler, and `{ command, error }` in the `cqrs` handlers. A plain `Error` nested in the metadata comes out as `{}`. `@enardo/errors` fixed this for `BaseError` with a `toJSON()` (`docs/specs/2026-09-24-harden-errors.md`, problem 1). Errors that are not a `BaseError` were left to this branch: native, driver and third-party errors, which are the ones an "Unhandled error." usually carries.

Probed on `master` (`b13a60e`) through `createLogger("console", { format, timestamp: false })`, logging `logger.error("msg", metadata)`:

| Metadata | `json` | `pretty` (the default, used by the api-server) |
| --- | --- | --- |
| `{ error: new Error("boom") }` | `"error":{}` | `{"error":{}}` |
| an `Error` with a `cause` | `"error":{}` | `{"error":{}}` |
| an `Error` with own fields (`code`, `errno`) | only `code` and `errno` | only `code` and `errno` |
| `{ result: { exception: new Error() } }` | `"exception":{}` | `"exception":{}` |
| `{ errors: [new Error()] }` | `"errors":[{}]` | `"errors":[{}]` |
| a `BaseError` with a cause | complete (its `toJSON`) | complete |
| a cyclic object, plus `other: "kept?"` | `"[Circular]"`, `other` kept | **`[unserializable metadata]`** |
| a `bigint`, plus `other` | `"10"`, `other` kept | **`[unserializable metadata]`** |
| a `BaseError` whose `details` points back to it | `"[Circular]"` inside | **`[unserializable metadata]`** |

Two defects, then:

1. **Every plain `Error` loses `name`, `message`, `stack` and `cause`**, in both formats and at any depth.
2. **In `pretty`, one value that `JSON.stringify` rejects drops all the metadata of the entry**, including unrelated keys.

No entry made the logger throw. The stack overflow that `harden-errors` implementation note 6 describes for a back-reference did not reproduce with the current formats. The `json` format's serializer marks the back-reference as circular, and `pretty` falls into the fallback of defect 2.

## Root cause

- `JSON.stringify` serializes only own enumerable properties. `name`, `message`, `stack` and `cause` are not enumerable on an `Error`.
- `winston.format.errors({ stack: true })` unwraps an error only when it is the log entry itself (`info`) or its `message`, never a value inside the metadata.
- The `pretty` format stringifies all the metadata in one `JSON.stringify` call (`safeStringify` in `winston-console.factory.ts`), so one failing value fails the whole call.
- The `json` format uses winston's `format.json()`, whose serializer handles cycles and `bigint` but knows nothing about errors.

## Fix

A conversion step that both formats run before they stringify. It turns the metadata into values that `JSON.stringify` serializes completely and cannot fail on.

### `toLoggable(value: unknown): unknown`

A new internal module, `src/serialize/to-loggable.ts`. `src/index.ts` does not export it.

| Value | Result |
| --- | --- |
| an object with a `toJSON()` method (a `BaseError`, a `Date`, …) | the result of `toJSON()`, itself converted. This is what `JSON.stringify` does: a class that controls its serialized form keeps control. |
| an `Error` without `toJSON` | its own enumerable fields (`undefined` left out), then `name`, `message`, `stack` when defined, and `cause` when defined, each converted. This is the shape of `BaseError.toJSON()`. |
| an array or any other object | the same structure, each element or own enumerable field converted |
| an object that is its own ancestor | the string `"[Circular]"`. An object reached twice without a cycle is converted both times, as `JSON.stringify` does. |
| a `bigint` | its decimal string, as the `json` format writes it today |
| anything else (string, number, boolean, `null`, `undefined`, function, symbol) | unchanged: `JSON.stringify` handles or drops it as today |
| a value whose conversion throws (a throwing getter or `toJSON`) | the string `"[Unserializable]"`, the rest kept |

It never throws.

### The formats

- `winston-console.factory.ts` exports its `createConsoleFormat(options)`, for tests only. `src/index.ts` still does not export it.
- In both formats, a step right after `format.errors()` replaces every own string-keyed field of the entry with its `toLoggable` value. That includes the fields merged from `defaultMetadata` and from `child()`, but not `level` and `message`.
- The rest of the output is unchanged: field names and order, colors, timestamps, and the top-level `stack` line of `pretty`.

### `@enardo/errors` is not a dependency

A previous analysis suggested reusing the serializer of `@enardo/errors`. The probe shows the logger has to walk the whole metadata anyway: objects, arrays, cycles, `bigint`. `serializeError` only copies an error's own fields as they are, so it would not spare that walk. It would also have to become public API. Calling `toJSON()` instead keeps `BaseError` in charge of its own form: a subclass that leaves a field out of its logs (the HTTP response error planned for `@enardo/http` will leave out the response body) stays out of the logs. Only the plain-`Error` shape is written twice, about ten lines, and test 2 pins it to the shape of `BaseError.toJSON()`.

To make that pin real, `@enardo/errors` becomes a **devDependency** of the logger, used only by the tests. It adds no runtime dependency. Because of it, `pnpm verify` re-checks the logger whenever `@enardo/errors` changes, which is what test 2 is for.

## Out of scope

- **Printing the stacks of nested errors on their own lines** in `pretty`. They are in the JSON, escaped.
- **Maps, Sets, depth and size limits, and redacting sensitive fields.**
- **Metadata keys that collide with `level` or `message`.**
- **A README for `@enardo/logger`** (it has none), and the split into a contract package and a winston adapter.

## Test plan

Test-first, because this is a bug fix. The `test-author` subagent writes the tests from this spec, and the regression cases are seen failing before the fix. The existing tests of the package import internal modules (`~/create-logger`), and these do the same.

### `toLoggable` (`__tests__/serialize/to-loggable.test.ts`, importing `~/serialize/to-loggable`)

1. A plain `Error` → `{ name, message, stack }` with its values, and no `cause` key.
2. An `Error` with own enumerable fields (`code: "ECONNREFUSED"`, `errno: -111`, and one field set to `undefined`) → those fields plus `name`, `message` and `stack`, without the `undefined` one. For a `BaseError` subclass (the real one, from `@enardo/errors`) without a `cause`: take `expected = error.toJSON()`, then hide the method on the instance (`Object.defineProperty(error, "toJSON", { value: undefined })`) so that the plain-`Error` path runs; the result deep-equals `expected`. Without hiding it, `toJSON` takes precedence and the comparison could not fail.
3. A cause chain: a `TypeError` whose cause is an `Error` whose cause is the string `"root"` → both errors serialized, the string kept.
4. Two errors that are each other's cause → `"[Circular]"` where the chain loops, with no throw.
5. An object whose `toJSON` returns `{ kept: 1 }` and that also has an own field `secret` → `{ kept: 1 }`, with no `secret`. The same for an `Error` subclass with an own field `secret` and a `toJSON` that returns `{ kept: 1 }`: `toJSON` takes precedence over the plain-`Error` shape.
6. Errors nested in an object and in an array, two levels deep → serialized as in case 1.
7. An object that contains itself → `"[Circular]"` at the cycle. An object referenced twice without a cycle → converted at both places.
8. A `BaseError` subclass whose `details` holds a reference to the error itself → the back-reference is `"[Circular]"`, with no throw.
9. `10n` → `"10"`.
10. A getter that throws, and a `toJSON` that throws → each becomes `"[Unserializable]"`, sibling fields kept, no throw. The same in an array: `[1, <element whose read throws>, 3]` → `[1, "[Unserializable]", 3]`. And in an error: an `Error` whose `message` is a getter that throws → `message` is `"[Unserializable]"`, its `name` and `stack` kept; an `Error` whose `stack` is `10n` → `stack` is `"10"`.
11. A `Date` → its ISO string. Strings, numbers, booleans and `null` → unchanged.

### The formats (`__tests__/winston/console-format.test.ts`, importing `createConsoleFormat` from `~/winston/winston-console.factory`)

Each test calls `createConsoleFormat(options).transform(info)` on an entry built as winston builds one: `{ level, message, …metadata, [Symbol.for("level")]: level }`. It reads the output line from `info[Symbol.for("message")]`, which is what the console transport prints. Probed: in vitest the console transport does not write through `process.stdout`, so capturing stdout does not work. In `pretty`, the ANSI color codes are stripped before asserting.

12. **Regression**: `json` with `{ error: new Error("boom") }` → the parsed line has `error.message` `"boom"`, `error.name` `"Error"` and a string `error.stack`. Today `error` is `{}`.
13. **Regression**: `pretty` with the same metadata → the line contains `"message":"boom"`. Today it contains `{"error":{}}`.
14. **Regression**: `pretty` with `{ a: <a cyclic object>, other: "kept" }` → the line contains `"other":"kept"` and `"[Circular]"`. Today the line contains `[unserializable metadata]`.
15. **Existing behavior**: `json` with `{ requestId: "r1" }` and `timestamp: false` → the parsed line is exactly `{ level: "error", message: "msg", requestId: "r1" }`.

## Plan

1. **Spec** (this file).
2. **Tests and fix.**
   - The `test-author` writes cases 1–15.
   - Every case fails at first, because `toLoggable` does not exist and `createConsoleFormat` is not exported.
   - To see the regression cases fail for the right reason, `createConsoleFormat` is exported first, alone. Cases 12–14 must then fail with the symptoms of the *Report*, and case 15 must pass.
   - Then the fix, with `pnpm verify` green.
   - One commit with the tests and the fix.
3. **Manual check**: the probe of the *Report* re-run against the built `dist/`. Expected: plain errors show `name`, `message` and `stack` at every depth, and in `pretty` no entry loses its other keys.
4. **Review**, checkpoint 2, integration.
