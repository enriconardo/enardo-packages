import { expect } from "vitest";
import { NetworkError } from "~/index";
import type { NetworkErrorCause } from "~/index";

// The helpers of the NetworkError tests, shared by network-error.test.ts
// and network-error.node.test.ts. A page loads this module: it imports
// nothing from node:*.

// A marker in each part of the URL that must not come out of the error.
export const MARKED_URL =
  "https://alice:hunter2@api.example.com/v1/users?token=q-secret#frag-secret";

export const buildError = (cause: unknown): NetworkError =>
  new NetworkError("POST", new URL(MARKED_URL), { cause });

/**
 * Builds the error as `buildError` does, after checking that the constructor
 * does not throw: a read of the rejection that throws counts as missing.
 */
export function buildErrorWithoutThrowing(cause: unknown): NetworkError {
  // A holder, not a `let`: the compiler does not see the assignment in the
  // callback, and would narrow a `let` to undefined.
  const built: { error?: NetworkError } = {};
  expect(() => {
    built.error = buildError(cause);
  }).not.toThrow();
  if (built.error === undefined) {
    throw new Error("Expected new NetworkError() to return an error");
  }
  return built.error;
}

// The rejections of Node's fetch, as probed: the own fields are set the way
// Node sets them, own and enumerable. Each `create` gives a fresh instance.
export const SHAPES: {
  shape: string;
  create: () => Error;
  chain: NetworkErrorCause;
}[] = [
  {
    shape: "credentials",
    create: () =>
      new TypeError(
        "Request cannot be constructed from a URL that includes credentials: https://alice:hunter2@api.example.com/v1/users?token=q-secret",
      ),
    chain: { name: "TypeError" },
  },
  {
    shape: "bad Location",
    create: () =>
      new TypeError("fetch failed", {
        cause: Object.assign(new TypeError("Invalid URL"), {
          code: "ERR_INVALID_URL",
          input: "http://exa mple.com/",
          base: "https://api.example.com/bad?hop-secret=1#hop-frag-secret",
        }),
      }),
    chain: {
      name: "TypeError",
      cause: { name: "TypeError", code: "ERR_INVALID_URL" },
    },
  },
  {
    shape: "malformed response",
    create: () =>
      new TypeError("fetch failed", {
        cause: Object.assign(
          new Error(
            "Response does not match the HTTP/1.1 protocol (Invalid header token)",
          ),
          {
            name: "HTTPParserError",
            code: undefined,
            data: " : a\r\nSet-Cookie: sid=cookie-secret\r\n\r\nbody-secret",
          },
        ),
      }),
    chain: { name: "TypeError", cause: { name: "HTTPParserError" } },
  },
  {
    shape: "responseError",
    create: () =>
      new TypeError("fetch failed", {
        cause: Object.assign(new Error("Response Error"), {
          name: "ResponseError",
          code: "UND_ERR_RESPONSE",
          statusCode: 500,
          headers: { "set-cookie": "sid=header-secret" },
          body: { token: "body-secret" },
        }),
      }),
    chain: {
      name: "TypeError",
      cause: { name: "ResponseError", code: "UND_ERR_RESPONSE" },
    },
  },
  {
    shape: "refused",
    create: () =>
      new TypeError("fetch failed", {
        cause: Object.assign(new Error("connect ECONNREFUSED 10.0.0.1:443"), {
          errno: -111,
          code: "ECONNREFUSED",
          syscall: "connect",
          address: "10.0.0.1",
          port: 443,
        }),
      }),
    chain: {
      name: "TypeError",
      cause: { name: "Error", code: "ECONNREFUSED" },
    },
  },
];
