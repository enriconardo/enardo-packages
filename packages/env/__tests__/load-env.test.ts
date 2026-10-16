import { describe, it, expect, vi, beforeEach } from "vitest";
import dotenv from "dotenv";
import type { DotenvPopulateInput } from "dotenv";
import { loadEnv } from "../src/load-env";

vi.mock("dotenv", () => ({
  default: {
    config: vi.fn(),
    populate: vi.fn(),
  },
}));

describe("loadEnv", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("should call dotenv.config and dotenv.populate with defaults when none are provided", () => {
    loadEnv();

    expect(dotenv.config).not.toHaveBeenCalled();
    expect(dotenv.populate).toHaveBeenCalledWith(
      process.env,
      process.env,
      undefined,
    );
  });

  it("should forward the path option to dotenv.config", () => {
    loadEnv({ path: "/custom/.env" });

    expect(dotenv.config).toHaveBeenCalledWith({ path: "/custom/.env" });
    expect(dotenv.populate).toHaveBeenCalledWith(process.env, process.env, {
      path: "/custom/.env",
    });
  });

  it("should forward override option to dotenv.config and dotenv.populate", () => {
    loadEnv({ path: ".env.local", override: true });

    expect(dotenv.config).toHaveBeenCalledWith({
      path: ".env.local",
      override: true,
    });
    expect(dotenv.populate).toHaveBeenCalledWith(process.env, process.env, {
      path: ".env.local",
      override: true,
    });
  });

  it("should use custom source and target when provided", () => {
    const source = { API_URL: "https://example.com" };
    const target: DotenvPopulateInput = {};

    loadEnv({ source, target });

    expect(dotenv.config).not.toHaveBeenCalled();
    expect(dotenv.populate).toHaveBeenCalledWith(target, source, undefined);
  });
});
