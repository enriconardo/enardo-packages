import { describe, expect, expectTypeOf, it } from "vitest";
import { BaseError } from "@enardo/errors";
import { HttpResponseError, NetworkError } from "~/index";

// These tests run on Node and in browsers. A test that needs Node (V8's
// stack) goes in http-response-error.node.test.ts.

// A marker in each part of the URL that must not come out of the error.
const MARKED_URL =
  "https://alice:hunter2@api.example.com/v1/users?token=q-secret#frag-secret";
const REDUCED_URL = "https://api.example.com/v1/users";

const MARKERS = [
  "alice",
  "hunter2",
  "q-secret",
  "frag-secret",
  "body-secret",
  "header-secret",
];

/** Hands `run` to the compiler without running it. */
const compileOnly = (run: () => unknown): void => {
  expectTypeOf(run).toBeFunction();
};

const buildError = (): HttpResponseError =>
  new HttpResponseError("GET", new URL(MARKED_URL), {
    status: 404,
    headers: new Headers({ "x-header": "header-secret" }),
    body: { error: "body-secret" },
  });

describe("HttpResponseError", () => {
  it("is an HttpResponseError, a BaseError and an Error, and not a NetworkError", () => {
    const error = buildError();

    expect(error).toBeInstanceOf(HttpResponseError);
    expect(error).toBeInstanceOf(BaseError);
    expect(error).toBeInstanceOf(Error);
    expect(error).not.toBeInstanceOf(NetworkError);
  });

  it("has the code HTTP_RESPONSE_ERROR, typed as that literal", () => {
    const error = buildError();

    expect(error.code).toBe("HTTP_RESPONSE_ERROR");
    // Read in type position: `expectTypeOf(error.code)` would widen a literal.
    expectTypeOf<
      HttpResponseError["code"]
    >().toEqualTypeOf<"HTTP_RESPONSE_ERROR">();
  });

  it("has the method, the reduced URL and the status in details", () => {
    const error = buildError();

    expect(error.details).toEqual({
      method: "GET",
      url: REDUCED_URL,
      status: 404,
    });
  });

  it("carries the response's headers and body", () => {
    const error = buildError();

    expect(error.headers.get("x-header")).toBe("header-secret");
    expect(error.body).toEqual({ error: "body-secret" });
  });

  it("keeps headers and body out of its own keys, and no marker reaches its JSON", () => {
    const error = buildError();

    // `name` is an own field, as in every BaseError subclass.
    expect(Object.keys(error).sort()).toEqual(
      ["code", "details", "name"].sort(),
    );

    const json = JSON.stringify(error);
    for (const marker of MARKERS) {
      expect(json, marker).not.toContain(marker);
    }
  });

  it("defaults to empty headers and an undefined body when given the status alone", () => {
    const error = new HttpResponseError("GET", new URL(MARKED_URL), {
      status: 500,
    });

    expect(error.headers).toBeInstanceOf(Headers);
    expect([...error.headers.entries()]).toEqual([]);
    expect(error.body).toBeUndefined();
  });

  it("makes headers, body and details readonly", () => {
    const error = buildError();
    const other = new HttpResponseError("GET", new URL(MARKED_URL), {
      status: 500,
    });

    // Each assignment takes the value of the same property of another
    // instance, so that readonly is the only error the compiler can report.
    compileOnly(() => {
      // @ts-expect-error headers is readonly
      error.headers = other.headers;
      // @ts-expect-error body is readonly
      error.body = other.body;
      // @ts-expect-error details is readonly
      error.details = other.details;
    });
  });
});
