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
});
