import { describe, expect, expectTypeOf, it } from "vitest";
import { BaseError } from "@enardo/errors";
import { HttpResponseError, NetworkError } from "~/index";
import type { NetworkErrorCause } from "~/index";
import {
  MARKED_URL,
  SHAPES,
  buildError,
  buildErrorWithoutThrowing,
} from "../support/network-error";

// These tests run on Node and in browsers. A test that needs Node (V8's
// stack, util.inspect, node:vm) goes in network-error.node.test.ts.

const REDUCED_URL = "https://api.example.com/v1/users";

const MARKERS = ["alice", "hunter2", "q-secret", "frag-secret"];

/** Hands `run` to the compiler without running it. */
const compileOnly = (run: () => unknown): void => {
  expectTypeOf(run).toBeFunction();
};

/** Sets `cause` the way the `Error` constructor does: own, not enumerable. */
function setCause(error: Error, cause: unknown): void {
  Object.defineProperty(error, "cause", {
    value: cause,
    writable: true,
    enumerable: false,
    configurable: true,
  });
}

/** Makes `key` an own getter of `error` that throws. */
function defineThrowingGetter(
  error: Error,
  key: "name" | "code" | "cause",
): void {
  Object.defineProperty(error, key, {
    get(): never {
      throw new Error(`The getter of ${key} threw`);
    },
    configurable: true,
  });
}

/**
 * A chain of `length` errors, each the cause of the one before, whose codes
 * are `L1` to `L<length>` from the rejection down.
 */
function chainOfErrors(length: number): Error {
  let error = Object.assign(new Error(`link ${String(length)}`), {
    code: `L${String(length)}`,
  });
  for (let index = length - 1; index >= 1; index--) {
    error = Object.assign(
      new Error(`link ${String(index)}`, { cause: error }),
      { code: `L${String(index)}` },
    );
  }
  return error;
}

/**
 * The reduced links `L1` to `L<count>` of `chainOfErrors`: the last one has
 * no `cause` key.
 */
function linksTo(count: number): NetworkErrorCause {
  let link: NetworkErrorCause = { name: "Error", code: `L${String(count)}` };
  for (let index = count - 1; index >= 1; index--) {
    link = { name: "Error", code: `L${String(index)}`, cause: link };
  }
  return link;
}

