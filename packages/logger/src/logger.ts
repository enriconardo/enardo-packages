export type LoggerLevel =
  "error" | "warn" | "info" | "http" | "verbose" | "debug" | "silly";

/**
 * Structured data of a log entry. `level`, `message` and `timestamp` are
 * reserved: a field with any of these names is dropped, the call's own level
 * and message are kept, and the entry's time comes from the logger.
 */
export type LogMetadata = Record<string, unknown>;

export interface LoggerChildOptions {
  context: string;
  metadata?: LogMetadata;
}

export interface Logger {
  debug(message: string, metadata?: LogMetadata): void;
  info(message: string, metadata?: LogMetadata): void;
  warn(message: string, metadata?: LogMetadata): void;
  error(message: string, metadata?: LogMetadata): void;
  child(options: LoggerChildOptions): Logger;
}

export interface LoggerBaseOptions {
  level?: LoggerLevel;
  defaultMetadata?: LogMetadata;
}

export interface ConsoleLoggerOptions extends LoggerBaseOptions {
  /** `pretty` is the default. */
  format?: "pretty" | "json";
  /**
   * Whether the `pretty` format colors its lines. `true` always colors, `false`
   * never does, a terminal included. Absent, it colors only when stdout is a
   * terminal. Decided once, when the logger is created. The environment
   * (`FORCE_COLOR`, `NO_COLOR`) plays no part. `json` never colors.
   */
  colors?: boolean;
  timestamp?: boolean;
}

export type NoopLoggerOptions = LoggerBaseOptions;

export type LoggerTransportType = "console" | "noop";

export interface LoggerOptionsByTransport {
  console: ConsoleLoggerOptions;
  noop: NoopLoggerOptions;
}

export type LoggerOptions<TTransport extends LoggerTransportType> =
  LoggerOptionsByTransport[TTransport];
