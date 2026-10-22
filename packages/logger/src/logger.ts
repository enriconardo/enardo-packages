/**
 * The npm levels, most severe first. A logger writes the entries at its own
 * level and above: at `warn`, `info` and `debug` are dropped. `Logger` has a
 * method for four of them; the others only set a threshold.
 */
export type LoggerLevel =
  "error" | "warn" | "info" | "http" | "verbose" | "debug" | "silly";

/**
 * Structured data of a log entry. `level`, `message` and `timestamp` are
 * reserved: a field with any of these names is dropped, the call's own level
 * and message are kept, and the entry's time comes from the logger.
 */
export type LogMetadata = Record<string, unknown>;

export interface LoggerChildOptions {
  /**
   * Written as the `context` field of every entry of the child, and replaced
   * by an inner child's. A `context` in `metadata`, or in a call's metadata,
   * wins over it.
   */
  context: string;
  /**
   * Added to every entry of the child, over its parent's bound metadata.
   * Converted once, when the child is created: a later mutation does not
   * reach the logs.
   */
  metadata?: LogMetadata;
}

/**
 * A structured logger. Each method writes one entry, made of the logger's
 * bound metadata (its defaults, then each child's), then the call's
 * `metadata`, then `level` and `message`: a later field wins. The message is
 * written as given, never interpolated. No metadata makes a call throw.
 */
export interface Logger {
  debug(message: string, metadata?: LogMetadata): void;
  info(message: string, metadata?: LogMetadata): void;
  warn(message: string, metadata?: LogMetadata): void;
  error(message: string, metadata?: LogMetadata): void;
  /** A logger that writes to the same output, with more bound metadata. */
  child(options: LoggerChildOptions): Logger;
}

export interface LoggerBaseOptions {
  /** The least severe level written. `info` is the default. */
  level?: LoggerLevel;
  /**
   * Added to every entry, under a child's and a call's metadata. Converted
   * once, when the logger is created: a later mutation does not reach the
   * logs.
   */
  defaultMetadata?: LogMetadata;
}

/** The options of the `"console"` transport, which writes to stdout. */
export interface ConsoleLoggerOptions extends LoggerBaseOptions {
  /**
   * `pretty`, the default, writes one line for people: time, level, context,
   * message, then the metadata as JSON. `json` writes each entry as one JSON
   * object.
   */
  format?: "pretty" | "json";
  /**
   * Whether the `pretty` format colors its lines. `true` always colors, `false`
   * never does, a terminal included. Absent, it colors only when stdout is a
   * terminal. Decided once, when the logger is created. The environment
   * (`FORCE_COLOR`, `NO_COLOR`) plays no part. `json` never colors.
   */
  colors?: boolean;
  /**
   * Whether each entry carries its time, as an ISO 8601 string in UTC.
   * `true` is the default.
   */
  timestamp?: boolean;
}

/**
 * The options of the `"noop"` transport, which writes nothing. Accepted for
 * symmetry with the console's, and ignored.
 */
export type NoopLoggerOptions = LoggerBaseOptions;

/** Where a logger writes: `console` to stdout, `noop` nowhere. */
export type LoggerTransportType = "console" | "noop";

/** The options each transport takes. */
export interface LoggerOptionsByTransport {
  console: ConsoleLoggerOptions;
  noop: NoopLoggerOptions;
}

/**
 * The options of a transport; for `LoggerTransportType` itself, those of
 * either.
 */
export type LoggerOptions<TTransport extends LoggerTransportType> =
  LoggerOptionsByTransport[TTransport];
