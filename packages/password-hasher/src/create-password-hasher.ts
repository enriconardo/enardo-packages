import { argon2, randomBytes, timingSafeEqual } from "node:crypto";
import { promisify } from "node:util";
import {
  type Argon2idCosts,
  encodeArgon2idHash,
  isIntegerInRange,
  MAX_MEMORY_KIB,
  MAX_PASSES,
  MIN_MEMORY_KIB_PER_LANE,
  MIN_PASSES,
  parseArgon2idHash,
} from "~/argon2id-hash";
import { InvalidPasswordError } from "~/errors";
import type { PasswordHasher } from "~/password-hasher.interface";

const DEFAULT_MEMORY_KIB = 65_536;
const DEFAULT_PASSES = 3;
const PARALLELISM = 1;
const SALT_BYTES = 16;
const TAG_BYTES = 32;
/**
 * In UTF-16 code units. `normalize` runs on the main thread and is quadratic
 * on some strings: under 1 ms at this length, 833 ms on a 100 KiB body.
 */
const MAX_PASSWORD_LENGTH = 1024;

const argon2Async = promisify(argon2);

/** The options of `createPasswordHasher`. Costs below the defaults are for tests. */
export interface PasswordHasherOptions {
  /**
   * Memory of each hash, in KiB, from 8 to 1048576 (1 GiB). Defaults to 65536
   * (64 MiB). Peak memory is this times `UV_THREADPOOL_SIZE`, and an overrun
   * gets the process killed, with nothing to catch.
   */
  readonly memoryKiB?: number;
  /** Passes over the memory, from 1 to 16. Defaults to 3. */
  readonly passes?: number;
}

function assertOption(
  name: keyof PasswordHasherOptions,
  value: number,
  min: number,
  max: number,
): void {
  if (!isIntegerInRange(value, min, max)) {
    throw new RangeError(
      `${name} must be an integer from ${min} to ${max}, got ${value}`,
    );
  }
}

/** Why `hash` refuses a password. The length comes first: see the maximum. */
function refusalOf(password: string): InvalidPasswordError["code"] | undefined {
  if (password.length > MAX_PASSWORD_LENGTH) {
    return "PASSWORD_TOO_LONG";
  }
  // A lone surrogate reaches the derive as U+FFFD, and collides with it.
  return password.isWellFormed() ? undefined : "PASSWORD_MALFORMED";
}

function derive(
  password: string,
  salt: Buffer,
  tagLength: number,
  costs: Argon2idCosts,
): Promise<Buffer> {
  return argon2Async("argon2id", {
    message: password.normalize("NFC"),
    nonce: salt,
    parallelism: costs.parallelism,
    tagLength,
    memory: costs.memoryKiB,
    passes: costs.passes,
  });
}

/**
 * Creates a `PasswordHasher` on Argon2id.
 *
 * @throws {RangeError} An option is out of range: at this call, so that a bad
 * value stops the app at startup and not at its first login.
 */
export function createPasswordHasher(
  options: PasswordHasherOptions = {},
): PasswordHasher {
  const { memoryKiB = DEFAULT_MEMORY_KIB, passes = DEFAULT_PASSES } = options;
  assertOption(
    "memoryKiB",
    memoryKiB,
    MIN_MEMORY_KIB_PER_LANE * PARALLELISM,
    MAX_MEMORY_KIB,
  );
  assertOption("passes", passes, MIN_PASSES, MAX_PASSES);
  const costs: Argon2idCosts = { memoryKiB, passes, parallelism: PARALLELISM };

  return {
    async hash(password) {
      const refusal = refusalOf(password);
      if (refusal !== undefined) {
        throw new InvalidPasswordError(refusal);
      }

      const salt = randomBytes(SALT_BYTES);
      const tag = await derive(password, salt, TAG_BYTES, costs);
      return encodeArgon2idHash({ ...costs, salt, tag });
    },

    async compare(password, hashedPassword) {
      // The hash first: an unreadable one is a fault, whatever the password.
      const stored = parseArgon2idHash(hashedPassword);
      if (refusalOf(password) !== undefined) {
        return false;
      }

      const tag = await derive(
        password,
        stored.salt,
        stored.tag.length,
        stored,
      );
      return timingSafeEqual(tag, stored.tag);
    },

    needsRehash(hashedPassword) {
      const stored = parseArgon2idHash(hashedPassword);
      return (
        stored.memoryKiB !== costs.memoryKiB ||
        stored.passes !== costs.passes ||
        stored.parallelism !== costs.parallelism
      );
    },
  };
}
