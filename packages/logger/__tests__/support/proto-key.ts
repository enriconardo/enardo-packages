import { expect } from "vitest";
import type { LogMetadata } from "~/logger";

/**
 * Parses a fresh object with an own `__proto__` field, the way untrusted
 * input arrives: `JSON.parse` defines the key as an own property instead of
 * setting the prototype.
 */
export function parseProtoKeyInput(): LogMetadata {
  return JSON.parse('{"__proto__":{"isAdmin":true},"a":1}') as LogMetadata;
}

function asObject(value: unknown): object {
  if (typeof value !== "object" || value === null) {
    throw new TypeError(
      `Expected an object, got ${value === null ? "null" : typeof value}.`,
    );
  }

  return value;
}

/**
 * Returns the value of the own field `key` of `value`, read through its
 * descriptor: a plain read of `__proto__` would return the prototype when
 * the field is missing.
 */
export function ownField(value: unknown, key: string): unknown {
  return Object.getOwnPropertyDescriptor(asObject(value), key)?.value;
}

/**
 * Asserts that `value` has an own `__proto__` field equal to
 * `{ isAdmin: true }`, and that its prototype is still `Object.prototype`.
 */
export function expectOwnProtoField(value: unknown): void {
  const object = asObject(value);

  expect(Object.getOwnPropertyNames(object)).toContain("__proto__");
  expect(ownField(object, "__proto__")).toEqual({ isAdmin: true });
  expect(
    Object.getPrototypeOf(object) === Object.prototype,
    "the prototype is Object.prototype",
  ).toBe(true);
}

/**
 * Asserts that `value` keeps the fields of `parseProtoKeyInput()`: its own
 * `__proto__` field, and `a`.
 */
export function expectKeepsProtoKey(value: unknown): void {
  expectOwnProtoField(value);
  expect(ownField(value, "a")).toBe(1);
}

/** Asserts that `Object.prototype` did not get the `isAdmin` field. */
export function expectObjectPrototypeUnpolluted(): void {
  const empty: Record<string, unknown> = {};

  expect(Object.hasOwn(Object.prototype, "isAdmin")).toBe(false);
  expect(empty.isAdmin).toBeUndefined();
}
