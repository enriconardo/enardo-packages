import { afterEach, describe, expect, it, vi } from "vitest";
import { createPasswordHasher, type PasswordHasher } from "~/index";
import {
  expectCompareUnreadable,
  expectInvalidPassword,
} from "./support/assertions";
import {
  BASE_HASH,
  BASE_PASSWORD,
  BCRYPT_HASH,
  CAFE_NFC,
  CAFE_NFC_HASH,
  CAFE_NFD,
  LONG_PASSWORD,
  LONG_PASSWORD_HASH,
  SHORT_TAG_HASH,
  T2_P2_HASH,
  TOO_LONG_PASSWORD,
  TOO_LONG_PASSWORD_HASH,
  WRONG_PASSWORD,
} from "./support/fixtures";

function cheapHasher(): PasswordHasher {
  return createPasswordHasher({ memoryKiB: 8, passes: 1 });
}

/** The decoded length of a part of a PHC string: 0 when the part is missing. */
function decodedBytes(hash: string, part: number): number {
  return Buffer.from(hash.split("$").at(part) ?? "", "base64").length;
}

describe("createPasswordHasher", () => {
  describe("hash", () => {
    it("should use the default parameters, a 16-byte salt and a 32-byte tag", async () => {
      const hash = await createPasswordHasher().hash("pw");

      expect(hash).toMatch(/^\$argon2id\$v=19\$m=65536,t=3,p=1\$/);
      expect(decodedBytes(hash, 4)).toBe(16);
      expect(decodedBytes(hash, 5)).toBe(32);
    });

    it("should use the given options, with p=1", async () => {
      const hasher = createPasswordHasher({ memoryKiB: 16, passes: 2 });

      await expect(hasher.hash("pw")).resolves.toContain("$m=16,t=2,p=1$");
    });

    it("should give different strings for the same password", async () => {
      const hasher = cheapHasher();

      const first = await hasher.hash("pw");
      const second = await hasher.hash("pw");

      expect(first).not.toBe(second);
    });

    it("should leave the event loop free", async () => {
      const hasher = createPasswordHasher();
      let ticks = 0;
      const timer = setInterval(() => {
        ticks += 1;
      }, 1);

      try {
        await hasher.hash("pw");
      } finally {
        clearInterval(timer);
      }

      expect(ticks).toBeGreaterThanOrEqual(1);
    });
  });

  describe("compare", () => {
    it("should accept the right password and refuse another", async () => {
      const hasher = cheapHasher();
      const hash = await hasher.hash("right");

      await expect(hasher.compare("right", hash)).resolves.toBe(true);
      await expect(hasher.compare("wrong", hash)).resolves.toBe(false);
    });

    it.each([
      ["the 73rd byte", "a".repeat(72) + "X", "a".repeat(72) + "Y"],
      ["the 1000th byte", "a".repeat(999) + "X", "a".repeat(999) + "Y"],
      ["a byte after a NUL", "a\0b", "a\0c"],
      ["what follows a NUL", "a\0b", "a"],
    ])("should read %s", async (_name, stored, other) => {
      const hasher = cheapHasher();
      const hash = await hasher.hash(stored);

      await expect(hasher.compare(stored, hash)).resolves.toBe(true);
      await expect(hasher.compare(other, hash)).resolves.toBe(false);
    });

    it("should take an empty password: the policy is the caller's", async () => {
      const hasher = cheapHasher();
      const hash = await hasher.hash("");

      await expect(hasher.compare("", hash)).resolves.toBe(true);
    });

    // On a hasher with default options: `p=2`, `t=2` and the 16-byte tag fail
    // on an implementation that derives with its own parameters.
    it.each([
      ["m=1024,t=1,p=1", BASE_PASSWORD, BASE_HASH],
      ["t=2 and p=2", BASE_PASSWORD, T2_P2_HASH],
      ["a 16-byte tag", BASE_PASSWORD, SHORT_TAG_HASH],
      ["an NFC password", CAFE_NFC, CAFE_NFC_HASH],
      ["a long password", LONG_PASSWORD, LONG_PASSWORD_HASH],
    ])(
      "should verify a hash of another library: %s",
      async (_name, password, hash) => {
        const hasher = createPasswordHasher();

        await expect(hasher.compare(password, hash)).resolves.toBe(true);
        await expect(hasher.compare(WRONG_PASSWORD, hash)).resolves.toBe(false);
      },
    );
  });

  describe("passwords that are not well-formed", () => {
    it.each([
      ["a high surrogate", "pw\uD800"],
      ["a low surrogate", "pw\uDC00"],
    ])("should refuse to hash a lone %s", async (_name, password) => {
      const serialized = await expectInvalidPassword(
        cheapHasher().hash(password),
        "PASSWORD_MALFORMED",
      );

      expect(serialized).not.toContain("pw");
    });

    it.each([
      ["a valid surrogate pair", "pw\u{1F600}"],
      ["U+FFFD", "pw�"],
    ])("should accept %s", async (_name, password) => {
      const hasher = cheapHasher();
      const hash = await hasher.hash(password);

      await expect(hasher.compare(password, hash)).resolves.toBe(true);
    });

    // Encoded to UTF-8, a lone surrogate becomes U+FFFD: only a check tells
    // these apart from the password of the hash.
    it.each([
      ["a high surrogate", "pw\uD800"],
      ["a low surrogate", "pw\uDC00"],
    ])("should resolve false to compare a lone %s", async (_name, password) => {
      const hasher = cheapHasher();
      const hash = await hasher.hash("pw�");

      await expect(hasher.compare(password, hash)).resolves.toBe(false);
    });
  });

  describe("normalization", () => {
    it("should match an NFD password against a hash of its NFC form", async () => {
      await expect(
        cheapHasher().compare(CAFE_NFD, CAFE_NFC_HASH),
      ).resolves.toBe(true);
    });

    it.each([
      ["NFD then NFC", CAFE_NFD, CAFE_NFC],
      ["NFC then NFD", CAFE_NFC, CAFE_NFD],
    ])("should match %s", async (_name, hashed, compared) => {
      const hasher = cheapHasher();
      const hash = await hasher.hash(hashed);

      await expect(hasher.compare(compared, hash)).resolves.toBe(true);
    });
  });

  describe("needsRehash", () => {
    it("should be false on the hasher's own hash", async () => {
      const hasher = createPasswordHasher({ memoryKiB: 16, passes: 2 });
      const hash = await hasher.hash("pw");

      expect(hasher.needsRehash(hash)).toBe(false);
    });

    it("should be false on a hash with the hasher's parameters", () => {
      const hasher = createPasswordHasher({ memoryKiB: 1024, passes: 1 });

      expect(hasher.needsRehash(BASE_HASH)).toBe(false);
    });

    it.each([
      ["m higher", { memoryKiB: 512, passes: 1 }, BASE_HASH],
      ["m lower", { memoryKiB: 2048, passes: 1 }, BASE_HASH],
      [
        "t higher",
        { memoryKiB: 1024, passes: 2 },
        BASE_HASH.replace(",t=1,", ",t=3,"),
      ],
      ["t lower", { memoryKiB: 1024, passes: 2 }, BASE_HASH],
      // That fixture's `m` and `t`: only its `p` differs.
      ["p=2", { memoryKiB: 1024, passes: 2 }, T2_P2_HASH],
    ])("should be true for a hash with %s", (_name, options, hash) => {
      expect(createPasswordHasher(options).needsRehash(hash)).toBe(true);
    });
  });

  describe("options", () => {
    it.each([
      ["memoryKiB 0", { memoryKiB: 0, passes: 1 }],
      ["memoryKiB 7", { memoryKiB: 7, passes: 1 }],
      ["memoryKiB 1.5", { memoryKiB: 1.5, passes: 1 }],
      ["memoryKiB NaN", { memoryKiB: Number.NaN, passes: 1 }],
      ["memoryKiB 1048577", { memoryKiB: 1048577, passes: 1 }],
      ["passes 0", { memoryKiB: 8, passes: 0 }],
      ["passes 1.5", { memoryKiB: 8, passes: 1.5 }],
      ["passes 17", { memoryKiB: 8, passes: 17 }],
    ])("should throw a RangeError at the call for %s", (_name, options) => {
      expect(() => createPasswordHasher(options)).toThrow(RangeError);
    });

    it.each([
      ["the minimums", { memoryKiB: 8, passes: 1 }],
      ["the caps", { memoryKiB: 1048576, passes: 16 }],
    ])("should accept %s", (_name, options) => {
      expect(typeof createPasswordHasher(options).hash).toBe("function");
    });
  });

  describe("the maximum length", () => {
    it("should take 1024 code units", async () => {
      const hasher = cheapHasher();
      const password = "a".repeat(1024);
      const hash = await hasher.hash(password);

      await expect(hasher.compare(password, hash)).resolves.toBe(true);
    });

    it("should refuse to hash 1025 code units, and not hold them in the error", async () => {
      const serialized = await expectInvalidPassword(
        cheapHasher().hash(TOO_LONG_PASSWORD),
        "PASSWORD_TOO_LONG",
      );

      expect(serialized).not.toMatch(/a{2,}/);
    });

    it("should count code units: 512 emoji are accepted", async () => {
      const hasher = cheapHasher();
      const password = "\u{1F600}".repeat(512);
      const hash = await hasher.hash(password);

      await expect(hasher.compare(password, hash)).resolves.toBe(true);
    });

    it("should resolve false to compare 1025 code units", async () => {
      const hasher = cheapHasher();

      await expect(hasher.compare(TOO_LONG_PASSWORD, BASE_HASH)).resolves.toBe(
        false,
      );
      // The hash of that very password: a check of the length alone says no.
      await expect(
        hasher.compare(TOO_LONG_PASSWORD, TOO_LONG_PASSWORD_HASH),
      ).resolves.toBe(false);
    });

    it("should still read the hash first, on 1025 code units", async () => {
      await expectCompareUnreadable(
        cheapHasher().compare(TOO_LONG_PASSWORD, BCRYPT_HASH),
        BCRYPT_HASH,
      );
    });
  });

  describe("normalize, on a password over the maximum", () => {
    const MARKS = "̣́";

    afterEach(() => {
      vi.restoreAllMocks();
    });

    /** The strings that `normalize` was called on, among those with the marks. */
    function normalizedWithMarks(spy: {
      mock: { contexts: unknown[] };
    }): string[] {
      return spy.mock.contexts
        .map((context) => String(context))
        .filter((text) => text.includes(MARKS));
    }

    it("should not run on hash", async () => {
      const hasher = cheapHasher();
      const spy = vi.spyOn(String.prototype, "normalize");

      await expectInvalidPassword(
        hasher.hash("x" + MARKS.repeat(50000)),
        "PASSWORD_TOO_LONG",
      );

      expect(normalizedWithMarks(spy)).toEqual([]);
    });

    it("should not run on compare", async () => {
      const hasher = cheapHasher();
      const spy = vi.spyOn(String.prototype, "normalize");

      await expect(
        hasher.compare("x" + MARKS.repeat(50000), BASE_HASH),
      ).resolves.toBe(false);

      expect(normalizedWithMarks(spy)).toEqual([]);
    });

    // Shows that the spy sees the calls: without it, the two cases above pass
    // on a `normalize` that the implementation reached in another way.
    it("should run on a password under the maximum", async () => {
      const hasher = cheapHasher();
      const spy = vi.spyOn(String.prototype, "normalize");

      await hasher.hash("x" + MARKS);

      expect(normalizedWithMarks(spy)).toContain("x" + MARKS);
      expect(spy).toHaveBeenCalledWith("NFC");
    });
  });
});
