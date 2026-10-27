export type LoggerMetadata = Record<string, unknown>;

export interface Logger {
  debug(message: string, metadata?: LoggerMetadata): void;
  warn(message: string, metadata?: LoggerMetadata): void;
  child?(options: { context?: string; metadata?: LoggerMetadata }): Logger;
}

export function createNoopLogger(): Logger {
  const noop = () => undefined;

  return {
    debug: noop,
    warn: noop,
    child() {
      return this;
    },
  };
}

export function withLoggerContext(
  logger: Logger,
  context: string,
  metadata?: LoggerMetadata,
): Logger {
  if (!logger.child) {
    return logger;
  }

  return logger.child({
    context,
    metadata,
  });
}
