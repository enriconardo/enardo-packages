import { createNoopLogger } from "~/noop/noop.logger";
import type {
  ConsoleLoggerOptions,
  Logger,
  LoggerOptions,
  LoggerTransportType,
  NoopLoggerOptions,
} from "~/logger";
import { createConsoleLogger } from "~/winston/winston-console.factory";

export function createLogger(
  transportType: "console",
  options?: LoggerOptions<"console">,
): Logger;
export function createLogger(
  transportType: "noop",
  options?: LoggerOptions<"noop">,
): Logger;
export function createLogger(
  transportType: LoggerTransportType,
  options: ConsoleLoggerOptions | NoopLoggerOptions = {},
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
