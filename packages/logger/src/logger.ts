export type LoggerLevel =
  "error" | "warn" | "info" | "http" | "verbose" | "debug" | "silly";

/**
 * Structured data of a log entry. `level` and `message` are reserved: a field
 * with either name is dropped, and the call's own level and message are kept.
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
