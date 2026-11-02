/**
 * Derives a stable key for primitive identities used by the change tracker.
 *
 * @throws {TypeError} `id` is not a string, number, bigint or boolean.
 */
export function identityKeyOf(id: unknown): string {
  switch (typeof id) {
    case "string":
      return `string:${id}`;
    case "number":
      return Object.is(id, -0) ? "number:-0" : `number:${String(id)}`;
    case "bigint":
    case "boolean":
      return `${typeof id}:${String(id)}`;
    default:
      throw new TypeError(
        `Cannot derive an identity key from ${describeType(id)}. Supply identityKey for composite identities.`,
      );
  }
}

function describeType(id: unknown): string {
  if (id === null) {
    return "null";
  }
  if (Array.isArray(id)) {
    return "an array";
  }
  return typeof id === "object" ? "an object" : `a ${typeof id}`;
}
