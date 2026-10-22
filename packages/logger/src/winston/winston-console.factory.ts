import winston from "winston";
import { toLoggable } from "~/serialize/to-loggable";
import { WinstonLoggerAdapter } from "~/winston/winston.adapter";
import type { ConsoleLoggerOptions, Logger, LoggerLevel } from "~/logger";

const DEFAULT_LEVEL: LoggerLevel = "info";
const DEFAULT_FORMAT: NonNullable<ConsoleLoggerOptions["format"]> = "pretty";
const DEFAULT_TIMESTAMP = true;

// Both formats drop what an Error keeps in non-enumerable fields, and the
// pretty one's JSON.stringify throws on cycles and bigints. `format.errors`
// only unwraps an error that is the entry itself, never one in the metadata.
// The adapter already converts what it writes: this pass is the safety net
// for entries that reach winston some other way.
const loggableMetadata = winston.format((info) => {
  for (const key of Object.keys(info)) {
    if (key !== "level" && key !== "message") {
      info[key] = toLoggable(info[key]);
    }
  }

  return info;
});

function safeStringify(value: unknown): string {
  try {
    return JSON.stringify(value);
  } catch {
    return "[unserializable metadata]";
  }
}

// Winston's colorize() cannot be toggled: loading it sets the global
// `colors.enabled = true`, so the choice is whether to include it.
function shouldColorize(options: ConsoleLoggerOptions): boolean {
  return options.colors ?? process.stdout.isTTY === true;
}

function createPrettyFormat(options: ConsoleLoggerOptions) {
  const includeTimestamp = options.timestamp ?? DEFAULT_TIMESTAMP;
  const formats = [
    ...(shouldColorize(options)
      ? [winston.format.colorize({ all: true })]
      : []),
    winston.format.errors({ stack: true }),
    loggableMetadata(),
  ];

  if (includeTimestamp) {
    formats.push(winston.format.timestamp());
  }

  formats.push(
    winston.format.printf((info) => {
      const { timestamp, level, message, ...rest } = info;
      const { context, stack } = rest;
      // `context` and `stack` leave the metadata only when printed in their
      // own place (an empty `context` prints nothing and leaves too): any
      // other value stays in the suffix, as in the JSON format.
      const hasContext = typeof context === "string" && context.length > 0;
      const hasStack = typeof stack === "string";
      const metadata = { ...rest };
      if (hasContext || context === "") {
        delete metadata.context;
      }
      if (hasStack) {
        delete metadata.stack;
      }

      const timePrefix = typeof timestamp === "string" ? `${timestamp} ` : "";
      const contextPrefix = hasContext ? `[${context}] ` : "";
      const metadataSuffix =
        Object.keys(metadata).length > 0 ? ` ${safeStringify(metadata)}` : "";
      const stackSuffix = hasStack ? `\n${stack}` : "";

      return `${timePrefix}${level}: ${contextPrefix}${String(message)}${metadataSuffix}${stackSuffix}`;
    }),
  );

  return winston.format.combine(...formats);
}

function createJsonFormat(options: ConsoleLoggerOptions) {
  const includeTimestamp = options.timestamp ?? DEFAULT_TIMESTAMP;
  const formats = [winston.format.errors({ stack: true }), loggableMetadata()];

  if (includeTimestamp) {
    formats.push(winston.format.timestamp());
  }

  formats.push(winston.format.json());

  return winston.format.combine(...formats);
}

export function createConsoleFormat(options: ConsoleLoggerOptions) {
  if ((options.format ?? DEFAULT_FORMAT) === "json") {
    return createJsonFormat(options);
  }

  return createPrettyFormat(options);
}

export function createConsoleLogger(
  options: ConsoleLoggerOptions = {},
): Logger {
  const logger = winston.createLogger({
    level: options.level ?? DEFAULT_LEVEL,
    format: createConsoleFormat(options),
    transports: [new winston.transports.Console()],
  });

  return new WinstonLoggerAdapter(logger, options.defaultMetadata);
}
