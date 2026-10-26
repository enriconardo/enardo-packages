import { BaseError } from "@enardo/errors";
import type { SerializedError } from "@enardo/errors";
import { describe, expect, it } from "vitest";
import { toLoggable } from "~/serialize/to-loggable";
import {
  expectKeepsProtoKey,
  expectObjectPrototypeUnpolluted,
  expectOwnProtoField,
  ownField,
  parseProtoKeyInput,
} from "../support/proto-key";

class ConnectionLostError extends BaseError {
  override readonly name = "ConnectionLostError";
}

/** A BaseError whose toJSON() marks its output, to show that it was called. */
class MarkedError extends BaseError {
  override readonly name = "MarkedError";

  override toJSON(): SerializedError {
    return { ...super.toJSON(), via: "toJSON" };
  }
}

/** Node's shape on a failed dual-stack connect: empty message, a code. */
function connectAggregate(): {
  aggregate: AggregateError;
  first: Error;
  second: Error;
} {
  const first = new Error("a");
  const second = new Error("b");
  const aggregate = Object.assign(new AggregateError([first, second], ""), {
    code: "ECONNREFUSED",
  });
  return { aggregate, first, second };
}

/** The own keys of a converted object, in order. */
function keysOf(value: unknown): string[] {
  expect(value).toBeTypeOf("object");
  return Object.keys(value ?? {});
}

/** Sets `cause` the way the `Error` constructor does: own, not enumerable. */
function setCause(error: Error, cause: unknown): void {
  Object.defineProperty(error, "cause", {
    value: cause,
    writable: true,
    enumerable: false,
    configurable: true,
  });
}

