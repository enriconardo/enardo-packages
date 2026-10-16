---
status: done
type: fix
packages: ["@enardo/logger"]
branch: fix/logger/winston-metadata-merge
---

# The logger loses, mangles or throws on metadata

## Report

The review of `fix/logger/serialize-nested-errors` found two defects that already existed. Both come from how the winston adapter hands an entry to winston. Probed on `master` (`3d59ccf`) through `createLogger("console", { format: "json", timestamp: false })`:

| Call | Line written |
| --- | --- |
| `error("discount 50%off", { requestId: "r1" })` | `{"level":"error","message":"discount 50%off"}`: **the metadata is gone** |
| `error("value %s", { requestId: "r1" })` | the same: metadata gone |
| `error("msg", <object with a getter that throws>)` | **`logger.error` throws** `getter failed` |
| the same getter in `defaultMetadata`, or in `child({ metadata })` | `logger.error` throws |
| `error("msg", { message: "from metadata", other: 1 })` | `"message":"msg from metadata"`: the field is glued to the message |
| `error("msg", { level: "debug", other: 1 })` | `level` stays `error`, and the field is dropped |
| `defaultMetadata: { service: "api" }`, then `error("msg", { service: "call" })` | `"service":"call"`: the call wins |
| `defaultMetadata: { service: "api" }`, then `child({ context: "C", metadata: { service: "child" } }).error("msg")` | `"service":"api"`: **the default wins over the child** |
| `child({ … service: "child" }).error("msg", { service: "call" })` | `"service":"call"`: the call wins |

## Root cause

`WinstonLoggerAdapter.log` calls `logger.log(level, message, metadata)` (`winston.adapter.ts`). Winston 3.19's `log()` (`lib/winston/logger.js`) then does the following:

- **It scans the message for printf tokens** (`/%[scdjifoO%]/`). If it finds one, it treats the arguments as printf arguments for `format.splat()`, which neither format has, and it never merges the metadata.
- **It merges the metadata with `Object.assign({}, defaultMeta, metadata, { level, message })`.** That reads every getter of the metadata and of `defaultMeta`. A child logger's `write` merges its bound metadata the same way, at every write.
- **It appends a metadata `message` to the message**, a feature meant for `logger.log(level, msg, error)`.
- **It puts the child's bound metadata under the entry** (`Object.assign({}, childMetadata, info)`), and the entry already carries `defaultMeta`. So the defaults win over the child.

The `Logger` interface has no printf arguments, so none of this is wanted.

## Fix

The adapter builds the whole entry itself and hands it to winston with `logger.log(entry)`, the single-argument form. That form neither scans the message nor merges the metadata. It does apply winston's `defaultMeta` *over* the entry, so the adapter keeps the defaults itself and winston gets none.

- **`WinstonLoggerAdapter`**: `new WinstonLoggerAdapter(logger, bound?)`. `bound` is the metadata bound to this logger: the defaults for a root logger, plus the child metadata for a child.
  - `debug`/`info`/`warn`/`error(message, metadata?)` write `{ ...bound, ...metadata, level, message }`, with the metadata converted by `toLoggable` (`src/serialize/to-loggable.ts`). Conversion reads one field at a time, so a throwing getter becomes `"[Unserializable]"` and nothing throws.
  - `child({ context, metadata })` returns a new adapter on the same winston logger, with `bound` = `{ ...bound, context, ...metadata }`, converted when the child is created. It no longer uses winston's `child()`.
- **Metadata that does not convert to a plain record** goes under the key `metadata` instead of being spread. This happens with an object whose `toJSON()` throws, or returns a string. It keeps rule 2 for these inputs: on `master`, a `toJSON()` that throws makes `logger.info` throw. Added after review, so it is not among the decisions confirmed at checkpoint 1. A bound field named `metadata` is overwritten in that case.
- **`createConsoleLogger`** no longer passes `defaultMeta` to winston. It passes `options.defaultMetadata` to the adapter as `bound`, converted once at creation.

Resulting rules:

1. **The metadata is always kept**, whatever the message contains.
2. **No metadata makes the logger throw**: not the call's, not the defaults, not a child's.
3. **Precedence, most specific first**: the call's `level` and `message`, then the call's metadata, then the child's (an inner child over an outer one), then the defaults.
4. **`level` and `message` belong to the call.** A metadata field with either name is dropped. The `LogMetadata` JSDoc says so.

### Decisions (to confirm at checkpoint 1)

