import { describe, expect, expectTypeOf, it } from "vitest";
import * as entryPoint from "~/index";
import type {
  FetchImpl,
  FetchInit,
  HeadersInput,
  HeadersInputIterable,
  HeadersInputRecord,
  HttpClientOptions,
  HttpMethod,
  Logger,
  LoggerMetadata,
  NetworkErrorCause,
  QueryValue,
  RequestOptions,
} from "~/index";
// @ts-expect-error HttpBody stays internal: decision 4 of fix/http/runtime-neutral-types
import type { HttpBody } from "~/index";
// @ts-expect-error HttpResponseOptions leaves the package with HttpResponse: decision 3 of feature/http/client-errors
import type { HttpResponseOptions } from "~/index";

describe("entry point", () => {
  it("exports exactly HttpClient, HttpResponseError, NetworkError and TimeoutError at runtime", () => {
    expect(Object.keys(entryPoint).sort()).toEqual(
      [
        "HttpClient",
        "HttpResponseError",
        "NetworkError",
        "TimeoutError",
      ].sort(),
    );
  });

  it("exports the public types", () => {
    // Enforced by `typecheck`: an import of a name the module does not
    // export fails, and the name resolves to `any`.
    expectTypeOf<HttpMethod>().not.toBeAny();
    expectTypeOf<HttpClientOptions>().not.toBeAny();
    expectTypeOf<RequestOptions>().not.toBeAny();
    expectTypeOf<QueryValue>().not.toBeAny();
    expectTypeOf<HeadersInput>().not.toBeAny();
    expectTypeOf<HeadersInputRecord>().not.toBeAny();
    expectTypeOf<HeadersInputIterable>().not.toBeAny();
    expectTypeOf<Logger>().not.toBeAny();
    expectTypeOf<LoggerMetadata>().not.toBeAny();
    expectTypeOf<FetchImpl>().not.toBeAny();
    expectTypeOf<FetchInit>().not.toBeAny();
    expectTypeOf<NetworkErrorCause>().not.toBeAny();
  });

  it("does not export HttpBody", () => {
    // Enforced by `typecheck` through the `@ts-expect-error` on the import:
    // a name the module does not export resolves to `any`.
    expectTypeOf<HttpBody>().toBeAny();
  });

  it("does not export HttpResponseOptions", () => {
    // Enforced by `typecheck` through the `@ts-expect-error` on the import:
    // a name the module does not export resolves to `any`.
    expectTypeOf<HttpResponseOptions>().toBeAny();
  });
});
