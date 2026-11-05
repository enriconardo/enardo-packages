import { describe, expect, expectTypeOf, it } from "vitest";
import * as entryPoint from "~/index";
import type { EnvReader, EnvSource } from "~/index";

describe("entry point", () => {
  it("exports exactly createEnv at runtime", () => {
    expect(Object.keys(entryPoint)).toEqual(["createEnv"]);
  });

  it("exports the public types", () => {
    // Enforced by `typecheck`: an import of a name the module does not
    // export fails, and the name resolves to `any`.
    expectTypeOf<EnvReader>().not.toBeAny();
    expectTypeOf<EnvSource>().not.toBeAny();
  });
});
