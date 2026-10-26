import type { SerializedError } from "./base-error.types";

const CIRCULAR = "[Circular]";

/**
 * Serializes any `Error`, not only a `BaseError`: a cause can be a native or
 * third-party error, and its message and stack matter as much.
 *
 * `message`, `stack` and `cause` are not enumerable, so `JSON.stringify` alone
 * would drop them. `seen` holds the errors already on the chain, so a cycle
 * becomes a marker instead of an infinite recursion.
 */
export function serializeError(
  error: Error,
  seen: WeakSet<Error> = new WeakSet<Error>(),
): SerializedError {
  seen.add(error);

  const fields: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(error)) {
    if (value !== undefined) {
      fields[key] = value;
    }
  }

  return {
    ...fields,
    name: error.name,
    message: error.message,
    ...(error.stack === undefined ? {} : { stack: error.stack }),
    ...(error.cause === undefined
      ? {}
      : { cause: serializeCause(error.cause, seen) }),
  };
}

function serializeCause(cause: unknown, seen: WeakSet<Error>): unknown {
  if (!(cause instanceof Error)) {
    return cause;
  }

  return seen.has(cause) ? CIRCULAR : serializeError(cause, seen);
}
