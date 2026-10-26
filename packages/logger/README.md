# @enardo/logger

A structured logger: a `Logger` interface, a console logger that writes to stdout, and a noop logger that writes nothing. The app picks where the logs go, never the library that writes them.

## Exports

| Export | Meaning |
| --- | --- |
| `createLogger(transport, options?)` | Creates a `Logger` for a transport, `"console"` or `"noop"` |
| `Logger` | `debug`, `info`, `warn` and `error`, each taking a message and optional metadata, and `child` |
| `LogMetadata` | The structured data of an entry, a record |
| `LoggerChildOptions` | The options of `child`: `context`, and optional `metadata` |
| `LoggerLevel` | `error`, `warn`, `info`, `http`, `verbose`, `debug`, `silly`, most severe first |
| `LoggerTransportType` | `"console" \| "noop"` |
| `ConsoleLoggerOptions`, `NoopLoggerOptions` | The options of each transport |
| `LoggerOptions<T>`, `LoggerOptionsByTransport` | The options of a transport, by its type |

```ts
import { createLogger } from "@enardo/logger";

const logger = createLogger("console", {
  level: "debug",
  format: "json",
  defaultMetadata: { service: "orders-api" },
});

logger.info("server started", { port: 3000 });

const orders = logger.child({ context: "orders", metadata: { region: "eu" } });
orders.error("payment failed", { orderId: "o-42", error });
```

A transport read from configuration, typed `LoggerTransportType`, is accepted, and takes the options of either transport.

Code that only writes logs takes a `Logger`, and gets one from the app's composition root: tests pass `createLogger("noop")`.

## Options

Both transports take:

| Option | Default | Meaning |
| --- | --- | --- |
| `level` | `"info"` | The least severe level written: at `"warn"`, `info` and `debug` entries are dropped |
| `defaultMetadata` | none | Added to every entry |

The console transport also takes:

| Option | Default | Meaning |
| --- | --- | --- |
| `format` | `"pretty"` | `"pretty"`: one line for people. `"json"`: one JSON object per line |
| `timestamp` | `true` | Whether each entry carries its time, an ISO 8601 string in UTC |
| `colors` | stdout is a terminal | Whether `pretty` colors its lines; decided once, at creation, and the environment (`FORCE_COLOR`, `NO_COLOR`) plays no part. `json` never colors |

The noop transport ignores its options: `createLogger("noop")` always returns the same logger, and its `child` returns that logger too.

## Entries

The `pretty` format writes the time, the level, the context in brackets, the message, then the rest of the metadata as JSON. A string `stack` field goes on the lines below:

```
2026-10-22T12:08:37.967Z error: [orders] payment failed {"service":"orders-api","region":"eu","orderId":"o-42"}
```

The `json` format writes every field of the entry, `level`, `message` and `timestamp` included, its keys in alphabetical order:

```
{"context":"orders","level":"error","message":"payment failed","orderId":"o-42","region":"eu","service":"orders-api","timestamp":"2026-10-22T12:08:37.972Z"}
```

The message is written as given: `%s` and other printf tokens are never interpolated.

## Metadata

- **Precedence.** An entry is made of the defaults, then each child's metadata (an inner child over an outer one), then the call's metadata, then the call's `level` and `message`: a later field wins.
- **Reserved fields.** A metadata field named `level`, `message` or `timestamp` is dropped: the entry keeps the call's level and message, and its time comes from the logger.
- **Context.** A child writes its `context` as the `context` field of every entry, and an inner child's replaces it. It is a field like the others: a `context` in the child's `metadata`, or in a call's metadata, wins over it.
- **Bound once.** The defaults and a child's metadata are converted when the logger is created: a later change to the object does not reach the logs. A call's metadata is converted at the call.
- **Conversion.** Every value is turned into one that serializes completely, and no metadata makes a call throw:
  - a value with a `toJSON()` method is replaced by its result, so an error class that controls its serialized form keeps control of what it logs;
  - any other `Error` keeps its own fields, plus `name`, `message`, `stack` and `cause`, its causes converted the same way; an `AggregateError` also keeps its `errors`, each element converted the same way;
  - a `bigint` becomes its decimal string, and an object that contains itself becomes `"[Circular]"` where it recurs;
  - a field whose read or conversion throws becomes `"[Unserializable]"`, and the other fields are kept;
  - metadata that is not a record at runtime is written under one `metadata` field.

## Contributing

Run these inside `packages/logger`, in the dev container:

```sh
pnpm format && pnpm lint && pnpm typecheck && pnpm test
```

The rules for changing the package are in [CLAUDE.md](./CLAUDE.md).
