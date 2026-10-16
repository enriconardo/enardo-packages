import { describe, expect, it } from "vitest";
import { TimeoutError } from "~/index";

// The test of the stack of TimeoutError runs on Node only: a
// first line of `Name: message` is V8's format, and a Firefox or WebKit
// stack starts with its first frame. The others are in
// timeout-error.test.ts, which runs in browsers too.

// A marker in each part of the URL that must not come out of the error.
const MARKED_URL =
  "https://alice:hunter2@api.example.com/v1/users?token=q-secret#frag-secret";
const REDUCED_URL = "https://api.example.com/v1/users";

const firstLineOf = (stack: string | undefined): string | undefined =>
  stack?.split("\n")[0];

const buildError = (): TimeoutError =>
  new TimeoutError("GET", new URL(MARKED_URL), 5000);

describe("TimeoutError", () => {
  it('is named "TimeoutError", and its stack starts with the method, the reduced URL and the timeout', () => {
    const error = buildError();

    expect(error.name).toBe("TimeoutError");
    expect(error.message).toBe(`GET ${REDUCED_URL} timed out after 5000 ms`);
    expect(firstLineOf(error.stack)).toBe(
      `TimeoutError: GET ${REDUCED_URL} timed out after 5000 ms`,
    );
  });
});
