export const MIN_MEMORY_KIB_PER_LANE = 8;
/**
 * 1 GiB. A large `m` is no error for `crypto.argon2`: the process gets killed,
 * with nothing to catch, so a corrupt string has to stop here. A smaller
 * machine can still be killed at this value: it is no sizing advice.
 */
export const MAX_MEMORY_KIB = 1_048_576;
export const MIN_PASSES = 1;
export const MAX_PASSES = 16;
const MIN_PARALLELISM = 1;
const MAX_PARALLELISM = 16;
const MIN_SALT_BYTES = 8;
const MAX_SALT_BYTES = 64;
const MIN_TAG_BYTES = 4;
const MAX_TAG_BYTES = 64;

const ARGON2ID_HASH =
  /^\$argon2id\$v=19\$m=(0|[1-9]\d*),t=(0|[1-9]\d*),p=(0|[1-9]\d*)\$([A-Za-z0-9+/]+)\$([A-Za-z0-9+/]+)$/;

/** The costs a hash is derived with. */
export interface Argon2idCosts {
  readonly memoryKiB: number;
  readonly passes: number;
  readonly parallelism: number;
}

/** What a stored string holds. */
export interface Argon2idHash extends Argon2idCosts {
  readonly salt: Buffer;
  readonly tag: Buffer;
}

/** Whether `value` is an integer from `min` to `max`. */
export function isIntegerInRange(
  value: number,
  min: number,
  max: number,
): boolean {
  return Number.isInteger(value) && value >= min && value <= max;
}

function toBase64(bytes: Buffer): string {
  return bytes.toString("base64").replace(/=+$/, "");
}

/**
 * The bytes of unpadded standard base64. `Buffer.from` accepts garbage and
 * ignores the unused bits of the last character: only the text that re-encodes
 * to itself is canonical.
 */
function fromBase64(text: string): Buffer {
  const bytes = Buffer.from(text, "base64");
  if (toBase64(bytes) !== text) {
    throw unreadable("a salt or a tag is not canonical base64");
  }
  return bytes;
}

// The reason only: a hash is a credential, and errors reach logs.
function unreadable(reason: string): TypeError {
  return new TypeError(`Unreadable password hash: ${reason}`);
}

/** The PHC string of a hash. */
export function encodeArgon2idHash(hash: Argon2idHash): string {
  const { memoryKiB, passes, parallelism, salt, tag } = hash;
  return `$argon2id$v=19$m=${memoryKiB},t=${passes},p=${parallelism}$${toBase64(salt)}$${toBase64(tag)}`;
}

/**
 * Reads a PHC string: the exact shape, within the caps.
 *
 * @throws {TypeError} The string is anything else. The message never holds it.
 */
export function parseArgon2idHash(text: string): Argon2idHash {
  const match = ARGON2ID_HASH.exec(text);
  if (match === null) {
    throw unreadable("not an Argon2id hash in the expected format");
  }

  const [, memory = "", time = "", lanes = "", salt = "", tag = ""] = match;
  const memoryKiB = Number(memory);
  const passes = Number(time);
  const parallelism = Number(lanes);
  if (
    !isIntegerInRange(parallelism, MIN_PARALLELISM, MAX_PARALLELISM) ||
    !isIntegerInRange(passes, MIN_PASSES, MAX_PASSES) ||
    !isIntegerInRange(
      memoryKiB,
      MIN_MEMORY_KIB_PER_LANE * parallelism,
      MAX_MEMORY_KIB,
    )
  ) {
    throw unreadable("a cost is out of range");
  }

  const saltBytes = fromBase64(salt);
  const tagBytes = fromBase64(tag);
  if (
    !isIntegerInRange(saltBytes.length, MIN_SALT_BYTES, MAX_SALT_BYTES) ||
    !isIntegerInRange(tagBytes.length, MIN_TAG_BYTES, MAX_TAG_BYTES)
  ) {
    throw unreadable("a salt or a tag is out of range");
  }

  return { memoryKiB, passes, parallelism, salt: saltBytes, tag: tagBytes };
}
