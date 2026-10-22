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
  /**
   * `pretty` (the default) colors only where colors are wanted, decided once
   * when the logger is created: with `FORCE_COLOR` set to `""`, `1`, `2`, `3`
   * or `true`, whatever the output; with any other `FORCE_COLOR` value, never;
   * without `FORCE_COLOR`, when stdout is a terminal that supports colors and
   * `NO_COLOR` is unset or empty. `json` never colors.
   */
  format?: "pretty" | "json";
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
