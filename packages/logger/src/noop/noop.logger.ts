import type {
  LogMetadata,
  Logger,
  LoggerChildOptions,
  NoopLoggerOptions,
} from "~/logger";

function ignore(value: unknown): void {
  void value;
}

const noopLogger: Logger = {
  debug(message: string, metadata?: LogMetadata): void {
    ignore(message);
    ignore(metadata);
  },

  info(message: string, metadata?: LogMetadata): void {
    ignore(message);
    ignore(metadata);
  },

  warn(message: string, metadata?: LogMetadata): void {
    ignore(message);
    ignore(metadata);
  },

  error(message: string, metadata?: LogMetadata): void {
    ignore(message);
    ignore(metadata);
  },

  child(options: LoggerChildOptions): Logger {
    ignore(options);
    return noopLogger;
  },
};

export function createNoopLogger(_options?: NoopLoggerOptions): Logger {
  ignore(_options);
  return noopLogger;
}
