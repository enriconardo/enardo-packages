function deepFreezeInternal<T>(value: T, seen: WeakSet<object>): T {
  if (value === null || typeof value !== "object") {
    return value;
  }

  if (seen.has(value)) {
    return value;
  }

  seen.add(value);

  // Handle Iterables
  if (value instanceof Map) {
    for (const [key, nested] of value.entries()) {
      deepFreezeInternal(key, seen);
      deepFreezeInternal(nested, seen);
    }
  } else if (value instanceof Set) {
    for (const nested of value.values()) {
      deepFreezeInternal(nested, seen);
    }
  } else {
    // Other objects (Arrays, plain objects, class instances, etc.)
    const propNames = Reflect.ownKeys(value);
    for (const name of propNames) {
      const prop = (value as Record<string | symbol, unknown>)[name];
      if (prop !== null && typeof prop === "object") {
        deepFreezeInternal(prop, seen);
      }
    }
  }

  return Object.freeze(value);
}

/**
 * Recursively freezes an object and its nested properties, making them immutable.
 * Handles primitives, Maps, Sets, Arrays, and plain objects.
 *
 * @template T - The type of the value being frozen.
 * @param {T} value - The object or value to deep freeze.
 * @returns {T} The same value, but deeply frozen.
 */
export function deepFreeze<T>(value: T): T {
  return deepFreezeInternal(value, new WeakSet<object>());
}
