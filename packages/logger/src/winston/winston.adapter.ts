import type winston from "winston";
import type {
  LogMetadata,
  Logger,
  LoggerChildOptions,
  LoggerLevel,
} from "~/logger";
import { toLoggable } from "~/serialize/to-loggable";

/**
 * A `Logger` over a winston logger.
 *
 * It builds every entry itself, `{ ...bound, ...metadata, level, message }`,
 * and hands it to winston as one object. Winston's `log(level, message,
 * metadata)` would scan the message for printf tokens and drop the metadata
 * when it finds one, append a metadata `message` to the message, and read
 * every getter while merging. Winston's own `defaultMeta` and `child()` are
 * not used either: the first overrides the entry in the one-object form, the
 * second makes the defaults win over the child's metadata.
 */
export class WinstonLoggerAdapter implements Logger {
  private readonly bound: LogMetadata;

  /**
   * @param logger The winston logger to write to, without `defaultMeta`.
   * @param bound Metadata added to every entry: the defaults of a root
   *   logger, plus the child's metadata for a child.
   */
  constructor(
    private readonly logger: winston.Logger,
    bound?: LogMetadata,
  ) {
    this.bound = toLoggableFields(bound);
  }

  public debug(message: string, metadata?: LogMetadata): void {
    this.log("debug", message, metadata);
  }

  public info(message: string, metadata?: LogMetadata): void {
    this.log("info", message, metadata);
  }

  public warn(message: string, metadata?: LogMetadata): void {
    this.log("warn", message, metadata);
  }

  public error(message: string, metadata?: LogMetadata): void {
    this.log("error", message, metadata);
  }

  public child(options: LoggerChildOptions): Logger {
    return new WinstonLoggerAdapter(this.logger, {
      ...this.bound,
      context: options.context,
      ...toLoggableFields(options.metadata),
    });
  }

  private log(
    level: LoggerLevel,
    message: string,
    metadata?: LogMetadata,
  ): void {
    this.logger.log({
      ...this.bound,
      ...toLoggableFields(metadata),
      level,
      message,
    });
  }
}

// Reads the metadata one field at a time, so a getter that throws costs only
// its own field. Metadata that is not a plain record at runtime is kept under
// one key rather than spread.
function toLoggableFields(metadata: LogMetadata | undefined): LogMetadata {
  if (metadata === undefined) {
    return {};
  }

  const fields = toLoggable(metadata);
  return isRecord(fields) ? fields : { metadata: fields };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