1. **The defaults no longer win over a child.** That is the only change of precedence. No caller in the monorepo binds the same key twice: the api-server's defaults are `service` and `environment`, and its children bind `context`, or `baseUrl` in `@enardo/http`. Checked with `git grep` over the `child(` and `defaultMetadata` sites.
2. **A metadata `message` is dropped instead of appended to the message.** None of the 39 logger calls in `src/` passes `message` or `level` in the metadata (checked). Keeping it under another name would invent a key that could collide in turn.
3. **Defaults and child metadata are converted once, when the logger is created.** Today winston keeps a reference to the object, so a later mutation shows up in the logs; after the change it does not. Nothing in the monorepo mutates them.

## Out of scope

- **Printf-style arguments** (`format.splat()`): the `Logger` interface has none.
- **Keys that the formats themselves add** (`timestamp`).
- **The noop logger**, which ignores everything.

## Test plan

Test-first, because this is a bug fix. The `test-author` subagent writes the tests from this spec, in the foreground, and the regression cases are seen failing before the fix.

The tests go in `__tests__/winston/winston.adapter.test.ts`. They import `WinstonLoggerAdapter` from `~/winston/winston.adapter` and `createConsoleFormat` from `~/winston/winston-console.factory`, as the existing tests import internal modules.

**How the tests capture lines.** Each test builds a winston logger whose transport is `new winston.transports.Stream({ stream })`, over a `Writable` that collects the chunks. Probed: it writes each line synchronously. The logger is:

```ts
winston.createLogger({ level: "debug", format: createConsoleFormat({ format: "json", timestamp: false }), transports: [transport] })
```

The test wraps it in `new WinstonLoggerAdapter(logger, bound?)` and parses each line as JSON.

**Getters that throw.** A getter that throws is installed with `Object.defineProperty(…, { enumerable: true, get() { throw … } })`.

**What "today" means for the regression cases.** The adapter's constructor does not yet take `bound`. So for cases 4 and 6, "today" is the probe of the *Report*, which went through `createLogger`.

1. **Regression**: `error("discount 50%off", { requestId: "r1" })`, `error("value %s", …)` and `error("100%%", …)` each write `requestId: "r1"`, and the exact message. Today the metadata is missing.
2. **Regression**: call metadata `{ other: 1, bad: <throwing getter> }`. `error` does not throw, and the line has `other: 1` and `bad: "[Unserializable]"`. Today it throws.
3. **Regression**: `child({ context: "C", metadata: <with a throwing getter> })`. Neither `child` nor a following `error("msg", { other: 1 })` throws, and the line has `context: "C"`, `other: 1` and the getter's key as `"[Unserializable]"`.
4. **Regression**: an adapter built with a `bound` that has a throwing getter. `error` does not throw, and the line has the getter's key as `"[Unserializable]"`.
5. **Regression**: `error("msg", { message: "from metadata", other: 1 })` writes `message: "msg"` exactly, and `other: 1`. Today it writes `"msg from metadata"`.
6. **Regression, precedence**: the adapter is built with `bound` `{ service: "default", a: 1 }`, then `child({ context: "C", metadata: { service: "child", b: 2 } })`.
   - `error("msg")` writes `service: "child"`, `a: 1`, `b: 2` and `context: "C"`. Today the default wins over the child.
   - `error("msg", { service: "call" })` writes `service: "call"`.
7. **Existing behavior**: `error("msg", { level: "debug", other: 1 })` writes `level: "error"` and `other: 1`.
8. **Existing behavior**: `child({ context: "A" }).child({ context: "B" }).info("x")` writes `context: "B"`.
9. **Existing behavior**: `error("msg", { error: new Error("boom") })` writes `error.message: "boom"`, through the conversion of `fix/logger/serialize-nested-errors`.
10. **Existing behavior**: `info("hello")` with no metadata writes exactly `{ level: "info", message: "hello" }` (the adapter built without `bound`).

Added after review. These pin code that already exists, so each is checked by removing what it pins:

11. `error("msg", { toJSON() { throw new Error("x") } })` does not throw and writes `metadata: "[Unserializable]"`. `error("msg", { toJSON: () => "s" })` writes `metadata: "s"`.
12. **Wiring**, in `__tests__/winston/winston-console.factory.test.ts`. With `~/winston/winston.adapter` mocked as `create-logger.test.ts` mocks its modules, `createConsoleLogger({ defaultMetadata: { service: "api" } })` constructs the adapter with a winston logger as first argument and `{ service: "api" }` as second.

**Manual check**: the probe of the *Report*, re-run against the rebuilt `dist/` through `createLogger`. Expected:
- the metadata is kept with `%` tokens in the message;
- no call throws;
- `message` is the call's;
- in the defaults-versus-child case, `service` is `"child"`.

## Plan

1. **Spec** (this file).
2. **Tests and fix.**
   - The `test-author` writes cases 1–10, in the foreground.
   - Then the fix, with `pnpm verify` green.
   - One commit with the tests and the fix.
3. **Manual check.**
4. **Review**, checkpoint 2, integration.
