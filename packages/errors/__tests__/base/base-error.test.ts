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

  it("reports the most derived name when a subclass redeclares it", () => {
    const error = new ChildError("something went wrong", { code: "TEST" });

    expect(error).toBeInstanceOf(ParentError);
    expect(error.name).toBe("ChildError");
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

  it("keeps the errors of an AggregateError cause, serialized in order", () => {
    const a = new Error("a");
    const b = new Error("b");
    const cause = Object.assign(new AggregateError([a, b], ""), {
      code: "ECONNREFUSED",
    });
    const json = new TestError("request failed", {
      code: "TEST",
      cause,
    }).toJSON();

    expect(json.cause).toEqual({
      code: "ECONNREFUSED",
      name: "AggregateError",
      message: "",
      stack: cause.stack,
      errors: [
        { name: "Error", message: "a", stack: a.stack },
        { name: "Error", message: "b", stack: b.stack },
      ],
    });
  });

  it("serializes a BaseError element of errors with its code and its cause", () => {
    const inner = new Error("disk full");
    const element = new TestError("write failed", {
      code: "WRITE_FAILED",
      cause: inner,
    });
    const cause = new AggregateError([element], "");
    const json = new TestError("request failed", {
      code: "TEST",
      cause,
    }).toJSON();

    expect(json.cause).toEqual({
      name: "AggregateError",
      message: "",
      stack: cause.stack,
      errors: [
        {
          code: "WRITE_FAILED",
          name: "TestError",
          message: "write failed",
          stack: element.stack,
          cause: { name: "Error", message: "disk full", stack: inner.stack },
        },
      ],
    });
  });

  it("keeps an element of errors that is not an Error as is", () => {
    const a = new Error("a");
    const objectElement = { x: 1 };
    const cause = new AggregateError([a, "b", objectElement, null], "");
    const json = new TestError("request failed", {
      code: "TEST",
      cause,
    }).toJSON();

    expect(json.cause).toEqual({
      name: "AggregateError",
      message: "",
      stack: cause.stack,
      errors: [
        { name: "Error", message: "a", stack: a.stack },
        "b",
        { x: 1 },
        null,
      ],
    });
    const errors = (json.cause as { errors: unknown[] }).errors;
    expect(errors[2]).toBe(objectElement);
  });

  it("keeps an empty errors of an AggregateError", () => {
    const cause = new AggregateError([], "");
    const json = new TestError("request failed", {
      code: "TEST",
      cause,
    }).toJSON();

    expect(json.cause).toEqual({
      name: "AggregateError",
      message: "",
      stack: cause.stack,
      errors: [],
    });
  });

  it("replaces an AggregateError holding itself in errors with '[Circular]'", () => {
    const a = new Error("a");
    const cause = new AggregateError([a], "");
    cause.errors.push(cause);
    const error = new TestError("request failed", { code: "TEST", cause });

    expect(() => error.toJSON()).not.toThrow();
    expect(error.toJSON().cause).toEqual({
      name: "AggregateError",
      message: "",
      stack: cause.stack,
      errors: [{ name: "Error", message: "a", stack: a.stack }, "[Circular]"],
    });
  });

  it("replaces the wrapping BaseError in errors with '[Circular]'", () => {
    const cause = new AggregateError([], "");
    const error = new TestError("request failed", { code: "TEST", cause });
    cause.errors.push(error);

    expect(() => error.toJSON()).not.toThrow();
    expect(error.toJSON().cause).toEqual({
      name: "AggregateError",
      message: "",
      stack: cause.stack,
      errors: ["[Circular]"],
    });
  });

  it("serializes the same Error twice in errors at both places", () => {
    const repeated = new Error("refused");
    const cause = new AggregateError([repeated, repeated], "");
    const json = new TestError("request failed", {
      code: "TEST",
      cause,
    }).toJSON();

    const serialized = {
      name: "Error",
      message: "refused",
      stack: repeated.stack,
    };
    expect(json.cause).toEqual({
      name: "AggregateError",
      message: "",
      stack: cause.stack,
      errors: [serialized, serialized],
    });
  });

  it("serializes an Error both in errors and as the cause at both places, errors before cause", () => {
    const shared = new Error("refused");
    const cause = new AggregateError([shared], "", { cause: shared });
    const json = new TestError("request failed", {
      code: "TEST",
      cause,
    }).toJSON();

    const serialized = {
      name: "Error",
      message: "refused",
      stack: shared.stack,
    };
    expect(json.cause).toEqual({
      name: "AggregateError",
      message: "",
      stack: cause.stack,
      errors: [serialized],
      cause: serialized,
    });
    expect(Object.keys(json.cause as object)).toEqual([
      "name",
      "message",
      "stack",
      "errors",
      "cause",
    ]);
  });

  it("keeps an errors replaced by a value that is not an array as is", () => {
    const cause = new AggregateError([new Error("a")], "");
    Reflect.set(cause, "errors", "x");
    const json = new TestError("request failed", {
      code: "TEST",
      cause,
    }).toJSON();

    expect(json.cause).toEqual({
      name: "AggregateError",
      message: "",
      stack: cause.stack,
      errors: "x",
    });
  });

  it("has no errors key for a plain Error cause", () => {
    const json = new TestError("request failed", {
      code: "TEST",
      cause: new Error("connection refused"),
    }).toJSON();

    expect(Object.keys(json.cause as object)).not.toContain("errors");
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
