import { describe, expect, it, vi } from "vitest";
import { BaseError, isBaseErrorLike } from "~/index";

// Node only: in browser mode vi.resetModules() does not evaluate the modules
// again, so the import below would return the same BaseError.
describe("isBaseErrorLike", () => {
  it("accepts an error built on a second copy of BaseError, which instanceof misses", async () => {
    vi.resetModules();
    const secondCopy = await import("~/index");

    class OtherCopyError extends secondCopy.BaseError {
      override readonly name = "OtherCopyError";
    }

    const error = new OtherCopyError("something went wrong", {
      code: "OTHER_COPY",
    });

    expect(secondCopy.BaseError).not.toBe(BaseError);
    expect(error instanceof BaseError).toBe(false);
    expect(isBaseErrorLike(error)).toBe(true);
  });
});
