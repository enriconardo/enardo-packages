import { isBaseErrorLike } from "@enardo/errors";
import { expect } from "vitest";

type NativeErrorClass = ErrorConstructor | TypeErrorConstructor;

/**
 * Asserts that `error` is the native `type`: its `constructor` is exactly
 * `type`, so a subclass named like a removed class fails, its `name` is
 * `type`'s, its message is `message`, it has no `code`, and
 * `isBaseErrorLike` rejects it.
 */
export function expectNativeError(
  error: unknown,
  type: NativeErrorClass,
  message: string,
): void {
  expect(error).toBeInstanceOf(type);
  const native = error as Error;
  expect(native.constructor, "the error's constructor").toBe(type);
  expect(native.name, "the error's name").toBe(type.name);
  expect(native.message, "the error's message").toBe(message);
  expect("code" in native, "a code property").toBe(false);
  expect(isBaseErrorLike(error), "isBaseErrorLike").toBe(false);
}

/** What `promise` rejects with. Fails when `promise` resolves. */
export async function reasonOf(promise: Promise<unknown>): Promise<unknown> {
  return promise.then(
    () => {
      throw new Error("Expected the call to reject, but it resolved");
    },
    (error: unknown) => error,
  );
}

/** What `run` throws. Fails when `run` returns. */
export function thrownBy(run: () => unknown): unknown {
  try {
    run();
  } catch (error) {
    return error;
  }
  throw new Error("Expected the call to throw, but it returned");
}
