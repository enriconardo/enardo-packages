import { describe, expect, expectTypeOf, it } from "vitest";
import { BaseError } from "@enardo/errors";
import { HttpResponseError, NetworkError, TimeoutError } from "~/index";
import type { HttpMethod } from "~/index";

// These tests run on Node and in browsers. A test that needs Node (V8's
// stack) goes in timeout-error.node.test.ts.

// A marker in each part of the URL that must not come out of the error.
const MARKED_URL =
  "https://alice:hunter2@api.example.com/v1/users?token=q-secret#frag-secret";
const REDUCED_URL = "https://api.example.com/v1/users";

const MARKERS = ["alice", "hunter2", "q-secret", "frag-secret"];

/** Hands `run` to the compiler without running it. */
const compileOnly = (run: () => unknown): void => {
  expectTypeOf(run).toBeFunction();
};

const buildError = (): TimeoutError =>
  new TimeoutError("GET", new URL(MARKED_URL), 5000);

describe("TimeoutError", () => {
  it("is a TimeoutError, a BaseError and an Error, and neither a NetworkError nor an HttpResponseError", () => {
    const error = buildError();

    expect(error).toBeInstanceOf(TimeoutError);
    expect(error).toBeInstanceOf(BaseError);
    expect(error).toBeInstanceOf(Error);
    expect(error).not.toBeInstanceOf(NetworkError);
    expect(error).not.toBeInstanceOf(HttpResponseError);
  });

  it("has the code TIMEOUT_ERROR, typed as that literal", () => {
    const error = buildError();

    expect(error.code).toBe("TIMEOUT_ERROR");
    // Read in type position: `expectTypeOf(error.code)` would widen a literal.
    expectTypeOf<TimeoutError["code"]>().toEqualTypeOf<"TIMEOUT_ERROR">();
  });

  it("has the method, the reduced URL and the timeout in details", () => {
    const error = buildError();

    expect(error.details).toEqual({
      method: "GET",
      url: REDUCED_URL,
      timeout: 5000,
    });
  });

  // The timeout is the client's own: there is no error underneath to keep.
  it("has no cause, only code, details and name as own keys, and no marker in its JSON", () => {
    const error = buildError();

    expect(error.cause).toBeUndefined();
    // `name` is an own field, as in every BaseError subclass.
    expect(Object.keys(error).sort()).toEqual(
      ["code", "details", "name"].sort(),
    );

    const json = JSON.stringify(error);
    for (const marker of MARKERS) {
      expect(json, marker).not.toContain(marker);
    }
  });

  it("types details as the readonly method, URL and timeout, and makes it readonly", () => {
    const error = buildError();
    const other = buildError();

    expectTypeOf<TimeoutError["details"]>().toEqualTypeOf<{
      readonly method: HttpMethod;
      readonly url: string;
      readonly timeout: number;
    }>();
    // The assignment takes the value of the same property of another
    // instance, so that readonly is the only error the compiler can report.
    compileOnly(() => {
      // @ts-expect-error details is readonly
      error.details = other.details;
    });
  });
});
