/** Structured fields of a log entry. */
export type LoggerMetadata = Record<string, unknown>;

/**
 * What `HttpClient` logs through: a local copy of the interface of
 * `@enardo/logger`, so the package does not depend on it. When `child`
 * exists, the client calls it once, with the context `"HttpClient"`.
 */
export interface Logger {
  debug(message: string, metadata?: LoggerMetadata): void;
  info(message: string, metadata?: LoggerMetadata): void;
  warn(message: string, metadata?: LoggerMetadata): void;
  error(message: string, metadata?: LoggerMetadata): void;
  child?(options: { context?: string; metadata?: LoggerMetadata }): Logger;
}

export function createNoopLogger(): Logger {
  const noop = () => undefined;

  return {
    debug: noop,
    info: noop,
    warn: noop,
    error: noop,
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
