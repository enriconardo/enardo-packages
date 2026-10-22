import { describe, expect, expectTypeOf, it } from "vitest";
import { createEnv, EnvMalformedError, EnvMissingError } from "~/index";

// These tests run on Node and in browsers: no `process` here. A test that
// needs `process.env` goes in create-env.node.test.ts.

/** Hands `run` to the compiler without running it. */
const compileOnly = (run: () => unknown): void => {
  expectTypeOf(run).toBeFunction();
};

/** Runs `run` and returns what it throws; fails the test if it returns. */
const thrownBy = (run: () => unknown): unknown => {
  try {
    run();
  } catch (error) {
    return error;
  }
  throw new Error("expected the call to throw, it returned");
};

const expectMalformed = (
  run: () => unknown,
  key: string,
  expected: "string" | "number" | "boolean",
): void => {
  const error = thrownBy(run);

  expect(error).toBeInstanceOf(EnvMalformedError);
  expect(error).not.toBeInstanceOf(EnvMissingError);
  expect((error as EnvMalformedError).code).toBe("ENV_MALFORMED");
  expect((error as EnvMalformedError).details).toEqual({ key, expected });
};

const expectMissing = (run: () => unknown, key: string): void => {
  const error = thrownBy(run);

  expect(error).toBeInstanceOf(EnvMissingError);
  expect(error).not.toBeInstanceOf(EnvMalformedError);
  expect((error as EnvMissingError).code).toBe("ENV_MISSING");
  expect((error as EnvMissingError).details).toEqual({ key });
};

/** The sources on which `A` is unset. */
const UNSET_SOURCES: readonly (readonly [string, Record<string, unknown>])[] = [
  ["{}", {}],
  ['{ A: "" }', { A: "" }],
  ["{ A: undefined }", { A: undefined }],
];

