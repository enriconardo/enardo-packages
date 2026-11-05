import { expect } from "vitest";

type NativeErrorClass = ErrorConstructor | TypeErrorConstructor;

/**
 * Asserts that `error` is the native `type`: its `constructor` is exactly
 * `type`, so a subclass named like a removed class fails, its `name` is
 * `type`'s, its message is `message`, and it has no `code` and no `details`.
 * The instance check prints nothing: see `unprintedRejectionOf`.
 */
export function expectNativeError(
  error: unknown,
  type: NativeErrorClass,
  message: string,
): void {
  expect(
    error instanceof type,
    `the error is an instance of ${type.name}`,
  ).toBe(true);
  const native = error as Error;
  expect(native.constructor, "the error's constructor").toBe(type);
  expect(native.name, "the error's name").toBe(type.name);
  expect(native.message, "the error's message").toBe(message);
  expect("code" in native, "a code property").toBe(false);
  expect("details" in native, "a details property").toBe(false);
}

/** The messages of the constructor's refusals, as they stand. */
export const OPTIONS_MESSAGES = {
  noTransport: "NodemailerEmailSender needs transport options",
  pool: "NodemailerEmailSender does not create a pooled transporter",
  notSmtp:
    "NodemailerEmailSender creates SMTP transporters only: transport must hold SMTP options",
  transportOptions:
    "nodemailer could not build a transporter from the transport options",
  defaultFrom:
    "The address of defaultFrom is not one NodemailerEmailSender accepts",
} as const;

/** The messages of `send`'s native refusals: no sender, content not a string. */
export const SEND_MESSAGES = {
  noSender: "The email has no sender: no from, and no default sender",
  notString: (field: "subject" | "text" | "html"): string =>
    `The email sender refuses ${field}: not a string`,
} as const;

/**
 * Asserts that the own properties of `error` are exactly `message` and
 * `stack`: a `cause`, or any field added to a native error, fails it.
 */
export function expectOnlyMessageAndStack(error: unknown): void {
  expect(
    Reflect.ownKeys(error as object)
      .map(String)
      .sort(),
    "the error's own properties",
  ).toEqual(["message", "stack"]);
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
 * The markers that the refused addresses of the tests carry: no error may
 * hold them.
 */
export const ADDRESS_MARKERS = /attacker|victim|evil/i;

/**
 * What `run` throws, checked to be an instance of `errorClass` without
 * printing it: see `unprintedRejectionOf`. Fails when `run` returns.
 */
export function unprintedThrownBy<E>(
  run: () => unknown,
  errorClass: abstract new (...args: never[]) => E,
): E {
  try {
    run();
  } catch (error) {
    expect(
      error instanceof errorClass,
      `the thrown value is an instance of ${errorClass.name}`,
    ).toBe(true);
    return error as E;
  }
  throw new Error("Expected the call to throw, but it returned");
}
