import { describe, expect, it } from "vitest";
import { BaseError } from "~/index";

// BaseError is abstract: every case goes through a concrete subclass.
class TestError extends BaseError {
  override readonly name = "TestError";
}

class ParentError extends BaseError {
  // Typed `string` so that a subclass can declare its own name.
  override readonly name: string = "ParentError";
}

class ChildError extends ParentError {
  override readonly name = "ChildError";
}

class RateLimitedError extends BaseError {
  override readonly name = "RateLimitedError";
  readonly retryAfterSeconds = 30;
}

const firstLineOf = (stack: string | undefined): string | undefined =>
  stack?.split("\n")[0];

describe("BaseError", () => {
  it("is an Error and a BaseError carrying the given message", () => {
    const error = new TestError("something went wrong", { code: "TEST" });

    expect(error).toBeInstanceOf(Error);
    expect(error).toBeInstanceOf(BaseError);
    expect(error).toBeInstanceOf(TestError);
    expect(error.message).toBe("something went wrong");
  });

  it("reports the name its subclass declares, as an own property", () => {
    const error = new TestError("something went wrong", { code: "TEST" });

    expect(error.name).toBe("TestError");
    expect(Object.hasOwn(error, "name")).toBe(true);
  });

  it("starts the stack with '<name>: <message>'", () => {
    const error = new TestError("something went wrong", { code: "TEST" });

    expect(firstLineOf(error.stack)).toBe("TestError: something went wrong");
  });

  it("leaves the constructor frames out of the stack", () => {
    const error = new TestError("something went wrong", { code: "TEST" });

    expect(error.stack).toEqual(expect.any(String));
    expect(error.stack).not.toContain("new TestError");
    expect(error.stack).not.toContain("new BaseError");
    // The frame that created the error is still there.
    expect(error.stack).toContain("base-error.test.ts");
  });

  it("reports the most derived name when a subclass redeclares it", () => {
    const error = new ChildError("something went wrong", { code: "TEST" });

    expect(error).toBeInstanceOf(ParentError);
    expect(error.name).toBe("ChildError");
    expect(firstLineOf(error.stack)).toBe("ChildError: something went wrong");
    expect(error.stack).not.toContain("new ChildError");
    expect(error.stack).not.toContain("new ParentError");
  });

  it("keeps the given code and details", () => {
    const error = new TestError("something went wrong", {
      code: "TEST",
      details: { key: "value", attempts: 3 },
    });

    expect(error.code).toBe("TEST");
    expect(error.details).toEqual({ key: "value", attempts: 3 });
  });

  it("leaves details undefined when omitted", () => {
    const error = new TestError("something went wrong", { code: "TEST" });

    expect(error.details).toBeUndefined();
  });

  it("propagates the cause", () => {
    const cause = new Error("root cause");
    const error = new TestError("something went wrong", {
      code: "TEST",
      cause,
    });

    expect(error.cause).toBe(cause);
  });

  it("keeps an empty code instead of dropping it as falsy", () => {
    const error = new TestError("something went wrong", { code: "" });

    expect(error.code).toBe("");
  });
});

