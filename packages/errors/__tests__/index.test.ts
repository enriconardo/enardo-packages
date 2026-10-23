import { describe, expect, expectTypeOf, it } from "vitest";
import * as entryPoint from "~/index";
// @ts-expect-error IBaseError is removed: every member it added was optional
import type { IBaseError } from "~/index";
// @ts-expect-error IHttpError is removed: every member it added was optional
import type { IHttpError } from "~/index";
// @ts-expect-error HttpErrorOptions is removed with the HTTP error classes
import type { HttpErrorOptions } from "~/index";

describe("entry point", () => {
  it("exports exactly BaseError and isBaseErrorLike at runtime", () => {
    expect(Object.keys(entryPoint).sort()).toEqual([
      "BaseError",
      "isBaseErrorLike",
    ]);
  });

  it("does not export IBaseError nor IHttpError", () => {
    // Enforced by `typecheck` through the `@ts-expect-error` on the imports:
    // a name the module does not export resolves to `any`.
    expectTypeOf<IBaseError>().toBeAny();
    expectTypeOf<IHttpError>().toBeAny();
  });

  it("does not export HttpErrorOptions", () => {
    // Enforced by `typecheck`, as above.
    expectTypeOf<HttpErrorOptions>().toBeAny();
  });
});
