import { isBaseErrorLike } from "@enardo/errors";
import { expect } from "vitest";
import { InvalidPasswordError, type PasswordHasher } from "~/index";

/**
 * What a settled promise rejected with. The call that makes the promise runs
 * before this one, so a missing function fails the test instead of counting
 * as the `TypeError` these tests expect.
 */
async function rejectionOf(promise: Promise<unknown>): Promise<unknown> {
  try {
    await promise;
  } catch (error) {
    return error;
  }
  throw new Error("Expected the promise to reject, and it resolved");
}

function expectUnreadable(error: unknown, hash: string): void {
  expect(error).toBeInstanceOf(TypeError);
  // Every string contains "": the case of the empty hash has nothing to hold.
  if (hash !== "") {
    expect((error as TypeError).message).not.toContain(hash);
  }
}

/** `compare` rejected with a `TypeError` whose message does not hold the hash. */
export async function expectCompareUnreadable(
  compare: Promise<boolean>,
  hash: string,
): Promise<void> {
  const error = await rejectionOf(compare);

  expectUnreadable(error, hash);
}

/** `needsRehash` threw a `TypeError` whose message does not hold the hash. */
export function expectNeedsRehashUnreadable(
  hasher: PasswordHasher,
  hash: string,
): void {
  let error: unknown;
  try {
    hasher.needsRehash(hash);
  } catch (caught) {
    error = caught;
  }

  expectUnreadable(error, hash);
}

/**
 * The rejection is an `InvalidPasswordError` with `code` and no `details`.
 * Returns its `toJSON()` without `stack`: the frames hold file paths, which
 * can hold any letters, and the header only repeats `message`.
 */
export async function expectInvalidPassword(
  hash: Promise<string>,
  code: "PASSWORD_MALFORMED" | "PASSWORD_TOO_LONG",
): Promise<string> {
  const error = await rejectionOf(hash);

  expect(error).toBeInstanceOf(InvalidPasswordError);
  expect(isBaseErrorLike(error)).toBe(true);
  const invalid = error as InvalidPasswordError;
  expect(invalid.code).toBe(code);
  expect(invalid.details).toBeUndefined();

  return JSON.stringify({ ...invalid.toJSON(), stack: undefined });
}
