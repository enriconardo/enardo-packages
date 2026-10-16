import { BaseError } from "@enardo/errors";
import type { HttpMethod } from "../http-client.types";
import { redactUrl } from "../utils";

/**
 * The timeout passed before the request settled: before a response arrived,
 * or, with `throwOnError`, before its error body was read.
 *
 * `details` holds the method, the URL and the timeout. The URL keeps its
 * origin and path only: no credentials, query string or fragment.
 *
 * @example
 * ```ts
 * try {
 *   await client.get("/users", { timeout: 5_000 });
 * } catch (error) {
 *   if (error instanceof TimeoutError) {
 *     // error.details.timeout === 5000
 *   }
 *   throw error;
 * }
 * ```
 */
export class TimeoutError extends BaseError {
  override readonly name = "TimeoutError";

  declare readonly code: "TIMEOUT_ERROR";

  declare readonly details: {
    readonly method: HttpMethod;
    /** The request's URL, without credentials, query string or fragment. */
    readonly url: string;
    /** The timeout that passed, in milliseconds. */
    readonly timeout: number;
  };

  /**
   * @param method - The request's method.
   * @param url - The request's URL; only its origin and path are kept.
   * @param timeout - The timeout that passed, in milliseconds.
   */
  constructor(method: HttpMethod, url: URL, timeout: number) {
    const redactedUrl = redactUrl(url);

    super(`${method} ${redactedUrl} timed out after ${timeout} ms`, {
      code: "TIMEOUT_ERROR",
      details: { method, url: redactedUrl, timeout },
    });
  }
}
