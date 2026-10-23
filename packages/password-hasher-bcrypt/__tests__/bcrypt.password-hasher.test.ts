import { describe, expect, it } from "vitest";
import { BcryptPasswordHasher } from "~/bcrypt.password-hasher";

describe("BcryptPasswordHasher", () => {
  it("should hash and compare a password", async () => {
    const hasher = new BcryptPasswordHasher(4);
    const plain = "P@ssword123";

    const hashed = await hasher.hash(plain);

    expect(hashed).not.toBe(plain);
    await expect(hasher.compare(plain, hashed)).resolves.toBe(true);
  });

  it("should return false for mismatched password", async () => {
    const hasher = new BcryptPasswordHasher(4);
    const hashed = await hasher.hash("correct-password");

    await expect(hasher.compare("wrong-password", hashed)).resolves.toBe(false);
  });

  // bcrypt reads only the first 72 bytes of a password: the README documents
  // the limit, and these cases fail when an upgrade of bcrypt changes it.
  it("should read the 72nd byte of a password", async () => {
    const hasher = new BcryptPasswordHasher(4);
    const prefix = "a".repeat(71);
    const hashed = await hasher.hash(`${prefix}X`);

    await expect(hasher.compare(`${prefix}Y`, hashed)).resolves.toBe(false);
  });

  it("should read no byte past the 72nd, counted in UTF-8", async () => {
    const hasher = new BcryptPasswordHasher(4);
    // 36 two-byte characters: a limit counted in characters would read the Y.
    const prefix = "é".repeat(36);
    const hashed = await hasher.hash(`${prefix}Y`);

    await expect(hasher.compare(prefix, hashed)).resolves.toBe(true);
  });

  // Hashes made by bcrypt 5.1.1 at cost 4: a hash an app stored before an
  // upgrade of bcrypt still has to verify.
  describe("hashes made by bcrypt 5.1.1", () => {
    const hasher = new BcryptPasswordHasher(4);
    const hash = "$2b$04$K3jkotAxEI6VAxGGMsYVBua0nImI9fCxSsOQhpjcvi0DKZ/zmbUWS";

    it("should verify the password of a stored hash", async () => {
      await expect(hasher.compare("P@ssword123", hash)).resolves.toBe(true);
    });

    it("should reject another password against a stored hash", async () => {
      await expect(hasher.compare("P@ssword124", hash)).resolves.toBe(false);
    });

    it("should encode a lone surrogate as U+FFFD", async () => {
      // The hash of "pw\uD800".
      const surrogateHash =
        "$2b$04$kK3eX./9Zx/qFKapeVPk6OxnUqXaw4E6UZbxZ3lpE0Er0w0OFb2Em";

      await expect(hasher.compare("pw�", surrogateHash)).resolves.toBe(true);
      await expect(hasher.compare("pw\uDC00", surrogateHash)).resolves.toBe(
        true,
      );
      // The match is the U+FFFD, not a dropped character.
      await expect(hasher.compare("pw", surrogateHash)).resolves.toBe(false);
    });
  });
});
