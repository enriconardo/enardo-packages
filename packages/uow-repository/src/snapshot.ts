/**
 * Builds the persistence snapshot that change detection compares against.
 *
 * The snapshot is a deep copy (see copyData), so that a later mutation of the
 * entity cannot reach it through a reference the mapper happens to share with
 * it, and it drops keys whose value is `undefined`: no data store round-trips
 * the difference between an explicitly undefined field and an absent one, so
 * keeping that distinction would report a change no store can observe.
 */
export function toSnapshot<T>(data: T): T {
  return copy(data, true, new WeakMap()) as T;
}

/**
 * Deep-copies data such as records or change sets, keeping the class
 * instances it holds.
 *
 * Plain objects, arrays, maps and sets are copied, and the mutable built-ins
 * structuredClone knows (Date, RegExp, binary data) are cloned. Any other
 * object is an instance of a class, such as a driver's ObjectId or Decimal128.
 * structuredClone would copy it as a plain object without its prototype, and
 * the driver would then write a sub-document instead of the value. Such
 * instances are treated as immutable values and kept as they are, so a
 * record must not hold a class instance that is mutated in place.
 */
export function copyData<T>(data: T): T {
  return copy(data, false, new WeakMap()) as T;
}

/**
 * Copies `value`, reusing the copy of an object reached twice so that shared
 * references and circular references survive, as with structuredClone.
 */
function copy(
  value: unknown,
  dropUndefined: boolean,
  copies: WeakMap<object, unknown>,
): unknown {
  if (typeof value !== "object" || value === null) {
    return value;
  }

  if (copies.has(value)) {
    return copies.get(value);
  }

  if (Array.isArray(value)) {
    const result: unknown[] = new Array<unknown>(value.length);
    copies.set(value, result);
    // forEach skips holes, so they stay holes: array positions are kept.
    value.forEach((item, index) => {
      result[index] = copy(item, dropUndefined, copies);
    });
    return result;
  }

  if (value instanceof Map) {
    const result = new Map<unknown, unknown>();
    copies.set(value, result);
    for (const [key, item] of value) {
      result.set(
        copy(key, dropUndefined, copies),
        copy(item, dropUndefined, copies),
      );
    }
    return result;
  }

  if (value instanceof Set) {
    const result = new Set<unknown>();
    copies.set(value, result);
    for (const item of value) {
      result.add(copy(item, dropUndefined, copies));
    }
    return result;
  }

  if (isPlainObject(value)) {
    const result: Record<string, unknown> = Object.create(
      Object.getPrototypeOf(value) as object | null,
    ) as Record<string, unknown>;
    copies.set(value, result);
    for (const [key, item] of Object.entries(value)) {
      if (dropUndefined && item === undefined) {
        continue;
      }
      result[key] = copy(item, dropUndefined, copies);
    }
    return result;
  }

  if (isClonableBuiltIn(value)) {
    const result = structuredClone(value);
    copies.set(value, result);
    return result;
  }

  return value;
}

/** Confines key-by-key copying to data objects, leaving class instances intact. */
function isPlainObject(value: object): value is Record<string, unknown> {
  const prototype: unknown = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}

/** Built-ins that can be mutated in place, and that structuredClone copies faithfully. */
function isClonableBuiltIn(value: object): boolean {
  return (
    value instanceof Date ||
    value instanceof RegExp ||
    value instanceof ArrayBuffer ||
    ArrayBuffer.isView(value)
  );
}
