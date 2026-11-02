import { describe, expect, it } from "vitest";
import { identityKeyOf } from "~/identity-key";
import { expectNativeError, thrownBy } from "./support/native-errors";

describe("identityKeyOf", () => {
  it("tags primitive identities by their type", () => {
    expect(identityKeyOf("1")).toBe("string:1");
    expect(identityKeyOf(1)).toBe("number:1");
    expect(identityKeyOf(1n)).toBe("bigint:1");
    expect(identityKeyOf(true)).toBe("boolean:true");
    expect(identityKeyOf(-0)).toBe("number:-0");
  });

  it.each([
    { identity: null, described: "null" },
    { identity: [], described: "an array" },
    { identity: { accountId: "account-1" }, described: "an object" },
    { identity: undefined, described: "a undefined" },
    { identity: Symbol("identity"), described: "a symbol" },
    { identity: () => "identity", described: "a function" },
  ])(
    "throws a native TypeError for $described, asking for a custom key",
    ({ identity, described }) => {
      const error = thrownBy(() => identityKeyOf(identity));

      expectNativeError(
        error,
        TypeError,
        `Cannot derive an identity key from ${described}. Supply identityKey for composite identities.`,
      );
    },
  );
});
