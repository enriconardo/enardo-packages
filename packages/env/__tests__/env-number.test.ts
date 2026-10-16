import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { envNumber } from "../src/env";

describe("envNumber", () => {
  const ORIGINAL_ENV = process.env;

  beforeEach(() => {
    process.env = { ...ORIGINAL_ENV };
  });

  afterEach(() => {
    process.env = ORIGINAL_ENV;
  });

  it("should parse a valid integer", () => {
    process.env.PORT = "3000";
    expect(envNumber("PORT")).toBe(3000);
  });

  it("should parse a valid float", () => {
    process.env.RATE = "0.75";
    expect(envNumber("RATE")).toBe(0.75);
  });

  it("should parse a negative number", () => {
    process.env.OFFSET = "-10";
    expect(envNumber("OFFSET")).toBe(-10);
  });

  it("should parse zero", () => {
    process.env.ZERO = "0";
    expect(envNumber("ZERO")).toBe(0);
  });

  it("should return null for a missing variable with no default", () => {
    delete process.env.MISSING_VAR;
    expect(envNumber("MISSING_VAR")).toBeNull();
  });

  it("should return the default for a missing variable", () => {
    delete process.env.MISSING_VAR;
    expect(envNumber("MISSING_VAR", 42)).toBe(42);
  });

  it("should return the default for an empty string variable", () => {
    process.env.EMPTY_VAR = "";
    expect(envNumber("EMPTY_VAR", 99)).toBe(99);
  });

  it("should return the default for a non-numeric value", () => {
    process.env.BAD_NUM = "not-a-number";
    expect(envNumber("BAD_NUM", 100)).toBe(100);
  });

  it("should return null for a non-numeric value with no default", () => {
    process.env.BAD_NUM = "abc";
    expect(envNumber("BAD_NUM")).toBeNull();
  });

  it("should parse scientific notation", () => {
    process.env.SCI = "1e3";
    expect(envNumber("SCI")).toBe(1000);
  });
});