describe("toLoggable", () => {
  describe("errors", () => {
    it("converts a plain Error to its name, message and stack, with no cause key", () => {
      const error = new Error("boom");

      const result = toLoggable(error);

      expect(result).toEqual({
        name: "Error",
        message: "boom",
        stack: error.stack,
      });
      expect(result).not.toHaveProperty("cause");
    });

    it("keeps the own enumerable fields of an Error but the undefined ones, plus its name, message and stack", () => {
      const error = Object.assign(new Error("connect ECONNREFUSED"), {
        code: "ECONNREFUSED",
        errno: -111,
        syscall: undefined,
      });

      const result = toLoggable(error);

      expect(result).toEqual({
        code: "ECONNREFUSED",
        errno: -111,
        name: "Error",
        message: "connect ECONNREFUSED",
        stack: error.stack,
      });
      // toEqual ignores undefined values: check that the key itself is gone.
      expect(result).not.toHaveProperty("syscall");
    });

    it("converts a BaseError without a cause, through the plain-Error path, to the same shape as its toJSON()", () => {
      const error = new ConnectionLostError("connection lost", {
        code: "CONNECTION_LOST",
        details: { host: "db", attempts: 3 },
      });
      const expected = error.toJSON();
      // toJSON takes precedence: hide it so that the plain-Error path runs and
      // the comparison can fail.
      Object.defineProperty(error, "toJSON", { value: undefined });

      expect(toLoggable(error)).toEqual(expected);
    });

    it("converts the fields of an Error, turning a bigint stack into its decimal string", () => {
      const error = new Error("boom");
      Object.defineProperty(error, "stack", { value: 10n });

      expect(toLoggable(error)).toEqual({
        name: "Error",
        message: "boom",
        stack: "10",
      });
    });

    it("converts the whole cause chain, keeping a cause that is not an error", () => {
      const inner = new Error("query failed", { cause: "root" });
      const outer = new TypeError("request failed", { cause: inner });

      expect(toLoggable(outer)).toEqual({
        name: "TypeError",
        message: "request failed",
        stack: outer.stack,
        cause: {
          name: "Error",
          message: "query failed",
          stack: inner.stack,
          cause: "root",
        },
      });
    });

    it("replaces the loop of two errors that are each other's cause with [Circular]", () => {
      const first = new Error("first");
      const second = new Error("second", { cause: first });
      setCause(first, second);

      expect(toLoggable(first)).toEqual({
        name: "Error",
        message: "first",
        stack: first.stack,
        cause: {
          name: "Error",
          message: "second",
          stack: second.stack,
          cause: "[Circular]",
        },
      });
    });

    it("converts errors nested two levels deep in an object and in an array", () => {
      const nested = new Error("nested in an object");
      const listed = new RangeError("listed in an array");

      const result = toLoggable({
        result: { exception: nested },
        errors: [listed],
      });

      expect(result).toEqual({
        result: {
          exception: {
            name: "Error",
            message: "nested in an object",
            stack: nested.stack,
          },
        },
        errors: [
          {
            name: "RangeError",
            message: "listed in an array",
            stack: listed.stack,
          },
        ],
      });
      expect(result).not.toHaveProperty(["result", "exception", "cause"]);
      expect(result).not.toHaveProperty(["errors", 0, "cause"]);
    });

    it("replaces a back-reference from a BaseError's details to the error with [Circular]", () => {
      const details: Record<string, unknown> = { host: "db" };
      const error = new ConnectionLostError("connection lost", {
        code: "CONNECTION_LOST",
        details,
      });
      details.error = error;

      expect(toLoggable(error)).toEqual({
        code: "CONNECTION_LOST",
        details: { host: "db", error: "[Circular]" },
        name: "ConnectionLostError",
        message: "connection lost",
        stack: error.stack,
      });
    });
  });

  describe("an AggregateError", () => {
    it("keeps its errors, converted, after its code, name, message and stack", () => {
      const { aggregate, first, second } = connectAggregate();

      const result = toLoggable({ err: aggregate });

      expect(result).toEqual({
        err: {
          code: "ECONNREFUSED",
          name: "AggregateError",
          message: "",
          stack: aggregate.stack,
          errors: [
            { name: "Error", message: "a", stack: first.stack },
            { name: "Error", message: "b", stack: second.stack },
          ],
        },
      });
      expect(keysOf(ownField(result, "err")).slice(-2)).toEqual([
        "stack",
        "errors",
      ]);
    });

    it("writes its errors before its cause", () => {
      const aggregate = new AggregateError([new Error("a")], "", {
        cause: new Error("root"),
      });

      const result = toLoggable(aggregate);

      expect(keysOf(result).slice(-3)).toEqual(["stack", "errors", "cause"]);
    });

    it("converts an element that is a BaseError through its toJSON()", () => {
      const element = new MarkedError("query failed", {
        code: "QUERY_FAILED",
        cause: new Error("socket closed"),
      });
      const aggregate = new AggregateError([element], "");
      const expected = element.toJSON();

      expect(ownField(toLoggable(aggregate), "errors")).toEqual([expected]);
    });

    it("replaces an element that is the AggregateError itself with [Circular]", () => {
      const other = new Error("other");
      const aggregate = new AggregateError([other], "self");
      aggregate.errors.push(aggregate);

      expect(toLoggable(aggregate)).toEqual({
        name: "AggregateError",
        message: "self",
        stack: aggregate.stack,
        errors: [
          { name: "Error", message: "other", stack: other.stack },
          "[Circular]",
        ],
      });
    });

    it("replaces an element whose read throws with [Unserializable], keeping the other elements", () => {
      const second = new Error("b");
      const aggregate = new AggregateError([new Error("a"), second], "");
      Object.defineProperty(aggregate.errors, 0, {
        get(): never {
          throw new Error("element read failed");
        },
        enumerable: true,
      });

      expect(ownField(toLoggable(aggregate), "errors")).toEqual([
        "[Unserializable]",
        { name: "Error", message: "b", stack: second.stack },
      ]);
    });

    it("replaces errors whose getter throws with [Unserializable], keeping its name, message and stack", () => {
      const aggregate = new AggregateError([new Error("a")], "failed");
      const stack = aggregate.stack;
      Object.defineProperty(aggregate, "errors", {
        get(): never {
          throw new Error("errors read failed");
        },
      });

      expect(toLoggable(aggregate)).toEqual({
        name: "AggregateError",
        message: "failed",
        stack,
        errors: "[Unserializable]",
      });
    });

    it("gives no errors key to a plain Error", () => {
      expect(toLoggable(new Error("boom"))).not.toHaveProperty("errors");
    });

    it("converts a BaseError whose cause is an AggregateError, through the plain-Error path, to the same shape as its toJSON()", () => {
      const { aggregate } = connectAggregate();
      const error = new ConnectionLostError("connection lost", {
        code: "CONNECTION_LOST",
        cause: aggregate,
      });
      const expected = error.toJSON();
      // toJSON takes precedence: hide it so that the plain-Error path runs and
      // the comparison can fail.
      Object.defineProperty(error, "toJSON", { value: undefined });

      expect(toLoggable(error)).toEqual(expected);
    });
  });

  describe("toJSON", () => {
    it("uses the result of toJSON() instead of the object's own fields", () => {
      const value = {
        secret: "s3cr3t",
        toJSON(): Record<string, unknown> {
          return { kept: 1 };
        },
      };

      const result = toLoggable(value);

      expect(result).toEqual({ kept: 1 });
      expect(result).not.toHaveProperty("secret");
    });

    it("uses the result of toJSON() of an Error subclass instead of the plain-Error shape", () => {
      class RedactedError extends Error {
        readonly secret = "s3cr3t";

        toJSON(): Record<string, unknown> {
          return { kept: 1 };
        }
      }

      const result = toLoggable(new RedactedError("redacted"));

      expect(result).toEqual({ kept: 1 });
      expect(result).not.toHaveProperty("secret");
    });

    it("converts a Date to its ISO string", () => {
      const date = new Date("2026-10-01T08:30:00.000Z");

      expect(toLoggable(date)).toBe("2026-10-01T08:30:00.000Z");
    });
  });

  describe("cycles", () => {
    it("replaces an object that contains itself with [Circular] at the cycle", () => {
      const node: Record<string, unknown> = { id: "root" };
      node.self = node;

      expect(toLoggable(node)).toEqual({ id: "root", self: "[Circular]" });
    });

    it("converts an object referenced twice without a cycle at both places", () => {
      const shared = { error: new Error("shared") };
      const converted = {
        error: { name: "Error", message: "shared", stack: shared.error.stack },
      };

      expect(toLoggable({ first: shared, second: shared })).toEqual({
        first: converted,
        second: converted,
      });
    });
  });

  describe("other values", () => {
    it("converts a bigint to its decimal string", () => {
      expect(toLoggable(10n)).toBe("10");
    });

    it.each([
      ["a string", "text"],
      ["a number", 42],
      ["a boolean", true],
      ["null", null],
    ])("keeps %s unchanged", (_label, value) => {
      expect(toLoggable(value)).toBe(value);
    });
  });

  describe("values whose conversion throws", () => {
    it("replaces a getter that throws with [Unserializable], keeping its siblings", () => {
      const value = {
        before: "kept",
        get broken(): string {
          throw new Error("getter failed");
        },
        after: "kept",
      };

      expect(toLoggable(value)).toEqual({
        before: "kept",
        broken: "[Unserializable]",
        after: "kept",
      });
    });

    it("replaces a value whose toJSON() throws with [Unserializable], keeping its siblings", () => {
      const value = {
        before: "kept",
        broken: {
          toJSON(): never {
            throw new Error("toJSON failed");
          },
        },
        after: "kept",
      };

      expect(toLoggable(value)).toEqual({
        before: "kept",
        broken: "[Unserializable]",
        after: "kept",
      });
    });

    it("replaces an array element whose read throws with [Unserializable], keeping the other elements", () => {
      const value = [1, 2, 3];
      Object.defineProperty(value, 1, {
        get(): never {
          throw new Error("element read failed");
        },
        enumerable: true,
      });

      expect(toLoggable(value)).toEqual([1, "[Unserializable]", 3]);
    });

    it("replaces the message of an Error whose message getter throws with [Unserializable], keeping its name and stack", () => {
      const error = new Error("boom");
      // Read before the getter is installed: V8 may format the stack lazily
      // from the message.
      const stack = error.stack;
      Object.defineProperty(error, "message", {
        get(): never {
          throw new Error("message read failed");
        },
      });

      expect(toLoggable(error)).toEqual({
        name: "Error",
        message: "[Unserializable]",
        stack,
      });
    });
  });

  describe("a __proto__ key", () => {
    it("keeps the own __proto__ field of an object", () => {
      expectKeepsProtoKey(toLoggable(parseProtoKeyInput()));
    });

    it("keeps the own __proto__ field of an object nested in an object", () => {
      const result = toLoggable({ body: parseProtoKeyInput() });

      expectKeepsProtoKey(ownField(result, "body"));
    });

    it("keeps the own __proto__ field of an object in an array", () => {
      const result = toLoggable({ items: [parseProtoKeyInput()] });

      expectKeepsProtoKey(ownField(ownField(result, "items"), "0"));
    });

    it("keeps the own enumerable __proto__ field of an Error next to its name, message and stack", () => {
      const error = new Error("boom");
      Object.defineProperty(error, "__proto__", {
        value: { isAdmin: true },
        writable: true,
        enumerable: true,
        configurable: true,
      });

      const result = toLoggable(error);

      expectOwnProtoField(result);
      expect(ownField(result, "name")).toBe("Error");
      expect(ownField(result, "message")).toBe("boom");
      expect(ownField(result, "stack")).toBe(error.stack);
    });
  });

  // Runs after the cases above, which convert objects with a __proto__ key.
  it("leaves Object.prototype without the fields of a converted __proto__ key", () => {
    expectObjectPrototypeUnpolluted();
  });
});
