import { describe, expect, it } from "vitest";
import { HttpResponseError } from "~/index";

// The test of the stack of HttpResponseError runs on Node only: a
// first line of `Name: message` is V8's format, and a Firefox or WebKit
// stack starts with its first frame. The others are in
// http-response-error.test.ts, which runs in browsers too.

// A marker in each part of the URL that must not come out of the error.
const MARKED_URL =
  "https://alice:hunter2@api.example.com/v1/users?token=q-secret#frag-secret";
const REDUCED_URL = "https://api.example.com/v1/users";

const firstLineOf = (stack: string | undefined): string | undefined =>
  stack?.split("\n")[0];

const buildError = (): HttpResponseError =>
  new HttpResponseError("GET", new URL(MARKED_URL), {
    status: 404,
    headers: new Headers({ "x-header": "header-secret" }),
    body: { error: "body-secret" },
  });

describe("HttpResponseError", () => {
  it('is named "HttpResponseError", and its stack starts with the status, the method and the reduced URL', () => {
    const error = buildError();

    expect(error.name).toBe("HttpResponseError");
    expect(error.message).toBe(`Status 404 in response to GET ${REDUCED_URL}`);
    expect(firstLineOf(error.stack)).toBe(
      `HttpResponseError: Status 404 in response to GET ${REDUCED_URL}`,
    );
  });
});
