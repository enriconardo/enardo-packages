import { describe, expect, it } from "vitest";
import { BaseError } from "~/index";

// Node only: the stack's shape is V8's. Firefox writes no '<name>: <message>'
// header and keeps the constructor frames (`BaseError@…`), WebKit writes no
// header either, and the README promises neither.
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

const firstLineOf = (stack: string | undefined): string | undefined =>
  stack?.split("\n")[0];

describe("BaseError", () => {
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
    expect(error.stack).toContain("base-error.node.test.ts");
  });

  it("starts the stack with the most derived name when a subclass redeclares it", () => {
    const error = new ChildError("something went wrong", { code: "TEST" });

    expect(firstLineOf(error.stack)).toBe("ChildError: something went wrong");
    expect(error.stack).not.toContain("new ChildError");
    expect(error.stack).not.toContain("new ParentError");
  });
});
