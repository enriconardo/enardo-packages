import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { env } from "../src/env";

describe("env", () => {
  const ORIGINAL_ENV = process.env;

  beforeEach(() => {
    process.env = { ...ORIGINAL_ENV };
  });

  afterEach(() => {
    process.env = ORIGINAL_ENV;
  });

  describe("string type (default)", () => {
    it("should return a string value", () => {
      process.env.NAME = "world";
      expect(env("NAME")).toBe("world");
    });

    it("should return null for a missing variable", () => {
      delete process.env.MISSING;
      expect(env("MISSING")).toBeNull();
    });

    it("should use the string default", () => {
      delete process.env.MISSING;
      expect(env("MISSING", "string", "fallback")).toBe("fallback");
    });
  });

  describe("number type", () => {
    it("should coerce to number", () => {
      process.env.PORT = "8080";
      expect(env("PORT", "number")).toBe(8080);
    });

    it("should use the number default", () => {
      delete process.env.MISSING;
      expect(env("MISSING", "number", 0)).toBe(0);
    });

    it("should return null for invalid number with no default", () => {
      process.env.BAD = "abc";
      expect(env("BAD", "number")).toBeNull();
    });
  });

  describe("boolean type", () => {
    it("should coerce to boolean", () => {
      process.env.DEBUG = "true";
      expect(env("DEBUG", "boolean")).toBe(true);
    });

    it("should use the boolean default", () => {
      delete process.env.MISSING;
      expect(env("MISSING", "boolean", false)).toBe(false);
    });

    it("should return null for unrecognized boolean with no default", () => {
      process.env.FLAG = "unknown";
      expect(env("FLAG", "boolean")).toBeNull();
    });
  });
});
