import { describe, expect, expectTypeOf, it } from "vitest";
import { createEnv } from "~/index";

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

/** Checks that `error` is a plain `Error`: not a subclass, not a `TypeError`. */
const expectPlainError = (error: unknown): Error => {
  expect(error).toBeInstanceOf(Error);
  expect((error as Error).constructor).toBe(Error);
  expect((error as Error).name).toBe("Error");
  return error as Error;
};

const expectMalformed = (
  run: () => unknown,
  key: string,
  expected: "string" | "number" | "boolean",
): void => {
  const error = expectPlainError(thrownBy(run));

  expect(error.message).toBe(
    `Environment variable "${key}" is not a valid ${expected}`,
  );
};

const expectMissing = (run: () => unknown, key: string): void => {
  const error = expectPlainError(thrownBy(run));

  expect(error.message).toBe(
    `Environment variable "${key}" is required but not set`,
  );
};

/** Checks that `error` carries nothing beyond a plain `Error`'s fields. */
const expectNoExtraFields = (error: unknown): void => {
  expect(Object.hasOwn(error as object, "code")).toBe(false);
  expect(Object.hasOwn(error as object, "details")).toBe(false);
  expect(Object.hasOwn(error as object, "cause")).toBe(false);
  expect("code" in (error as object)).toBe(false);
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
    it("throws a malformed Error on a boolean, as Vite's DEV", () => {
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
    ])("throws a malformed Error on %s", (_, value) => {
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
    ])("throws a malformed Error on the string %j", (value) => {
      expectMalformed(() => createEnv({ A: value }).number("A"), "A", "number");
    });

    it.each([
      ["NaN", Number.NaN],
      ["Infinity", Number.POSITIVE_INFINITY],
      ["true", true],
      ["null", null],
      ["an object", {}],
    ])("throws a malformed Error on the value %s", (_, value) => {
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
      "throws a malformed Error on the string %j",
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
    ])("throws a malformed Error on the value %s", (_, value) => {
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
      it.each(UNSET_SOURCES)("throws an unset Error on %s", (_, source) => {
        expectMissing(() => createEnv(source)[method]("A"), "A");
      });
    });

    it("requireString reports a malformed value, not an unset one, on a number", () => {
      expectMalformed(
        () => createEnv({ A: 1 }).requireString("A"),
        "A",
        "string",
      );
    });

    it("requireNumber reports a malformed value, not an unset one, on a malformed string", () => {
      expectMalformed(
        () => createEnv({ A: "x" }).requireNumber("A"),
        "A",
        "number",
      );
    });

    it("requireBool reports a malformed value, not an unset one, on a malformed string", () => {
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

  describe("errors", () => {
    it("an unset variable throws an Error with no own code, details or cause", () => {
      expectNoExtraFields(thrownBy(() => createEnv({}).requireString("A")));
    });

    it("a malformed variable throws an Error with no own code, details or cause", () => {
      expectNoExtraFields(thrownBy(() => createEnv({ A: "x" }).number("A")));
    });

    describe("never holds the value", () => {
      const SECRET = "s3cr3t-value";
      // A value that is not a string, but whose `String()` is the secret.
      const secretObject = { toString: (): string => SECRET };

      it.each([
        ["number", SECRET],
        ["requireNumber", SECRET],
        ["bool", SECRET],
        ["requireBool", SECRET],
        ["string", secretObject],
        ["requireString", secretObject],
      ] as const)("%s, in its message, stack or JSON", (method, value) => {
        const error = thrownBy(() =>
          createEnv({ A: value })[method]("A"),
        ) as Error;

        expect(error.message).not.toContain(SECRET);
        // Firefox and WebKit leave the message out of `stack`, Node and
        // Chromium hold it: the assertion bites on those two.
        expect(error.stack ?? "").not.toContain(SECRET);
        expect(JSON.stringify(error)).not.toContain(SECRET);
      });
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
