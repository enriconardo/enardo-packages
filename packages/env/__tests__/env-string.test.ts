import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { envString } from "../src/env";

describe("envString", () => {
  const ORIGINAL_ENV = process.env;

  beforeEach(() => {
    process.env = { ...ORIGINAL_ENV };
  });

  afterEach(() => {
    process.env = ORIGINAL_ENV;
  });

  it("should return the value of an existing environment variable", () => {
    process.env.TEST_VAR = "hello";
    expect(envString("TEST_VAR")).toBe("hello");
  });

  it("should return null for a missing variable with no default", () => {
    delete process.env.MISSING_VAR;
    expect(envString("MISSING_VAR")).toBeNull();
  });

  it("should return the default value for a missing variable", () => {
    delete process.env.MISSING_VAR;
    expect(envString("MISSING_VAR", "default")).toBe("default");
  });

  it("should return the default value for an empty string variable", () => {
    process.env.EMPTY_VAR = "";
    expect(envString("EMPTY_VAR", "fallback")).toBe("fallback");
  });

  it("should return null for an empty string variable with no default", () => {
    process.env.EMPTY_VAR = "";
    expect(envString("EMPTY_VAR")).toBeNull();
  });

  it("should return the actual value when set, ignoring the default", () => {
    process.env.TEST_VAR = "actual";
    expect(envString("TEST_VAR", "default")).toBe("actual");
  });

  it("should preserve whitespace in values", () => {
    process.env.SPACED = "  spaces  ";
    expect(envString("SPACED")).toBe("  spaces  ");
  });
});
