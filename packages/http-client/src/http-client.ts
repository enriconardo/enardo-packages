import { isErrorStatus } from "@enardo/http-status";
import type {
  FetchImpl,
  FetchInit,
  HttpBody,
  HttpClientOptions,
  HttpMethod,
  QueryValue,
  RequestOptions,
} from "./http-client.types";
import { HttpResponseError, NetworkError, TimeoutError } from "./errors";
import { Deadline, toTimeout } from "./deadline";
import type { EarlyEnd } from "./deadline";
import {
  hasCredentials,
  isStreamBody,
  redactUrl,
  toBasePrefix,
  toHeaders,
} from "./utils";
import type { Logger } from "./logger";
import { createNoopLogger, withLoggerContext } from "./logger";

const DEFAULT_TIMEOUT = 30_000;

/**
 * HTTP client over the Fetch API, for browsers and Node alike.
 *
 * A response is returned whatever its status, unless the request sets
 * `throwOnError`. Each request logs once, by outcome.
 *
 * @throws {TypeError} From the constructor, when it cannot use `baseUrl` (see
 *   {@link HttpClientOptions.baseUrl}) or `timeout`.
 * @throws {TypeError} From a request, when the URL, the headers or the
 *   timeout cannot be used, the URL has credentials, or a `GET` or `HEAD`
 *   request has a body: no request is made, and nothing is logged.
 * @throws {NetworkError} When no response arrives: the fetch implementation
 *   rejected, and the `cause` is its rejection, reduced to names and codes.
 * @throws {HttpResponseError} With `throwOnError`, when the status is in
 *   400–599.
 * @throws {TimeoutError} When the timeout passes before the request settles:
 *   30 s by default.
 * @throws The `reason` of the request's `signal`, as it is, when it aborts.
 */
export class HttpClient {
  // The origin and the path of baseUrl, with one trailing "/" dropped: a
  // copy, so a URL the caller changes later changes nothing.
  private readonly basePrefix: string | undefined;
  private fetchImpl: FetchImpl;
  private readonly logger: Logger;
  private readonly timeout: number | false;

  constructor(options: HttpClientOptions = {}) {
    this.basePrefix =
      options.baseUrl === undefined ? undefined : toBasePrefix(options.baseUrl);
    this.timeout =
      options.timeout === undefined
        ? DEFAULT_TIMEOUT
        : toTimeout(options.timeout);
    this.fetchImpl = options.fetchImpl ?? globalThis.fetch;

    // No baseUrl in the context: every log carries the request's URL.
    this.logger = withLoggerContext(
      options.logger ?? createNoopLogger(),
      "HttpClient",
    );

    if (!this.fetchImpl) {
      throw new Error(
        "Fetch API not available. Provide fetchImpl or use an environment with global fetch (e.g. browsers or Node 18+).",
      );
    }
  }

  /**
   * Joins a string to the base as a path, when there is a base. A `URL`, or a
   * string without a base, is copied as it is.
   *
   * @throws {TypeError} If the URL is invalid, or has credentials.
   */
  private makeUrl(resource: string | URL): URL {
    // After "<origin>/" the parser reads a path: nothing in the resource can
    // change the origin, though dot segments can climb above the base's path.
    const url =
      typeof resource === "string" && this.basePrefix !== undefined
        ? new URL(`${this.basePrefix}/${resource.replace(/^\//, "")}`)
        : new URL(resource);

    // Node's fetch rejects it with the URL in its message.
    if (hasCredentials(url)) {
      throw new TypeError("Expected a request URL without credentials");
    }

    return url;
  }

  private applyQuery(url: URL, query?: Record<string, QueryValue>): void {
    if (!query) return;

    for (const [key, value] of Object.entries(query)) {
      if (value === undefined || value === null) continue;

      if (Array.isArray(value)) {
        value.forEach((item) => url.searchParams.append(key, String(item)));
      } else {
        url.searchParams.set(key, String(value));
      }
    }
  }

