import { describe, expect, it } from "vitest";
import { BaseError } from "@enardo/errors";
import { createEnv, EnvMalformedError, EnvMissingError } from "~/index";

// These tests run on Node and in browsers. The errors are built through the
// readers, the only way the package builds them.

const SECRET = "s3cr3t-value";
const KEY = "API_TOKEN";

/** Runs `run` and returns what it throws; fails the test if it returns. */
const thrownBy = (run: () => unknown): unknown => {
  try {
    run();
  } catch (error) {
    return error;
  }
  throw new Error("expected the call to throw, it returned");
};

const malformedBy = (run: () => unknown): EnvMalformedError => {
  const error = thrownBy(run);
  expect(error).toBeInstanceOf(EnvMalformedError);
  return error as EnvMalformedError;
};

// A value that is not a string, but whose `String()` is the secret.
const secretObject = { toString: (): string => SECRET };

const CASES = [
  {
    name: "a malformed number",
    expected: "number",
    value: SECRET,
    read: (source: Record<string, unknown>) => createEnv(source).number(KEY),
  },
  {
    name: "a malformed required number",
    expected: "number",
    value: SECRET,
    read: (source: Record<string, unknown>) =>
      createEnv(source).requireNumber(KEY),
  },
  {
    name: "a malformed boolean",
    expected: "boolean",
    value: SECRET,
    read: (source: Record<string, unknown>) => createEnv(source).bool(KEY),
  },
  {
    name: "a malformed required boolean",
    expected: "boolean",
    value: SECRET,
    read: (source: Record<string, unknown>) =>
      createEnv(source).requireBool(KEY),
  },
  {
    name: "a malformed string",
    expected: "string",
    value: secretObject,
    read: (source: Record<string, unknown>) => createEnv(source).string(KEY),
  },
  {
    name: "a malformed required string",
    expected: "string",
    value: secretObject,
    read: (source: Record<string, unknown>) =>
      createEnv(source).requireString(KEY),
  },
] as const;

describe("EnvMalformedError", () => {
  describe.each(CASES)("on $name", ({ expected, value, read }) => {
    const build = (): EnvMalformedError =>
      malformedBy(() => read({ [KEY]: value }));

    it("has the code ENV_MALFORMED and exactly the key and the expected type in details", () => {
      const error = build();

      expect(error.code).toBe("ENV_MALFORMED");
      expect(error.details).toStrictEqual({ key: KEY, expected });
    });

    it("never holds the value, in its message, details or JSON", () => {
      const error = build();

      expect(error.message).not.toContain(SECRET);
      expect(JSON.stringify(error.details)).not.toContain(SECRET);
      expect(JSON.stringify(error)).not.toContain(SECRET);
    });

    it("has no cause", () => {
      expect(build().cause).toBeUndefined();
    });

    it("names the key in its message", () => {
      expect(build().message).toContain(KEY);
    });
  });

  it("is an EnvMalformedError, a BaseError and an Error, not an EnvMissingError", () => {
    const error = malformedBy(() => createEnv({ A: "x" }).number("A"));

    expect(error).toBeInstanceOf(EnvMalformedError);
    expect(error).toBeInstanceOf(BaseError);
    expect(error).toBeInstanceOf(Error);
    expect(error).not.toBeInstanceOf(EnvMissingError);
  });

  it('has the name "EnvMalformedError"', () => {
    const error = malformedBy(() => createEnv({ A: "x" }).number("A"));

    expect(error.name).toBe("EnvMalformedError");
  });
});
