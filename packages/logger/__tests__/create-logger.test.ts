import type { LogMetadata, Logger, LoggerChildOptions } from "~/logger";
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => {
  return {
    createConsoleLogger: vi.fn(),
    createNoopLogger: vi.fn(),
  };
});

vi.mock("~/winston/winston-console.factory", () => {
  return {
    createConsoleLogger: mocks.createConsoleLogger,
  };
});

vi.mock("~/noop/noop.logger", () => {
  return {
    createNoopLogger: mocks.createNoopLogger,
  };
});

import { createLogger } from "~/create-logger";

function ignore(value: unknown): void {
  void value;
}

function createFakeLogger(): Logger {
  const fakeLogger: Logger = {
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
      return fakeLogger;
    },
  };

  return fakeLogger;
}

describe("createLogger", () => {
  beforeEach(() => {
    mocks.createConsoleLogger.mockReset();
    mocks.createNoopLogger.mockReset();
  });

  it("dispatches to console transport creator", () => {
    const fakeLogger = createFakeLogger();
    const options = {
      level: "debug" as const,
      format: "json" as const,
      timestamp: false,
      defaultMetadata: { service: "api-server" },
    };

    mocks.createConsoleLogger.mockReturnValue(fakeLogger);

    const result = createLogger("console", options);

    expect(mocks.createConsoleLogger).toHaveBeenCalledTimes(1);
    expect(mocks.createConsoleLogger).toHaveBeenCalledWith(options);
    expect(mocks.createNoopLogger).not.toHaveBeenCalled();
    expect(result).toBe(fakeLogger);
  });

  it("dispatches to noop transport creator", () => {
    const fakeLogger = createFakeLogger();

    mocks.createNoopLogger.mockReturnValue(fakeLogger);

    const result = createLogger("noop", {
      level: "error",
      defaultMetadata: { service: "worker" },
    });

    expect(mocks.createNoopLogger).toHaveBeenCalledTimes(1);
    expect(mocks.createNoopLogger).toHaveBeenCalledWith({
      level: "error",
      defaultMetadata: { service: "worker" },
    });
    expect(mocks.createConsoleLogger).not.toHaveBeenCalled();
    expect(result).toBe(fakeLogger);
  });
});
