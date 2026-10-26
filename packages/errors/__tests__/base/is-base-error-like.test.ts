import { describe, expect, it } from "vitest";
import { BaseError, isBaseErrorLike } from "~/index";

// The brand's key is a contract between the majors of the package (ADR 0012,
// point 2): the tests spell it out instead of importing it.
const BRAND = Symbol.for("@enardo/errors.BaseError");

class TestError extends BaseError {
  override readonly name: string = "TestError";
}

class ChildTestError extends TestError {
  override readonly name = "ChildTestError";
}

/** A value of the ecosystem's shape, not built by `BaseError`. */
const branded = (fields: Record<string, unknown> = {}): object => ({
  [BRAND]: true,
  name: "X",
  code: "X",
  ...fields,
});

describe("isBaseErrorLike", () => {
  it("accepts an instance of a concrete subclass of BaseError", () => {
    const error = new TestError("something went wrong", { code: "TEST" });

    expect(isBaseErrorLike(error)).toBe(true);
  });

  it("accepts an instance of a subclass of a concrete subclass", () => {
    const error = new ChildTestError("something went wrong", {
      code: "TEST",
      details: { key: "value" },
    });

    expect(isBaseErrorLike(error)).toBe(true);
  });

  it("accepts a plain object with the brand under its documented key, a name and a code", () => {
    expect(isBaseErrorLike(branded())).toBe(true);
  });

  it("accepts details undefined, absent, an object or an array", () => {
    expect(isBaseErrorLike(branded({ details: undefined }))).toBe(true);
    expect(isBaseErrorLike(branded())).toBe(true);
    expect(isBaseErrorLike(branded({ details: { a: 1 } }))).toBe(true);
    expect(isBaseErrorLike(branded({ details: [] }))).toBe(true);
  });

  it("rejects a value without the brand", () => {
    const nodeError = Object.assign(new Error("connect ECONNREFUSED"), {
      name: "SystemError",
      code: "ECONNREFUSED",
    });

    expect(isBaseErrorLike(new Error("something went wrong"))).toBe(false);
    expect(isBaseErrorLike(nodeError)).toBe(false);
    expect(
      isBaseErrorLike({ name: "X", code: "X", details: { key: "value" } }),
    ).toBe(false);
  });

  it("rejects a value that is not an object", () => {
    const fn = Object.assign(() => undefined, { [BRAND]: true, code: "X" });

    expect(isBaseErrorLike(null)).toBe(false);
    expect(isBaseErrorLike(undefined)).toBe(false);
    expect(isBaseErrorLike("BaseError")).toBe(false);
    expect(isBaseErrorLike(42)).toBe(false);
    // A function has a string `name` of its own: only its type rules it out.
    expect(fn.name).toEqual(expect.any(String));
    expect(isBaseErrorLike(fn)).toBe(false);
  });

  it("rejects a brand whose value is not true", () => {
    expect(isBaseErrorLike(branded({ [BRAND]: 1 }))).toBe(false);
    expect(isBaseErrorLike(branded({ [BRAND]: "true" }))).toBe(false);
  });

  it("rejects the brand with a wrong shape", () => {
    const withoutCode = { [BRAND]: true, name: "X" };

    expect(isBaseErrorLike(branded({ code: 42 }))).toBe(false);
    expect(isBaseErrorLike(withoutCode)).toBe(false);
    expect(isBaseErrorLike(branded({ name: 42 }))).toBe(false);
    expect(isBaseErrorLike(branded({ details: null }))).toBe(false);
    expect(isBaseErrorLike(branded({ details: "extra info" }))).toBe(false);
  });

  it("returns false, without throwing, when a read throws", () => {
    const { proxy, revoke } = Proxy.revocable(branded(), {});
    revoke();
    const throwingCode = {
      [BRAND]: true,
      name: "X",
      get code(): string {
        throw new Error("code getter");
      },
    };

    expect(isBaseErrorLike(proxy)).toBe(false);
    expect(isBaseErrorLike(throwingCode)).toBe(false);
  });
});

describe("BaseError's brand", () => {
  it("sits on BaseError.prototype, true, non-writable, non-enumerable, non-configurable", () => {
    expect(Object.getOwnPropertyDescriptor(BaseError.prototype, BRAND)).toEqual(
      {
        value: true,
        writable: false,
        enumerable: false,
        configurable: false,
      },
    );
  });

  it("is not an own key of an instance, nor in its serialized forms", () => {
    const error = new TestError("something went wrong", {
      code: "TEST",
      details: { key: "value" },
      cause: new Error("root cause"),
    });

    expect(Object.getOwnPropertySymbols(error)).toEqual([]);
    expect(Object.getOwnPropertySymbols(error.toJSON())).toEqual([]);
    expect(JSON.stringify(error)).not.toContain("@enardo/errors");
  });
});
