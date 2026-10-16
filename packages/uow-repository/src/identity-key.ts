import { UnsupportedIdentityError } from "./errors";

/** Derives a stable key for primitive identities used by the change tracker. */
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
      throw new UnsupportedIdentityError(describeType(id));
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
