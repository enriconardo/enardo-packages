import { describe, expect, it } from "vitest";
import { createPasswordHasher, type PasswordHasher } from "~/index";
import {
  expectCompareUnreadable,
  expectNeedsRehashUnreadable,
} from "./support/assertions";
import {
  BASE_HASH,
  BASE_PASSWORD,
  BASE_SALT,
  BASE_TAG,
  BCRYPT_HASH,
  base64OfLength,
} from "./support/fixtures";

// The parser is internal, and the spec names no function of it: these cases
// reach it through `needsRehash` and `compare`. Every variation keeps the
// fixture's right password, so an implementation that reads the string too
// leniently resolves `true`, or `false`, instead of rejecting.
function cheapHasher(): PasswordHasher {
  return createPasswordHasher({ memoryKiB: 8, passes: 1 });
}

/** A hash with the parameters, the salt and the tag of the arguments. */
function hashWith(
  parameters: string,
  salt: string = BASE_SALT,
  tag: string = BASE_TAG,
): string {
  return `$argon2id$v=19$${parameters}$${salt}$${tag}`;
}

const BASE_PARAMETERS = "m=1024,t=1,p=1";

const UNREADABLE_HASHES: readonly (readonly [string, string])[] = [
  ["a bcrypt hash", BCRYPT_HASH],
  ["an empty string", ""],
  ["argon2i", BASE_HASH.replace("$argon2id$", "$argon2i$")],
  ["argon2d", BASE_HASH.replace("$argon2id$", "$argon2d$")],
  ["v=16", BASE_HASH.replace("$v=19$", "$v=16$")],
  ["no v", BASE_HASH.replace("$v=19$", "$")],
  ["the tag missing", `$argon2id$v=19$${BASE_PARAMETERS}$${BASE_SALT}`],
  ["the salt missing", `$argon2id$v=19$${BASE_PARAMETERS}$${BASE_TAG}`],
  ["the parameters missing", `$argon2id$v=19$${BASE_SALT}$${BASE_TAG}`],
  ["the algorithm missing", BASE_HASH.replace("$argon2id$", "$")],
  ["a part too many", `${BASE_HASH}$${BASE_TAG}`],
  ["a trailing newline", `${BASE_HASH}\n`],
  ["a salt in !!!", hashWith(BASE_PARAMETERS, "!!!")],
  ["a tag in !!!", hashWith(BASE_PARAMETERS, BASE_SALT, "!!!")],
  ["a salt with = padding", hashWith(BASE_PARAMETERS, `${BASE_SALT}==`)],
  [
    "a tag with = padding",
    hashWith(BASE_PARAMETERS, BASE_SALT, `${BASE_TAG}=`),
  ],
  // The last character of each holds unused bits: Q and R, A and B decode to
  // the same bytes.
  [
    "a non-canonical salt",
    hashWith(BASE_PARAMETERS, `${BASE_SALT.slice(0, -1)}R`),
  ],
  [
    "a non-canonical tag",
    hashWith(BASE_PARAMETERS, BASE_SALT, `${BASE_TAG.slice(0, -1)}B`),
  ],
  [
    "a tag in URL-safe base64",
    hashWith(BASE_PARAMETERS, BASE_SALT, BASE_TAG.replace("+", "-")),
  ],
  ["m=0", hashWith("m=0,t=1,p=1")],
  ["t=0", hashWith("m=1024,t=0,p=1")],
  ["p=0", hashWith("m=1024,t=1,p=0")],
  ["m=01024", hashWith("m=01024,t=1,p=1")],
  ["t=01", hashWith("m=1024,t=01,p=1")],
  ["p=01", hashWith("m=1024,t=1,p=01")],
  ["the parameters out of order", hashWith("t=1,m=1024,p=1")],
  ["keyid among the parameters", hashWith(`${BASE_PARAMETERS},keyid=abc`)],
  ["data among the parameters", hashWith(`${BASE_PARAMETERS},data=abc`)],
];

describe("reading a stored hash", () => {
  describe.each(UNREADABLE_HASHES)("%s", (_name, hash) => {
    it("should reject compare with a TypeError that does not hold the hash", async () => {
      const hasher = cheapHasher();

      await expectCompareUnreadable(hasher.compare(BASE_PASSWORD, hash), hash);
    });

    it("should throw from needsRehash a TypeError that does not hold the hash", () => {
      expectNeedsRehashUnreadable(cheapHasher(), hash);
    });
  });

  it("should read the hash before the password", async () => {
    const hasher = cheapHasher();

    await expectCompareUnreadable(
      hasher.compare("pw\uD800", BCRYPT_HASH),
      BCRYPT_HASH,
    );
  });

  describe("caps", () => {
    // `needsRehash` reads the string and derives nothing: `compare` would
    // spend 1 GiB on the first of these.
    it.each([
      ["m=1048576", hashWith("m=1048576,t=1,p=1")],
      ["t=16", hashWith("m=1024,t=16,p=1")],
      ["p=16", hashWith("m=1024,t=1,p=16")],
      ["m at 8 * p", hashWith("m=16,t=1,p=2")],
      ["a salt of 8 bytes", hashWith(BASE_PARAMETERS, base64OfLength(8))],
      ["a salt of 64 bytes", hashWith(BASE_PARAMETERS, base64OfLength(64))],
      [
        "a tag of 4 bytes",
        hashWith(BASE_PARAMETERS, BASE_SALT, base64OfLength(4)),
      ],
      [
        "a tag of 64 bytes",
        hashWith(BASE_PARAMETERS, BASE_SALT, base64OfLength(64)),
      ],
    ])("should read a hash with %s", (_name, hash) => {
      const hasher = cheapHasher();

      expect(typeof hasher.needsRehash(hash)).toBe("boolean");
    });

    it.each([
      ["m=1048577", hashWith("m=1048577,t=1,p=1")],
      ["t=17", hashWith("m=1024,t=17,p=1")],
      ["p=17", hashWith("m=1024,t=1,p=17")],
      ["m under 8 * p", hashWith("m=15,t=1,p=2")],
      ["a salt of 7 bytes", hashWith(BASE_PARAMETERS, base64OfLength(7))],
      ["a salt of 65 bytes", hashWith(BASE_PARAMETERS, base64OfLength(65))],
      [
        "a tag of 3 bytes",
        hashWith(BASE_PARAMETERS, BASE_SALT, base64OfLength(3)),
      ],
      [
        "a tag of 65 bytes",
        hashWith(BASE_PARAMETERS, BASE_SALT, base64OfLength(65)),
      ],
    ])("should refuse a hash with %s", async (_name, hash) => {
      const hasher = cheapHasher();

      expectNeedsRehashUnreadable(hasher, hash);
      await expectCompareUnreadable(hasher.compare(BASE_PASSWORD, hash), hash);
    });

    // On an implementation without the cap, this kills the process, with no
    // error that a test could catch.
    it("should refuse m=4294967295 before any work", async () => {
      const hash = hashWith("m=4294967295,t=1,p=1");

      await expectCompareUnreadable(
        cheapHasher().compare(BASE_PASSWORD, hash),
        hash,
      );
    });
  });
});
