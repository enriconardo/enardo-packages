import { createNoopLogger } from "~/noop/noop.logger";
import { describe, expect, it } from "vitest";

describe("createNoopLogger", () => {
  it("returns the same singleton instance", () => {
    const loggerA = createNoopLogger();
    const loggerB = createNoopLogger();

    expect(loggerA).toBe(loggerB);
  });

  it("returns itself when creating a child", () => {
    const logger = createNoopLogger();

    const child = logger.child({
      context: "jwt-authentication-token-service",
      metadata: { scope: "issue-token" },
    });

    expect(child).toBe(logger);
  });

  it("does not throw on any log level", () => {
    const logger = createNoopLogger();

    expect(() => logger.debug("debug", { userId: "u1" })).not.toThrow();
    expect(() => logger.info("info", { userId: "u1" })).not.toThrow();
    expect(() => logger.warn("warn", { userId: "u1" })).not.toThrow();
    expect(() => logger.error("error", { userId: "u1" })).not.toThrow();
  });
});
