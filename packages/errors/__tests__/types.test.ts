import { describe, expect, expectTypeOf, it } from "vitest";
import { BaseError, isBaseErrorLike } from "~/index";
import type {
  BaseErrorLike,
  BaseErrorOptions,
  ErrorDetails,
  SerializedError,
} from "~/index";

// These tests are enforced by `tsc --noEmit`: the `@ts-expect-error` lines
// must not compile. Constructions go through `compileOnly`, so the compiler
// checks them but they never run.

/** Hands `construct` to the compiler without running it. */
const compileOnly = (construct: () => unknown): void => {
  expectTypeOf(construct).toBeFunction();
};

class TestError extends BaseError {
  override readonly name = "TestError";
}

// The narrowing pattern of the spec: `declare` narrows the inherited types.
class DuplicateEntityError extends BaseError {
  override readonly name = "DuplicateEntityError";
  declare readonly code: "DUPLICATE_ENTITY";
  declare readonly details: { readonly key: string };

  constructor(key: string, options?: Pick<BaseErrorOptions, "cause">) {
    super(`An entity with identity "${key}" is already tracked.`, {
      ...options,
      code: "DUPLICATE_ENTITY",
      details: { key },
    });
  }
}

describe("BaseError types", () => {
  it("rejects instantiating BaseError: the class is abstract", () => {
    // @ts-expect-error BaseError is abstract
    compileOnly(() => new BaseError("message", { code: "CODE" }));
  });

  it("rejects a concrete subclass that does not declare name", () => {
    // @ts-expect-error a concrete subclass must declare its name
    class NamelessError extends BaseError {}

    compileOnly(() => new NamelessError("message", { code: "CODE" }));
  });

  it("accepts a code, with optional details and cause", () => {
    compileOnly(() => new TestError("message", { code: "CODE" }));
    compileOnly(
      () =>
        new TestError("message", {
          code: "CODE",
          details: { key: "value" },
          cause: new Error("root cause"),
        }),
    );

    expectTypeOf<BaseErrorOptions>()
      .toHaveProperty("code")
      .toEqualTypeOf<string>();
    expectTypeOf<BaseErrorOptions["details"]>().toEqualTypeOf<
      ErrorDetails | undefined
    >();
    expectTypeOf<BaseErrorOptions["cause"]>().toEqualTypeOf<unknown>();
  });

  it("rejects options without a code", () => {
    // @ts-expect-error code is required
    compileOnly(() => new TestError("message", {}));
    // @ts-expect-error the options carry the code, so they are required
    compileOnly(() => new TestError("message"));
  });

  it("rejects name in the options", () => {
    compileOnly(
      () =>
        new TestError("message", {
          code: "CODE",
          // @ts-expect-error the name is declared by the class, not passed
          name: "OtherError",
        }),
    );

    expectTypeOf<BaseErrorOptions>().not.toHaveProperty("name");
  });

  it("rejects a string and an array as details", () => {
    compileOnly(
      () =>
        new TestError("message", {
          code: "CODE",
          // @ts-expect-error details is an object, not a string
          details: "extra info",
        }),
    );
    compileOnly(
      () =>
        new TestError("message", {
          code: "CODE",
          // @ts-expect-error details is an object, not an array
          details: ["one", "two"],
        }),
    );

    expectTypeOf<ErrorDetails>().toEqualTypeOf<
      Readonly<Record<string, unknown>>
    >();
  });

  it("makes name, code and details readonly", () => {
    const error: BaseError = new TestError("message", { code: "CODE" });

    compileOnly(() => {
      // @ts-expect-error name is readonly
      error.name = "OtherError";
      // @ts-expect-error code is readonly
      error.code = "OTHER_CODE";
      // @ts-expect-error details is readonly
      error.details = { key: "other" };
    });
  });

  it("types code as string, not any, after instanceof on an unknown", () => {
    const reached: string[] = [];

    const inspect = (error: unknown) => {
      if (error instanceof BaseError) {
        expectTypeOf(error.code).toEqualTypeOf<string>();
        expectTypeOf(error.details).toEqualTypeOf<ErrorDetails | undefined>();
        reached.push("BaseError");
      }
    };

    inspect(new TestError("message", { code: "CODE" }));

    expect(reached).toEqual(["BaseError"]);
  });

  it("narrows code and details with declare readonly, and keeps a literal name", () => {
    const cause = new Error("root cause");
    const error = new DuplicateEntityError("user-1", { cause });

    // Read in type position: a readonly field initialized with a literal has a
    // widening literal type, which `expectTypeOf(error.name)` would widen.
    expectTypeOf<
      DuplicateEntityError["name"]
    >().toEqualTypeOf<"DuplicateEntityError">();
    expectTypeOf(error.code).toEqualTypeOf<"DUPLICATE_ENTITY">();
    expectTypeOf(error.details).toEqualTypeOf<{ readonly key: string }>();

    // `declare` emits nothing: the values set by the base constructor survive.
    expect(error.name).toBe("DuplicateEntityError");
    expect(error.code).toBe("DUPLICATE_ENTITY");
    expect(error.details).toEqual({ key: "user-1" });
    expect(error.cause).toBe(cause);
  });

  it("types toJSON as returning a SerializedError", () => {
    const error = new TestError("message", { code: "CODE" });

    expectTypeOf(error.toJSON()).toEqualTypeOf<SerializedError>();
    expectTypeOf<SerializedError>().toEqualTypeOf<{
      readonly name: string;
      readonly message: string;
      readonly stack?: string;
      readonly cause?: unknown;
      readonly [key: string]: unknown;
    }>();
  });
});

describe("isBaseErrorLike types", () => {
  it("narrows an unknown to BaseErrorLike, with code exactly string and no toJSON", () => {
    const reached: string[] = [];

    const inspect = (value: unknown) => {
      if (isBaseErrorLike(value)) {
        expectTypeOf(value).toEqualTypeOf<BaseErrorLike>();
        expectTypeOf(value.code).toEqualTypeOf<string>();
        expectTypeOf(value.details).toEqualTypeOf<ErrorDetails | undefined>();
        compileOnly(
          // @ts-expect-error the guard proves the shape: BaseErrorLike has no toJSON
          () => value.toJSON,
        );
        reached.push("BaseErrorLike");
      }
    };

    inspect(new TestError("message", { code: "CODE" }));

    expect(reached).toEqual(["BaseErrorLike"]);
  });

  it("accepts a BaseError subclass instance as a BaseErrorLike", () => {
    const error = new DuplicateEntityError("user-1");

    expectTypeOf(error).toExtend<BaseErrorLike>();
    expectTypeOf(
      new TestError("message", { code: "CODE" }),
    ).toExtend<BaseErrorLike>();
  });
});
