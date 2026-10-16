import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => {
  return {
    WinstonLoggerAdapter: vi.fn(),
  };
});

vi.mock("~/winston/winston.adapter", () => {
  return {
    WinstonLoggerAdapter: mocks.WinstonLoggerAdapter,
  };
});

import { createConsoleLogger } from "~/winston/winston-console.factory";

describe("createConsoleLogger", () => {
  beforeEach(() => {
    mocks.WinstonLoggerAdapter.mockReset();
  });

  it("constructs the adapter with a winston logger and the default metadata as bound metadata", () => {
    createConsoleLogger({ defaultMetadata: { service: "api" } });

    expect(mocks.WinstonLoggerAdapter).toHaveBeenCalledTimes(1);
    expect(mocks.WinstonLoggerAdapter).toHaveBeenCalledWith(
      expect.objectContaining({ log: expect.any(Function) }),
      { service: "api" },
    );
  });
});
