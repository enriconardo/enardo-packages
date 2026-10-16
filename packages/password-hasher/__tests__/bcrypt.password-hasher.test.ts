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
});