describe("BaseError#toJSON", () => {
  it("has name, message, stack, code, details and the fields a subclass adds", () => {
    const error = new RateLimitedError("slow down", {
      code: "RATE_LIMITED",
      details: { limit: 10 },
    });

    expect(error.toJSON()).toEqual({
      code: "RATE_LIMITED",
      details: { limit: 10 },
      retryAfterSeconds: 30,
      name: "RateLimitedError",
      message: "slow down",
      stack: error.stack,
    });
  });

  it("has no details key and no cause key when they are omitted", () => {
    const json = new TestError("something went wrong", {
      code: "TEST",
    }).toJSON();

    expect(Object.keys(json)).not.toContain("details");
    expect(Object.keys(json)).not.toContain("cause");
  });

  it("has no details key and no cause key when they are undefined", () => {
    const json = new TestError("something went wrong", {
      code: "TEST",
      details: undefined,
      cause: undefined,
    }).toJSON();

    expect(Object.keys(json)).not.toContain("details");
    expect(Object.keys(json)).not.toContain("cause");
  });

  it("has no stack key when the stack is undefined", () => {
    const error = new TestError("something went wrong", { code: "TEST" });
    error.stack = undefined;

    expect(Object.keys(error.toJSON())).not.toContain("stack");
  });

  it("serializes a plain Error cause to its name, message and stack", () => {
    const cause = new TypeError("connection refused");
    const json = new TestError("request failed", {
      code: "TEST",
      cause,
    }).toJSON();

    expect(json.cause).toEqual({
      name: "TypeError",
      message: "connection refused",
      stack: cause.stack,
    });
  });

  it("keeps the own enumerable fields of a plain Error cause", () => {
    const cause = Object.assign(new Error("connect ECONNREFUSED"), {
      code: "ECONNREFUSED",
      errno: -111,
    });
    const json = new TestError("request failed", {
      code: "TEST",
      cause,
    }).toJSON();

    expect(json.cause).toEqual({
      code: "ECONNREFUSED",
      errno: -111,
      name: "Error",
      message: "connect ECONNREFUSED",
      stack: cause.stack,
    });
  });

  it("serializes a BaseError cause to its own toJSON shape, code included", () => {
    const cause = new RateLimitedError("slow down", {
      code: "RATE_LIMITED",
      details: { limit: 10 },
    });
    const json = new TestError("request failed", {
      code: "TEST",
      cause,
    }).toJSON();

    expect(json.cause).toEqual(cause.toJSON());
    expect(json.cause).toEqual({
      code: "RATE_LIMITED",
      details: { limit: 10 },
      retryAfterSeconds: 30,
      name: "RateLimitedError",
      message: "slow down",
      stack: cause.stack,
    });
  });

  it("serializes a chain of three causes to the end", () => {
    const third = new Error("disk full");
    const second = new TestError("write failed", {
      code: "WRITE_FAILED",
      cause: third,
    });
    const first = new Error("save failed", { cause: second });
    const error = new TestError("request failed", {
      code: "TEST",
      cause: first,
    });

    expect(error.toJSON().cause).toEqual({
      name: "Error",
      message: "save failed",
      stack: first.stack,
      cause: {
        code: "WRITE_FAILED",
        name: "TestError",
        message: "write failed",
        stack: second.stack,
        cause: {
          name: "Error",
          message: "disk full",
          stack: third.stack,
        },
      },
    });
  });

  it("keeps a cause that is not an Error as is", () => {
    const objectCause = { status: 503 };

    expect(
      new TestError("request failed", {
        code: "TEST",
        cause: "timeout",
      }).toJSON().cause,
    ).toBe("timeout");
    expect(
      new TestError("request failed", {
        code: "TEST",
        cause: objectCause,
      }).toJSON().cause,
    ).toBe(objectCause);
  });

  it("keeps a null cause, which is not undefined", () => {
    const json = new TestError("request failed", {
      code: "TEST",
      cause: null,
    }).toJSON();

    expect(Object.keys(json)).toContain("cause");
    expect(json.cause).toBeNull();
  });

  it("replaces a cycle back to the error with '[Circular]' without throwing", () => {
    const root = new Error("root");
    const error = new TestError("request failed", {
      code: "TEST",
      cause: root,
    });
    root.cause = error;

    expect(() => error.toJSON()).not.toThrow();
    expect(error.toJSON().cause).toEqual({
      name: "Error",
      message: "root",
      stack: root.stack,
      cause: "[Circular]",
    });
    expect(() => JSON.stringify(error)).not.toThrow();
  });

  it("replaces a cause that is its own cause with '[Circular]'", () => {
    const loop = new Error("loop");
    loop.cause = loop;
    const error = new TestError("request failed", {
      code: "TEST",
      cause: loop,
    });

    expect(error.toJSON().cause).toEqual({
      name: "Error",
      message: "loop",
      stack: loop.stack,
      cause: "[Circular]",
    });
  });

  it("keeps message, stack and cause when nested in a serialized object (issue 1)", () => {
    const cause = new Error("connection refused");
    const error = new TestError("request failed", {
      code: "REQUEST_FAILED",
      cause,
    });

    const logged: unknown = JSON.parse(JSON.stringify({ error }));

    expect(logged).toMatchObject({
      error: {
        name: "TestError",
        code: "REQUEST_FAILED",
        message: "request failed",
        stack: error.stack,
        cause: { message: "connection refused" },
      },
    });
  });
});
