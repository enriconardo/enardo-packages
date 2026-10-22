import { afterEach, describe, expect, it } from "vitest";
import { createEnv } from "~/index";

describe("createEnv on process.env", () => {
  afterEach(() => {
    delete process.env.ENARDO_ENV_TEST;
  });

  it("reads a variable set on process.env after createEnv", () => {
    const env = createEnv(process.env);

    expect(env.string("ENARDO_ENV_TEST")).toBeUndefined();

    process.env.ENARDO_ENV_TEST = "3000";

    expect(env.string("ENARDO_ENV_TEST")).toBe("3000");
    expect(env.requireNumber("ENARDO_ENV_TEST")).toBe(3000);
  });
});