  /**
   * Sends a request. The method defaults to `POST` when there is a body,
   * `GET` otherwise.
   *
   * @param resource - With a `baseUrl`, a string is a path under it, and a
   *   `URL` is used as it is. Without one, an absolute URL.
   * @returns The `Response` the fetch implementation resolved with, unread,
   *   whatever its status unless `throwOnError` is set.
   */
  public async request(
    resource: string | URL,
    options: RequestOptions = {},
  ): Promise<Response> {
    const {
      method: requestMethod,
      headers: requestHeaders,
      body: requestBody,
      query: requestQuery,
      throwOnError = false,
      signal,
      timeout: requestTimeout,
    } = options;

    const method = requestMethod ?? (requestBody != null ? "POST" : "GET");

    // Checked and built before anything is sent: an invalid timeout, URL or
    // header, a URL with credentials, or a body with GET or HEAD, is the
    // caller's error, and reaches it as a TypeError, not as a NetworkError.
    const timeout =
      requestTimeout === undefined ? this.timeout : toTimeout(requestTimeout);
    const url = this.makeUrl(resource);
    this.applyQuery(url, requestQuery);

    const init: FetchInit = {
      method,
      headers: toHeaders(requestHeaders),
      body: requestBody ?? undefined,
    };

    // Only a stream gets `duplex`: every other init stays as it was.
    if (requestBody != null && isStreamBody(requestBody)) {
      init.duplex = "half";
    }

    // fetch rejects it with a TypeError that has no `code`, which would reach
    // the caller as a NetworkError that does not say why. A fetchImpl that is
    // not fetch could send it, so the rule holds for every one.
    if (requestBody != null && (method === "GET" || method === "HEAD")) {
      throw new TypeError("Expected no body with GET or HEAD");
    }

    const loggedUrl = redactUrl(url);

    // After the caller's errors, which come first. fetch would send nothing
    // either; a fetchImpl that ignores the signal would.
    if (signal?.aborted) {
      throw this.endedEarly(
        { by: "signal", reason: signal.reason },
        method,
        loggedUrl,
      );
    }

    const deadline = new Deadline(
      signal,
      timeout,
      (ms) => new TimeoutError(method, url, ms),
    );
    // Only with a signal or a timeout: every other init stays as it was.
    if (deadline.signal !== undefined) {
      init.signal = deadline.signal;
    }

    try {
      const sent = await deadline.race(
        () => this.fetchImpl.call(globalThis, url, init),
        cancelBody,
      );

      if (sent.status === "ended") {
        throw this.endedEarly(sent.end, method, loggedUrl);
      }

      if (sent.status === "rejected") {
        const error = new NetworkError(method, url, { cause: sent.reason });
        this.logger.warn("HTTP request got no response.", {
          method,
          url: loggedUrl,
          error,
        });
        throw error;
      }

      const res = sent.value;

      if (throwOnError && isErrorStatus(res.status)) {
        // readBody never rejects: only the deadline ends the read early, and
        // cancels it.
        const read = await deadline.race(() => readBody(res, deadline.signal));
        if (read.status === "ended") {
          throw this.endedEarly(read.end, method, loggedUrl);
        }

        const error = new HttpResponseError(method, url, {
          status: res.status,
          headers: res.headers,
          body: read.status === "fulfilled" ? read.value : undefined,
        });
        this.logger.warn("HTTP response with an error status.", {
          method,
          url: loggedUrl,
          status: res.status,
          error,
        });
        throw error;
      }

      this.logger.debug("HTTP response received.", {
        method,
        url: loggedUrl,
        status: res.status,
      });

      // As fetch gave it: wrapping it would lose its `url`, `redirected` and
      // `type`.
      return res;
    } finally {
      // The body of a returned response is not covered: the caller's signal
      // is, through init.signal.
      deadline.end();
    }
  }

  /**
   * Logs a request that the timeout or the caller's signal ended, and gives
   * what it rejects with. The reason is the caller's: handed back as it is,
   * never read and never logged.
   */
  private endedEarly(end: EarlyEnd, method: HttpMethod, url: string): unknown {
    if (end.by === "timeout") {
      this.logger.warn("HTTP request timed out.", {
        method,
        url,
        timeout: end.error.details.timeout,
        error: end.error,
      });
      return end.error;
    }

    this.logger.debug("HTTP request aborted.", { method, url });
    return end.reason;
  }

  /** Sends a `GET` request. See {@link HttpClient.request}. */
  public async get(
    resource: string | URL,
    options: Omit<RequestOptions, "method" | "body"> = {},
  ): Promise<Response> {
    return this.request(resource, { ...options, method: "GET" });
  }

  /** Sends a `POST` request. See {@link HttpClient.request}. */
  public async post(
    resource: string | URL,
    body?: HttpBody | null,
    options: Omit<RequestOptions, "method" | "body"> = {},
  ): Promise<Response> {
    return this.request(resource, { ...options, method: "POST", body });
  }

  /** Sends a `PUT` request. See {@link HttpClient.request}. */
  public async put(
    resource: string | URL,
    body?: HttpBody | null,
    options: Omit<RequestOptions, "method" | "body"> = {},
  ): Promise<Response> {
    return this.request(resource, { ...options, method: "PUT", body });
  }

