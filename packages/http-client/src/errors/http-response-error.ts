import { BaseError } from "@enardo/errors";
import type { HttpMethod } from "../http-client.types";
import { redactUrl } from "../utils";

/**
 * A response arrived, with a status the caller asked to treat as an error
 * (`throwOnError`).
 *
 * `details` holds the method, the URL and the status. The URL keeps its
 * origin and path only: no credentials, query string or fragment.
 *
 * `headers` and `body` are not enumerable, so `toJSON()` and any serializer
 * that enumerates own keys leave them out of the logs.
 *
 * @example
 * ```ts
 * try {
 *   await client.get(`/users/${id}`, { throwOnError: true });
 * } catch (error) {
 *   if (error instanceof HttpResponseError && error.details.status === 404) {
 *     throw new UserNotFoundError(id, { cause: error });
 *   }
 *   throw error;
 * }
 * ```
 */
export class HttpResponseError extends BaseError {
  override readonly name = "HttpResponseError";

  declare readonly code: "HTTP_RESPONSE_ERROR";

  declare readonly details: {
    readonly method: HttpMethod;
    /** The request's URL, without credentials, query string or fragment. */
    readonly url: string;
    readonly status: number;
  };

  /** The response's headers. Not enumerable. */
  declare readonly headers: Headers;

  /**
   * The response's body: the parsed value when it is JSON, the text
   * otherwise, `undefined` when it is empty or could not be read. Not
   * enumerable.
   */
  declare readonly body: unknown;

  /**
   * @param method - The request's method.
   * @param url - The request's URL; only its origin and path are kept.
   * @param response - The response's status, and its headers (default: none)
   *   and body (default: `undefined`).
   */
  constructor(
    method: HttpMethod,
    url: URL,
    response: { status: number; headers?: Headers; body?: unknown },
  ) {
    const redactedUrl = redactUrl(url);

    super(`Status ${response.status} in response to ${method} ${redactedUrl}`, {
      code: "HTTP_RESPONSE_ERROR",
      details: { method, url: redactedUrl, status: response.status },
    });

    // Not enumerable, so they stay out of the logs. Not writable either,
    // like the readonly fields.
    Object.defineProperties(this, {
      headers: { value: response.headers ?? new Headers() },
      body: { value: response.body },
    });
  }
}
