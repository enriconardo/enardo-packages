import { BaseError } from "@enardo/errors";
import type { HttpMethod } from "../http-client.types";
import { redactUrl } from "../utils";

/**
 * What a `NetworkError` keeps of one error of the rejection's `cause` chain:
 * its `name`, and its `code` when it is a string. The message, the stack and
 * every other field are left out: they can hold URLs and raw response bytes.
 */
export interface NetworkErrorCause {
  readonly name: string;
  /** The error's `code`, when it is a string (`"ECONNREFUSED"`). */
  readonly code?: string;
  /** What the error's own `cause` reduces to, when it is an `Error`. */
  readonly cause?: NetworkErrorCause;
}

/**
 * No response arrived: the fetch implementation rejected or threw. Its
 * rejection is reduced into the `cause`, which says why (a refused
 * connection, a DNS failure) and nothing else.
 *
 * `details` holds the method and the URL. The URL keeps its origin and path
 * only: no credentials, query string or fragment.
 *
 * @example
 * ```ts
 * // On Node, a refused connection:
 * error.cause; // { name: "TypeError", cause: { name: "Error", code: "ECONNREFUSED" } }
 * ```
 */
export class NetworkError extends BaseError {
  override readonly name = "NetworkError";

  declare readonly code: "NETWORK_ERROR";

  declare readonly details: {
    readonly method: HttpMethod;
    /** The request's URL, without credentials, query string or fragment. */
    readonly url: string;
  };

  /**
   * The rejection, reduced to the `name` and string `code` of each error of
   * its `cause` chain, 10 links at most. `undefined` when the rejection is
   * not an `Error` of this realm with a string `name`.
   */
  declare readonly cause: NetworkErrorCause | undefined;

  /**
   * @param method - The request's method.
   * @param url - The request's URL; only its origin and path are kept.
   * @param options - `cause`: what the fetch implementation rejected with.
   *   Only its reduction is kept.
   */
  constructor(method: HttpMethod, url: URL, options?: ErrorOptions) {
    const redactedUrl = redactUrl(url);
    const cause = reduceCause(options?.cause);

    super(`No response to ${method} ${redactedUrl}`, {
      ...(cause === undefined ? {} : { cause }),
      code: "NETWORK_ERROR",
      details: { method, url: redactedUrl },
    });
  }
}

// Far more than any chain probed, which has two links: a longer one is cut,
// so that neither this recursion nor a serializer's can overflow the stack.
const MAX_LINKS = 10;

// The rejection is replaced, not left out of `toJSON()`: an error that wraps
// this one serializes its cause chain without calling `toJSON()`, and
// `util.inspect` prints it. A non-Error, an error with no string name, or an
// error already seen ends the chain.
function reduceCause(
  value: unknown,
  seen = new Set<Error>(),
): NetworkErrorCause | undefined {
  if (seen.size >= MAX_LINKS || !isError(value) || seen.has(value)) {
    return undefined;
  }
  seen.add(value);

  const name = attempt(() => value.name);
  if (typeof name !== "string") return undefined;

  const code = attempt(() => ("code" in value ? value.code : undefined));
  const cause = reduceCause(
    attempt(() => value.cause),
    seen,
  );

  return {
    name,
    ...(typeof code === "string" ? { code } : {}),
    ...(cause === undefined ? {} : { cause }),
  };
}

function isError(value: unknown): value is Error {
  return attempt(() => value instanceof Error) === true;
}

// A getter or a Proxy trap can throw: a read that fails counts as missing,
// so that building the error never throws in place of it.
function attempt(read: () => unknown): unknown {
  try {
    return read();
  } catch {
    return undefined;
  }
}
