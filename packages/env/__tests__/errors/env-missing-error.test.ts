import { describe, expect, it } from "vitest";
import { BaseError } from "@enardo/errors";
import { createEnv, EnvMalformedError, EnvMissingError } from "~/index";

// These tests run on Node and in browsers. The errors are built through the
// readers, the only way the package builds them.

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

const missingBy = (run: () => unknown): EnvMissingError => {
  const error = thrownBy(run);
  expect(error).toBeInstanceOf(EnvMissingError);
  return error as EnvMissingError;
};

const build = (): EnvMissingError =>
  missingBy(() => createEnv({}).requireString(KEY));

describe("EnvMissingError", () => {
  it("is an EnvMissingError, a BaseError and an Error, not an EnvMalformedError", () => {
    const error = build();

    expect(error).toBeInstanceOf(EnvMissingError);
    expect(error).toBeInstanceOf(BaseError);
    expect(error).toBeInstanceOf(Error);
    expect(error).not.toBeInstanceOf(EnvMalformedError);
  });

  it('has the name "EnvMissingError"', () => {
    expect(build().name).toBe("EnvMissingError");
  });

  it("has the code ENV_MISSING and exactly the key in details", () => {
    const error = build();

    expect(error.code).toBe("ENV_MISSING");
    expect(error.details).toStrictEqual({ key: KEY });
  });

  it("names the key in its message", () => {
    expect(build().message).toContain(KEY);
  });

  it("has no cause", () => {
    expect(build().cause).toBeUndefined();
  });
});