  /** Sends a `PATCH` request. See {@link HttpClient.request}. */
  public async patch(
    resource: string | URL,
    body?: HttpBody | null,
    options: Omit<RequestOptions, "method" | "body"> = {},
  ): Promise<Response> {
    return this.request(resource, { ...options, method: "PATCH", body });
  }

  /** Sends a `DELETE` request. See {@link HttpClient.request}. */
  public async delete(
    resource: string | URL,
    options: Omit<RequestOptions, "method" | "body"> = {},
  ): Promise<Response> {
    return this.request(resource, { ...options, method: "DELETE" });
  }

  /** Sends a `HEAD` request. See {@link HttpClient.request}. */
  public async head(
    resource: string | URL,
    options: Omit<RequestOptions, "method" | "body"> = {},
  ): Promise<Response> {
    return this.request(resource, { ...options, method: "HEAD" });
  }

  /** Sends an `OPTIONS` request. See {@link HttpClient.request}. */
  public async options(
    resource: string | URL,
    options: Omit<RequestOptions, "method" | "body"> = {},
  ): Promise<Response> {
    return this.request(resource, { ...options, method: "OPTIONS" });
  }
}

/**
 * A response that arrives after the request ended is never read: its body is
 * cancelled, so that it releases its connection. Recognized by its shape, a
 * `body` with a `cancel` method: the `Response` of npm `undici` is another
 * class than the global one. The value comes from fetchImpl: a read that
 * throws is dropped by `Deadline.race`, a failed cancel by `cancelQuietly`.
 */
function cancelBody(value: unknown): void {
  if (typeof value !== "object" || value === null || !("body" in value)) {
    return;
  }

  const body = value.body;
  if (typeof body !== "object" || body === null || !("cancel" in body)) {
    return;
  }

  // Read once: a getter could give another value the second time.
  const cancel = body.cancel;
  if (typeof cancel === "function") {
    cancelQuietly(() => cancel.call(body));
  }
}

/**
 * Calls a `cancel` of a body or a reader that came from fetchImpl. A throw,
 * a rejection, or a result that is not a promise is dropped: the request has
 * settled, or is settling, with its own outcome. In an `abort` listener, Node
 * would rethrow an error as an `uncaughtException`.
 */
function cancelQuietly(cancel: () => unknown): void {
  try {
    Promise.resolve(cancel()).catch(() => undefined);
  } catch {
    // Dropped, as above.
  }
}

/**
 * The body of an error response: the parsed value when it is JSON, the text
 * otherwise, `undefined` when it is empty or cannot be read. Reading it
 * releases the connection, which an unread body would hold.
 */
async function readBody(
  response: Response,
  signal: AbortSignal | undefined,
): Promise<unknown> {
  let text: string;
  try {
    text = await readText(response, signal);
  } catch {
    return undefined;
  }

  if (text === "") return undefined;

  try {
    return JSON.parse(text) as unknown;
  } catch {
    return text;
  }
}

/**
 * The body as text, decoded as `response.text()` does: UTF-8, a leading BOM
 * dropped. Read through a reader of the client's own, which `signal`
 * cancels: `text()` would hold the stream's lock, and nothing could stop a
 * read that the request no longer waits for, from a fetchImpl that ignores
 * the signal. A body that is not a web stream, from another fetch
 * implementation, is read with `text()`, which nothing can cancel.
 */
async function readText(
  response: Response,
  signal: AbortSignal | undefined,
): Promise<string> {
  const body: unknown = response.body;
  // Read once: a getter could give another value the second time.
  const getReader =
    typeof body === "object" && body !== null && "getReader" in body
      ? body.getReader
      : undefined;
  if (typeof getReader !== "function") {
    return response.text();
  }

  const reader = getReader.call(
    body,
  ) as ReadableStreamDefaultReader<Uint8Array>;
  // With no reason: the caller's is never passed on.
  const cancel = (): void => {
    cancelQuietly(() => reader.cancel());
  };
  signal?.addEventListener("abort", cancel, { once: true });

  try {
    // Aborted between the response and this read: the race has ended.
    if (signal?.aborted) cancel();

    const decoder = new TextDecoder();
    let text = "";
    for (;;) {
      const { done, value } = await reader.read();
      if (done) return text + decoder.decode();
      text += decoder.decode(value, { stream: true });
    }
  } finally {
    signal?.removeEventListener("abort", cancel);
  }
}