describe("createEnv", () => {
  describe("reading", () => {
    it("returns the string value of a key", () => {
      expect(createEnv({ A: "abc" }).string("A")).toBe("abc");
    });

    it.each(UNSET_SOURCES)("returns undefined on %s", (_, source) => {
      expect(createEnv(source).string("A")).toBeUndefined();
    });

    it("returns a blank string as it is, untrimmed", () => {
      expect(createEnv({ A: " " }).string("A")).toBe(" ");
    });

    it("does not read a key of Object.prototype", () => {
      expect(createEnv({}).string("toString")).toBeUndefined();
    });

    it("does not read an inherited key", () => {
      const source = Object.create({ A: "x" }) as Record<string, unknown>;

      expect(createEnv(source).string("A")).toBeUndefined();
    });

    it("reads an own key of an object with a null prototype", () => {
      const source = Object.assign(
        Object.create(null) as Record<string, unknown>,
        { A: "x" },
      );

      expect(createEnv(source).string("A")).toBe("x");
    });

    it("reads the source at each call, not a copy", () => {
      const source: Record<string, unknown> = { A: "1" };
      const reader = createEnv(source);

      source.A = "2";

      expect(reader.string("A")).toBe("2");
    });

    it("propagates the very error a getter of the source throws", () => {
      const boom = new RangeError("boom");
      const source = Object.defineProperty({}, "A", {
        enumerable: true,
        get(): never {
          throw boom;
        },
      }) as Record<string, unknown>;

      expect(thrownBy(() => createEnv(source).string("A"))).toBe(boom);
    });
  });

  describe("string", () => {
    it("throws EnvMalformedError on a boolean, as Vite's DEV", () => {
      expectMalformed(
        () => createEnv({ DEV: true }).string("DEV"),
        "DEV",
        "string",
      );
    });

    it.each([
      ["a number", 1],
      ["null", null],
      ["an object", {}],
    ])("throws EnvMalformedError on %s", (_, value) => {
      expectMalformed(() => createEnv({ A: value }).string("A"), "A", "string");
    });
  });

  describe("number", () => {
    it.each([
      ["3000", 3000],
      ["-1.5", -1.5],
      ["+2", 2],
      [".5", 0.5],
      ["5.", 5],
      ["1e3", 1000],
      ["1E-2", 0.01],
      ["007", 7],
      ["0", 0],
    ])("reads %j as %d", (value, expected) => {
      expect(createEnv({ A: value }).number("A")).toBe(expected);
    });

    it.each([3, -1.5, 0])("returns the finite number %d as it is", (value) => {
      expect(createEnv({ A: value }).number("A")).toBe(value);
    });

    it.each([
      " 1",
      "1 ",
      "0x10",
      "0b1",
      "0o7",
      "1_000",
      "Infinity",
      "-Infinity",
      "NaN",
      "1e999",
      "abc",
      "1.2.3",
      "e3",
      ".",
      "+",
      "1e",
    ])("throws EnvMalformedError on the string %j", (value) => {
      expectMalformed(() => createEnv({ A: value }).number("A"), "A", "number");
    });

    it.each([
      ["NaN", Number.NaN],
      ["Infinity", Number.POSITIVE_INFINITY],
      ["true", true],
      ["null", null],
      ["an object", {}],
    ])("throws EnvMalformedError on the value %s", (_, value) => {
      expectMalformed(() => createEnv({ A: value }).number("A"), "A", "number");
    });

    it.each(UNSET_SOURCES)("returns undefined on %s", (_, source) => {
      expect(createEnv(source).number("A")).toBeUndefined();
    });
  });

  describe("bool", () => {
    it.each(["true", "TRUE", "1", "yes", "Yes"])(
      "reads %j as true",
      (value) => {
        expect(createEnv({ A: value }).bool("A")).toBe(true);
      },
    );

    it.each(["false", "False", "0", "no", "NO"])(
      "reads %j as false",
      (value) => {
        expect(createEnv({ A: value }).bool("A")).toBe(false);
      },
    );

    it.each([true, false])("returns the boolean %s as it is", (value) => {
      expect(createEnv({ A: value }).bool("A")).toBe(value);
    });

    it.each([" true", "true ", "on", "2", "y"])(
      "throws EnvMalformedError on the string %j",
      (value) => {
        expectMalformed(
          () => createEnv({ A: value }).bool("A"),
          "A",
          "boolean",
        );
      },
    );

    it.each([
      ["1", 1],
      ["null", null],
    ])("throws EnvMalformedError on the value %s", (_, value) => {
      expectMalformed(() => createEnv({ A: value }).bool("A"), "A", "boolean");
    });

    it.each(UNSET_SOURCES)("returns undefined on %s", (_, source) => {
      expect(createEnv(source).bool("A")).toBeUndefined();
    });
  });

  describe("required", () => {
    const REQUIRE_METHODS = [
      "requireString",
      "requireNumber",
      "requireBool",
    ] as const;

    describe.each(REQUIRE_METHODS)("%s", (method) => {
      it.each(UNSET_SOURCES)("throws EnvMissingError on %s", (_, source) => {
        expectMissing(() => createEnv(source)[method]("A"), "A");
      });
    });

    it("requireString throws EnvMalformedError, not EnvMissingError, on a number", () => {
      expectMalformed(
        () => createEnv({ A: 1 }).requireString("A"),
        "A",
        "string",
      );
    });

    it("requireNumber throws EnvMalformedError, not EnvMissingError, on a malformed string", () => {
      expectMalformed(
        () => createEnv({ A: "x" }).requireNumber("A"),
        "A",
        "number",
      );
    });

    it("requireBool throws EnvMalformedError, not EnvMissingError, on a malformed string", () => {
      expectMalformed(
        () => createEnv({ A: "x" }).requireBool("A"),
        "A",
        "boolean",
      );
    });

    it("returns a falsy value, which is not missing", () => {
      expect(createEnv({ A: "false" }).requireBool("A")).toBe(false);
      expect(createEnv({ A: false }).requireBool("A")).toBe(false);
      expect(createEnv({ A: "0" }).requireNumber("A")).toBe(0);
      expect(createEnv({ A: " " }).requireString("A")).toBe(" ");
    });

    it("returns a present value", () => {
      expect(createEnv({ A: "abc" }).requireString("A")).toBe("abc");
      expect(createEnv({ A: "3000" }).requireNumber("A")).toBe(3000);
      expect(createEnv({ A: "yes" }).requireBool("A")).toBe(true);
    });
  });

  describe("types", () => {
    it("types the optional readers T | undefined and the required ones T", () => {
      const reader = createEnv({});

      expectTypeOf(reader.string).returns.toEqualTypeOf<string | undefined>();
      expectTypeOf(reader.number).returns.toEqualTypeOf<number | undefined>();
      expectTypeOf(reader.bool).returns.toEqualTypeOf<boolean | undefined>();
      expectTypeOf(reader.requireString).returns.toEqualTypeOf<string>();
      expectTypeOf(reader.requireNumber).returns.toEqualTypeOf<number>();
      expectTypeOf(reader.requireBool).returns.toEqualTypeOf<boolean>();
    });

    it("requires a source", () => {
      compileOnly(() => {
        // @ts-expect-error the source has no default
        createEnv();
      });
    });

    it("accepts a source with an index signature, as process.env and Vite's ImportMetaEnv", () => {
      // The shapes of `process.env` and of Vite's `ImportMetaEnv`, augmented
      // as an app does, without depending on their types.
      type ProcessEnvLike = Record<string, string | undefined>;
      interface ImportMetaEnvLike {
        [key: string]: unknown;
        readonly BASE_URL: string;
        readonly DEV: boolean;
        readonly VITE_API_URL: string;
      }
      const processEnv: ProcessEnvLike = {};
      const importMetaEnv: ImportMetaEnvLike = {
        BASE_URL: "/",
        DEV: true,
        VITE_API_URL: "http://localhost",
      };

      expect(createEnv(processEnv).string("A")).toBeUndefined();
      expect(createEnv(importMetaEnv).bool("DEV")).toBe(true);
    });

    it("refuses an interface without an index signature", () => {
      interface Narrow {
        readonly A: string;
      }
      const narrow: Narrow = { A: "x" };

      compileOnly(() => {
        // @ts-expect-error an interface has no implicit index signature
        createEnv(narrow);
      });
    });
  });
});
