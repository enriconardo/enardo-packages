import type { HeadersInput } from "./header";

/** The methods `HttpClient` sends. */
export type HttpMethod =
  "GET" | "POST" | "PUT" | "DELETE" | "PATCH" | "HEAD" | "OPTIONS";

/** Options of the `HttpClient` constructor. */
export interface HttpClientOptions {
  /**
   * The base of a string resource, which is a path under it: `/users` and
   * `users` against `https://api.example.com/v2` or `…/v2/` both give
   * `https://api.example.com/v2/users`. A `URL` resource is used as it is.
   *
   * An absolute `http` or `https` URL, without credentials, query string or
   * fragment; otherwise the constructor throws a `TypeError`. The client
   * keeps a copy.
   */
  baseUrl?: string | URL;
  /**
   * Sends the requests; the global `fetch` by default. Pass another fetch
   * implementation, or a wrapper, to set Node transport options such as an
   * undici `dispatcher`.
   */
  fetchImpl?: FetchImpl;
  /**
   * The timeout of every request, in milliseconds: an integer from 1 to
   * 2147483647, or `false` for none; otherwise the constructor throws a
   * `TypeError`. A request's own `timeout` wins over it.
   *
   * It covers what `request()` waits for: the response, and with
   * `throwOnError` the error body. Not the body read from a returned
   * response: a `signal` covers that.
   *
   * @default 30_000
   */
  timeout?: number | false;
}

// Not `BodyInit`: only the DOM lib declares it. A Node consumer without the
// DOM lib would see it unresolved, and `skipLibCheck` turns it into `any`.
// `RequestInit` is a global in both runtimes.
export type HttpBody = NonNullable<RequestInit["body"]>;

/**
 * What `HttpClient` calls to send a request: the global `fetch`, another
 * fetch implementation, or a function over one. It is always called with a
 * `URL` and a {@link FetchInit}, never with a `Request`, which another
 * implementation (npm `undici`) does not recognize.
 *
 * @example
 * ```ts
 * import { Agent, fetch } from "undici";
 *
 * const dispatcher = new Agent({ connect: { timeout: 5_000 } });
 * const client = new HttpClient({
 *   fetchImpl: (url, init) => fetch(url, { ...init, dispatcher }),
 * });
 * ```
 */
export type FetchImpl = (url: URL, init: FetchInit) => Promise<Response>;

/**
 * The init `HttpClient` passes to its {@link FetchImpl}, and nothing else:
 * extending `RequestInit` would bring in, under the Node types, undici's
 * `dispatcher`, whose type differs between undici versions.
 */
export interface FetchInit {
  method: HttpMethod;
  headers: Headers;
  body?: HttpBody;
  /**
   * `"half"` for a stream body, which fetch requires for it; absent
   * otherwise. The DOM lib's `RequestInit` does not declare it.
   */
  duplex?: "half";
  /**
   * Present when the request has a signal or a timeout. It aborts when the
   * caller's signal does, with its reason, or when the timeout passes, with
   * the `TimeoutError` the request rejects with.
   */
  signal?: AbortSignal;
}

/** A query-string value: an array repeats the key, null and undefined leave it out. */
export type QueryValue =
  | string
  | number
  | boolean
  | null
  | undefined
  | readonly (string | number | boolean)[];

/** Options of a request. */
export interface RequestOptions {
  /** Defaults to `POST` when there is a body, `GET` otherwise. */
  method?: HttpMethod;
  headers?: HeadersInput;
  /**
   * A stream body (a `ReadableStream`, or on Node an async iterable of
   * `Uint8Array`) is sent with `duplex: "half"`, which fetch requires for
   * it. Any other body is passed to fetch as it is. `GET` and `HEAD` take
   * none: the request throws a `TypeError`, an empty body included.
   */
  body?: HttpBody | null;
  /** Added to the URL's query string. */
  query?: Record<string, QueryValue>;
  /**
   * When `true`, a response with a status in 400–599 is not returned: the
   * client reads its body, up to 1 MiB, and throws an `HttpResponseError`.
   *
   * @default false
   */
  throwOnError?: boolean;
  /**
   * Aborts the request: it rejects with the signal's `reason`, as it is,
   * whether `fetchImpl` honors the signal or not. It also aborts the read of
   * the body of the returned response, when `fetchImpl` passes `init.signal`
   * on to `fetch`, as the default one does.
   */
  signal?: AbortSignal;
  /**
   * The timeout of this request, in milliseconds: an integer from 1 to
   * 2147483647, or `false` for none; otherwise the request rejects with a
   * `TypeError`. When it passes, the request rejects with a `TimeoutError`.
   * Without it, the client's applies.
   */
  timeout?: number | false;
}
