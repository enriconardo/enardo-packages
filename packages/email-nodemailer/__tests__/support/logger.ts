import { vi } from "vitest";
import type { Mock } from "vitest";

type LogMethod = (message: string, metadata?: Record<string, unknown>) => void;

interface ChildOptions {
  context?: string;
  metadata?: Record<string, unknown>;
}

export interface RecordingLogger {
  debug: Mock<LogMethod>;
  info: Mock<LogMethod>;
  warn: Mock<LogMethod>;
  error: Mock<LogMethod>;
  /** Records its argument, and returns this same logger. */
  child: Mock<(options: ChildOptions) => RecordingLogger>;
  /**
   * Every call of the four log methods, in the order they were made, as
   * `[level, ...arguments]`.
   */
  readonly calls: unknown[][];
}

/** A logger that records every call, in order, across its four levels. */
export function createRecordingLogger(): RecordingLogger {
  const calls: unknown[][] = [];
  const method = (level: string): Mock<LogMethod> =>
    vi.fn<LogMethod>((...args) => {
      calls.push([level, ...args]);
    });
  const logger: RecordingLogger = {
    debug: method("debug"),
    info: method("info"),
    warn: method("warn"),
    error: method("error"),
    child: vi.fn<(options: ChildOptions) => RecordingLogger>(() => logger),
    calls,
  };
  return logger;
}
