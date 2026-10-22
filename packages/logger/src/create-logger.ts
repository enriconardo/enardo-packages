import { createNoopLogger } from "~/noop/noop.logger";
import type { Logger, LoggerOptions, LoggerTransportType } from "~/logger";
import { createConsoleLogger } from "~/winston/winston-console.factory";

/**
 * Creates a logger for a transport.
 *
 * The options are typed by the transport: `"console"` takes the console
 * options, `"noop"` only the base ones. A transport typed
 * `LoggerTransportType`, as one read from configuration, is accepted, and
 * takes the options of either.
 */
export function createLogger<TTransport extends LoggerTransportType>(
  transportType: TTransport,
  options: LoggerOptions<TTransport> = {},
): Logger {
  if (transportType === "console") {
    return createConsoleLogger(options);
  }

  if (transportType === "noop") {
    return createNoopLogger(options);
  }

  return assertUnreachable(transportType);
}

function assertUnreachable(value: never): never {
  throw new Error(`Unsupported logger transport type: ${String(value)}`);
}
