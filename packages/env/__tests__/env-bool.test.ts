import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { envBool } from "../src/env";

describe("envBool", () => {
  const ORIGINAL_ENV = process.env;

  beforeEach(() => {
    process.env = { ...ORIGINAL_ENV };
  });

  afterEach(() => {
    process.env = ORIGINAL_ENV;
  });

  it.each(["true", "1", "yes", "TRUE", "True", "YES", "Yes"])(
    "should return true for '%s'",
    (val) => {
      process.env.FLAG = val;
      expect(envBool("FLAG")).toBe(true);
    },
  );

  it.each(["false", "0", "no", "FALSE", "False", "NO", "No"])(
    "should return false for '%s'",
    (val) => {
      process.env.FLAG = val;
      expect(envBool("FLAG")).toBe(false);
    },
  );

  it("should return null for a missing variable with no default", () => {
    delete process.env.MISSING_VAR;
    expect(envBool("MISSING_VAR")).toBeNull();
  });

  it("should return the default for a missing variable", () => {
    delete process.env.MISSING_VAR;
    expect(envBool("MISSING_VAR", true)).toBe(true);
  });

  it("should return the default for an empty string variable", () => {
    process.env.EMPTY_VAR = "";
    expect(envBool("EMPTY_VAR", false)).toBe(false);
  });

  it("should return the default for an unrecognized value", () => {
    process.env.FLAG = "maybe";
    expect(envBool("FLAG", true)).toBe(true);
  });

  it("should return null for an unrecognized value with no default", () => {
    process.env.FLAG = "random";
    expect(envBool("FLAG")).toBeNull();
  });
});
