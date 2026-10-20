import { expect } from "vitest";

/** What `promise` rejects with. Fails when `promise` resolves. */
export async function reasonOf(promise: Promise<unknown>): Promise<unknown> {
  return promise.then(
    () => {
      throw new Error("Expected the call to reject, but it resolved");
    },
    (error: unknown) => error,
  );
}

/**
 * What `promise` rejects with, checked to be an instance of `errorClass`.
 * Fails when `promise` resolves.
 */
export async function rejectionOf<E>(
  promise: Promise<unknown>,
  errorClass: abstract new (...args: never[]) => E,
): Promise<E> {
  const reason = await reasonOf(promise);
  expect(reason).toBeInstanceOf(errorClass);
  return reason as E;
}

/**
 * What `promise` rejects with, checked to be an instance of `errorClass`
 * without printing it: a failed `toBeInstanceOf` formats the value it got,
 * and a getter of it that throws would replace the failure with its own
 * error. Fails when `promise` resolves.
 */
export async function unprintedRejectionOf<E>(
  promise: Promise<unknown>,
  errorClass: abstract new (...args: never[]) => E,
): Promise<E> {
  const reason = await reasonOf(promise);
  expect(
    reason instanceof errorClass,
    `the rejection is an instance of ${errorClass.name}`,
  ).toBe(true);
  return reason as E;
}

/**
 * What `run` throws, checked to be an instance of `errorClass`. Fails when
 * `run` returns.
 */
export function thrownBy<E>(
  run: () => unknown,
  errorClass: abstract new (...args: never[]) => E,
): E {
  try {
    run();
  } catch (error) {
    expect(error).toBeInstanceOf(errorClass);
    return error as E;
  }
  throw new Error("Expected the call to throw, but it returned");
}

/**
 * The markers that the refused addresses of the tests carry: no error or log
 * may hold them.
 */
export const ADDRESS_MARKERS = /attacker|victim|evil/i;
