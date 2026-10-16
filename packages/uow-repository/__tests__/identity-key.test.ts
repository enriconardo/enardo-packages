import { describe, expect, it } from "vitest";
import { identityKeyOf } from "~/identity-key";

describe("identityKeyOf", () => {
  it("tags primitive identities by their type", () => {
    expect(identityKeyOf("1")).toBe("string:1");
    expect(identityKeyOf(1)).toBe("number:1");
    expect(identityKeyOf(1n)).toBe("bigint:1");
    expect(identityKeyOf(true)).toBe("boolean:true");
    expect(identityKeyOf(-0)).toBe("number:-0");
  });

  it("requires a custom key for object identities", () => {
    expect(() => identityKeyOf({ accountId: "account-1" })).toThrow(
      "Supply identityKey for composite identities.",
    );
  });
});