describe("NetworkError", () => {
  it("is a NetworkError, a BaseError and an Error, and not an HttpResponseError", () => {
    const error = buildError(new TypeError("Failed to fetch"));

    expect(error).toBeInstanceOf(NetworkError);
    expect(error).toBeInstanceOf(BaseError);
    expect(error).toBeInstanceOf(Error);
    expect(error).not.toBeInstanceOf(HttpResponseError);
  });

  it("has the code NETWORK_ERROR, typed as that literal", () => {
    const error = buildError(new TypeError("Failed to fetch"));

    expect(error.code).toBe("NETWORK_ERROR");
    // Read in type position: `expectTypeOf(error.code)` would widen a literal.
    expectTypeOf<NetworkError["code"]>().toEqualTypeOf<"NETWORK_ERROR">();
  });

  it("has the method and the reduced URL in details", () => {
    const error = buildError(new TypeError("Failed to fetch"));

    expect(error.details).toEqual({ method: "POST", url: REDUCED_URL });
  });

  it("has an undefined cause when built without options", () => {
    const error = new NetworkError("POST", new URL(MARKED_URL));

    expect(error.cause).toBeUndefined();
  });

  it("lets no marker of the URL reach its JSON", () => {
    const error = buildError(new TypeError("Failed to fetch"));

    const json = JSON.stringify(error);
    for (const marker of MARKERS) {
      expect(json, marker).not.toContain(marker);
    }
  });

  describe("the cause", () => {
    it.each(SHAPES)(
      "keeps of a $shape rejection the chain of its names and string codes, as plain objects",
      ({ create, chain }) => {
        const error = buildError(create());

        expect(error.cause).toStrictEqual(chain);
      },
    );

    it.each(SHAPES)(
      "serializes the same chain in toJSON(), for a $shape rejection",
      ({ create, chain }) => {
        const error = buildError(create());

        expect(error.toJSON().cause).toStrictEqual(chain);
      },
    );

    it.each(SHAPES)(
      "is not the $shape rejection given, and no own field of the error holds it",
      ({ create }) => {
        const given = create();
        const error = buildError(given);

        expect(error.cause).not.toBe(given);
        for (const key of Reflect.ownKeys(error)) {
          expect(Reflect.get(error, key), String(key)).not.toBe(given);
        }
      },
    );

    it("leaves out the number code of a DOMException", () => {
      const error = buildError(
        new DOMException("The operation was aborted.", "AbortError"),
      );

      expect(error.cause).toStrictEqual({ name: "AbortError" });
    });

    it("leaves out a number code of an Error", () => {
      const error = buildError(Object.assign(new Error("boom"), { code: 42 }));

      expect(error.cause).toStrictEqual({ name: "Error" });
    });

    it.each<{ rejection: string; given: unknown }>([
      { rejection: "a string", given: "body-secret" },
      {
        rejection: "a plain object",
        given: {
          name: "ResponseError",
          code: "UND_ERR_RESPONSE",
          body: "body-secret",
        },
      },
      { rejection: "null", given: null },
    ])(
      "is undefined, with no cause key in toJSON(), for $rejection",
      ({ given }) => {
        const error = buildError(given);

        expect(error.cause).toBeUndefined();
        expect(error.toJSON()).not.toHaveProperty("cause");
      },
    );

    it("leaves out a non-Error deeper in the chain", () => {
      const error = buildError(
        new TypeError("fetch failed", { cause: "body-secret" }),
      );

      expect(error.cause).toStrictEqual({ name: "TypeError" });
    });

    it("ends at the first error already seen, for two errors that are each other's cause", () => {
      const first = new TypeError("first");
      const second = new RangeError("second", { cause: first });
      setCause(first, second);

      const error = buildError(first);

      expect(error.cause).toStrictEqual({
        name: "TypeError",
        cause: { name: "RangeError" },
      });
    });

    it("ends at the first error already seen, for an error that is its own cause", () => {
      const own = new TypeError("own");
      setCause(own, own);

      const error = buildError(own);

      expect(error.cause).toStrictEqual({ name: "TypeError" });
    });

    it("follows cause only, not the errors of an AggregateError", () => {
      const aggregate = Object.assign(
        new AggregateError(
          [
            Object.assign(new Error("connect ECONNREFUSED 10.0.0.1:443"), {
              code: "ECONNREFUSED",
            }),
          ],
          "connect failed",
        ),
        { code: "ECONNREFUSED" },
      );

      const error = buildError(aggregate);

      expect(error.cause).toStrictEqual({
        name: "AggregateError",
        code: "ECONNREFUSED",
      });
    });

    it("is typed as a NetworkErrorCause or undefined", () => {
      expectTypeOf<NetworkError["cause"]>().toEqualTypeOf<
        NetworkErrorCause | undefined
      >();
    });

    it("types NetworkErrorCause as a name, an optional string code and an optional cause, all readonly", () => {
      expectTypeOf<NetworkErrorCause>().toEqualTypeOf<{
        readonly name: string;
        readonly code?: string;
        readonly cause?: NetworkErrorCause;
      }>();
    });

    it("is readonly", () => {
      const error = buildError(new TypeError("Failed to fetch"));
      const other = buildError(new TypeError("Failed to fetch"));

      // The assignment takes the value of the same property of another
      // instance, so that readonly is the only error the compiler can report.
      compileOnly(() => {
        // @ts-expect-error cause is readonly
        error.cause = other.cause;
      });
    });

    // The reduction reads the rejection: a getter or a Proxy trap can throw,
    // and a read that throws counts as missing.
    describe("a read that throws", () => {
      it("leaves out a code whose getter throws", () => {
        const rejection = new TypeError("fetch failed");
        defineThrowingGetter(rejection, "code");

        const error = buildErrorWithoutThrowing(rejection);

        expect(error.cause).toStrictEqual({ name: "TypeError" });
      });

      it("gives an undefined cause for a rejection whose name getter throws", () => {
        const rejection = new Error("boom");
        defineThrowingGetter(rejection, "name");

        const error = buildErrorWithoutThrowing(rejection);

        expect(error.cause).toBeUndefined();
      });

      it("ends the chain before a cause whose name getter throws", () => {
        const cause = new Error("boom");
        defineThrowingGetter(cause, "name");

        const error = buildErrorWithoutThrowing(
          new TypeError("fetch failed", { cause }),
        );

        expect(error.cause).toStrictEqual({ name: "TypeError" });
      });

      it("ends the chain after an error whose cause getter throws", () => {
        const rejection = new TypeError("fetch failed");
        defineThrowingGetter(rejection, "cause");

        const error = buildErrorWithoutThrowing(rejection);

        expect(error.cause).toStrictEqual({ name: "TypeError" });
      });

      it("gives an undefined cause for a revoked Proxy, whose instanceof check throws", () => {
        const { proxy, revoke } = Proxy.revocable(new TypeError("x"), {});
        revoke();

        const error = buildErrorWithoutThrowing(proxy);

        expect(error.cause).toBeUndefined();
      });

      // The cases below put a second field next to the one that throws: a
      // read that throws loses that field only, not the other.

      it("still follows the cause of an error whose code getter throws", () => {
        const rejection = new TypeError("fetch failed", {
          cause: Object.assign(new Error("inner"), { code: "INNER" }),
        });
        defineThrowingGetter(rejection, "code");

        const error = buildErrorWithoutThrowing(rejection);

        expect(error.cause).toStrictEqual({
          name: "TypeError",
          cause: { name: "Error", code: "INNER" },
        });
      });

      it("still keeps the code of an error whose cause getter throws", () => {
        const rejection = Object.assign(new TypeError("fetch failed"), {
          code: "OUTER",
        });
        defineThrowingGetter(rejection, "cause");

        const error = buildErrorWithoutThrowing(rejection);

        expect(error.cause).toStrictEqual({ name: "TypeError", code: "OUTER" });
      });

      it("leaves out the code of a Proxy whose has trap throws", () => {
        const rejection = new Proxy(new TypeError("x"), {
          has(): never {
            throw new Error("has");
          },
        });
        // The premise: asking whether the rejection has a code throws.
        expect(() => "code" in rejection).toThrow("has");

        const error = buildErrorWithoutThrowing(rejection);

        expect(error.cause).toStrictEqual({ name: "TypeError" });
      });
    });

    it("ends the chain before an error whose name is not a string, and lets none of that name reach the JSON", () => {
      const cause = Object.assign(new Error("Response Error"), {
        name: { leak: "body-secret" },
      });

      const error = buildErrorWithoutThrowing(
        new TypeError("fetch failed", { cause }),
      );

      expect(error.cause).toStrictEqual({ name: "TypeError" });
      expect(JSON.stringify(error)).not.toContain("body-secret");
    });

    it("ends the chain at an error whose name is not a string, instead of skipping that link to the errors below it", () => {
      const cause = Object.assign(
        new Error("middle", {
          cause: Object.assign(new Error("deep"), { code: "DEEP" }),
        }),
        { name: 42 },
      );

      const error = buildErrorWithoutThrowing(
        new TypeError("fetch failed", { cause }),
      );

      expect(error.cause).toStrictEqual({ name: "TypeError" });
    });

    it("gives an undefined cause for a rejection whose name is undefined", () => {
      const rejection = Object.assign(new Error("boom"), { name: undefined });

      const error = buildErrorWithoutThrowing(rejection);

      expect(error.cause).toBeUndefined();
    });

    it("keeps the first 10 links of a chain of 11, L1 to L10, the tenth with no cause", () => {
      const error = buildErrorWithoutThrowing(chainOfErrors(11));

      expect(error.cause).toStrictEqual(linksTo(10));
    });

    it("keeps the first 10 links of a chain of 20,000", () => {
      const error = buildErrorWithoutThrowing(chainOfErrors(20_000));

      expect(error.cause).toStrictEqual(linksTo(10));
    });
  });
});
