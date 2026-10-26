import type { SerializedError } from "./base-error.types";

const CIRCULAR = "[Circular]";

/**
 * Serializes any `Error`, not only a `BaseError`: a cause can be a native or
 * third-party error, and its message and stack matter as much.
 *
 * `message`, `stack` and `cause` are not enumerable, so `JSON.stringify` alone
 * would drop them; neither is the `errors` of an `AggregateError`, which
 * carries what a failed connection to several addresses reports. `ancestors`
 * holds the errors on the path from the root to this one, so a return to one
 * of them becomes a marker instead of an infinite recursion, while an error
 * reached twice without a cycle is serialized at both places.
 */
export function serializeError(
  error: Error,
  ancestors: readonly Error[] = [],
): SerializedError {
  const path = [...ancestors, error];

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
    ...(error instanceof AggregateError
      ? { errors: serializeErrors(error.errors, path) }
      : {}),
    ...(error.cause === undefined
      ? {}
      : { cause: serializeCause(error.cause, path) }),
  };
}

// `errors` is writable: a caller can replace it with any value.
function serializeErrors(errors: unknown, path: readonly Error[]): unknown {
  return Array.isArray(errors)
    ? (errors as unknown[]).map((element) => serializeCause(element, path))
    : errors;
}

function serializeCause(cause: unknown, path: readonly Error[]): unknown {
  if (!(cause instanceof Error)) {
    return cause;
  }

  return path.includes(cause) ? CIRCULAR : serializeError(cause, path);
}
