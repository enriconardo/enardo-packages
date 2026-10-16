const CIRCULAR = "[Circular]";
const UNSERIALIZABLE = "[Unserializable]";

/**
 * Converts a log metadata value into one that `JSON.stringify` serializes
 * completely and cannot fail on.
 *
 * - A value with a `toJSON()` method is replaced by its result, as
 *   `JSON.stringify` would do: a class that controls its serialized form (a
 *   `BaseError`) keeps control of what reaches the logs.
 * - Any other `Error` becomes its own enumerable fields plus `name`,
 *   `message`, `stack` and `cause`, which are not enumerable and would be
 *   lost. This is the shape of `BaseError.toJSON()`.
 * - An object that is its own ancestor becomes `"[Circular]"`; a `bigint`
 *   becomes its decimal string; a value whose conversion throws becomes
 *   `"[Unserializable]"`, and its siblings are kept.
 *
 * Never throws.
 */
export function toLoggable(value: unknown): unknown {
  return convertValue(() => value, []);
}

function convertValue(read: () => unknown, ancestors: object[]): unknown {
  try {
    return convert(read(), ancestors);
  } catch {
    return UNSERIALIZABLE;
  }
}

function convert(value: unknown, ancestors: object[]): unknown {
  if (typeof value === "bigint") {
    return value.toString();
  }

  if (typeof value !== "object" || value === null) {
    return value;
  }

  if (ancestors.includes(value)) {
    return CIRCULAR;
  }

  ancestors.push(value);
  try {
    return convertObject(value, ancestors);
  } finally {
    ancestors.pop();
  }
}

function convertObject(value: object, ancestors: object[]): unknown {
  const toJSON: unknown = (value as { toJSON?: unknown }).toJSON;
  if (typeof toJSON === "function") {
    const json: unknown = Reflect.apply(toJSON, value, []);
    return json === value
      ? convertFields(value, ancestors)
      : convert(json, ancestors);
  }

  if (value instanceof Error) {
    return convertError(value, ancestors);
  }

  if (Array.isArray(value)) {
    // Not `map`: it reads each element before the callback could guard it.
    const items = value as unknown[];
    return Array.from({ length: items.length }, (_item, index) =>
      convertValue(() => items[index], ancestors),
    );
  }

  return convertFields(value, ancestors);
}

function convertError(
  error: Error,
  ancestors: object[],
): Record<string, unknown> {
  const fields = convertFields(error, ancestors);
  const stack = convertValue(() => error.stack, ancestors);
  const cause = convertValue(() => error.cause, ancestors);

  return {
    ...fields,
    name: convertValue(() => error.name, ancestors),
    message: convertValue(() => error.message, ancestors),
    ...(stack === undefined ? {} : { stack }),
    ...(cause === undefined ? {} : { cause }),
  };
}

// Reads one field at a time: a throwing getter costs only its own field.
function convertFields(
  value: object,
  ancestors: object[],
): Record<string, unknown> {
  const fields: Record<string, unknown> = {};

  for (const key of Object.keys(value)) {
    const converted = convertValue(
      () => (value as Record<string, unknown>)[key],
      ancestors,
    );
    if (converted !== undefined) {
      // Not `fields[key] =`: for a "__proto__" key, as JSON.parse can
      // produce, that would replace the prototype and lose the field.
      Object.defineProperty(fields, key, {
        value: converted,
        enumerable: true,
        writable: true,
        configurable: true,
      });
    }
  }

  return fields;
}
